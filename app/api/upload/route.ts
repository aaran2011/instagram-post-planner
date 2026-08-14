import { NextRequest } from "next/server";
import path from "path";
import { guard, badRequest, json, newId } from "@/lib/api";
import { updateDb } from "@/lib/db";
import { saveUpload, saveThumb } from "@/lib/blobstore";
import { publicMedia } from "@/lib/state";
import type { MediaItem, MediaType } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ALLOWED: Record<string, MediaType> = {
  "image/jpeg": "photo",
  "image/jpg": "photo",
  "image/png": "photo",
  "image/webp": "photo",
  "video/mp4": "video",
  "video/quicktime": "video", // .mov
};

const EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
};

export async function POST(req: NextRequest) {
  const denied = guard();
  if (denied) return denied;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return badRequest("Expected multipart form data");
  }

  const file = form.get("file");
  if (!(file instanceof File)) return badRequest("No file provided");

  const mime = (file.type || "").toLowerCase();
  const type = ALLOWED[mime];
  if (!type) {
    return badRequest(
      `Unsupported file type "${file.type || "unknown"}". Allowed: JPG, PNG, WEBP, MP4, MOV.`,
      { code: "unsupported" },
    );
  }

  const id = newId("media");
  const ext = EXT[mime] || path.extname((file as File).name) || "";
  const storedName = `${id}${ext}`;

  try {
    // Persist the original file (Vercel Blob in prod, disk in dev).
    const buf = Buffer.from(await file.arrayBuffer());
    const stored = await saveUpload(storedName, buf, mime);

    // Persist the client-generated thumbnail if present.
    let thumbKey: string | null = null;
    let thumbUrl: string | null = null;
    const thumb = form.get("thumb");
    if (thumb instanceof File && thumb.size > 0) {
      const t = await saveThumb(`${id}.jpg`, Buffer.from(await thumb.arrayBuffer()));
      thumbKey = t.key;
      thumbUrl = t.url;
    }

    const num = (v: FormDataEntryValue | null) => {
      const n = v == null ? NaN : parseFloat(String(v));
      return isNaN(n) ? null : n;
    };

    const item: MediaItem = {
      id,
      type,
      originalName: String(form.get("originalName") || (file as File).name || storedName),
      mime,
      size: buf.length,
      width: num(form.get("width")),
      height: num(form.get("height")),
      duration: num(form.get("duration")),
      file: stored.key,
      thumb: thumbKey,
      fileUrl: stored.url,
      thumbUrl: thumbUrl,
      igUrl: (form.get("igUrl") && String(form.get("igUrl"))) || null,
      createdAt: new Date().toISOString(),
      analysis: null,
    };

    await updateDb((db) => db.media.push(item));
    return json({ media: publicMedia(item) });
  } catch (e: any) {
    // Surface the real reason instead of a blank 500.
    return json({ error: "Upload failed on server: " + String(e?.message || e).slice(0, 220) }, 500);
  }
}
