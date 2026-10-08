import { loadRaw, saveRaw } from "./kvstore";
import { getSession } from "./session";
import { config } from "./config";
import { newId } from "./api";
import type { Database, GlobalDB, Settings, InstagramAccount, User, ResetState, MediaItem } from "./types";

// Multi-account store over a pluggable backend (Upstash Redis in prod, JSON file
// in dev — see kvstore.ts). The whole GlobalDB lives at one key; each app
// account (User) owns an isolated Database partition under `accounts[userId]`.
// readDb()/updateDb() transparently scope to the CURRENT SESSION's account, so
// every per-account route keeps working without passing a user id around.

const DEFAULT_SETTINGS: Settings = {
  timezone: process.env.DEFAULT_TIMEZONE || "Asia/Kolkata",
  defaultTimes: ["11:00", "19:30"],
  postingCadenceDays: 1,
  aiTone: "warm, authentic, concise",
  aiEmojis: true,
  niche: "wildlife & nature photography",
  demoMode: (process.env.DEMO_MODE ?? "true") !== "false",
};

const DEFAULT_INSTAGRAM: InstagramAccount = {
  connected: false, username: null, igUserId: null, accountType: null, connectedAt: null, demo: false,
};

// A fresh, empty account — what every new sign-up gets (no Instagram, no media).
export function blankAccount(): Database {
  return {
    media: [], posts: [],
    settings: { ...DEFAULT_SETTINGS },
    instagram: { ...DEFAULT_INSTAGRAM },
    editStyle: null,
    secrets: { instagramAccessToken: null },
  };
}

function withAccountDefaults(p: Partial<Database> | null | undefined): Database {
  const d = p ?? {};
  return {
    media: d.media ?? [],
    posts: d.posts ?? [],
    settings: { ...DEFAULT_SETTINGS, ...(d.settings ?? {}) },
    instagram: { ...DEFAULT_INSTAGRAM, ...(d.instagram ?? {}) },
    editStyle: d.editStyle ?? null,
    secrets: { instagramAccessToken: null, ...(d.secrets ?? {}) },
  };
}

const DEFAULT_UID = "u_default";

// Load + normalize the whole store, migrating the legacy single-account shape
// ({ media, posts, settings, instagram, secrets, editStyle, auth }) into the
// multi-account shape on first read, preserving the owner's data as account #1.
export async function loadGlobal(): Promise<GlobalDB> {
  const raw: any = await loadRaw();

  // Already multi-account.
  if (raw && raw.version === 2 && raw.users && raw.accounts) {
    const users: User[] = Array.isArray(raw.users) ? raw.users : [];
    const accounts: Record<string, Database> = {};
    for (const u of users) accounts[u.id] = withAccountDefaults(raw.accounts?.[u.id]);
    return { version: 2, users, accounts, reset: raw.reset ?? {} };
  }

  // Migrate legacy single-account DB, or seed a first-run default account.
  const legacyAuth = raw?.auth ?? {};
  const email = String(legacyAuth.email || config.appEmail || "you@example.com").trim().toLowerCase();
  const user: User = {
    id: DEFAULT_UID,
    email,
    passwordHash: legacyAuth.passwordHash ?? null,
    createdAt: new Date().toISOString(),
  };
  const g: GlobalDB = {
    version: 2,
    users: [user],
    accounts: { [DEFAULT_UID]: withAccountDefaults(raw) },
    reset: legacyAuth.reset ? { [DEFAULT_UID]: legacyAuth.reset } : {},
  };
  try { await saveRaw(g as any); } catch {}
  return g;
}

async function saveGlobal(g: GlobalDB): Promise<void> {
  await saveRaw(g as any);
}

export async function updateGlobal<T>(fn: (g: GlobalDB) => T): Promise<T> {
  const g = await loadGlobal();
  const result = fn(g);
  await saveGlobal(g);
  return result;
}

// ---- current session's account ----

export function currentUserId(): string | null {
  return getSession();
}

// Resolve a session subject to an account id. Handles BOTH new id-based
// sessions and legacy sessions whose subject was the account email.
function resolveUid(g: GlobalDB, sub: string | null): string | null {
  if (!sub) return null;
  if (g.accounts[sub]) return sub;
  const s = sub.trim().toLowerCase();
  const u = g.users.find((x) => x.id === sub || x.email === s);
  return u ? u.id : null;
}

