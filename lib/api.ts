import { NextResponse } from "next/server";
import { getSession } from "./session";

export function json(data: unknown, init?: number | ResponseInit) {
  const responseInit =
    typeof init === "number" ? { status: init } : init;
  return NextResponse.json(data as any, responseInit);
}

export function ok(data: unknown = { ok: true }) {
  return json(data, 200);
}

export function badRequest(message: string, extra?: Record<string, unknown>) {
  return json({ error: message, ...extra }, 400);
}

export function unauthorized() {
  return json({ error: "Unauthorized" }, 401);
}

export function serverError(message: string) {
  return json({ error: message }, 500);
}

// Guard a route handler: returns null if authorized, or a 401 response.
export function guard(): NextResponse | null {
  if (!getSession()) return unauthorized();
  return null;
}

export function newId(prefix = "id"): string {
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
      : Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  return `${prefix}_${rnd}`;
}
