import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { linkedinExchangeCode, linkedinUserinfo } from "@/lib/oauth";
import { updateDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// LinkedIn redirects here with ?code=...&state=...
export async function GET(req: NextRequest) {
  if (!getSession()) return NextResponse.redirect(new URL("/login", req.url));

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("li_oauth_state")?.value;
  const err = url.searchParams.get("error_description") || url.searchParams.get("error");

  if (err) return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(err)}`, req.url));
  if (!code) return NextResponse.redirect(new URL("/?error=missing_code", req.url));
  if (!state || !cookieState || state !== cookieState) {
    return NextResponse.redirect(new URL("/?error=state_mismatch", req.url));
  }

  try {
    const tokens = await linkedinExchangeCode(code);
    const me = await linkedinUserinfo(tokens.accessToken);
    await updateDb((db) => {
      db.linkedin = { connected: true, name: me.name, memberId: me.sub, connectedAt: new Date().toISOString() };
      db.secrets.linkedinAccessToken = tokens.accessToken;
      db.secrets.linkedinExpiresAt = tokens.expiresAt;
      if (!db.crossPost.baselineAt) db.crossPost.baselineAt = new Date().toISOString();
    });
    const res = NextResponse.redirect(new URL("/?connected=linkedin", req.url));
    res.cookies.set("li_oauth_state", "", { maxAge: 0, path: "/" });
    return res;
  } catch (e: any) {
    return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(e?.message || "connect_failed")}`, req.url));
  }
}
