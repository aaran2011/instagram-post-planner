import { NextRequest } from "next/server";
import { guard, badRequest, json } from "@/lib/api";
import { updateDb } from "@/lib/db";
import { buildClientState } from "@/lib/state";

export const dynamic = "force-dynamic";

// Reorder posts by an explicit id sequence. Each post KEEPS its own
// date/time — only the grid position (order) changes. The client decides
// whether to also re-flow the schedule via a separate call.
export async function POST(req: NextRequest) {
  const denied = guard();
  if (denied) return denied;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid body");
  }
  const orderedIds: string[] = Array.isArray(body?.orderedIds) ? body.orderedIds : [];
  if (!orderedIds.length) return badRequest("orderedIds required");

  await updateDb((db) => {
    const pos = new Map(orderedIds.map((id, i) => [id, i]));
    db.posts.forEach((p) => {
      if (pos.has(p.id)) p.order = pos.get(p.id)!;
    });
    db.posts.sort((a, b) => a.order - b.order).forEach((p, i) => (p.order = i));
  });

  return json(await buildClientState());
}
