import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getSession } from "@/lib/session";
import { googleAuthUrl } from "@/lib/oauth";
import { youtubeConfigured } from "@/lib/config";

export const dynamic = "force-dynamic";

// Kick off Google OAuth for YouTube uploads.
export async function GET(req: NextRequest) {
  if (!getSession()) return NextResponse.redirect(new URL("/login", req.url));
  if (!youtubeConfigured()) return NextResponse.redirect(new URL("/?error=youtube_not_configured", req.url));
  const state = crypto.randomBytes(12).toString("hex");
  const res = NextResponse.redirect(googleAuthUrl(state));
  res.cookies.set("yt_oauth_state", state, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
