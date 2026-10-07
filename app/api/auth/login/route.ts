import { NextRequest } from "next/server";
import { verifyCredentials } from "@/lib/auth";
import { setSessionCookie } from "@/lib/session";
import { badRequest, json } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid request body");
  }
  const { email, password } = body || {};
  if (!email || !password) return badRequest("Email and password are required");

  const uid = await verifyCredentials(String(email), String(password));
  if (!uid) return json({ error: "Incorrect email or password" }, 401);
  setSessionCookie(uid, body.remember !== false);
  return json({ ok: true });
}
