import { NextRequest } from "next/server";
import { guard, badRequest, json } from "@/lib/api";
import { updateDb } from "@/lib/db";
import type { Post } from "@/lib/types";

export const dynamic = "force-dynamic";

// Partial update of a single post. Only whitelisted fields are touched, so
// editing one field never regenerates or clobbers the rest.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = guard();
  if (denied) return denied;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid body");
  }

  const result = await updateDb((db) => {
    const post = db.posts.find((p) => p.id === params.id);
    if (!post) return null;

    if (typeof body.caption === "string") post.caption = body.caption;
    if (typeof body.cta === "string") post.cta = body.cta;
    if (typeof body.category === "string") post.category = body.category;
    if (typeof body.mood === "string") post.mood = body.mood;
    if (typeof body.subject === "string") post.subject = body.subject;
    if (body.format === "post" || body.format === "reel") post.format = body.format;
    if (Array.isArray(body.hashtags)) {
      post.hashtags = body.hashtags
        .map((h: any) => String(h).trim())
        .filter(Boolean)
        .map((h: string) => (h.startsWith("#") ? h : "#" + h.replace(/\s+/g, "")));
    }
    if (body.music === null) post.music = null;
    else if (body.music && typeof body.music === "object") {
      post.music = {
        name: String(body.music.name || ""),
        artist: String(body.music.artist || ""),
        supportedByApi: false,
      };
    }
    if (typeof body.scheduledAt === "string" && !isNaN(Date.parse(body.scheduledAt))) {
      post.scheduledAt = new Date(body.scheduledAt).toISOString();
    }
    if (typeof body.timezone === "string") post.timezone = body.timezone;
    if (typeof body.status === "string" && isValidStatus(body.status)) {
      post.status = body.status;
    }
    post.updatedAt = new Date().toISOString();
    return post;
  });

  if (!result) return json({ error: "Post not found" }, 404);
  return json({ post: result });
}

function isValidStatus(s: string): s is Post["status"] {
  return ["draft", "scheduled", "publishing", "published", "demo_published", "failed"].includes(s);
}
