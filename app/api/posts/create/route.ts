import { NextRequest } from "next/server";
import { guard, badRequest, json, newId } from "@/lib/api";
import { updateDb } from "@/lib/db";
import { buildClientState } from "@/lib/state";
import type { Post } from "@/lib/types";

export const dynamic = "force-dynamic";

// Create a single scheduled post (used by the Reel Creator's "Add to Calendar").
// Integrates with the SAME calendar + scheduler as generated plans — a scheduled
// post is auto-published at its time by the existing scheduler.
export async function POST(req: NextRequest) {
  const denied = guard();
  if (denied) return denied;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid body");
  }

  const mediaIds: string[] = Array.isArray(body?.mediaIds)
    ? body.mediaIds.map((x: any) => String(x)).filter(Boolean)
    : [];
  if (!mediaIds.length) return badRequest("Select at least one media item");

  const scheduledAt = String(body?.scheduledAt || "");
  if (isNaN(Date.parse(scheduledAt))) return badRequest("Invalid scheduled time");

  const caption = String(body?.caption || "");
  const hashtags: string[] = Array.isArray(body?.hashtags)
    ? body.hashtags.map((x: any) => String(x)).slice(0, 30)
    : [];
  const format = body?.format === "reel" ? "reel" : "post";

  const now = new Date().toISOString();

  const created = await updateDb((db) => {
    // Validate media exists.
    const items = mediaIds.map((id) => db.media.find((m) => m.id === id)).filter(Boolean);
    if (!items.length) throw new Error("Media not found");
    const validIds = items.map((m) => m!.id);
    const order = (db.posts.reduce((max, p) => Math.max(max, p.order), 0) || 0) + 1;

    const post: Post = {
      id: newId("post"),
      mediaId: validIds[0],
      mediaIds: validIds,
      order,
      caption,
      hashtags,
      cta: "",
      category: format === "reel" ? "Reel" : "Post",
      mood: "",
      subject: "",
      format,
      music: null,
      scheduledAt: new Date(scheduledAt).toISOString(),
      timezone: body?.timezone || db.settings.timezone,
      status: "scheduled",
      igMediaId: null,
      error: null,
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    db.posts.push(post);
    return post;
  });

  const state = await buildClientState();
  return json({ post: created, ...state });
}
