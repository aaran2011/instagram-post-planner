import { readDb } from "./db";
import { configStatus } from "./config";
import { IG_LIMITATIONS } from "./instagram";
import type { MediaItem } from "./types";

// Client-facing media (no secrets). Uses stored public URLs when present
// (Vercel Blob), otherwise falls back to the local /api/media/* routes.
export function publicMedia(m: MediaItem) {
  const url = m.fileUrl || `/api/media/file/${m.id}`;
  const thumbUrl =
    m.thumbUrl || (m.thumb ? `/api/media/thumb/${m.id}` : url);
  return {
    id: m.id,
    type: m.type,
    originalName: m.originalName,
    mime: m.mime,
    size: m.size,
    width: m.width,
    height: m.height,
    duration: m.duration,
    createdAt: m.createdAt,
    url,
    thumbUrl,
    analysis: m.analysis,
  };
}

// Everything the client app needs in one payload. No secrets.
export async function buildClientState() {
  const db = await readDb();
  return {
    media: db.media
      .slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map(publicMedia),
    posts: db.posts.slice().sort((a, b) => a.order - b.order),
    settings: db.settings,
    instagram: db.instagram,
    config: configStatus(),
    limitations: IG_LIMITATIONS,
  };
}

export type ClientState = Awaited<ReturnType<typeof buildClientState>>;
