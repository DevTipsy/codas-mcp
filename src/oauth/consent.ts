/**
 * Page de consentement OAuth — affichée à l'utilisateur quand un client
 * MCP (claude.ai, ChatGPT, Cursor…) initie une connexion via OAuth.
 *
 * Pas de framework, juste du HTML inline pour minimiser la surface
 * d'attaque et garder le build node léger. On évalue le risque XSS en
 * échappant les variables injectées.
 */

export function renderConsentPage(args: {
  clientName: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  errorMessage?: string;
}): string {
  const safe = {
    clientName: esc(args.clientName),
    clientId: esc(args.clientId),
    redirectUri: esc(args.redirectUri),
    state: esc(args.state),
    codeChallenge: esc(args.codeChallenge),
    codeChallengeMethod: esc(args.codeChallengeMethod),
    errorMessage: args.errorMessage ? esc(args.errorMessage) : "",
  };

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Autoriser ${safe.clientName} — Codas</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif;
      background: linear-gradient(135deg, #000d1a 0%, #0a1a3a 100%);
      color: #e8eef7;
      padding: 24px;
    }
    .card {
      width: 100%;
      max-width: 440px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 20px;
      padding: 36px 32px;
      backdrop-filter: blur(20px);
    }
    .logo {
      width: 56px;
      height: 56px;
      border-radius: 14px;
      background: linear-gradient(135deg, #0073ff 0%, #4a9eff 100%);
      margin-bottom: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 24px;
      color: white;
    }
    h1 {
      font-size: 1.4rem;
      font-weight: 700;
      letter-spacing: -0.01em;
      margin: 0 0 8px;
    }
    .subtitle {
      color: rgba(255,255,255,0.6);
      font-size: 0.95rem;
      line-height: 1.5;
      margin: 0 0 28px;
    }
    .subtitle strong { color: #fff; }
    label {
      display: block;
      font-size: 0.85rem;
      font-weight: 600;
      margin-bottom: 8px;
      color: rgba(255,255,255,0.8);
    }
    input[type="password"], input[type="text"] {
      width: 100%;
      padding: 12px 14px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.15);
      background: rgba(0,0,0,0.3);
      color: #fff;
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      font-size: 0.92rem;
      outline: none;
      transition: border-color 0.15s;
    }
    input[type="password"]:focus, input[type="text"]:focus {
      border-color: #0073ff;
    }
    .hint {
      font-size: 0.82rem;
      color: rgba(255,255,255,0.45);
      margin-top: 8px;
      line-height: 1.5;
    }
    .hint a { color: #4a9eff; text-decoration: none; }
    .hint a:hover { text-decoration: underline; }
    .actions {
      display: flex;
      gap: 10px;
      margin-top: 24px;
    }
    button {
      flex: 1;
      padding: 12px 18px;
      border-radius: 10px;
      border: none;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s, transform 0.05s;
    }
    button:active { transform: scale(0.98); }
    .btn-primary {
      background: #0073ff;
      color: white;
    }
    .btn-primary:hover { opacity: 0.9; }
    .btn-cancel {
      background: rgba(255,255,255,0.08);
      color: rgba(255,255,255,0.8);
    }
    .btn-cancel:hover { background: rgba(255,255,255,0.12); }
    .error {
      background: rgba(255, 80, 80, 0.12);
      border: 1px solid rgba(255, 80, 80, 0.3);
      color: #ffb3b3;
      border-radius: 8px;
      padding: 10px 12px;
      font-size: 0.88rem;
      margin-bottom: 16px;
    }
  </style>
</head>
<body>
  <main class="card">
    <div class="logo">C</div>
    <h1>Autoriser <span>${safe.clientName}</span></h1>
    <p class="subtitle">
      <strong>${safe.clientName}</strong> demande l'accès au catalogue Codas via votre clé API personnelle.
      Collez la clé pour autoriser la connexion.
    </p>

    ${safe.errorMessage ? `<div class="error">${safe.errorMessage}</div>` : ""}

    <form method="POST" action="/oauth/authorize">
      <input type="hidden" name="client_id" value="${safe.clientId}" />
      <input type="hidden" name="redirect_uri" value="${safe.redirectUri}" />
      <input type="hidden" name="state" value="${safe.state}" />
      <input type="hidden" name="code_challenge" value="${safe.codeChallenge}" />
      <input type="hidden" name="code_challenge_method" value="${safe.codeChallengeMethod}" />

      <label for="api_key">Clé API Codas</label>
      <input
        type="password"
        id="api_key"
        name="api_key"
        placeholder="codas_pk_..."
        autocomplete="off"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
        required
      />
      <p class="hint">
        Génère une clé dans l'app Codas → Profil → Clés API.
        <br>Tu peux la révoquer à tout moment depuis l'app.
      </p>

      <div class="actions">
        <button type="submit" class="btn-primary">Autoriser</button>
      </div>
    </form>
  </main>
</body>
</html>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
