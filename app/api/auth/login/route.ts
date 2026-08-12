import { NextRequest } from "next/server";
import { verifyCredentials } from "@/lib/auth";
import { setSessionCookie } from "@/lib/session";
import { badRequest, json } from "@/lib/api";
import { config } from "@/lib/config";

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid request body");
  }
  const { email, password } = body || {};
  if (!email || !password) return badRequest("Email and password are required");

  if (!(await verifyCredentials(String(email), String(password)))) {
    return json({ error: "Incorrect email or password" }, 401);
  }
  setSessionCookie(config.appEmail);
  return json({ ok: true });
}
