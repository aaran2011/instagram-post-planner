import { NextRequest } from "next/server";
import { guard, badRequest, json } from "@/lib/api";
import { readDb, updateDb } from "@/lib/db";
import { generatePlan } from "@/lib/ai";
import { buildClientState } from "@/lib/state";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Generate a fresh posting plan from selected (or all) media.
export async function POST(req: NextRequest) {
  const denied = guard();
  if (denied) return denied;

  let body: any = {};
  try {
    body = await req.json();
  } catch {}

  const db = await readDb();
  if (db.media.length === 0) return badRequest("Upload some media first.");

  const ids: string[] | null = Array.isArray(body?.mediaIds) && body.mediaIds.length ? body.mediaIds : null;
  const selected = ids ? db.media.filter((m) => ids.includes(m.id)) : db.media;
  if (selected.length === 0) return badRequest("No matching media to plan.");

  // generatePlan mutates selected[].analysis and returns scheduled draft posts.
  const posts = await generatePlan(selected, db.settings);
  const analyses = new Map(selected.map((m) => [m.id, m.analysis]));

  await updateDb((d) => {
    d.posts = posts;
    for (const m of d.media) {
      if (analyses.has(m.id)) m.analysis = analyses.get(m.id) ?? m.analysis;
    }
  });

  return json({ ...(await buildClientState()), generated: posts.length });
}
