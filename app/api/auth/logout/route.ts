import { clearSessionCookie } from "@/lib/session";
import { ok } from "@/lib/api";

export async function POST() {
  clearSessionCookie();
  return ok();
}
