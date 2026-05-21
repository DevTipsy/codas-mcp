/**
 * Stockage mémoire pour les flows OAuth en cours.
 *
 *  - `clients` — clients OAuth enregistrés via Dynamic Client Registration
 *    (RFC 7591). claude.ai, ChatGPT etc. se sont enregistrés une fois pour
 *    obtenir un client_id et leurs redirect_uris.
 *  - `codes` — codes d'autorisation à usage unique, durée de vie ~10 min,
 *    échangés contre un access_token via /oauth/token.
 *
 * Pas de DB : ces données sont éphémères. Un redémarrage du serveur perd
 * les clients enregistrés et les codes en cours — les clients se ré-
 * enregistrent automatiquement à la prochaine connexion. Les access
 * tokens (JWT signés) survivent au redémarrage car ils sont autonomes.
 */

import { randomBytes } from "node:crypto";

// ---------- Clients ----------

export interface OAuthClient {
  clientId: string;
  redirectUris: string[];
  clientName?: string;
  createdAt: number;
}

const clients = new Map<string, OAuthClient>();

export function registerClient(redirectUris: string[], clientName?: string): OAuthClient {
  const clientId = `codas-${randomBytes(16).toString("hex")}`;
  const client: OAuthClient = {
    clientId,
    redirectUris: redirectUris.length ? redirectUris : ["http://localhost"],
    clientName,
    createdAt: Date.now(),
  };
  clients.set(clientId, client);
  return client;
}

export function getClient(clientId: string): OAuthClient | undefined {
  return clients.get(clientId);
}

// ---------- Auth codes ----------

export interface AuthCode {
  code: string;
  clientId: string;
  redirectUri: string;
  /** PKCE code_challenge envoyé par le client lors du /authorize. */
  codeChallenge: string;
  /** Toujours "S256" — on refuse "plain" pour des raisons de sécurité. */
  codeChallengeMethod: "S256";
  /** Clé API Codas saisie par l'user sur la page de consentement. */
  apiKey: string;
  expiresAt: number;
}

const codes = new Map<string, AuthCode>();
const CODE_TTL_MS = 10 * 60 * 1000;

export function issueAuthCode(args: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  apiKey: string;
}): string {
  const code = randomBytes(24).toString("base64url");
  codes.set(code, {
    code,
    ...args,
    expiresAt: Date.now() + CODE_TTL_MS,
  });
  return code;
}

/** Consomme un code (usage unique). Retourne null si expiré ou absent. */
export function consumeAuthCode(code: string): AuthCode | null {
  const entry = codes.get(code);
  if (!entry) return null;
  codes.delete(code);
  if (entry.expiresAt < Date.now()) return null;
  return entry;
}

// Cleanup périodique des codes expirés (évite la fuite mémoire si beaucoup
// de flows abandonnés avant l'échange /token).
setInterval(() => {
  const now = Date.now();
  for (const [code, entry] of codes.entries()) {
    if (entry.expiresAt < now) codes.delete(code);
  }
}, 60_000).unref();
