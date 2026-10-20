import { readAccount, updateAccount, listAccountIds } from "./db";
import { newId } from "./api";
import { fetchRecentMedia, type IgMediaItem } from "./instagram";
import { getValidLinkedInToken, getValidYouTubeToken, NEEDS_RECONNECT } from "./oauth";
import { postImage, postMultiImage, postVideo, postText } from "./linkedin";
import { uploadShort, QuotaError } from "./youtube";
import type { CrossPostLogEntry, CrossPostDestination, Database } from "./types";

// Background + on-demand engine: reposts an account's Instagram media to its
// connected LinkedIn + YouTube, byte-for-byte (media and caption are never
// modified). Videos/reels → LinkedIn + YouTube Shorts; photos/carousels →
// LinkedIn only. Account-scoped (no session) so the scheduler can run it.

const MAX_JOBS_PER_TICK = 3;
const MAX_BYTES = 100 * 1024 * 1024;
const SYNC_INTERVAL_MS = 15 * 60 * 1000;
const KEEP_IDS = 500;

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

// Post ONE Instagram item to the requested destinations (gated on connection).
// Caption + media are passed through unchanged. Returns the log entry + whether
// the item should be considered handled (markDone=false only when everything
// soft-skipped, i.e. reconnect/quota, so it can be retried later).
export async function crossPostOne(
  uid: string, db: Database, item: IgMediaItem, wantLinkedIn: boolean, wantYouTube: boolean,
): Promise<{ entry: CrossPostLogEntry; markDone: boolean }> {
  const caption = item.caption || "";
  const permalink = item.permalink || "";
  const entry: CrossPostLogEntry = { igId: item.id, at: new Date().toISOString(), caption: caption.slice(0, 140) };

  const doLinkedIn = wantLinkedIn && db.linkedin.connected;
  const doYouTube = wantYouTube && db.youtube.connected && item.mediaType === "VIDEO";
  let attempted = false;

  if (doLinkedIn) {
    attempted = true;
    try {
      const token = await getValidLinkedInToken(uid);
      const author = `urn:li:person:${db.linkedin.memberId}`;
      if (item.mediaType === "VIDEO" && item.mediaUrl) {
        const { buf } = await fetchBytes(item.mediaUrl);
        if (buf.length > MAX_BYTES) entry.linkedin = { ok: false, error: "video too large" };
        else {
          try {
            const r = await postVideo(token, author, caption, buf);
            entry.linkedin = { ok: true, id: r.id };
          } catch {
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
      } else if (item.mediaUrl) {
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

  if (doYouTube) {
    attempted = true;
    try {
      if (!item.mediaUrl) throw new Error("no media url");
      const token = await getValidYouTubeToken(uid);
      const { buf, mime } = await fetchBytes(item.mediaUrl);
      if (buf.length > MAX_BYTES) entry.youtube = { ok: false, error: "video too large" };
      else {
        const title = (caption.split("\n")[0] || "Instagram reel");
        const r = await uploadShort(token, { title, description: caption, videoBytes: buf, mime: mime || "video/mp4" });
        entry.youtube = { ok: true, id: r.videoId };
      }
    } catch (e: any) {
      if (e instanceof QuotaError) entry.youtube = { ok: false, skipped: "quota" };
      else if (e?.message === NEEDS_RECONNECT) entry.youtube = { ok: false, skipped: "reconnect youtube" };
      else entry.youtube = { ok: false, error: String(e?.message || e).slice(0, 160) };
    }
  }

  const liSkip = !doLinkedIn || softSkip(entry.linkedin);
  const ytSkip = !doYouTube || softSkip(entry.youtube);
  const onlySoft = attempted && liSkip && ytSkip && (softSkip(entry.linkedin) || softSkip(entry.youtube));
  return { entry, markDone: !onlySoft };
}

// ---- Watcher: auto-repost new IG media on a throttle ----
async function syncAccount(uid: string, now = new Date()): Promise<SyncOutcome> {
  const db = await readAccount(uid);
  if (!db) return { uid, processed: 0, results: [] };
  const cp = db.crossPost;
  const liOn = cp.destinations.linkedin && db.linkedin.connected;
  const ytOn = cp.destinations.youtube && db.youtube.connected;
  const igToken = db.secrets.instagramAccessToken;
  const igUserId = db.instagram.igUserId;

  // Cross-posting needs a REAL Instagram to read from + a connected destination.
  // It is independent of the IG "Demo mode" (that only simulates IG publishing).
  if (!cp.enabled || !db.instagram.connected || db.instagram.demo ||
      !igToken || !igUserId || (!liOn && !ytOn)) {
    await updateAccount(uid, (d) => { d.crossPost.lastSyncAt = now.toISOString(); });
    return { uid, processed: 0, results: [] };
  }

  let items: IgMediaItem[] = [];
  try { items = await fetchRecentMedia(igToken, igUserId, 25); }
  catch { await updateAccount(uid, (d) => { d.crossPost.lastSyncAt = now.toISOString(); }); return { uid, processed: 0, results: [] }; }

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

  // Rate limit: auto-repost at most ONE item per 24h.
  const DAILY_MS = 24 * 3600 * 1000;
  const lastRepost = cp.lastRepostAt ? Date.parse(cp.lastRepostAt) : 0;
  if (now.getTime() - lastRepost < DAILY_MS) {
    await updateAccount(uid, (d) => { d.crossPost.lastSyncAt = now.toISOString(); });
    return { uid, processed: 0, results: [] };
  }

  const already = new Set(cp.repostedIgIds);
  const baseline = Date.parse(cp.baselineAt);
  const candidates = items
    .filter((it) => !already.has(it.id) && it.timestamp && Date.parse(it.timestamp) > baseline)
    .sort((a, b) => Date.parse(a.timestamp || "") - Date.parse(b.timestamp || ""))
    .slice(0, 1); // one per day

  const results: CrossPostLogEntry[] = [];
  for (const item of candidates) {
    const { entry, markDone } = await crossPostOne(uid, db, item, cp.destinations.linkedin, cp.destinations.youtube);
    const posted = Boolean(entry.linkedin?.ok || entry.youtube?.ok);
    await updateAccount(uid, (d) => {
      if (markDone) d.crossPost.repostedIgIds = [...d.crossPost.repostedIgIds, item.id].slice(-KEEP_IDS);
      if (posted) d.crossPost.lastRepostAt = now.toISOString(); // start the 24h clock
      d.crossPost.log = [entry, ...d.crossPost.log].slice(0, 100);
      d.crossPost.lastSyncAt = now.toISOString();
    });
    results.push(entry);
  }
  if (!candidates.length) await updateAccount(uid, (d) => { d.crossPost.lastSyncAt = now.toISOString(); });
  return { uid, processed: results.length, results };
}

// ---- Scheduled jobs (from the Automation builder) ----
async function processDueJobs(uid: string, now: Date): Promise<number> {
  const db = await readAccount(uid);
  if (!db || db.instagram.demo) return 0;
  const igToken = db.secrets.instagramAccessToken;
  const igUserId = db.instagram.igUserId;
  if (!igToken || !igUserId) return 0;
  const due = db.crossPost.jobs.filter((j) => j.status === "scheduled" && Date.parse(j.scheduledAt) <= now.getTime());
  if (!due.length) return 0;

  let items: IgMediaItem[] = [];
  try { items = await fetchRecentMedia(igToken, igUserId, 50); } catch { return 0; }

  let done = 0;
  for (const job of due.slice(0, MAX_JOBS_PER_TICK)) {
    const item = items.find((it) => it.id === job.igId);
    if (!item) {
      await updateAccount(uid, (d) => { const j = d.crossPost.jobs.find((x) => x.id === job.id); if (j) j.status = "failed"; });
      continue;
    }
    const { entry } = await crossPostOne(
      uid, db, item, job.destinations.includes("linkedin"), job.destinations.includes("youtube"),
    );
    const ok = Boolean(entry.linkedin?.ok || entry.youtube?.ok);
    await updateAccount(uid, (d) => {
      const j = d.crossPost.jobs.find((x) => x.id === job.id);
      if (j) { j.status = ok ? "done" : "failed"; j.result = entry; }
      d.crossPost.repostedIgIds = [...d.crossPost.repostedIgIds, item.id].slice(-KEEP_IDS);
      d.crossPost.log = [entry, ...d.crossPost.log].slice(0, 100);
    });
    done++;
  }
  return done;
}

// Run the sync + due jobs for every account, throttled for the watcher.
export async function processAllCrossPosts(now = new Date()): Promise<SyncOutcome[]> {
  const ids = await listAccountIds();
  const out: SyncOutcome[] = [];
  for (const uid of ids) {
    const db = await readAccount(uid);
    if (!db) continue;
    try { await processDueJobs(uid, now); } catch { /* ignore */ }
    if (!db.crossPost.enabled) continue;
    const last = db.crossPost.lastSyncAt ? Date.parse(db.crossPost.lastSyncAt) : 0;
    if (now.getTime() - last < SYNC_INTERVAL_MS) continue;
    try { out.push(await syncAccount(uid, now)); } catch { /* never break the tick */ }
  }
  return out;
}

// ---- On-demand helpers for the Automation builder (session-scoped callers) ----

export interface ReviewItem {
  id: string; mediaType: IgMediaItem["mediaType"]; caption: string;
  thumbUrl: string | null; permalink: string | null; timestamp: string | null;
  isVideo: boolean; reposted: boolean; queued: boolean;
}

export async function listIgMediaForReview(uid: string): Promise<ReviewItem[]> {
  const db = await readAccount(uid);
  if (!db?.instagram.connected || !db.secrets.instagramAccessToken || !db.instagram.igUserId) return [];
  const items = await fetchRecentMedia(db.secrets.instagramAccessToken, db.instagram.igUserId, 30);
  const reposted = new Set(db.crossPost.repostedIgIds);
  const queued = new Set(db.crossPost.jobs.filter((j) => j.status === "scheduled").map((j) => j.igId));
  return items.map((it) => ({
    id: it.id, mediaType: it.mediaType, caption: it.caption,
    thumbUrl: it.thumbnailUrl, permalink: it.permalink, timestamp: it.timestamp,
    isVideo: it.mediaType === "VIDEO",
    reposted: reposted.has(it.id), queued: queued.has(it.id),
  }));
}

// Post one item immediately, or schedule it for later. `destinations` is the
// user's choice; YouTube is auto-dropped for non-videos.
export async function runOrScheduleItem(
  uid: string, igId: string, destinations: CrossPostDestination[], scheduledAt?: string,
): Promise<{ scheduled: boolean; entry?: CrossPostLogEntry; error?: string }> {
  const db = await readAccount(uid);
  if (!db?.instagram.connected || !db.secrets.instagramAccessToken || !db.instagram.igUserId) {
    return { scheduled: false, error: "Instagram not connected" };
  }
  const items = await fetchRecentMedia(db.secrets.instagramAccessToken, db.instagram.igUserId, 50);
  const item = items.find((it) => it.id === igId);
  if (!item) return { scheduled: false, error: "That Instagram item wasn't found" };
  const wantLinkedIn = destinations.includes("linkedin");
  const wantYouTube = destinations.includes("youtube") && item.mediaType === "VIDEO";

  const when = scheduledAt ? Date.parse(scheduledAt) : NaN;
  if (!isNaN(when) && when > Date.now() + 30_000) {
    // schedule a job
    await updateAccount(uid, (d) => {
      d.crossPost.jobs = [
        {
          id: newId("xpost"), igId, mediaType: item.mediaType,
          destinations: [...(wantLinkedIn ? ["linkedin"] : []), ...(destinations.includes("youtube") && item.mediaType === "VIDEO" ? ["youtube"] : [])] as CrossPostDestination[],
          caption: item.caption, thumbUrl: item.thumbnailUrl,
          scheduledAt: new Date(when).toISOString(), status: "scheduled" as const, createdAt: new Date().toISOString(),
        },
        ...d.crossPost.jobs,
      ].slice(0, 200);
    });
    return { scheduled: true };
  }

  // post now
  const { entry, markDone } = await crossPostOne(uid, db, item, wantLinkedIn, wantYouTube);
  await updateAccount(uid, (d) => {
    if (markDone) d.crossPost.repostedIgIds = [...d.crossPost.repostedIgIds, igId].slice(-KEEP_IDS);
    d.crossPost.log = [entry, ...d.crossPost.log].slice(0, 100);
  });
  return { scheduled: false, entry };
}
