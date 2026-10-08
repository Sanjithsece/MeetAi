import fsp from "node:fs/promises";
import { env } from "../../config/env.js";
import { ensureStorageDirectories, secretsFile } from "../../config/paths.js";
import { logger } from "../../utils/logger.js";

/**
 * Minimal Google OAuth 2.0 client for the Gmail read-only scope.
 *
 * MeetAI never sees a Google password: the user consents in their own browser
 * and only the resulting refresh token is stored, locally, in
 * `.secrets/gmail-token.json` (git-ignored, never returned to the frontend).
 */

export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];
const TOKEN_FILE = "gmail-token.json";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export function isGmailConfigured() {
  return Boolean(env.gmail.clientId && env.gmail.clientSecret);
}

export async function readToken() {
  try {
    const raw = await fsp.readFile(secretsFile(TOKEN_FILE), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeToken(token) {
  ensureStorageDirectories();
  await fsp.writeFile(secretsFile(TOKEN_FILE), JSON.stringify(token, null, 2), { mode: 0o600 });
}

export async function clearToken() {
  await fsp.rm(secretsFile(TOKEN_FILE), { force: true });
}

export function buildAuthUrl(state = "meetai") {
  if (!isGmailConfigured()) {
    throw new Error("Gmail is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first.");
  }
  const params = new URLSearchParams({
    client_id: env.gmail.clientId,
    redirect_uri: env.gmail.redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function tokenRequest(body) {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString()
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Google token request failed (${response.status}): ${payload.error_description ?? payload.error ?? "unknown error"}`);
  }
  return payload;
}

export async function exchangeCode(code) {
  const payload = await tokenRequest({
    code,
    client_id: env.gmail.clientId,
    client_secret: env.gmail.clientSecret,
    redirect_uri: env.gmail.redirectUri,
    grant_type: "authorization_code"
  });

  const token = {
    refreshToken: payload.refresh_token,
    accessToken: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
    scope: payload.scope,
    connectedAt: new Date().toISOString()
  };

  if (!token.refreshToken) {
    const existing = await readToken();
    token.refreshToken = existing?.refreshToken;
  }
  if (!token.refreshToken) {
    throw new Error("Google did not return a refresh token. Remove MeetAI from your Google account permissions and connect again.");
  }

  await writeToken(token);
  logger.info("Gmail account connected");
  return { connectedAt: token.connectedAt };
}

/** Returns a valid access token, refreshing it when needed. */
export async function getAccessToken() {
  if (!isGmailConfigured()) throw new Error("Gmail is not configured");
  const token = await readToken();
  if (!token?.refreshToken) throw new Error("Gmail is not connected. Connect it from Settings.");

  if (token.accessToken && token.expiresAt && token.expiresAt - 60000 > Date.now()) {
    return token.accessToken;
  }

  const payload = await tokenRequest({
    client_id: env.gmail.clientId,
    client_secret: env.gmail.clientSecret,
    refresh_token: token.refreshToken,
    grant_type: "refresh_token"
  });

  const refreshed = {
    ...token,
    accessToken: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000
  };
  await writeToken(refreshed);
  return refreshed.accessToken;
}

export async function gmailStatus() {
  if (!isGmailConfigured()) {
    return { configured: false, connected: false, message: "Gmail: Not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are empty)" };
  }
  const token = await readToken();
  if (!token?.refreshToken) {
    return { configured: true, connected: false, message: "Gmail is configured but not connected yet" };
  }
  try {
    const accessToken = await getAccessToken();
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) throw new Error(`Gmail profile request failed (${response.status})`);
    const profile = await response.json();
    return {
      configured: true,
      connected: true,
      emailAddress: profile.emailAddress,
      connectedAt: token.connectedAt,
      message: `Connected as ${profile.emailAddress}`
    };
  } catch (error) {
    return { configured: true, connected: false, message: error.message };
  }
}
