/**
 * One-time script to obtain a Google Calendar OAuth2 refresh token.
 *
 * Prerequisites:
 *   1. Go to https://console.cloud.google.com/
 *   2. Create a project (or use existing)
 *   3. Enable "Google Calendar API"
 *   4. Create OAuth 2.0 credentials (Desktop app type)
 *   5. Download the client ID and client secret
 *
 * Usage:
 *   npx tsx scripts/google-auth-setup.ts <CLIENT_ID> <CLIENT_SECRET>
 *
 * The script will:
 *   1. Print an authorization URL — open it in your browser
 *   2. After granting access, Google redirects to localhost (will fail — that's ok)
 *   3. Copy the "code" parameter from the redirect URL
 *   4. Paste it back into the terminal
 *   5. The script prints the GOOGLE_REFRESH_TOKEN to add to your .env
 */

import { google } from "googleapis";
import readline from "node:readline";

const [clientId, clientSecret] = process.argv.slice(2);

if (!clientId || !clientSecret) {
  console.error("Usage: npx tsx scripts/google-auth-setup.ts <CLIENT_ID> <CLIENT_SECRET>");
  process.exit(1);
}

const SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"];
const REDIRECT_URI = "urn:ietf:wg:oauth:2.0:oob"; // Manual copy/paste flow

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  scope: SCOPES,
  prompt: "consent" // Force consent to get refresh token
});

console.log("\n========================================");
console.log("Google Calendar OAuth2 Setup");
console.log("========================================\n");
console.log("1. Open this URL in your browser:\n");
console.log(authUrl);
console.log("\n2. Grant access to your Google Calendar");
console.log("3. Copy the authorization code from the page/redirect URL\n");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question("Paste the authorization code here: ", async (code) => {
  rl.close();

  try {
    const { tokens } = await oauth2Client.getToken(code.trim());

    if (!tokens.refresh_token) {
      console.error("\nERROR: No refresh token returned. This can happen if:");
      console.error("  - You already authorized this app before (revoke at https://myaccount.google.com/permissions)");
      console.error("  - Try again after revoking access\n");
      process.exit(1);
    }

    console.log("\n========================================");
    console.log("SUCCESS! Add these to your .env file:");
    console.log("========================================\n");
    console.log(`GOOGLE_CLIENT_ID=${clientId}`);
    console.log(`GOOGLE_CLIENT_SECRET=${clientSecret}`);
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log("\n========================================\n");

    if (tokens.access_token) {
      console.log("(Access token — for reference only, will auto-refresh):");
      console.log(`Access Token: ${tokens.access_token.slice(0, 20)}...`);
      console.log(`Expires: ${tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : "unknown"}`);
    }
  } catch (error) {
    console.error("\nERROR: Failed to exchange code for tokens:");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
});
