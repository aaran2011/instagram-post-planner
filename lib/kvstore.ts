import fs from "fs";
import fs2 from "fs/promises";
import { Redis } from "@upstash/redis";
import { DB_FILE, ensureDirs } from "./paths";
import type { Database } from "./types";

// Persistence backend for the whole DB object.
//  - Production (Vercel): Upstash Redis (serverless-friendly, no local disk).
//  - Local dev: a JSON file under ./data (zero setup).
// The backend is chosen purely by the presence of Upstash env vars, so the
// same code runs in both places.

const REDIS_URL =
  process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
const REDIS_TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";

const DB_KEY = "igplanner:db";

let redis: Redis | null = null;
export function usingRedis() {
  return Boolean(REDIS_URL && REDIS_TOKEN);
}
function client(): Redis {
  if (!redis) redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });
  return redis;
}

// Load the raw stored DB (or null if none yet). Defaults are applied by db.ts.
export async function loadRaw(): Promise<Partial<Database> | null> {
  if (usingRedis()) {
    // Upstash auto-serializes/deserializes JSON values.
    const val = await client().get<Partial<Database>>(DB_KEY);
    return val ?? null;
  }
  ensureDirs();
  if (!fs.existsSync(DB_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8")) as Partial<Database>;
  } catch {
    try {
      fs.renameSync(DB_FILE, DB_FILE + ".corrupt-" + Date.now());
    } catch {}
    return null;
  }
}

// Lightweight heartbeat so we can confirm the external scheduler is pinging us.
const TICK_KEY = "igplanner:lasttick";
export async function setLastTick(iso: string): Promise<void> {
  if (usingRedis()) {
    await client().set(TICK_KEY, iso);
    return;
  }
  try {
    await fs2.writeFile(DB_FILE + ".tick", iso);
  } catch {}
}
export async function getLastTick(): Promise<string | null> {
  if (usingRedis()) {
    return (await client().get<string>(TICK_KEY)) ?? null;
  }
  try {
    return fs.readFileSync(DB_FILE + ".tick", "utf8");
  } catch {
    return null;
  }
}

export async function saveRaw(db: Database): Promise<void> {
  if (usingRedis()) {
    await client().set(DB_KEY, db);
    return;
  }
  ensureDirs();
  const tmp = DB_FILE + ".tmp";
  await fs2.writeFile(tmp, JSON.stringify(db, null, 2));
  await fs2.rename(tmp, DB_FILE);
}
