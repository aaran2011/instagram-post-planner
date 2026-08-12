import { NextRequest } from "next/server";
import { json, badRequest } from "@/lib/api";
import { config } from "@/lib/config";
import { readDb, updateDb } from "@/lib/db";
import { hashCode, hashPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Verify the emailed code and set a new password (stored hashed in the DB,
// which then overrides the APP_PASSWORD env value).
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid body");
  }
  const email = String(body?.email || "").trim().toLowerCase();
  const code = String(body?.code || "").trim();
  const newPassword = String(body?.newPassword || "");

  if (email !== config.appEmail.trim().toLowerCase()) return badRequest("Invalid email.");
  if (newPassword.length < 6) return badRequest("Password must be at least 6 characters.");

  const db = await readDb();
  const reset = db.auth.reset;
  if (!reset) return badRequest("No reset in progress. Request a new code.");
  if (Date.now() > reset.expires) {
    await updateDb((d) => { d.auth.reset = null; });
    return badRequest("That code expired. Request a new one.");
  }
  if (reset.attempts >= 5) {
    await updateDb((d) => { d.auth.reset = null; });
    return badRequest("Too many attempts. Request a new code.");
  }
  if (hashCode(code) !== reset.codeHash) {
    await updateDb((d) => { if (d.auth.reset) d.auth.reset.attempts += 1; });
    return badRequest("Incorrect code.");
  }

  const hash = hashPassword(newPassword);
  await updateDb((d) => {
    d.auth.passwordHash = hash;
    d.auth.reset = null;
  });
  return json({ ok: true });
}
