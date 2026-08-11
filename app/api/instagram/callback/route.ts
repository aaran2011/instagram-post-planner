import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { exchangeCodeForAccount } from "@/lib/instagram";
import { updateDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// Meta redirects here with ?code=...&state=...
export async function GET(req: NextRequest) {
  if (!getSession()) return NextResponse.redirect(new URL("/login", req.url));

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("ig_oauth_state")?.value;
  const err = url.searchParams.get("error_description") || url.searchParams.get("error");

  if (err) {
    return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(err)}`, req.url));
  }
  if (!code) return NextResponse.redirect(new URL("/?error=missing_code", req.url));
  if (!state || !cookieState || state !== cookieState) {
    return NextResponse.redirect(new URL("/?error=state_mismatch", req.url));
  }

  try {
    const account = await exchangeCodeForAccount(code);
    await updateDb((db) => {
      db.instagram = {
        connected: true,
        username: account.username,
        igUserId: account.igUserId,
        accountType: account.accountType,
        connectedAt: new Date().toISOString(),
        demo: false,
      };
      db.secrets.instagramAccessToken = account.accessToken;
    });
    const res = NextResponse.redirect(new URL("/?connected=1", req.url));
    res.cookies.set("ig_oauth_state", "", { maxAge: 0, path: "/" });
    return res;
  } catch (e: any) {
    return NextResponse.redirect(
      new URL(`/?error=${encodeURIComponent(e?.message || "connect_failed")}`, req.url),
    );
  }
}
