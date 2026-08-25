import { NextRequest } from "next/server";
import { guard, badRequest, json, newId } from "@/lib/api";
import { readDb, updateDb } from "@/lib/db";
import { buildClientState } from "@/lib/state";
import { buildSlots } from "@/lib/schedule";
import { regenerateCaption, regenerateHashtags } from "@/lib/ai";
import type { Post } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TWO_DAYS = 2 * 24 * 3600 * 1000;

// Create a single scheduled post (used by the Reel Creator's "Add to Calendar").
// With auto=true it writes its own caption/hashtags and picks the time itself —
// reels are spaced every ALTERNATE day (>=2 days apart) whenever possible.
export async function POST(req: NextRequest) {
  const denied = guard();
  if (denied) return denied;

  let body: any;
  try { body = await req.json(); } catch { return badRequest("Invalid body"); }

  const mediaIds: string[] = Array.isArray(body?.mediaIds)
    ? body.mediaIds.map((x: any) => String(x)).filter(Boolean) : [];
  if (!mediaIds.length) return badRequest("Select at least one media item");

  const format = body?.format === "reel" ? "reel" : "post";
  const auto = body?.auto === true;

  const db = await readDb();
  const cover = db.media.find((m) => mediaIds.includes(m.id));
  if (!cover) return badRequest("Media not found");

  // ---- caption / hashtags ----
  let caption = String(body?.caption || "");
  let cta = "";
  let hashtags: string[] = Array.isArray(body?.hashtags)
    ? body.hashtags.map((x: any) => String(x)).slice(0, 30) : [];
  if (auto && !caption) {
    try {
      const variant = Math.floor((Date.now() / 1000) % 997);
      const c = await regenerateCaption(cover, db.settings, variant);
      caption = c.caption; cta = c.cta;
      if (!hashtags.length) hashtags = await regenerateHashtags(cover, variant);
    } catch { /* fall back to empty caption */ }
  }

  // ---- schedule time ----
  let scheduledIso = String(body?.scheduledAt || "");
  if (!scheduledIso || isNaN(Date.parse(scheduledIso))) {
    // Auto time. For reels, place at least 2 days after the last reel (or now),
    // at a preferred posting time; for other posts, next preferred slot.
    const times = db.settings.defaultTimes;
    const tz = db.settings.timezone;
    if (format === "reel") {
      const reelTimes = db.posts
        .filter((p) => p.format === "reel")
        .map((p) => Date.parse(p.scheduledAt))
        .filter((n) => !isNaN(n));
      const lastReel = reelTimes.length ? Math.max(...reelTimes) : 0;
      const from = new Date(Math.max(Date.now(), lastReel + TWO_DAYS) - 1000);
      const slot = buildSlots(1, { times, cadenceDays: 2, tz, from })[0];
      scheduledIso = (slot ?? new Date(Date.now() + TWO_DAYS)).toISOString();
    } else {
      const allTimes = db.posts.map((p) => Date.parse(p.scheduledAt)).filter((n) => !isNaN(n));
      const from = allTimes.length ? new Date(Math.max(...allTimes)) : new Date();
      const slot = buildSlots(1, { times, cadenceDays: db.settings.postingCadenceDays, tz, from })[0];
      scheduledIso = (slot ?? new Date()).toISOString();
    }
  }
  if (isNaN(Date.parse(scheduledIso))) return badRequest("Invalid scheduled time");

  const now = new Date().toISOString();
  const created = await updateDb((d) => {
    const items = mediaIds.map((id) => d.media.find((m) => m.id === id)).filter(Boolean);
    if (!items.length) throw new Error("Media not found");
    const validIds = items.map((m) => m!.id);
    const order = (d.posts.reduce((max, p) => Math.max(max, p.order), 0) || 0) + 1;
    const post: Post = {
      id: newId("post"),
      mediaId: validIds[0],
      mediaIds: validIds,
      order,
      caption,
      hashtags,
      cta,
      category: format === "reel" ? "Reel" : "Post",
      mood: "", subject: "", format, music: null,
      scheduledAt: new Date(scheduledIso).toISOString(),
      timezone: body?.timezone || d.settings.timezone,
      status: "scheduled",
      igMediaId: null, error: null, publishedAt: null,
      createdAt: now, updatedAt: now,
    };
    d.posts.push(post);
    return post;
  });

  const state = await buildClientState();
  return json({ post: created, ...state });
}