export async function readDb(): Promise<Database> {
  const g = await loadGlobal();
  const uid = resolveUid(g, currentUserId());
  if (uid && g.accounts[uid]) return g.accounts[uid];
  // No session (or unknown user): return an ephemeral blank account. Guarded
  // routes always have a valid session, so this only affects public/diagnostic reads.
  return blankAccount();
}

export async function updateDb<T>(fn: (db: Database) => T): Promise<T> {
  const sub = currentUserId();
  const g = await loadGlobal();
  const id = resolveUid(g, sub) || sub || DEFAULT_UID;
  if (!g.accounts[id]) {
    g.accounts[id] = blankAccount();
    if (!g.users.find((u) => u.id === id)) {
      g.users.push({ id, email: `${id}@local`, passwordHash: null, createdAt: new Date().toISOString() });
    }
  }
  const result = fn(g.accounts[id]);
  await saveGlobal(g);
  return result;
}

// ---- account-scoped access by id (for the scheduler, which has no session) ----

export async function readAccount(uid: string): Promise<Database | null> {
  const g = await loadGlobal();
  return g.accounts[uid] ?? null;
}

export async function updateAccount<T>(uid: string, fn: (db: Database) => T): Promise<T | undefined> {
  const g = await loadGlobal();
  if (!g.accounts[uid]) return undefined;
  const result = fn(g.accounts[uid]);
  await saveGlobal(g);
  return result;
}

export async function listAccountIds(): Promise<string[]> {
  const g = await loadGlobal();
  return g.users.map((u) => u.id);
}

// Find a media item across ALL accounts (media serving routes are public and
// carry no session, and media ids are globally unique).
export async function findMediaGlobal(id: string): Promise<MediaItem | null> {
  const g = await loadGlobal();
  for (const uid of Object.keys(g.accounts)) {
    const m = g.accounts[uid].media.find((x) => x.id === id);
    if (m) return m;
  }
  return null;
}

// ---- users ----

export async function listUsers(): Promise<User[]> {
  return (await loadGlobal()).users;
}
export async function findUserByEmail(email: string): Promise<User | null> {
  const e = (email || "").trim().toLowerCase();
  return (await loadGlobal()).users.find((u) => u.email === e) ?? null;
}
export async function getUser(uid: string): Promise<User | null> {
  return (await loadGlobal()).users.find((u) => u.id === uid) ?? null;
}
export async function createUser(email: string, passwordHash: string): Promise<User> {
  const e = (email || "").trim().toLowerCase();
  return updateGlobal((g) => {
    const user: User = { id: newId("user"), email: e, passwordHash, createdAt: new Date().toISOString() };
    g.users.push(user);
    g.accounts[user.id] = blankAccount();
    return user;
  });
}
export async function setUserPassword(uid: string, passwordHash: string): Promise<void> {
  await updateGlobal((g) => {
    const u = g.users.find((x) => x.id === uid);
    if (u) u.passwordHash = passwordHash;
  });
}

// The resolved account id for the current session (handles legacy email subs).
export async function currentAccountId(): Promise<string | null> {
  const g = await loadGlobal();
  return resolveUid(g, currentUserId());
}

// Delete ONE account entirely — its user, its isolated data (media/posts/
// Instagram connection/token/editing style) and its reset state. Other accounts
// are untouched. Returns the removed account's data so the caller can clean up
// its stored media files.
export async function deleteUser(uid: string): Promise<Database | null> {
  return updateGlobal((g) => {
    const acc = g.accounts[uid] ?? null;
    g.users = g.users.filter((u) => u.id !== uid);
    delete g.accounts[uid];
    delete g.reset[uid];
    return acc;
  });
}

// ---- reset state (per user) ----

export async function getReset(uid: string): Promise<ResetState | null> {
  return (await loadGlobal()).reset[uid] ?? null;
}
export async function setReset(uid: string, state: ResetState | null): Promise<void> {
  await updateGlobal((g) => {
    if (state) g.reset[uid] = state; else delete g.reset[uid];
  });
}

export function publicInstagram(db: Database): InstagramAccount {
  return { ...db.instagram };
}

export { DEFAULT_SETTINGS };
