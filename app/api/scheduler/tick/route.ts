import { NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { json, unauthorized } from "@/lib/api";
import { processDue } from "@/lib/publisher";
import { setLastTick } from "@/lib/kvstore";

export const dynamic = "force-dynamic";

// Publishes any posts whose scheduled time has arrived.
// Auth: a logged-in session OR ?key=SCHEDULER_KEY (for an external cron).
async function run(req: NextRequest) {
  const key = new URL(req.url).searchParams.get("key");
  const cronKey = process.env.SCHEDULER_KEY;
  const authed = Boolean(getSession()) || (cronKey && key === cronKey);
  if (!authed) return unauthorized();

  const outcomes = await processDue();
  await setLastTick(new Date().toISOString()).catch(() => {});
  return json({ ran: true, processed: outcomes.length, outcomes });
}

export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}
