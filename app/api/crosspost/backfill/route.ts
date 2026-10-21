import { NextRequest } from "next/server";
import { guard, badRequest, json } from "@/lib/api";
import { currentAccountId } from "@/lib/db";
import { scheduleBackfill } from "@/lib/crosspost";
import { buildClientState } from "@/lib/state";
import type { CrossPostDestination } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Queue every Instagram post from a chosen past date up to today, one per day.
// Body: { since: ISO date, firstAt: ISO datetime, destinations: ("linkedin"|"youtube")[] }
export async function POST(req: NextRequest) {
  const denied = guard();
  if (denied) return denied;
  const uid = await currentAccountId();
  if (!uid) return badRequest("Not signed in");

  let body: any;
  try { body = await req.json(); } catch { return badRequest("Invalid body"); }

  const sinceMs = Date.parse(String(body?.since || ""));
  if (isNaN(sinceMs)) return badRequest("Pick a start date");
  const firstAtMs = Date.parse(String(body?.firstAt || "")) || Date.now() + 60_000;
  const destinations = (Array.isArray(body?.destinations) ? body.destinations : [])
    .filter((d: any): d is CrossPostDestination => d === "linkedin" || d === "youtube");
  if (!destinations.length) return badRequest("Choose at least one destination");

  try {
    const result = await scheduleBackfill(uid, sinceMs, destinations, firstAtMs);
    if (result.error) return json({ error: result.error }, 400);
    const state = await buildClientState();
    return json({ ...result, ...state });
  } catch (e: any) {
    return json({ error: e?.message || "Backfill failed" }, 500);
  }
}
