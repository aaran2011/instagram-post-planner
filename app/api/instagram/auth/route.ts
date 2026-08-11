import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getAuthUrl } from "@/lib/instagram";
import { config } from "@/lib/config";
import crypto from "crypto";

export const dynamic = "force-dynamic";

// Kick off the real Meta/Instagram OAuth flow.
export async function GET(req: NextRequest) {
  if (!getSession()) return NextResponse.redirect(new URL("/login", req.url));
  if (!config.ig.appId || !config.ig.appSecret) {
    return NextResponse.redirect(new URL("/?error=ig_not_configured", req.url));
  }
  const state = crypto.randomBytes(12).toString("hex");
  const res = NextResponse.redirect(getAuthUrl(state));
  // Store state in a short-lived cookie to guard against CSRF on callback.
  res.cookies.set("ig_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
