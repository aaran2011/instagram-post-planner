import { config } from "./config";
import { readAccount, updateAccount } from "./db";

// Shared OAuth2 plumbing for the cross-post destinations (Google/YouTube and
// LinkedIn): build auth URLs, exchange codes, and hand the engine a VALID access
// token (refreshing Google when expired). Account-scoped by uid because the
// engine runs under the scheduler with no session.

export const NEEDS_RECONNECT = "NEEDS_RECONNECT"; // thrown when a token can't be refreshed

// ---------------- Google / YouTube ----------------

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube.upload";

export function googleAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.redirectUri,
    response_type: "code",
    scope: YOUTUBE_SCOPE,
    access_type: "offline", // ask for a refresh token
    prompt: "consent", // force refresh token issuance every time
    include_granted_scopes: "true",
    state,
  });
  return `${GOOGLE_AUTH}?${p.toString()}`;
}

export interface GoogleTokens { accessToken: string; refreshToken: string | null; expiresAt: number; }

export async function googleExchangeCode(code: string): Promise<GoogleTokens> {
  const res = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: config.google.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `Google token exchange failed (${res.status})`);
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  };
}

// Returns a non-expired Google access token for account uid, refreshing if
// needed and persisting the new token. Throws NEEDS_RECONNECT if not refreshable.
export async function getValidYouTubeToken(uid: string): Promise<string> {
  const db = await readAccount(uid);
  const s = db?.secrets;
  if (!db?.youtube.connected || !s?.youtubeAccessToken) throw new Error(NEEDS_RECONNECT);
  if (s.youtubeExpiresAt && s.youtubeExpiresAt - 60_000 > Date.now()) return s.youtubeAccessToken;

  // Access token expired → refresh.
  if (!s.youtubeRefreshToken) throw new Error(NEEDS_RECONNECT);
  const res = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      refresh_token: s.youtubeRefreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(NEEDS_RECONNECT);
  const accessToken: string = data.access_token;
  const expiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000;
  await updateAccount(uid, (d) => {
    d.secrets.youtubeAccessToken = accessToken;
    d.secrets.youtubeExpiresAt = expiresAt;
  });
  return accessToken;
}

// ---------------- LinkedIn ----------------

const LI_AUTH = "https://www.linkedin.com/oauth/v2/authorization";
const LI_TOKEN = "https://www.linkedin.com/oauth/v2/accessToken";
const LI_SCOPES = "openid profile w_member_social";

export function linkedinAuthUrl(state: string): string {
  const p = new URLSearchParams({
    response_type: "code",
    client_id: config.linkedin.clientId,
    redirect_uri: config.linkedin.redirectUri,
    scope: LI_SCOPES,
    state,
  });
  return `${LI_AUTH}?${p.toString()}`;
}

export interface LinkedInTokens { accessToken: string; expiresAt: number; }

export async function linkedinExchangeCode(code: string): Promise<LinkedInTokens> {
  const res = await fetch(LI_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: config.linkedin.clientId,
      client_secret: config.linkedin.clientSecret,
      redirect_uri: config.linkedin.redirectUri,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `LinkedIn token exchange failed (${res.status})`);
  }
  return { accessToken: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 5184000) * 1000 };
}

export async function linkedinUserinfo(accessToken: string): Promise<{ sub: string; name: string }> {
  const res = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.sub) throw new Error(data.message || `LinkedIn userinfo failed (${res.status})`);
  return { sub: String(data.sub), name: String(data.name || data.given_name || "LinkedIn member") };
}

// LinkedIn's default member token (~60 days) has no free refresh. Return it if
// still valid, else signal a reconnect is needed.
export async function getValidLinkedInToken(uid: string): Promise<string> {
  const db = await readAccount(uid);
  const s = db?.secrets;
  if (!db?.linkedin.connected || !s?.linkedinAccessToken) throw new Error(NEEDS_RECONNECT);
  if (s.linkedinExpiresAt && s.linkedinExpiresAt < Date.now() + 86_400_000) throw new Error(NEEDS_RECONNECT);
  return s.linkedinAccessToken;
}
