import { NextRequest } from "next/server";
import { guard, badRequest, ok } from "@/lib/api";
import { updateDb } from "@/lib/db";
import { removeUpload, removeThumb } from "@/lib/blobstore";

export async function POST(req: NextRequest) {
  const denied = guard();
  if (denied) return denied;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid body");
  }
  const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];
  if (!ids.length) return badRequest("No ids provided");

  const toRemove: { file: string; thumb: string | null }[] = [];
  await updateDb((db) => {
    for (const id of ids) {
      const m = db.media.find((x) => x.id === id);
      if (m) toRemove.push({ file: m.file, thumb: m.thumb });
    }
    db.media = db.media.filter((m) => !ids.includes(m.id));
    // Drop any posts that referenced deleted media, then renumber order.
    db.posts = db.posts.filter((p) => !ids.includes(p.mediaId));
    db.posts.sort((a, b) => a.order - b.order).forEach((p, i) => (p.order = i));
  });

  // Best-effort storage cleanup (don't fail the request if already gone).
  await Promise.all(
    toRemove.flatMap((r) => [
      removeUpload(r.file),
      r.thumb ? removeThumb(r.thumb) : Promise.resolve(),
    ]),
  );

  return ok({ deleted: ids.length });
}
