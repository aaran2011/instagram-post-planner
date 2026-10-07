import { NextRequest } from "next/server";
import { badRequest, json } from "@/lib/api";
import { createUser, findUserByEmail } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { setSessionCookie } from "@/lib/session";

export const dynamic = "force-dynamic";

// Create a NEW account and sign in. Each account is fully isolated — the new
// one starts blank (no Instagram connected, no media/posts). Open by design for
// this personal app: no current password required. An email already in use is
// rejected (log in instead) so existing accounts aren't clobbered.
export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return badRequest("Invalid body"); }

  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return badRequest("Enter a valid email address.");
  if (password.length < 6) return badRequest("Password must be at least 6 characters.");

  try {
    const existing = await findUserByEmail(email);
    if (existing) {
      return json({ error: "An account with that email already exists. Log in instead." }, 409);
    }
    const user = await createUser(email, hashPassword(password));
    setSessionCookie(user.id, true);
    return json({ ok: true });
  } catch {
    return json({ error: "Storage is unavailable right now — try again in a moment." }, 503);
  }
}
