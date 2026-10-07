import { NextRequest } from "next/server";
import { badRequest, json } from "@/lib/api";
import { updateDb } from "@/lib/db";
import { hashPassword, accountExists, verifyCredentials, resolvedAccountEmail } from "@/lib/auth";
import { setSessionCookie } from "@/lib/session";

export const dynamic = "force-dynamic";

// Create the single owner account (email + password), then sign in.
//   - If no account exists yet, anyone can claim it (first-run setup).
//   - If an account ALREADY exists, creating a new one REPLACES it but requires
//     the current password (or the reset flow) — so the app can't be taken over
//     on its public URL by a stranger.
export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return badRequest("Invalid body"); }

  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");
  const currentPassword = String(body?.currentPassword || "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return badRequest("Enter a valid email address.");
  if (password.length < 6) return badRequest("Password must be at least 6 characters.");

  let exists: boolean;
  try {
    exists = await accountExists();
  } catch {
    return json({ error: "Storage is unavailable right now — try again in a moment." }, 503);
  }

  if (exists) {
    // Authorize the replacement with the existing account's current password.
    const curEmail = await resolvedAccountEmail();
    const ok = currentPassword && (await verifyCredentials(curEmail, currentPassword));
    if (!ok) {
      return json({
        error: "An account already exists. Enter its current password to replace it, or use “Forgot password”.",
        needsCurrentPassword: true,
      }, 403);
    }
  }

  await updateDb((d) => {
    d.auth.email = email;
    d.auth.passwordHash = hashPassword(password);
    d.auth.reset = null;
  });

  setSessionCookie(email, true);
  return json({ ok: true });
}
