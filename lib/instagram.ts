import { config, instagramConfigured } from "./config";
import type { MediaItem, Post } from "./types";

// Instagram integration using the official "Instagram API with Instagram Login".
//
// This flow does NOT require a Facebook Page linked to the account. You log in
// with your Instagram credentials, and the app talks to graph.instagram.com
// with an Instagram-scoped access token.
//
// REAL LIMITATIONS (surfaced honestly in the UI):
//  1. The API publishes IMMEDIATELY — there is no native "schedule later".
//     This app stores the schedule and publishes each post at its time.
//  2. Instagram FETCHES your media from a public URL (PUBLIC_BASE_URL). It must
//     be reachable by Instagram's servers — localhost will not work.
//  3. The API CANNOT attach arbitrary music to a feed post. Music is a manual
//     step inside Instagram; we only suggest a song.
//  4. Requires an Instagram Business or Creator (professional) account.

const AUTH = "https://www.instagram.com/oauth/authorize";
const TOKEN = "https://api.instagram.com/oauth/access_token";
const GRAPH = "https://graph.instagram.com";
const GRAPH_V = "https://graph.instagram.com/v23.0";

// Scopes for the Instagram Login API (old scopes were deprecated 2025-01-27).
const SCOPES = ["instagram_business_basic", "instagram_business_content_publish"];

export const IG_LIMITATIONS = {
  noNativeScheduling:
    "Instagram's API publishes immediately; scheduling is handled by this app's own scheduler.",
  requiresPublicUrl:
    "Instagram downloads your media from a public URL. Set PUBLIC_BASE_URL to a host Instagram can reach.",
  noMusicAttach:
    "The API cannot attach music to a feed post. Add the suggested song manually in Instagram.",
  businessOnly:
    "Requires an Instagram Business or Creator account (no Facebook Page needed).",
};

// ---- OAuth (Instagram Business Login) ----

export function getAuthUrl(state: string): string {
  const params = new URLSearchParams({
    enable_fb_login: "0", // force the Instagram credential login, not Facebook
    force_authentication: "1",
    client_id: config.ig.appId,
    redirect_uri: config.ig.redirectUri,
    response_type: "code",
    scope: SCOPES.join(","),
    state,
  });
  return `${AUTH}?${params.toString()}`;
}

async function jsonOrThrow(res: Response, ctx: string) {
  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg =
      data?.error?.message ||
      data?.error_message ||
      data?.error_description ||
      data?.raw ||
      `${ctx} failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

async function graphGet(path: string, params: Record<string, string>) {
  const url = new URL(path.startsWith("http") ? path : `${GRAPH_V}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return jsonOrThrow(await fetch(url.toString()), "Instagram request");
}

async function graphPost(path: string, params: Record<string, string>) {
  const url = path.startsWith("http") ? path : `${GRAPH_V}${path}`;
  return jsonOrThrow(
    await fetch(url, { method: "POST", body: new URLSearchParams(params) }),
    "Instagram request",
  );
}

export interface ConnectResult {
  accessToken: string;
  igUserId: string;
  username: string;
  accountType: string;
}

// Exchange an OAuth code for a long-lived Instagram token + account info.
export async function exchangeCodeForAccount(code: string): Promise<ConnectResult> {
  // 1) Short-lived token (also returns the Instagram-scoped user_id).
  const short = await jsonOrThrow(
    await fetch(TOKEN, {
      method: "POST",
      body: new URLSearchParams({
        client_id: config.ig.appId,
        client_secret: config.ig.appSecret,
        grant_type: "authorization_code",
        redirect_uri: config.ig.redirectUri,
        code,
      }),
    }),
    "Token exchange",
  );

  let accessToken: string = short.access_token;
  const igUserId = String(short.user_id);

  // 2) Upgrade to a long-lived token (~60 days).
  try {
    const ll = await graphGet(`${GRAPH}/access_token`, {
      grant_type: "ig_exchange_token",
      client_secret: config.ig.appSecret,
      access_token: accessToken,
    });
    if (ll.access_token) accessToken = ll.access_token;
  } catch {
    // Keep the short-lived token if the exchange fails.
  }

  // 3) Profile info.
  const me = await profile(accessToken);
  return {
    accessToken,
    igUserId: me.user_id || igUserId,
    username: me.username,
    accountType: me.account_type || "BUSINESS",
  };
}

