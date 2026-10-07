import { NextRequest } from "next/server";
import { json, badRequest } from "@/lib/api";
import { findUserByEmail, getReset, setReset, setUserPassword } from "@/lib/db";
import { hashCode, hashPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Verify the emailed code and set a new password for that account.
export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return badRequest("Invalid body"); }

  const email = String(body?.email || "").trim().toLowerCase();
  const code = String(body?.code || "").trim();
  const newPassword = String(body?.newPassword || "");

  if (newPassword.length < 6) return badRequest("Password must be at least 6 characters.");

  const user = await findUserByEmail(email);
  if (!user) return badRequest("Invalid email.");

  const reset = await getReset(user.id);
  if (!reset) return badRequest("No reset in progress. Request a new code.");
  if (Date.now() > reset.expires) {
    await setReset(user.id, null);
    return badRequest("That code expired. Request a new one.");
  }
  if (reset.attempts >= 5) {
    await setReset(user.id, null);
    return badRequest("Too many attempts. Request a new code.");
  }
  if (hashCode(code) !== reset.codeHash) {
    await setReset(user.id, { ...reset, attempts: reset.attempts + 1 });
    return badRequest("Incorrect code.");
  }

  await setUserPassword(user.id, hashPassword(newPassword));
  await setReset(user.id, null);
  return json({ ok: true });
}
