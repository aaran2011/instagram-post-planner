import { NextRequest } from "next/server";
import { json, badRequest } from "@/lib/api";
import { findUserByEmail, getReset, setReset } from "@/lib/db";
import { makeCode, hashCode } from "@/lib/auth";
import { sendResetCode, emailConfigured } from "@/lib/mailer";

export const dynamic = "force-dynamic";

// Send a reset code to the account that owns `email` (if any). Only ever emails
// that account's own address, so it can't be used to spam arbitrary inboxes.
export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return badRequest("Invalid body"); }

  const email = String(body?.email || "").trim().toLowerCase();

  if (!emailConfigured()) {
    return json({
      error: "Password reset by email isn't set up yet. Add a free RESEND_API_KEY to enable it.",
      needsEmailSetup: true,
    }, 400);
  }

  const user = await findUserByEmail(email);
  if (user) {
    // Throttle: if a code was issued in the last minute, don't send another.
    const existing = await getReset(user.id);
    const freshlySent = existing && existing.expires - Date.now() > 9 * 60 * 1000;
    if (!freshlySent) {
      const code = makeCode();
      await setReset(user.id, { codeHash: hashCode(code), expires: Date.now() + 10 * 60 * 1000, attempts: 0 });
      try {
        await sendResetCode(user.email, code);
      } catch (e: any) {
        return json({ error: e?.message || "Could not send the reset email." }, 502);
      }
    }
  }

  // Generic success either way (don't reveal whether the email matched).
  return json({ sent: true });
}
