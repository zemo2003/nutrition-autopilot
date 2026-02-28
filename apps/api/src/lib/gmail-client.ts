import { google, type Auth } from "googleapis";

/**
 * Creates a base OAuth2 client configured from env vars.
 */
export function getOAuth2Client(): Auth.OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Missing Google OAuth env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI"
    );
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/**
 * Generates the Google OAuth consent URL for Gmail readonly access.
 */
export function getAuthUrl(): string {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/gmail.readonly"],
  });
}

/**
 * Exchanges an authorization code for tokens.
 */
export async function exchangeCode(code: string) {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);
  return tokens;
}

/**
 * Returns an authenticated OAuth2 client with auto-refresh,
 * given a stored refresh token.
 */
export function getAuthenticatedClient(refreshToken: string): Auth.OAuth2Client {
  const client = getOAuth2Client();
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

/**
 * Returns a Gmail API instance authenticated with the given refresh token.
 */
export function getGmailClient(refreshToken: string) {
  const auth = getAuthenticatedClient(refreshToken);
  return google.gmail({ version: "v1", auth });
}
