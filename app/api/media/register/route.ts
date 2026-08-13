import { NextRequest } from "next/server";
import { guard, badRequest, json, newId } from "@/lib/api";
import { updateDb } from "@/lib/db";
import { publicMedia } from "@/lib/state";
import type { MediaItem, MediaType } from "@/lib/types";

export const dynamic = "force-dynamic";

// Creates a media record after the browser has uploaded the file directly to
// Blob. Only small JSON metadata comes through here — no size limit concern.
export async function POST(req: NextRequest) {
  const denied = guard();
  if (denied) return denied;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid body");
  }

  const fileUrl = String(body?.fileUrl || "");
  if (!/^https?:\/\//i.test(fileUrl)) return badRequest("Missing fileUrl");

  const type: MediaType = body?.type === "video" ? "video" : "photo";
  const num = (v: any) => {
    const n = v == null ? NaN : parseFloat(String(v));
    return isNaN(n) ? null : n;
  };

  const item: MediaItem = {
    id: newId("media"),
    type,
    originalName: String(body?.originalName || "upload"),
    mime: String(body?.mime || (type === "video" ? "video/mp4" : "image/jpeg")),
    size: num(body?.size) ?? 0,
    width: num(body?.width),
    height: num(body?.height),
    duration: num(body?.duration),
    // For Blob, the key used for deletion is the public URL.
    file: fileUrl,
    thumb: body?.thumbUrl ? String(body.thumbUrl) : null,
    fileUrl,
    thumbUrl: body?.thumbUrl ? String(body.thumbUrl) : null,
    createdAt: new Date().toISOString(),
    analysis: null,
  };

  await updateDb((db) => db.media.push(item));
  return json({ media: publicMedia(item) });
}
