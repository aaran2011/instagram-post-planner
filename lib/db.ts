import { loadRaw, saveRaw } from "./kvstore";
import type { Database, Settings, InstagramAccount } from "./types";

// Async DB access over a pluggable backend (Upstash Redis in prod, JSON file in
// dev — see kvstore.ts). Every request reads fresh and writes the whole object,
// which is correct for serverless (no persistent in-memory state) and fine for
// a single-user app.

const DEFAULT_SETTINGS: Settings = {
  timezone: process.env.DEFAULT_TIMEZONE || "Asia/Kolkata",
  defaultTimes: ["11:00", "19:30"],
  postingCadenceDays: 1,
  aiTone: "warm, authentic, concise",
  aiEmojis: true,
  demoMode: (process.env.DEMO_MODE ?? "true") !== "false",
};

const DEFAULT_INSTAGRAM: InstagramAccount = {
  connected: false,
  username: null,
  igUserId: null,
  accountType: null,
  connectedAt: null,
  demo: false,
};

function withDefaults(parsed: Partial<Database> | null): Database {
  const p = parsed ?? {};
  return {
    media: p.media ?? [],
    posts: p.posts ?? [],
    settings: { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) },
    instagram: { ...DEFAULT_INSTAGRAM, ...(p.instagram ?? {}) },
    secrets: { instagramAccessToken: null, ...(p.secrets ?? {}) },
    auth: {
      passwordHash: p.auth?.passwordHash ?? null,
      reset: p.auth?.reset ?? null,
    },
  };
}

// Read the current DB (applies defaults; seeds storage on first run).
export async function readDb(): Promise<Database> {
  const parsed = await loadRaw();
  const db = withDefaults(parsed);
  if (!parsed) {
    try { await saveRaw(db); } catch {}
  }
  return db;
}

// Apply a mutation and persist it. The mutator MUST change the passed `db`
// object (not objects captured elsewhere), since this reads a fresh copy.
export async function updateDb<T>(fn: (db: Database) => T): Promise<T> {
  const db = await readDb();
  const result = fn(db);
  await saveRaw(db);
  return result;
}

export function publicInstagram(db: Database): InstagramAccount {
  return { ...db.instagram };
}

export { DEFAULT_SETTINGS };
