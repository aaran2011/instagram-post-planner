import { NextRequest } from "next/server";
import { guard, badRequest, json } from "@/lib/api";
import { readDb, updateDb } from "@/lib/db";
import {
  regenerateCaption,
  regenerateHashtags,
  regenerateMusic,
  regenerateRecommendation,
} from "@/lib/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Regenerate ONE aspect of a post (caption | hashtags | music | recommendation).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = guard();
  if (denied) return denied;

  let body: any = {};
  try {
    body = await req.json();
  } catch {}
  const field = String(body?.field || "");

  const db = await readDb();
  const post = db.posts.find((p) => p.id === params.id);
  if (!post) return json({ error: "Post not found" }, 404);
  const media = db.media.find((m) => m.id === post.mediaId);
  if (!media) return json({ error: "Media not found" }, 404);

  // A rotating variant so repeated clicks produce different results.
  const variant = Math.floor((Date.now() / 1000) % 997);

  if (field === "caption") {
    const { caption, cta } = await regenerateCaption(media, db.settings, variant);
    const updated = await updateDb((d) => {
      const p = d.posts.find((x) => x.id === post.id)!;
      p.caption = caption;
      p.cta = cta;
      p.updatedAt = new Date().toISOString();
      return p;
    });
    return json({ post: updated });
  }

  if (field === "hashtags") {
    const hashtags = await regenerateHashtags(media, variant);
    const updated = await updateDb((d) => {
      const p = d.posts.find((x) => x.id === post.id)!;
      p.hashtags = hashtags;
      p.updatedAt = new Date().toISOString();
      return p;
    });
    return json({ post: updated });
  }

  if (field === "music") {
    if (media.type === "video") {
      return badRequest("Videos keep their original audio — no music is suggested.");
    }
    const music = regenerateMusic(media, variant);
    const updated = await updateDb((d) => {
      const p = d.posts.find((x) => x.id === post.id)!;
      p.music = music;
      p.updatedAt = new Date().toISOString();
      return p;
    });
    return json({ post: updated });
  }

  if (field === "recommendation") {
    const rec = regenerateRecommendation(media);
    const updated = await updateDb((d) => {
      const p = d.posts.find((x) => x.id === post.id)!;
      p.subject = rec.subject;
      p.category = rec.category;
      p.mood = rec.mood;
      p.format = rec.format;
      p.updatedAt = new Date().toISOString();
      return p;
    });
    return json({ post: updated });
  }

  return badRequest("Unknown field. Use caption | hashtags | music | recommendation.");
}
