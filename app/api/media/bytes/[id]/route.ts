import { NextRequest } from "next/server";
import fs from "fs";
import fsp from "fs/promises";
import { Readable } from "stream";
import { guard } from "@/lib/api";
import { readDb } from "@/lib/db";
import { uploadPath } from "@/lib/paths";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Same-origin byte proxy for a media item. Unlike /api/media/file (which
// redirects to the Blob CDN), this STREAMS the bytes through our own origin so
// client-side ffmpeg.wasm can read them without any cross-origin restriction.
// Session-gated (used only inside the authed app for audio muxing).
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = guard();
  if (denied) return denied;

  const db = await readDb();
  const media = db.media.find((m) => m.id === params.id);
  if (!media) return new Response("Not found", { status: 404 });

  // Blob mode: fetch the CDN file server-side and pass the bytes back same-origin.
  if (media.fileUrl && /^https?:\/\//i.test(media.fileUrl)) {
    const upstream = await fetch(media.fileUrl);
    if (!upstream.ok || !upstream.body) return new Response("Upstream error", { status: 502 });
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": media.mime || upstream.headers.get("content-type") || "application/octet-stream",
        "Cache-Control": "private, max-age=600",
      },
    });
  }

  // Disk mode.
  const filePath = uploadPath(media.file);
  try {
    await fsp.stat(filePath);
  } catch {
    return new Response("File missing", { status: 404 });
  }
  const stream = fs.createReadStream(filePath);
  return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
    status: 200,
    headers: { "Content-Type": media.mime, "Cache-Control": "private, max-age=600" },
  });
}
