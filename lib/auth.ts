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

// Single-user credential check. Email must match; password matches either the
// DB-stored (reset) hash if present, otherwise the APP_PASSWORD env value.
export async function verifyCredentials(email: string, password: string): Promise<boolean> {
  const emailOk = safeEqual(
    (email || "").trim().toLowerCase(),
    config.appEmail.trim().toLowerCase(),
  );
  if (!emailOk) return false;

  // If the DB is reachable and a reset password is set, use it. If the DB is
  // unavailable, fall back to the env password so a storage outage can't lock
  // the owner out (and login returns a clean result instead of a 500).
  try {
    const db = await readDb();
    if (db.auth.passwordHash) return verifyHash(password || "", db.auth.passwordHash);
  } catch {
    // storage unavailable — fall through to env comparison
  }
  return safeEqual(password || "", config.appPassword);
}

// --- Reset code helpers ---
export function makeCode(): string {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}
export function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code.trim()).digest("hex");
}
