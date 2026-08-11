import { NextRequest } from "next/server";
import { guard, badRequest, json } from "@/lib/api";
import { updateDb } from "@/lib/db";
import { config, instagramConfigured } from "@/lib/config";
import { connectWithManualToken } from "@/lib/instagram";

export const dynamic = "force-dynamic";

// mode: "oauth" (return redirect url) | "manual" (env token) | "demo".
export async function POST(req: NextRequest) {
  const denied = guard();
  if (denied) return denied;

  let body: any = {};
  try {
    body = await req.json();
  } catch {}
  const mode = String(body?.mode || "");

  if (mode === "oauth") {
    if (!config.ig.appId || !config.ig.appSecret) {
      return badRequest("Meta OAuth is not configured. Set META_APP_ID and META_APP_SECRET.");
    }
    return json({ redirect: "/api/instagram/auth" });
  }

  if (mode === "manual") {
    if (!config.ig.manualToken) {
      return badRequest("No IG_ACCESS_TOKEN configured in the environment.");
    }
    try {
      const account = await connectWithManualToken();
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
      return json({ ok: true, instagram: { ...account, accessToken: undefined } });
    } catch (e: any) {
      return badRequest(e?.message || "Could not connect with the provided token.");
    }
  }

  if (mode === "demo") {
    const username = String(body?.username || "your_handle").replace(/^@/, "");
    await updateDb((db) => {
      db.instagram = {
        connected: true,
        username,
        igUserId: "demo_user",
        accountType: "BUSINESS",
        connectedAt: new Date().toISOString(),
        demo: true,
      };
      db.secrets.instagramAccessToken = null;
    });
    return json({ ok: true, demo: true });
  }

  return badRequest("Unknown connect mode.", { configured: instagramConfigured() });
}
