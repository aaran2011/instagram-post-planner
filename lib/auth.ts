import crypto from "crypto";
import { config } from "./config";
import { readDb } from "./db";

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

// --- Password hashing (scrypt) for reset-set passwords stored in the DB ---
export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyHash(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(pw, salt, 64);
  const hb = Buffer.from(hash, "hex");
  return hb.length === test.length && crypto.timingSafeEqual(hb, test);
}

// Single-user credential check. The valid email is the DB-stored account email
// (if the owner created one in-app), otherwise APP_EMAIL. The password matches
// the DB-stored hash if present, otherwise the APP_PASSWORD env value.
export async function verifyCredentials(email: string, password: string): Promise<boolean> {
  let validEmail = config.appEmail;
  let hash: string | null = null;
  // If the DB is unavailable, fall back to the env credentials so a storage
  // outage can't lock the owner out (and login returns a clean result).
  try {
    const db = await readDb();
    if (db.auth.email) validEmail = db.auth.email;
    hash = db.auth.passwordHash;
  } catch {
    // storage unavailable — use env credentials
  }
  const emailOk = safeEqual((email || "").trim().toLowerCase(), validEmail.trim().toLowerCase());
  if (!emailOk) return false;
  if (hash) return verifyHash(password || "", hash);
  return safeEqual(password || "", config.appPassword);
}

// Has the owner already created an in-app account? Once true, signup is locked.
export async function accountExists(): Promise<boolean> {
  try {
    const db = await readDb();
    return Boolean(db.auth.passwordHash);
  } catch {
    return false;
  }
}

// The account email to show / email reset codes to.
export async function resolvedAccountEmail(): Promise<string> {
  try {
    const db = await readDb();
    return db.auth.email || config.appEmail;
  } catch {
    return config.appEmail;
  }
}

// --- Reset code helpers ---
export function makeCode(): string {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}
export function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code.trim()).digest("hex");
}
