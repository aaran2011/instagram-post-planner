import { readDb, updateDb, readAccount, updateAccount, currentUserId, listAccountIds } from "./db";
import { publishPost, publicMediaUrl } from "./instagram";
import { getValidYouTubeToken, NEEDS_RECONNECT } from "./oauth";
import { ensureDriveFolder, uploadImageToDrive, DriveSetupError } from "./drive";
import type { Post, MediaItem, Database } from "./types";

// Mirror a published post's IMAGES to the account's Google Drive folder, with
// the exact caption as each file's description. Best-effort: never throws, and
// never blocks publishing. The user wires that folder to LinkedIn via a free
// connector, which is how images reach LinkedIn without LinkedIn's blocked API.
async function mirrorImagesToDrive(
  uid: string, db: Database, post: Post, mediaItems: MediaItem[],
  write: (fn: (d: Database) => void) => Promise<unknown>,
): Promise<void> {
  if (!db.crossPost.driveMirror) return;
  const images = mediaItems.filter((m) => m.type !== "video");
  if (!images.length) return;

  const caption = [post.caption, post.cta, (post.hashtags || []).join(" ")].filter(Boolean).join("\n\n");
  const logEntry = (drive: { ok: boolean; count?: number; error?: string }) =>
    write((d) => {
      d.crossPost.log = [{ igId: post.id, at: new Date().toISOString(), caption: caption.slice(0, 140), drive }, ...d.crossPost.log].slice(0, 100);
    });

  try {
    const token = await getValidYouTubeToken(uid); // same Google connection (now with drive.file)

    let folderId = db.crossPost.driveFolderId;
    if (!folderId) {
      const folder = await ensureDriveFolder(token);
      folderId = folder.id;
      await write((d) => { d.crossPost.driveFolderId = folder.id; d.crossPost.driveFolderLink = folder.link; });
    }

    const stamp = new Date().toISOString().slice(0, 10);
    let count = 0;
    for (let i = 0; i < images.length; i++) {
      const m = images[i];
      const url = publicMediaUrl(m);
      if (!url) continue;
      const r = await fetch(url);
      if (!r.ok) continue;
      const bytes = Buffer.from(await r.arrayBuffer());
      const mime = r.headers.get("content-type") || "image/jpeg";
      const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
      const name = `${stamp}-${post.id}${images.length > 1 ? `-${i + 1}` : ""}.${ext}`;
      await uploadImageToDrive(token, folderId, { name, bytes, mime, description: caption });
      count++;
    }
    await logEntry({ ok: count > 0, count });
  } catch (e: any) {
    const msg = e?.message === NEEDS_RECONNECT
      ? "reconnect Google (Drive access) in Settings"
      : e instanceof DriveSetupError
        ? `Google Drive not ready: ${String(e.message).slice(0, 120)}`
        : String(e?.message || e).slice(0, 140);
    await logEntry({ ok: false, error: msg });
  }
}

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
    // Mirror images to Drive even in demo, so the LinkedIn path works regardless
    // of whether Instagram itself is live.
    await mirrorImagesToDrive(uid, db, post, mediaItems, write);
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
    await mirrorImagesToDrive(uid, db, post, mediaItems, write);
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
