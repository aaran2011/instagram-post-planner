import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getSession } from "@/lib/session";
import { linkedinAuthUrl } from "@/lib/oauth";
import { linkedinConfigured } from "@/lib/config";

export const dynamic = "force-dynamic";

// Kick off LinkedIn OAuth for posting as the member.
export async function GET(req: NextRequest) {
  if (!getSession()) return NextResponse.redirect(new URL("/login", req.url));
  if (!linkedinConfigured()) return NextResponse.redirect(new URL("/?error=linkedin_not_configured", req.url));
  const state = crypto.randomBytes(12).toString("hex");
  const res = NextResponse.redirect(linkedinAuthUrl(state));
  res.cookies.set("li_oauth_state", state, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
