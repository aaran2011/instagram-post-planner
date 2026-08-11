import crypto from "crypto";
import { cookies } from "next/headers";
import { config } from "./config";

// Minimal, dependency-free signed-cookie sessions for a single user.
// Token format: base64url(JSON payload) + "." + base64url(HMAC-SHA256).

const COOKIE_NAME = "ig_planner_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function b64url(buf: Buffer) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function sign(payloadB64: string) {
  return b64url(
    crypto.createHmac("sha256", config.sessionSecret).update(payloadB64).digest(),
  );
}

export function createToken(sub: string) {
  const payload = {
    sub,
    exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS,
  };
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload)));
  return `${payloadB64}.${sign(payloadB64)}`;
}

export function verifyToken(token: string | undefined | null): string | null {
  if (!token || !token.includes(".")) return null;
  const [payloadB64, sig] = token.split(".");
  const expected = sign(payloadB64);
  // Timing-safe comparison.
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return null;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64").toString("utf8"),
    );
    if (typeof payload.exp !== "number" || payload.exp < Date.now() / 1000) {
      return null;
    }
    return payload.sub as string;
  } catch {
    return null;
  }
}

export function setSessionCookie(sub: string) {
  cookies().set(COOKIE_NAME, createToken(sub), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export function clearSessionCookie() {
  cookies().set(COOKIE_NAME, "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
}

export function getSession(): string | null {
  const token = cookies().get(COOKIE_NAME)?.value;
  return verifyToken(token);
}

export function requireSession(): string {
  const sub = getSession();
  if (!sub) throw new UnauthorizedError();
  return sub;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

export { COOKIE_NAME };
