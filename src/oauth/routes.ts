/**
 * Endpoints OAuth 2.0 pour permettre aux clients MCP (claude.ai, ChatGPT,
 * Cursor, Windsurf, etc.) d'utiliser le serveur Codas via Authorization
 * Code + PKCE flow, en plus de l'auth Bearer directe.
 *
 * Endpoints exposés :
 *   GET  /.well-known/oauth-authorization-server  → metadata RFC 8414
 *   POST /oauth/register                          → Dynamic Client Reg (RFC 7591)
 *   GET  /oauth/authorize                         → page de consentement
 *   POST /oauth/authorize                         → submit du formulaire
 *   POST /oauth/token                             → échange code → access_token
 */

import type { Express, Request, Response } from "express";
import { createHash } from "node:crypto";

import { CodasClient, CodasAPIError } from "../codasClient.js";
import {
  registerClient,
  getClient,
  issueAuthCode,
  consumeAuthCode,
} from "./store.js";
import { signAccessToken } from "./jwt.js";
import { renderConsentPage } from "./consent.js";

export function mountOAuth(app: Express, publicBaseUrl: string) {
  // ---------- Metadata ----------
  // Lu par les clients MCP au moment de leur initiation OAuth pour
  // découvrir les autres endpoints.
  app.get("/.well-known/oauth-authorization-server", (_req, res) => {
    res.json({
      issuer: publicBaseUrl,
      authorization_endpoint: `${publicBaseUrl}/oauth/authorize`,
      token_endpoint: `${publicBaseUrl}/oauth/token`,
      registration_endpoint: `${publicBaseUrl}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"], // PKCE public client
      scopes_supported: ["mcp"],
    });
  });

  // ---------- Dynamic Client Registration (RFC 7591) ----------
  app.post("/oauth/register", (req, res) => {
    const body = req.body ?? {};
    const redirectUris: string[] = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
    const clientName = typeof body.client_name === "string" ? body.client_name : undefined;

    const client = registerClient(redirectUris, clientName);
    res.status(201).json({
      client_id: client.clientId,
      client_id_issued_at: Math.floor(client.createdAt / 1000),
      redirect_uris: client.redirectUris,
      client_name: client.clientName,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  });

  // ---------- Authorize : page de consentement ----------
  app.get("/oauth/authorize", (req, res) => {
    const params = parseAuthorizeParams(req);
    if (!params.ok) {
      res.status(400).type("text/plain").send(params.error);
      return;
    }

    res.type("html").send(
      renderConsentPage({
        clientName: params.client.clientName ?? "Un client externe",
        clientId: params.client.clientId,
        redirectUri: params.redirectUri,
        state: params.state,
        codeChallenge: params.codeChallenge,
        codeChallengeMethod: params.codeChallengeMethod,
      })
    );
  });

  app.post("/oauth/authorize", async (req, res) => {
    // Les hidden fields du formulaire viennent en form-encoded ou JSON
    // selon le middleware. On accepte les deux.
    const body = (req.body ?? {}) as Record<string, string>;
    const apiKey = String(body.api_key ?? "").trim();
    const clientId = body.client_id;
    const redirectUri = body.redirect_uri;
    const state = body.state ?? "";
    const codeChallenge = body.code_challenge;
    const codeChallengeMethod = body.code_challenge_method;

    if (!clientId || !redirectUri || !codeChallenge || codeChallengeMethod !== "S256") {
      res.status(400).type("text/plain").send("Paramètres OAuth invalides.");
      return;
    }
    const client = getClient(clientId);
    if (!client || !client.redirectUris.includes(redirectUri)) {
      res.status(400).type("text/plain").send("Client inconnu ou redirect_uri non enregistré.");
      return;
    }
    if (!apiKey.startsWith("codas_pk_")) {
      res.status(400).type("html").send(
        renderConsentPage({
          clientName: client.clientName ?? "Un client externe",
          clientId,
          redirectUri,
          state,
          codeChallenge,
          codeChallengeMethod,
          errorMessage: "Format de clé invalide. Elle doit commencer par codas_pk_.",
        })
      );
      return;
    }

    // Validation de la clé contre le backend Codas (1 appel test).
    const valid = await validateApiKey(apiKey);
    if (!valid) {
      res.status(400).type("html").send(
        renderConsentPage({
          clientName: client.clientName ?? "Un client externe",
          clientId,
          redirectUri,
          state,
          codeChallenge,
          codeChallengeMethod,
          errorMessage: "Clé invalide ou révoquée. Vérifie dans l'app Codas → Profil → Clés API.",
        })
      );
      return;
    }

    const code = issueAuthCode({
      clientId,
      redirectUri,
      codeChallenge,
      codeChallengeMethod: "S256",
      apiKey,
    });

    const redirect = new URL(redirectUri);
    redirect.searchParams.set("code", code);
    if (state) redirect.searchParams.set("state", state);
    res.redirect(302, redirect.toString());
  });

  // ---------- Token : échange code → access_token ----------
  app.post("/oauth/token", (req, res) => {
    const body = (req.body ?? {}) as Record<string, string>;
    const grantType = body.grant_type;
    const code = body.code;
    const codeVerifier = body.code_verifier;
    const clientId = body.client_id;
    const redirectUri = body.redirect_uri;

    if (grantType !== "authorization_code") {
      res.status(400).json({ error: "unsupported_grant_type" });
      return;
    }
    if (!code || !codeVerifier || !clientId) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }

    const entry = consumeAuthCode(code);
    if (!entry) {
      res.status(400).json({ error: "invalid_grant", error_description: "Code expiré ou déjà utilisé." });
      return;
    }
    if (entry.clientId !== clientId || (redirectUri && entry.redirectUri !== redirectUri)) {
      res.status(400).json({ error: "invalid_grant", error_description: "Client mismatch." });
      return;
    }

    // PKCE : vérification que SHA256(code_verifier) === code_challenge
    const challenge = createHash("sha256").update(codeVerifier).digest("base64url");
    if (challenge !== entry.codeChallenge) {
      res.status(400).json({ error: "invalid_grant", error_description: "PKCE mismatch." });
      return;
    }

    const { token, expiresIn } = signAccessToken(entry.apiKey);
    res.json({
      access_token: token,
      token_type: "Bearer",
      expires_in: expiresIn,
      scope: "mcp",
    });
  });
}

// ---------- Helpers ----------

interface ParsedAuthorize {
  ok: true;
  client: { clientId: string; clientName?: string; redirectUris: string[] };
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
}

function parseAuthorizeParams(
  req: Request
): ParsedAuthorize | { ok: false; error: string } {
  const responseType = String(req.query.response_type ?? "");
  if (responseType !== "code") {
    return { ok: false, error: "response_type doit valoir 'code'." };
  }
  const clientId = String(req.query.client_id ?? "");
  const client = getClient(clientId);
  if (!client) {
    return { ok: false, error: "client_id inconnu — appelle /oauth/register d'abord." };
  }
  const redirectUri = String(req.query.redirect_uri ?? "");
  if (!client.redirectUris.includes(redirectUri)) {
    return { ok: false, error: "redirect_uri non enregistré pour ce client." };
  }
  const codeChallenge = String(req.query.code_challenge ?? "");
  const codeChallengeMethod = String(req.query.code_challenge_method ?? "");
  if (!codeChallenge || codeChallengeMethod !== "S256") {
    return { ok: false, error: "PKCE S256 obligatoire (code_challenge + code_challenge_method=S256)." };
  }
  const state = String(req.query.state ?? "");
  return {
    ok: true,
    client,
    redirectUri,
    state,
    codeChallenge,
    codeChallengeMethod: "S256",
  };
}

/**
 * Vérifie que la clé saisie par l'user est valide côté Codas en faisant
 * un appel quelconque qui demande une auth (ici /categories qui est
 * authentifié). Si on reçoit 200, la clé marche.
 */
async function validateApiKey(apiKey: string): Promise<boolean> {
  try {
    const client = new CodasClient({ apiKey });
    await client.getCategoriesMap();
    return true;
  } catch (err) {
    if (err instanceof CodasAPIError && (err.status === 401 || err.status === 403)) return false;
    // Autre erreur (réseau, serveur down) → on suppose que la clé est OK
    // plutôt que de bloquer l'user pour une raison non-auth. Si vraiment
    // mauvaise, le MCP plantera plus tard avec un meilleur message.
    return true;
  }
}
