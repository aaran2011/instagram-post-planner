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

// A learned photographic editing style. All values are normalized -1..1 and map
// directly to non-destructive photographic adjustments (never generative). They
// are the SAME knobs the manual sliders expose, so a learned look can be tweaked.
export interface EditAdjustments {
  exposure: number; // overall brightness
  contrast: number; // S-curve strength
  temperature: number; // cool (-) <-> warm (+)
  tint: number; // green (-) <-> magenta (+)
  saturation: number; // global saturation
  vibrance: number; // saturation weighted toward muted tones
  highlights: number; // recover (-) / lift (+) bright tones
  shadows: number; // deepen (-) / lift (+) dark tones
  whites: number; // white point
  blacks: number; // black point
}

export interface EditStyle {
  adjustments: EditAdjustments;
  pairs: number; // how many before/after pairs it was learned from
  trainedAt: string; // ISO
  notes: string; // human-readable summary of the look
}

// Connected destination accounts for cross-posting (public, token-free — safe
// for client state, like InstagramAccount). Tokens live in `secrets`.
export interface LinkedInAccount {
  connected: boolean;
  name: string | null; // from /v2/userinfo
  memberId: string | null; // OIDC "sub"; author URN = urn:li:person:{memberId}
  connectedAt: string | null;
}

export interface YouTubeAccount {
  connected: boolean;
  channelTitle: string | null;
  channelId: string | null;
  connectedAt: string | null;
}

export type CrossPostDestination = "linkedin" | "youtube";

export interface CrossPostLogEntry {
  igId: string;
  at: string; // ISO
  caption?: string;
  linkedin?: { ok: boolean; id?: string; error?: string; skipped?: string };
  youtube?: { ok: boolean; id?: string; error?: string; skipped?: string };
  drive?: { ok: boolean; count?: number; error?: string };
}

// A specific Instagram item the user chose (in the Automation builder) to
// cross-post at a chosen time to chosen destinations. Processed by the scheduler.
export interface CrossPostJob {
  id: string;
  igId: string;
  mediaType: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  destinations: CrossPostDestination[];
  caption: string;
  thumbUrl: string | null;
  scheduledAt: string; // ISO; past/now = post immediately on next tick
  status: "scheduled" | "done" | "failed";
  result?: CrossPostLogEntry;
  createdAt: string;
}

// Auto-repost state: which Instagram media have already been handled, plus a
// baseline so existing history is never backfilled, plus any explicit jobs the
// user scheduled via the Automation builder.
export interface CrossPostState {
  enabled: boolean;
  destinations: Record<CrossPostDestination, boolean>;
  repostedIgIds: string[]; // dedup: IG media ids already handled by the watcher
  log: CrossPostLogEntry[]; // recent activity (capped)
  baselineAt: string | null; // only media newer than this is auto-reposted
  lastSyncAt: string | null; // throttle marker
  lastRepostAt: string | null; // last auto-repost time (enforces 1/day)
  jobs: CrossPostJob[]; // explicit user-scheduled cross-posts
  // Google Drive mirror: when the app publishes an IMAGE post, also upload the
  // image (full quality + caption) to a Drive folder the user wires to LinkedIn
  // via a free connector (Zapier/Make). Routes around LinkedIn's blocked API.
  driveMirror: boolean;
  driveFolderId: string | null;
  driveFolderLink: string | null;
}

// One account's private data. Each app account (User) owns an isolated copy —
// its own media, posts, settings, Instagram connection and editing style — so
// accounts never see each other's content and a new account starts blank.
export interface Database {
  media: MediaItem[];
  posts: Post[];
  settings: Settings;
  instagram: InstagramAccount;
  linkedin: LinkedInAccount;
  youtube: YouTubeAccount;
  crossPost: CrossPostState;
  // The user's personal editing style, learned from before/after pairs. Null
  // until trained. Applied automatically to future edits.
  editStyle?: EditStyle | null;
  // Server-only secret material. Never serialized to any client response.
  secrets: {
    instagramAccessToken: string | null;
    linkedinAccessToken: string | null;
    linkedinExpiresAt: number | null; // epoch ms
    youtubeAccessToken: string | null;
    youtubeRefreshToken: string | null; // durable credential
    youtubeExpiresAt: number | null; // epoch ms for the access token
  };
}

// An app account. Multiple can exist; each maps to one Database partition.
export interface User {
  id: string;
  email: string;
  passwordHash: string | null; // scrypt "salt:hash"; null = fall back to env password
  createdAt: string;
}

export interface ResetState {
  codeHash: string;
  expires: number;
  attempts: number;
}

// The whole store: the list of accounts, each account's isolated data, and
// per-account password-reset state. Server-only.
export interface GlobalDB {
  version: 2;
  users: User[];
  accounts: Record<string, Database>; // keyed by User.id
  reset: Record<string, ResetState>; // keyed by User.id
}
