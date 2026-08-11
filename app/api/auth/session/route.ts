import { getSession } from "@/lib/session";
import { configStatus, config } from "@/lib/config";
import { json } from "@/lib/api";

// Public: lets the login screen show setup warnings + whether already signed in.
export async function GET() {
  return json({
    authenticated: Boolean(getSession()),
    email: config.appEmail,
    config: configStatus(),
  });
}
