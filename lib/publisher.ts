import { readDb, updateDb, readAccount, updateAccount, currentUserId, listAccountIds } from "./db";
import { publishPost } from "./instagram";
import type { Post, MediaItem, Database } from "./types";

// Publishing service. Honors demo mode so test content is NEVER sent to
// Instagram, and only reports "published" when the real API confirms it.
// Everything is account-scoped: a post is published using ITS OWN account's
// Instagram connection/token, so accounts never cross-post.

export interface PublishOutcome {
  postId: string;
  status: Post["status"];
  error?: string;
  demo?: boolean;
}

// Core: publish one post within a specific account (uid), using that account's
// data and Instagram connection. `read`/`write` are the account's accessors.
async function publishInAccount(
  uid: string,
  postId: string,
  read: () => Promise<Database | null>,
  write: (fn: (d: Database) => void) => Promise<unknown>,
): Promise<PublishOutcome> {
  const db = await read();
  if (!db) return { postId, status: "failed", error: "Account not found" };
  const post = db.posts.find((p) => p.id === postId);
  if (!post) return { postId, status: "failed", error: "Post not found" };

  const mediaIds = post.mediaIds && post.mediaIds.length ? post.mediaIds : [post.mediaId];
  const mediaItems = mediaIds.map((id) => db.media.find((m) => m.id === id)).filter(Boolean) as MediaItem[];

  const setStatus = (status: Post["status"], error: string | null) =>
    write((d) => {
      const p = d.posts.find((x) => x.id === postId);
      if (p) { p.status = status; p.error = error; p.updatedAt = new Date().toISOString(); }
    });

  if (!mediaItems.length) {
    await setStatus("failed", "Media file missing");
    return { postId, status: "failed", error: "Media file missing" };
  }

  // Demo mode: simulate a successful publish, clearly labeled, no API calls.
  if (db.settings.demoMode) {
    await write((d) => {
      const p = d.posts.find((x) => x.id === postId);
      if (p) { p.status = "demo_published"; p.publishedAt = new Date().toISOString(); p.igMediaId = "DEMO"; p.error = null; p.updatedAt = new Date().toISOString(); }
    });
    return { postId, status: "demo_published", demo: true };
  }

  if (!db.instagram.connected || !db.secrets.instagramAccessToken || !db.instagram.igUserId) {
    const msg = "Instagram is not connected. Connect a Business account before publishing.";
    await setStatus("failed", msg);
    return { postId, status: "failed", error: msg };
  }

  await setStatus("publishing", null);
  try {
    const result = await publishPost(post, mediaItems, db.secrets.instagramAccessToken, db.instagram.igUserId);
    await write((d) => {
      const p = d.posts.find((x) => x.id === postId);
      if (p) { p.status = "published"; p.igMediaId = result.igMediaId; p.publishedAt = new Date().toISOString(); p.error = null; p.updatedAt = new Date().toISOString(); }
    });
    return { postId, status: "published" };
  } catch (e: any) {
    const msg = e?.message || "Publish failed";
    await setStatus("failed", msg);
    return { postId, status: "failed", error: msg };
  }
}

// Publish one post in the CURRENT session's account (used by /api/publish).
export async function publishOne(postId: string, _opts?: { force?: boolean }): Promise<PublishOutcome> {
  const uid = currentUserId();
  if (!uid) return { postId, status: "failed", error: "Not signed in" };
  return publishInAccount(uid, postId, () => readDb(), (fn) => updateDb(fn));
}

async function processDueForAccount(uid: string, now: Date): Promise<PublishOutcome[]> {
  const acc = await readAccount(uid);
  if (!acc) return [];
  const due = acc.posts.filter((p) => p.status === "scheduled" && new Date(p.scheduledAt).getTime() <= now.getTime());
  const outcomes: PublishOutcome[] = [];
  for (const post of due) {
    outcomes.push(await publishInAccount(uid, post.id, () => readAccount(uid), (fn) => updateAccount(uid, fn) as Promise<unknown>));
  }
  return outcomes;
}

// Publish the current session account's due posts (client heartbeat ping).
export async function processDue(now = new Date()): Promise<PublishOutcome[]> {
  const uid = currentUserId();
  if (!uid) return [];
  return processDueForAccount(uid, now);
}

// Publish due posts across EVERY account (external cron / scheduler tick).
export async function processAllDue(now = new Date()): Promise<PublishOutcome[]> {
  const ids = await listAccountIds();
  const outcomes: PublishOutcome[] = [];
  for (const uid of ids) outcomes.push(...(await processDueForAccount(uid, now)));
  return outcomes;
}
