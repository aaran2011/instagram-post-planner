import { NextRequest } from "next/server";
import fs from "fs";
import fsp from "fs/promises";
import { Readable } from "stream";
import { readDb } from "@/lib/db";
import { uploadPath } from "@/lib/paths";

// Node Readable -> Web ReadableStream so Next's Response streams it correctly.
function toWeb(stream: fs.ReadStream): ReadableStream {
  return Readable.toWeb(stream) as unknown as ReadableStream;
}

export const dynamic = "force-dynamic";

// Serves original media with HTTP Range support (needed for video seeking and
// for Instagram to fetch the file). Intentionally not session-gated so <img>,
// <video> and Instagram's fetcher can load it.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const db = await readDb();
  const media = db.media.find((m) => m.id === params.id);
  if (!media) return new Response("Not found", { status: 404 });

  // Blob mode: media lives on a public CDN — redirect there.
  if (media.fileUrl && /^https?:\/\//i.test(media.fileUrl)) {
    return Response.redirect(media.fileUrl, 307);
  }

  const filePath = uploadPath(media.file);
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    return new Response("File missing", { status: 404 });
  }

  const total = stat.size;
  const range = req.headers.get("range");
  const headersBase: Record<string, string> = {
    "Content-Type": media.mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };

  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    let start = match && match[1] ? parseInt(match[1], 10) : 0;
    let end = match && match[2] ? parseInt(match[2], 10) : total - 1;
    if (isNaN(start)) start = 0;
    if (isNaN(end) || end >= total) end = total - 1;
    if (start > end) return new Response("Range Not Satisfiable", { status: 416 });
    const chunkSize = end - start + 1;
    const stream = fs.createReadStream(filePath, { start, end });
    return new Response(toWeb(stream), {
      status: 206,
      headers: {
        ...headersBase,
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Content-Length": String(chunkSize),
      },
    });
  }

  const stream = fs.createReadStream(filePath);
  return new Response(toWeb(stream), {
    status: 200,
    headers: { ...headersBase, "Content-Length": String(total) },
  });
}
