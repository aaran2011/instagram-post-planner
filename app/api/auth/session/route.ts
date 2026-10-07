import { getSession } from "@/lib/session";
import { configStatus } from "@/lib/config";
import { json } from "@/lib/api";
import { accountExists, accountEmailFor } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Public: lets the login screen show setup warnings, the signed-in account's
// email, whether any account exists yet, and if already signed in.
export async function GET() {
  const uid = getSession();
  return json({
    authenticated: Boolean(uid),
    email: await accountEmailFor(uid),
    accountExists: await accountExists(),
    config: configStatus(),
  });
}
