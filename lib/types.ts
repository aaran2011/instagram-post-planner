// Shared domain types for Instagram Planner.

export type MediaType = "photo" | "video";

export interface MediaAnalysis {
  subject: string;
  contentType: string;
  visualTheme: string;
  mood: string;
  context: string;
  audience: string;
  category: string;
  format: "post" | "reel";
  colors: string[];
  // Group id used to detect near-duplicate / very similar items.
  similarityGroup: string;
}

export interface MediaItem {
  id: string;
  type: MediaType;
  originalName: string;
  mime: string;
  size: number; // bytes
  width: number | null;
  height: number | null;
  duration: number | null; // seconds, videos only
  // Storage keys: on disk these are filenames within the data dirs; with Vercel
  // Blob they are the blob URLs (used for deletion).
  file: string; // original media file key
  thumb: string | null; // jpeg thumbnail key
  // Public URLs. Absolute (Blob CDN) in production; null on disk (served via
  // /api/media/* routes instead).
  fileUrl?: string | null;
  thumbUrl?: string | null;
  // Instagram-ready URL: an aspect-padded copy for images outside 4:5–1.91:1
  // (so IG can't crop the subject). Absent/null => send the original fileUrl.
  igUrl?: string | null;
  createdAt: string; // ISO
  analysis: MediaAnalysis | null;
}

export type PostStatus =
  | "draft"
  | "scheduled"
  | "publishing"
  | "published"
  | "demo_published"
  | "failed";

export interface Post {
  id: string;
  mediaId: string; // cover / first item (kept for back-compat)
  mediaIds?: string[]; // all items; >1 means an Instagram carousel post
  order: number; // position in the planned sequence
  caption: string;
  hashtags: string[];
  cta: string;
  category: string;
  mood: string;
  subject: string;
  format: "post" | "reel";
  // Music is a *suggestion* only. Instagram's API cannot attach arbitrary
  // audio to a feed post, so this is always a manual step on photo posts.
  music: {
    name: string;
    artist: string;
    supportedByApi: false; // documents the real limitation
  } | null;
  scheduledAt: string; // ISO timestamp (UTC instant)
  timezone: string; // IANA tz used to display the local time
  status: PostStatus;
  igMediaId: string | null; // returned by Instagram when published
  error: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InstagramAccount {
  connected: boolean;
  username: string | null;
  igUserId: string | null;
  accountType: string | null; // e.g. "BUSINESS"
  // Access tokens are stored server-side only, never sent to the client.
  connectedAt: string | null;
  demo: boolean; // true when this is a simulated connection
}

export interface Settings {
  timezone: string;
  defaultTimes: string[]; // e.g. ["11:00", "19:30"] used to build schedules
  postingCadenceDays: number; // gap between posts
  aiTone: string; // caption tone preference
  aiEmojis: boolean;
  niche: string; // e.g. "wildlife & nature photography" — steers captions/hashtags
  demoMode: boolean; // when true, publishing is simulated
}

export interface Database {
  media: MediaItem[];
  posts: Post[];
  settings: Settings;
  instagram: InstagramAccount;
  // Server-only secret material. Never serialized to any client response.
  secrets: {
    instagramAccessToken: string | null;
  };
  // Auth: a reset can set a hashed password here that overrides the env var,
  // plus a pending reset code. Server-only.
  auth: {
    passwordHash: string | null; // scrypt "salt:hash"
    reset: { codeHash: string; expires: number; attempts: number } | null;
  };
}
