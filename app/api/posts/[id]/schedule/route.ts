import { NextRequest } from "next/server";
import { guard, badRequest, json } from "@/lib/api";
import { readDb, updateDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const CONFLICT_WINDOW_MIN = 30;

// Move a post to a new date/time. If another (unpublished) post is within the
// conflict window, we warn instead of silently overwriting — unless force.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = guard();
  if (denied) return denied;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid body");
  }
  const scheduledAt = String(body?.scheduledAt || "");
  if (!scheduledAt || isNaN(Date.parse(scheduledAt))) {
    return badRequest("A valid scheduledAt is required");
  }
  const force = Boolean(body?.force);
  const timezone: string | undefined = body?.timezone;

  const db = await readDb();
  const post = db.posts.find((p) => p.id === params.id);
  if (!post) return json({ error: "Post not found" }, 404);

  const target = new Date(scheduledAt).getTime();
  const conflict = db.posts.find(
    (p) =>
      p.id !== post.id &&
      p.status !== "published" &&
      p.status !== "demo_published" &&
      Math.abs(new Date(p.scheduledAt).getTime() - target) < CONFLICT_WINDOW_MIN * 60 * 1000,
  );

  if (conflict && !force) {
    return json({
      conflict: true,
      message: `Another post is scheduled within ${CONFLICT_WINDOW_MIN} minutes of this time.`,
      conflictPostId: conflict.id,
      conflictAt: conflict.scheduledAt,
    });
  }

  const updated = await updateDb((d) => {
    const p = d.posts.find((x) => x.id === post.id)!;
    p.scheduledAt = new Date(scheduledAt).toISOString();
    if (timezone) p.timezone = timezone;
    p.updatedAt = new Date().toISOString();
    return p;
  });

  return json({ post: updated, conflictResolved: Boolean(conflict) });
}
