import { NextRequest } from "next/server";
import { guard, badRequest, json } from "@/lib/api";
import { updateDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest) {
  const denied = guard();
  if (denied) return denied;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid body");
  }

  const settings = await updateDb((db) => {
    const s = db.settings;
    if (typeof body.timezone === "string" && isValidTz(body.timezone)) s.timezone = body.timezone;
    if (Array.isArray(body.defaultTimes)) {
      const times = body.defaultTimes
        .map((t: any) => String(t))
        .filter((t: string) => /^\d{1,2}:\d{2}$/.test(t));
      if (times.length) s.defaultTimes = times;
    }
    if (typeof body.postingCadenceDays === "number" && body.postingCadenceDays >= 1) {
      s.postingCadenceDays = Math.min(30, Math.round(body.postingCadenceDays));
    }
    if (typeof body.aiTone === "string") s.aiTone = body.aiTone;
    if (typeof body.aiEmojis === "boolean") s.aiEmojis = body.aiEmojis;
    if (typeof body.niche === "string") s.niche = body.niche.slice(0, 120);
    if (typeof body.demoMode === "boolean") s.demoMode = body.demoMode;
    return { ...s };
  });

  return json({ settings });
}

function isValidTz(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
