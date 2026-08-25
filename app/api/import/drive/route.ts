import { NextRequest } from "next/server";
import { guard, badRequest, json, newId } from "@/lib/api";
import { updateDb, readDb } from "@/lib/db";
import { saveUpload } from "@/lib/blobstore";
import { buildClientState } from "@/lib/state";
import { generatePlan } from "@/lib/ai";
import type { MediaItem, MediaType } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED: Record<string, MediaType> = {
  "image/jpeg": "photo", "image/jpg": "photo", "image/png": "photo", "image/webp": "photo",
  "video/mp4": "video", "video/quicktime": "video",
};
const EXT: Record<string, string> = {
  "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/png": ".png", "image/webp": ".webp",
  "video/mp4": ".mp4", "video/quicktime": ".mov",
};

const MAX_BYTES = 60 * 1024 * 1024; // skip files larger than 60MB

function folderIdFromUrl(url: string): string | null {
  const s = String(url || "");
  const m =
    s.match(/\/folders\/([a-zA-Z0-9_-]+)/) ||
    s.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
    s.match(/\/drive\/(?:u\/\d+\/)?folders\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  // bare id
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s.trim())) return s.trim();
  return null;
}

// Import images/videos from a PUBLIC ("anyone with the link") Google Drive
// folder using an API key. No per-user OAuth. The app lists the folder, fetches
// each file server-side, and stores it like a normal upload.
export async function POST(req: NextRequest) {
  const denied = guard();
  if (denied) return denied;

  const key = process.env.GOOGLE_API_KEY || "";
  if (!key) {
    return json({
      error: "Google Drive import isn't set up yet.",
      needsSetup: true,
      setup: "Add a GOOGLE_API_KEY environment variable (a Google Cloud API key with the Drive API enabled), then share the folder as 'Anyone with the link'.",
    }, 400);
  }

  let body: any;
  try { body = await req.json(); } catch { return badRequest("Invalid body"); }
  const folderId = folderIdFromUrl(body?.folderUrl || "");
  if (!folderId) return badRequest("Couldn't find a folder id in that link. Paste a Google Drive folder URL.");

  // Batching: import BATCH files per call; the client loops offset until done,
  // so the whole folder is imported without any single call timing out.
  const offset = Math.max(0, parseInt(String(body?.offset ?? 0)) || 0);
  const BATCH = 10;

  // List files (paginated).
  const files: any[] = [];
  let pageToken: string | undefined;
  try {
    do {
      const params = new URLSearchParams({
        q: `'${folderId}' in parents and trashed=false`,
        key,
        fields: "nextPageToken,files(id,name,mimeType,size)",
        pageSize: "100",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`);
      const data = await res.json();
      if (!res.ok) {
        const msg = data?.error?.message || `Drive API error (${res.status})`;
        return json({
          error: `Google Drive: ${msg}. Make sure the folder is shared as 'Anyone with the link' and the API key is valid with the Drive API enabled.`,
        }, 400);
      }
      files.push(...(data.files || []));
      pageToken = data.nextPageToken;
    } while (pageToken && files.length < 500);
  } catch (e: any) {
    return json({ error: "Could not reach Google Drive: " + String(e?.message || e).slice(0, 160) }, 502);
  }

  const media = files.filter((f) => ALLOWED[(f.mimeType || "").toLowerCase()]);
  if (!media.length) {
    return json({ error: "No supported images/videos (JPG, PNG, WEBP, MP4, MOV) found in that folder." }, 400);
  }

  const created: MediaItem[] = [];
  let skipped = 0;
  const batch = media.slice(offset, offset + BATCH);
  for (const f of batch) {
    const mime = String(f.mimeType).toLowerCase();
    const type = ALLOWED[mime];
    const size = f.size ? parseInt(f.size, 10) : 0;
    if (size && size > MAX_BYTES) { skipped++; continue; }
    try {
      const dl = await fetch(
        `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media&supportsAllDrives=true&key=${key}`,
      );
      if (!dl.ok) { skipped++; continue; }
      const buf = Buffer.from(await dl.arrayBuffer());
      const id = newId("media");
      const stored = await saveUpload(`${id}${EXT[mime] || ""}`, buf, mime);
      const item: MediaItem = {
        id, type, originalName: String(f.name || id), mime, size: buf.length,
        width: null, height: null, duration: null,
        file: stored.key, thumb: null, fileUrl: stored.url, thumbUrl: null, igUrl: null,
        createdAt: new Date().toISOString(), analysis: null,
      };
      await updateDb((db) => db.media.push(item));
      created.push(item);
    } catch { skipped++; }
  }

  // Automatically build a plan for the imported media and add it to the
  // calendar (additive — appended after any existing posts), scheduled so the
  // auto-poster publishes each at its time. No manual "Generate Plan" needed.
  let scheduled = 0;
  if (created.length) {
    try {
      const db = await readDb();
      const startOrder = db.posts.length ? Math.max(...db.posts.map((p) => p.order)) + 1 : 0;
      const startAfter = db.posts.length
        ? new Date(Math.max(...db.posts.map((p) => Date.parse(p.scheduledAt))))
        : undefined;
      const newPosts = await generatePlan(created, db.settings, { startOrder, startAfter });
      await updateDb((d) => {
        d.posts = [...d.posts, ...newPosts];
        // persist the analysis generatePlan attached to each cover item
        for (const c of created) {
          const m = d.media.find((x) => x.id === c.id);
          if (m && c.analysis) m.analysis = c.analysis;
        }
      });
      scheduled = newPosts.length;
    } catch {
      // if planning fails, the media is still imported — user can Generate Plan
      scheduled = 0;
    }
  }

  const nextOffset = offset + BATCH < media.length ? offset + BATCH : null;

  const state = await buildClientState();
  return json({
    imported: created.length,
    scheduled,
    skipped,
    total: media.length,
    nextOffset,
    ...state,
  });
}
