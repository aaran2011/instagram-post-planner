import fsp from "fs/promises";
import { readDb } from "@/lib/db";
import { thumbPath, uploadPath } from "@/lib/paths";

export const dynamic = "force-dynamic";

// Serves the small jpeg thumbnail; falls back to the original for photos.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const db = await readDb();
  const media = db.media.find((m) => m.id === params.id);
  if (!media) return new Response("Not found", { status: 404 });

  // Blob mode: redirect to the CDN thumbnail (or the file itself).
  const cdn = media.thumbUrl || media.fileUrl;
  if (cdn && /^https?:\/\//i.test(cdn)) {
    return Response.redirect(cdn, 307);
  }

  if (media.thumb) {
    try {
      const buf = await fsp.readFile(thumbPath(media.thumb));
      return new Response(buf, {
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" },
      });
    } catch {
      // fall through
    }
  }
  if (media.type === "photo") {
    try {
      const buf = await fsp.readFile(uploadPath(media.file));
      return new Response(buf, {
        headers: { "Content-Type": media.mime, "Cache-Control": "private, max-age=3600" },
      });
    } catch {}
  }
  return new Response("No thumbnail", { status: 404 });
}