async function profile(accessToken: string) {
  const me = await graphGet(`${GRAPH}/me`, {
    fields: "user_id,username,account_type",
    access_token: accessToken,
  });
  return {
    user_id: me.user_id ? String(me.user_id) : "",
    username: me.username as string,
    account_type: (me.account_type as string) || "BUSINESS",
  };
}

export async function resolveAccount(accessToken: string): Promise<ConnectResult> {
  const me = await profile(accessToken);
  if (!me.user_id) throw new Error("Could not resolve Instagram user id from token.");
  return { accessToken, igUserId: me.user_id, username: me.username, accountType: me.account_type };
}

// Connect using a manually-provided long-lived token (skips OAuth entirely).
export async function connectWithManualToken(): Promise<ConnectResult> {
  if (!config.ig.manualToken) throw new Error("IG_ACCESS_TOKEN not set");
  const r = await resolveAccount(config.ig.manualToken);
  if (config.ig.manualUserId) r.igUserId = config.ig.manualUserId;
  return r;
}

// ---- Publishing ----

function publicMediaUrl(media: MediaItem): string | null {
  // With Vercel Blob the media already has an absolute, public CDN URL —
  // Instagram can fetch it directly and no PUBLIC_BASE_URL is needed.
  if (media.fileUrl && /^https?:\/\//i.test(media.fileUrl)) return media.fileUrl;
  // Disk mode: Instagram must reach us via a public base URL (tunnel/domain).
  if (!config.publicBaseUrl) return null;
  const path = media.fileUrl || `/api/media/file/${media.id}`;
  return `${config.publicBaseUrl.replace(/\/$/, "")}${path}`;
}

export interface PublishResult {
  igMediaId: string;
}

export async function publishPost(
  post: Post,
  media: MediaItem,
  accessToken: string,
  igUserId: string,
): Promise<PublishResult> {
  const url = publicMediaUrl(media);
  if (!url) {
    throw new Error(
      "PUBLIC_BASE_URL is not set, so Instagram cannot fetch this media. " +
        IG_LIMITATIONS.requiresPublicUrl,
    );
  }
  const caption = [post.caption, post.cta, post.hashtags.join(" ")]
    .filter(Boolean)
    .join("\n\n");

  let creationId: string;
  if (media.type === "video") {
    const container = await graphPost(`/${igUserId}/media`, {
      access_token: accessToken,
      media_type: "REELS",
      video_url: url,
      caption,
    });
    creationId = container.id;
  } else {
    const container = await graphPost(`/${igUserId}/media`, {
      access_token: accessToken,
      image_url: url,
      caption,
    });
    creationId = container.id;
  }

  // Wait until the container finishes processing before publishing. Even image
  // containers start as IN_PROGRESS and briefly need to become FINISHED, or
  // media_publish fails with "Media ID is not available".
  await waitForContainer(creationId, accessToken);

  const published = await graphPost(`/${igUserId}/media_publish`, {
    access_token: accessToken,
    creation_id: creationId,
  });
  return { igMediaId: published.id };
}

async function waitForContainer(containerId: string, accessToken: string) {
  for (let i = 0; i < 20; i++) {
    const status = await graphGet(`/${containerId}`, {
      access_token: accessToken,
      fields: "status_code,status",
    });
    if (status.status_code === "FINISHED") return;
    if (status.status_code === "ERROR") {
      throw new Error(`Instagram could not process the video: ${status.status || "ERROR"}`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("Timed out waiting for Instagram to process the video.");
}

export { instagramConfigured, publicMediaUrl };
