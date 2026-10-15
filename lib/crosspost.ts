import { readAccount, updateAccount, listAccountIds } from "./db";
import { fetchRecentMedia, type IgMediaItem } from "./instagram";
import { getValidLinkedInToken, getValidYouTubeToken, NEEDS_RECONNECT } from "./oauth";
import { postImage, postMultiImage, postVideo, postText } from "./linkedin";
import { uploadShort, QuotaError } from "./youtube";
import type { CrossPostLogEntry } from "./types";

// Background engine: reposts an account's NEW Instagram media to its connected
// LinkedIn + YouTube. Videos/reels → LinkedIn + YouTube Shorts; photos/carousels
// → LinkedIn only. Account-scoped (no session) so the scheduler can run it.

const MAX_PER_TICK = 2; // respect YouTube quota + the 300s serverless budget
const MAX_BYTES = 100 * 1024 * 1024; // skip anything larger than 100MB
const SYNC_INTERVAL_MS = 15 * 60 * 1000; // at most ~every 15 min per account
const KEEP_IDS = 500; // cap the dedup set

export interface SyncOutcome { uid: string; processed: number; results: CrossPostLogEntry[]; }

async function fetchBytes(url: string): Promise<{ buf: Buffer; mime: string }> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`media fetch failed (${r.status})`);
  const ab = await r.arrayBuffer();
  return { buf: Buffer.from(ab), mime: r.headers.get("content-type") || "" };
}

function softSkip(x?: { skipped?: string }): boolean {
  return Boolean(x?.skipped && (x.skipped.includes("reconnect") || x.skipped.includes("quota")));
}

