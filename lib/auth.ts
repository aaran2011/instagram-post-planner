import crypto from "crypto";
import { config } from "./config";
import { findUserByEmail, listUsers, getUser } from "./db";

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

// Verify credentials against the matching account. Returns the account's user
// id on success, or null. A user with no stored hash (the migrated/first-run
// account) falls back to the APP_PASSWORD env value so the owner isn't locked
// out before setting a password.
export async function verifyCredentials(email: string, password: string): Promise<string | null> {
  const user = await findUserByEmail(email).catch(() => null);
  if (!user) return null;
  if (user.passwordHash) return verifyHash(password || "", user.passwordHash) ? user.id : null;
  // legacy/first-run account without a stored hash → env password
  return safeEqual(password || "", config.appPassword) ? user.id : null;
}

// Does any account exist yet? (Drives the sign-in page copy.)
export async function accountExists(): Promise<boolean> {
  try { return (await listUsers()).length > 0; } catch { return false; }
}

// The email of the signed-in account (for the session endpoint); "" if none.
export async function accountEmailFor(uid: string | null): Promise<string> {
  if (!uid) return "";
  const u = await getUser(uid).catch(() => null);
  return u?.email || "";
}

// --- Reset code helpers ---
export function makeCode(): string {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}
export function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code.trim()).digest("hex");
}
