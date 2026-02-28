/**
 * One-time script to obtain a Google Calendar OAuth2 refresh token.
 *
 * Prerequisites:
 *   1. Go to https://console.cloud.google.com/
 *   2. Create a project (or use existing)
 *   3. Enable "Google Calendar API"
 *   4. Create OAuth 2.0 credentials (type: "Web application")
 *   5. Add "http://localhost:3333/callback" as an Authorized redirect URI
 *   6. Copy the Client ID and Client Secret
 *
 * Usage:
 *   npx tsx scripts/google-auth-setup.ts <CLIENT_ID> <CLIENT_SECRET>
 *
 * The script will:
 *   1. Start a local server on port 3333
 *   2. Print an authorization URL — open it in your browser
 *   3. After granting access, Google redirects back to localhost
 *   4. The script automatically captures the code and exchanges it for tokens
 *   5. Prints the GOOGLE_REFRESH_TOKEN to add to your .env
 */

import { OAuth2Client } from "google-auth-library";
import http from "node:http";
import { URL } from "node:url";

const [clientId, clientSecret] = process.argv.slice(2);

if (!clientId || !clientSecret) {
  console.error("Usage: npx tsx scripts/google-auth-setup.ts <CLIENT_ID> <CLIENT_SECRET>");
  process.exit(1);
}

const PORT = 3333;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const SCOPES = ["https://www.googleapis.com/auth/calendar"];

const oauth2Client = new OAuth2Client(clientId, clientSecret, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  scope: SCOPES,
  prompt: "consent" // Force consent to always get refresh token
});

console.log("\n========================================");
console.log("Google Calendar OAuth2 Setup");
console.log("========================================\n");
console.log("1. Open this URL in your browser:\n");
console.log(authUrl);
console.log("\n2. Grant access to your Google Calendar");
console.log("3. You'll be redirected back automatically\n");
console.log("Waiting for authorization...\n");

// Start a temporary local server to capture the OAuth redirect
const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith("/callback")) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<h1>❌ Erro</h1><p>Autorização negada: ${error}</p><p>Pode fechar esta janela.</p>`);
    console.error(`\nERROR: Authorization denied — ${error}`);
    server.close();
    process.exit(1);
    return;
  }

  if (!code) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h1>❌ Erro</h1><p>Nenhum código de autorização recebido.</p>");
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        "<h1>⚠️ Sem Refresh Token</h1>" +
        "<p>Revogue o acesso em <a href='https://myaccount.google.com/permissions'>myaccount.google.com/permissions</a> e tente novamente.</p>"
      );
      console.error("\nERROR: No refresh token returned.");
      console.error("Revoke access at https://myaccount.google.com/permissions and try again.\n");
      server.close();
      process.exit(1);
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      "<h1>✅ Sucesso!</h1>" +
      "<p>Refresh token obtido. Volte ao terminal para copiar as credenciais.</p>" +
      "<p>Pode fechar esta janela.</p>"
    );

    console.log("========================================");
    console.log("SUCCESS! Add these to your .env file:");
    console.log("========================================\n");
    console.log(`GOOGLE_CLIENT_ID=${clientId}`);
    console.log(`GOOGLE_CLIENT_SECRET=${clientSecret}`);
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log("\n========================================\n");

    server.close();
    process.exit(0);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h1>❌ Erro</h1><p>Falha ao trocar código por tokens. Veja o terminal.</p>");
    console.error("\nERROR: Failed to exchange code for tokens:");
    console.error(err instanceof Error ? err.message : String(err));
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log(`Local server listening on http://localhost:${PORT}`);
});

// Auto-close after 5 minutes
setTimeout(() => {
  console.error("\nTimeout: no authorization received after 5 minutes.");
  server.close();
  process.exit(1);
}, 5 * 60 * 1000);
