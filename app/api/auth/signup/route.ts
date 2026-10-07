import { NextRequest } from "next/server";
import { badRequest, json } from "@/lib/api";
import { updateDb } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { setSessionCookie } from "@/lib/session";

export const dynamic = "force-dynamic";

// Create the single owner account (email + password), then sign in. Open by the
// owner's choice: no current password required — creating an account sets (or
// replaces) the stored credentials. (This is a personal single-user app.)
export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return badRequest("Invalid body"); }

  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return badRequest("Enter a valid email address.");
  if (password.length < 6) return badRequest("Password must be at least 6 characters.");

  try {
    await updateDb((d) => {
      d.auth.email = email;
      d.auth.passwordHash = hashPassword(password);
      d.auth.reset = null;
    });
  } catch {
    return json({ error: "Storage is unavailable right now — try again in a moment." }, 503);
  }

  setSessionCookie(email, true);
  return json({ ok: true });
}
