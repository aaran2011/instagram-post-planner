import { NextRequest } from "next/server";
import { json, badRequest } from "@/lib/api";
import { config } from "@/lib/config";
import { readDb, updateDb } from "@/lib/db";
import { makeCode, hashCode } from "@/lib/auth";
import { sendResetCode, emailConfigured } from "@/lib/mailer";

export const dynamic = "force-dynamic";

// Send a reset code to the account email. Only ever emails the configured
// account address, so it can't be abused to spam arbitrary inboxes.
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid body");
  }
  const email = String(body?.email || "").trim().toLowerCase();
  const match = email === config.appEmail.trim().toLowerCase();

  if (!emailConfigured()) {
    return json(
      {
        error:
          "Password reset by email isn't set up yet. Add a free RESEND_API_KEY to enable it.",
        needsEmailSetup: true,
      },
      400,
    );
  }

  if (match) {
    // Throttle: if a code was issued in the last minute, don't send another.
    const db = await readDb();
    const existing = db.auth.reset;
    const freshlySent = existing && existing.expires - Date.now() > 9 * 60 * 1000;
    if (!freshlySent) {
      const code = makeCode();
      await updateDb((d) => {
        d.auth.reset = {
          codeHash: hashCode(code),
          expires: Date.now() + 10 * 60 * 1000,
          attempts: 0,
        };
      });
      try {
        await sendResetCode(config.appEmail, code);
      } catch (e: any) {
        return json({ error: e?.message || "Could not send the reset email." }, 502);
      }
    }
  }

  // Generic success either way (don't reveal whether the email matched).
  return json({ sent: true });
}
