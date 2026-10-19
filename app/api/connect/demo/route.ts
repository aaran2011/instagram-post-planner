import { NextRequest } from "next/server";
import { guard, badRequest, json } from "@/lib/api";
import { updateDb } from "@/lib/db";
import { buildClientState } from "@/lib/state";

export const dynamic = "force-dynamic";

// Simulate connecting LinkedIn or YouTube (mirrors Instagram's demo mode) so the
// whole auto-repost flow can be exercised without real OAuth credentials.
// Cross-posts to a demo destination are simulated (no external API calls).
export async function POST(req: NextRequest) {
  const denied = guard();
  if (denied) return denied;
  let body: any;
  try { body = await req.json(); } catch { return badRequest("Invalid body"); }
  const provider = body?.provider;
  if (provider !== "linkedin" && provider !== "youtube") return badRequest("Unknown provider");

  await updateDb((db) => {
    const now = new Date().toISOString();
    if (provider === "linkedin") {
      db.linkedin = { connected: true, name: "Demo LinkedIn", memberId: "demo", connectedAt: now, demo: true };
    } else {
      db.youtube = { connected: true, channelTitle: "Demo channel", channelId: "demo", connectedAt: now, demo: true };
    }
    if (!db.crossPost.baselineAt) db.crossPost.baselineAt = now;
  });

  const state = await buildClientState();
  return json({ ok: true, ...state });
}
