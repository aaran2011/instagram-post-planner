import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { googleExchangeCode } from "@/lib/oauth";
import { updateDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// Google redirects here with ?code=...&state=...
export async function GET(req: NextRequest) {
  if (!getSession()) return NextResponse.redirect(new URL("/login", req.url));

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("yt_oauth_state")?.value;
  const err = url.searchParams.get("error");

  if (err) return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(err)}`, req.url));
  if (!code) return NextResponse.redirect(new URL("/?error=missing_code", req.url));
  if (!state || !cookieState || state !== cookieState) {
    return NextResponse.redirect(new URL("/?error=state_mismatch", req.url));
  }

  try {
    const tokens = await googleExchangeCode(code);
    await updateDb((db) => {
      db.youtube = { connected: true, channelTitle: null, channelId: null, connectedAt: new Date().toISOString() };
      db.secrets.youtubeAccessToken = tokens.accessToken;
      if (tokens.refreshToken) db.secrets.youtubeRefreshToken = tokens.refreshToken;
      db.secrets.youtubeExpiresAt = tokens.expiresAt;
      // Capture a baseline so existing Instagram history isn't backfilled.
      if (!db.crossPost.baselineAt) db.crossPost.baselineAt = new Date().toISOString();
    });
    const res = NextResponse.redirect(new URL("/?connected=youtube", req.url));
    res.cookies.set("yt_oauth_state", "", { maxAge: 0, path: "/" });
    return res;
  } catch (e: any) {
    return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(e?.message || "connect_failed")}`, req.url));
  }
}
