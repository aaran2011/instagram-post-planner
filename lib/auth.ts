import crypto from "crypto";
import { config } from "./config";

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Still do a comparison to reduce timing signal, but result is false.
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

// Single-user credential check. Email match is case-insensitive.
export function verifyCredentials(email: string, password: string): boolean {
  const emailOk = safeEqual(
    (email || "").trim().toLowerCase(),
    config.appEmail.trim().toLowerCase(),
  );
  const passOk = safeEqual(password || "", config.appPassword);
  return emailOk && passOk;
}
