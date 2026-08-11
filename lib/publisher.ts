import { readDb, updateDb } from "./db";
import { publishPost } from "./instagram";
import type { Post } from "./types";

// Publishing service. Honors demo mode so test content is NEVER sent to
// Instagram, and only reports "published" when the real API confirms it.

export interface PublishOutcome {
  postId: string;
  status: Post["status"];
  error?: string;
  demo?: boolean;
}

export async function publishOne(postId: string, opts?: { force?: boolean }): Promise<PublishOutcome> {
  const db = await readDb();
  const post = db.posts.find((p) => p.id === postId);
  if (!post) return { postId, status: "failed", error: "Post not found" };
  const media = db.media.find((m) => m.id === post.mediaId);
  if (!media) {
    await setStatus(postId, "failed", "Media file missing");
    return { postId, status: "failed", error: "Media file missing" };
  }

  // Demo mode: simulate a successful publish, clearly labeled, no API calls.
  if (db.settings.demoMode) {
    await updateDb((d) => {
      const p = d.posts.find((x) => x.id === postId);
      if (p) {
        p.status = "demo_published";
        p.publishedAt = new Date().toISOString();
        p.igMediaId = "DEMO";
        p.error = null;
        p.updatedAt = new Date().toISOString();
      }
    });
    return { postId, status: "demo_published", demo: true };
  }

  // Real publish path.
  if (!db.instagram.connected || !db.secrets.instagramAccessToken || !db.instagram.igUserId) {
    const msg = "Instagram is not connected. Connect a Business account before publishing.";
    await setStatus(postId, "failed", msg);
    return { postId, status: "failed", error: msg };
  }

  await setStatus(postId, "publishing", null);
  try {
    const result = await publishPost(
      post,
      media,
      db.secrets.instagramAccessToken,
      db.instagram.igUserId,
    );
    await updateDb((d) => {
      const p = d.posts.find((x) => x.id === postId);
      if (p) {
        p.status = "published";
        p.igMediaId = result.igMediaId;
        p.publishedAt = new Date().toISOString();
        p.error = null;
        p.updatedAt = new Date().toISOString();
      }
    });
    return { postId, status: "published" };
  } catch (e: any) {
    const msg = e?.message || "Publish failed";
    await setStatus(postId, "failed", msg);
    return { postId, status: "failed", error: msg };
  }
}

async function setStatus(postId: string, status: Post["status"], error: string | null) {
  await updateDb((d) => {
    const p = d.posts.find((x) => x.id === postId);
    if (p) {
      p.status = status;
      p.error = error;
      p.updatedAt = new Date().toISOString();
    }
  });
}

// Publish everything that is scheduled and now due. Called by the scheduler.
export async function processDue(now = new Date()): Promise<PublishOutcome[]> {
  const db = await readDb();
  const due = db.posts.filter(
    (p) => p.status === "scheduled" && new Date(p.scheduledAt).getTime() <= now.getTime(),
  );
  const outcomes: PublishOutcome[] = [];
  for (const post of due) {
    outcomes.push(await publishOne(post.id));
  }
  return outcomes;
}
