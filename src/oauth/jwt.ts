/**
 * HS256 JWT minimaliste — sert à émettre les access tokens OAuth.
 *
 * On évite une dépendance npm pour rester léger. La spec JWT est simple :
 * 3 segments base64url séparés par des points, signature HMAC-SHA256 du
 * `header.payload`.
 *
 * Le secret doit être posé via `OAUTH_JWT_SECRET` en env. Si absent, on
 * dérive un secret depuis le PID + boot time : OK pour dev, pas pour prod
 * (les tokens deviendraient invalides à chaque redémarrage). En prod
 * (systemd Oracle), `OAUTH_JWT_SECRET` est obligatoire.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const SECRET = process.env.OAUTH_JWT_SECRET ?? `dev-only-${randomBytes(16).toString("hex")}`;

if (!process.env.OAUTH_JWT_SECRET) {
  console.warn(
    "⚠️  OAUTH_JWT_SECRET absent — un secret aléatoire a été généré. " +
    "Les access tokens deviendront invalides au redémarrage. " +
    "Pose un OAUTH_JWT_SECRET stable en prod."
  );
}

const TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;

interface AccessTokenClaims {
  /** Clé API Codas dont ce token est l'enveloppe OAuth. */
  apiKey: string;
  /** Issued at (epoch seconds). */
  iat: number;
  /** Expiration (epoch seconds). */
  exp: number;
}

export function signAccessToken(apiKey: string): { token: string; expiresIn: number } {
  const now = Math.floor(Date.now() / 1000);
  const claims: AccessTokenClaims = {
    apiKey,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify(claims));
  const data = `${header}.${payload}`;
  const sig = sign(data);
  return { token: `${data}.${sig}`, expiresIn: TOKEN_TTL_SECONDS };
}

/** Vérifie la signature et l'exp, renvoie la clé API extraite ou null. */
export function verifyAccessToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const expected = sign(`${header}.${payload}`);
  if (!safeEqual(sig, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as AccessTokenClaims;
    if (typeof claims.exp !== "number" || claims.exp < Math.floor(Date.now() / 1000)) return null;
    if (typeof claims.apiKey !== "string") return null;
    return claims.apiKey;
  } catch {
    return null;
  }
}

// ---------- Helpers ----------

function sign(data: string): string {
  return createHmac("sha256", SECRET).update(data).digest("base64url");
}

function b64url(s: string): string {
  return Buffer.from(s).toString("base64url");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
