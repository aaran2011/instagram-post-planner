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

  // Carousel groups from the composer: each group = one post (>1 = carousel).
  const rawGroups: string[][] | null =
    Array.isArray(body?.groups) && body.groups.length ? body.groups : null;

  // Which media are already planned (so re-generating only ADDS new content)?
  const planned = new Set<string>();
  for (const p of db.posts) (p.mediaIds ?? [p.mediaId]).forEach((id) => planned.add(id));

  let selected;
  let genGroups: string[][] | undefined;
  if (rawGroups) {
    const valid = rawGroups
      .map((g) => g.filter((id) => db.media.some((m) => m.id === id)))
      .filter((g) => g.length > 0);
    if (!valid.length) return badRequest("No valid media in the groups.");
    genGroups = valid;
    const idset = new Set(valid.flat());
    selected = db.media.filter((m) => idset.has(m.id));
  } else {
    // Auto mode: plan only media not already in the calendar (additive).
    selected = db.media.filter((m) => !planned.has(m.id));
    if (!selected.length) {
      return badRequest("Everything's already on your calendar. Upload new content to add more.");
    }
  }

  // Append after the existing plan — never replace it.
  const startOrder = db.posts.length ? Math.max(...db.posts.map((p) => p.order)) + 1 : 0;
  const startAfter = db.posts.length
    ? new Date(Math.max(...db.posts.map((p) => new Date(p.scheduledAt).getTime())))
    : undefined;

  const newPosts = await generatePlan(selected, db.settings, {
    groups: genGroups,
    startOrder,
    startAfter,
  });
  const analyses = new Map(selected.map((m) => [m.id, m.analysis]));

  await updateDb((d) => {
    d.posts = [...d.posts, ...newPosts]; // APPEND, keep existing calendar
    for (const m of d.media) {
      if (analyses.has(m.id)) m.analysis = analyses.get(m.id) ?? m.analysis;
    }
  });

  return json({ ...(await buildClientState()), generated: newPosts.length });
}