export async function syncAccount(uid: string, now = new Date()): Promise<SyncOutcome> {
  const db = await readAccount(uid);
  if (!db) return { uid, processed: 0, results: [] };

  const cp = db.crossPost;
  const liOn = cp.destinations.linkedin && db.linkedin.connected;
  const ytOn = cp.destinations.youtube && db.youtube.connected;
  const igToken = db.secrets.instagramAccessToken;
  const igUserId = db.instagram.igUserId;

  // Bail quietly unless everything needed is present and real.
  if (!cp.enabled || !db.instagram.connected || db.instagram.demo || db.settings.demoMode ||
      !igToken || !igUserId || (!liOn && !ytOn)) {
    await updateAccount(uid, (d) => { d.crossPost.lastSyncAt = now.toISOString(); });
    return { uid, processed: 0, results: [] };
  }

  let items: IgMediaItem[] = [];
  try {
    items = await fetchRecentMedia(igToken, igUserId, 25);
  } catch {
    await updateAccount(uid, (d) => { d.crossPost.lastSyncAt = now.toISOString(); });
    return { uid, processed: 0, results: [] };
  }

  // First run (no baseline): seed — mark everything current as handled, no backfill.
  if (!cp.baselineAt) {
    await updateAccount(uid, (d) => {
      d.crossPost.baselineAt = now.toISOString();
      const ids = new Set(d.crossPost.repostedIgIds);
      for (const it of items) ids.add(it.id);
      d.crossPost.repostedIgIds = [...ids].slice(-KEEP_IDS);
      d.crossPost.lastSyncAt = now.toISOString();
    });
    return { uid, processed: 0, results: [] };
  }

  const already = new Set(cp.repostedIgIds);
  const baseline = Date.parse(cp.baselineAt);
  const candidates = items
    .filter((it) => !already.has(it.id) && it.timestamp && Date.parse(it.timestamp) > baseline)
    .sort((a, b) => Date.parse(a.timestamp || "") - Date.parse(b.timestamp || ""))
    .slice(0, MAX_PER_TICK);

  const results: CrossPostLogEntry[] = [];

  for (const item of candidates) {
    const caption = item.caption || "";
    const permalink = item.permalink || "";
    const entry: CrossPostLogEntry = { igId: item.id, at: now.toISOString(), caption: caption.slice(0, 140) };
    let attempted = false;

    // ---- LinkedIn ----
    if (liOn) {
      attempted = true;
      try {
        const token = await getValidLinkedInToken(uid);
        const author = `urn:li:person:${db.linkedin.memberId}`;
        if (item.mediaType === "VIDEO" && item.mediaUrl) {
          const { buf, mime } = await fetchBytes(item.mediaUrl);
          if (buf.length > MAX_BYTES) { entry.linkedin = { ok: false, error: "video too large" }; }
          else {
            try {
              const r = await postVideo(token, author, caption, buf);
              entry.linkedin = { ok: true, id: r.id };
            } catch {
              // video posting may be unavailable → fall back to a text + link post
              const r = await postText(token, author, `${caption}\n\n${permalink}`.trim());
              entry.linkedin = { ok: true, id: r.id, skipped: "video-unavailable-posted-link" };
            }
          }
        } else if (item.mediaType === "CAROUSEL_ALBUM") {
          const imgs = item.children.filter((c) => c.mediaType === "IMAGE" && c.mediaUrl);
          if (imgs.length) {
            const loaded = [];
            for (const c of imgs) { const { buf, mime } = await fetchBytes(c.mediaUrl!); loaded.push({ bytes: buf, mime: mime || "image/jpeg" }); }
            const r = await postMultiImage(token, author, caption, loaded);
            entry.linkedin = { ok: true, id: r.id };
          } else {
            const r = await postText(token, author, `${caption}\n\n${permalink}`.trim());
            entry.linkedin = { ok: true, id: r.id };
          }
        } else if (item.mediaUrl) { // IMAGE
          const { buf, mime } = await fetchBytes(item.mediaUrl);
          const r = await postImage(token, author, caption, buf, mime || "image/jpeg");
          entry.linkedin = { ok: true, id: r.id };
        } else {
          entry.linkedin = { ok: false, error: "no media url" };
        }
      } catch (e: any) {
        entry.linkedin = e?.message === NEEDS_RECONNECT
          ? { ok: false, skipped: "reconnect linkedin" }
          : { ok: false, error: String(e?.message || e).slice(0, 160) };
      }
    }

    // ---- YouTube (videos/reels only) ----
    if (ytOn && item.mediaType === "VIDEO") {
      attempted = true;
      try {
        if (!item.mediaUrl) throw new Error("no media url");
        const token = await getValidYouTubeToken(uid);
        const { buf, mime } = await fetchBytes(item.mediaUrl);
        if (buf.length > MAX_BYTES) { entry.youtube = { ok: false, error: "video too large" }; }
        else {
          const title = (caption.split("\n")[0] || "Instagram reel").slice(0, 100);
          const r = await uploadShort(token, { title, description: caption, videoBytes: buf, mime: mime || "video/mp4" });
          entry.youtube = { ok: true, id: r.videoId };
        }
      } catch (e: any) {
        if (e instanceof QuotaError) entry.youtube = { ok: false, skipped: "quota" };
        else if (e?.message === NEEDS_RECONNECT) entry.youtube = { ok: false, skipped: "reconnect youtube" };
        else entry.youtube = { ok: false, error: String(e?.message || e).slice(0, 160) };
      }
    }

    // Mark the item done UNLESS every attempted destination soft-skipped
    // (reconnect/quota) — those should be retried on a later tick.
    const liSkip = !liOn || softSkip(entry.linkedin);
    const ytSkip = (!ytOn || item.mediaType !== "VIDEO") || softSkip(entry.youtube);
    const onlySoftSkipped = attempted && liSkip && ytSkip &&
      (softSkip(entry.linkedin) || softSkip(entry.youtube));
    const markDone = !onlySoftSkipped;

    await updateAccount(uid, (d) => {
      if (markDone) {
        d.crossPost.repostedIgIds = [...d.crossPost.repostedIgIds, item.id].slice(-KEEP_IDS);
      }
      d.crossPost.log = [entry, ...d.crossPost.log].slice(0, 100);
      d.crossPost.lastSyncAt = now.toISOString();
    });
    results.push(entry);
  }

  if (!candidates.length) {
    await updateAccount(uid, (d) => { d.crossPost.lastSyncAt = now.toISOString(); });
  }

  return { uid, processed: results.length, results };
}

// Run the sync for every account with cross-posting enabled, throttled.
export async function processAllCrossPosts(now = new Date()): Promise<SyncOutcome[]> {
  const ids = await listAccountIds();
  const out: SyncOutcome[] = [];
  for (const uid of ids) {
    const db = await readAccount(uid);
    if (!db?.crossPost.enabled) continue;
    const last = db.crossPost.lastSyncAt ? Date.parse(db.crossPost.lastSyncAt) : 0;
    if (now.getTime() - last < SYNC_INTERVAL_MS) continue;
    try { out.push(await syncAccount(uid, now)); } catch { /* never break the tick */ }
  }
  return out;
}
