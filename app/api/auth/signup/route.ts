import { NextRequest } from "next/server";
import { badRequest, json } from "@/lib/api";
import { readDb, updateDb } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { setSessionCookie } from "@/lib/session";

export const dynamic = "force-dynamic";

// Create the single owner account (email + password), then sign in. This is a
// one-time setup: once an account exists it is LOCKED — further signups are
// refused so nobody can take the app over on its public URL. After that the
// owner changes the password via the reset flow.
export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return badRequest("Invalid body"); }

  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return badRequest("Enter a valid email address.");
  if (password.length < 6) return badRequest("Password must be at least 6 characters.");

  // Locked once claimed.
  try {
    const db = await readDb();
    if (db.auth.passwordHash) {
      return json({ error: "An account already exists. Please log in, or reset the password." }, 409);
    }
  } catch {
    return json({ error: "Storage is unavailable right now — try again in a moment." }, 503);
  }

  await updateDb((d) => {
    d.auth.email = email;
    d.auth.passwordHash = hashPassword(password);
    d.auth.reset = null;
  });

  setSessionCookie(email, true);
  return json({ ok: true });
}
