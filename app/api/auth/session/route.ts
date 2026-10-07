import { getSession } from "@/lib/session";
import { configStatus } from "@/lib/config";
import { json } from "@/lib/api";
import { accountExists, resolvedAccountEmail } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Public: lets the login screen show setup warnings, the account email, whether
// an account has been created yet (to offer sign-up), and if already signed in.
export async function GET() {
  return json({
    authenticated: Boolean(getSession()),
    email: await resolvedAccountEmail(),
    accountExists: await accountExists(),
    config: configStatus(),
  });
}
