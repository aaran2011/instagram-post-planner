import { NextRequest } from "next/server";
import { guard, badRequest, json } from "@/lib/api";
import { currentAccountId } from "@/lib/db";
import { runOrScheduleItem } from "@/lib/crosspost";
import { buildClientState } from "@/lib/state";
import type { CrossPostDestination } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Post a specific Instagram item now, or schedule it, to chosen destinations.
export async function POST(req: NextRequest) {
  const denied = guard();
  if (denied) return denied;
  const uid = await currentAccountId();
  if (!uid) return badRequest("Not signed in");

  let body: any;
  try { body = await req.json(); } catch { return badRequest("Invalid body"); }

  const igId = String(body?.igId || "");
  if (!igId) return badRequest("Missing igId");
  const destinations = (Array.isArray(body?.destinations) ? body.destinations : [])
    .filter((d: any): d is CrossPostDestination => d === "linkedin" || d === "youtube");
  if (!destinations.length) return badRequest("Choose at least one destination");
  const scheduledAt = body?.scheduledAt ? String(body.scheduledAt) : undefined;

  try {
    const result = await runOrScheduleItem(uid, igId, destinations, scheduledAt);
    const state = await buildClientState();
    return json({ ...result, ...state });
  } catch (e: any) {
    return json({ error: e?.message || "Cross-post failed" }, 500);
  }
}
