import { guard, json, serverError } from "@/lib/api";
import { readDb } from "@/lib/db";
import { fetchReelHistory } from "@/lib/instagram";

export const dynamic = "force-dynamic";

// Read-only analysis of the connected account's reels. Never re-connects.
export async function GET() {
  const denied = guard();
  if (denied) return denied;

  const db = await readDb();
  const token = db.secrets.instagramAccessToken;
  const igUserId = db.instagram.igUserId;

  if (!db.instagram.connected || !token || !igUserId || db.instagram.demo) {
    return json({
      connected: false,
      demo: db.instagram.demo === true,
      reels: [],
      metricsLevel: "none",
      patterns: null,
      note: db.instagram.demo
        ? "This is a demo connection, so there's no real reel history to analyze."
        : "Connect your Instagram account to analyze your reel history.",
    });
  }

  try {
    const history = await fetchReelHistory(token, igUserId);
    const patterns = computePatterns(history.reels, db.settings.timezone);
    return json({
      connected: true,
      demo: false,
      reels: history.reels.slice(0, 30),
      metricsLevel: history.metricsLevel,
      count: history.count,
      patterns,
      note:
        history.metricsLevel === "basic"
          ? "Ranked by likes + comments. Views, reach, saves and shares need Instagram's insights permission (a one-time re-authorization) — enable it later if you want deeper metrics."
          : null,
    });
  } catch (e: any) {
    return serverError(e?.message || "Could not fetch reel history");
  }
}

function computePatterns(reels: any[], tz: string) {
  if (!reels.length) return null;
  const top = reels.slice(0, Math.max(3, Math.ceil(reels.length * 0.3)));

  // Best posting hour / weekday among top performers.
  const hourBins = new Array(24).fill(0);
  const dayBins = new Array(7).fill(0);
  let capLenSum = 0, capCount = 0;
  const hashtagFreq = new Map<string, number>();

  for (const r of top) {
    if (r.timestamp) {
      try {
        const parts = new Intl.DateTimeFormat("en-US", {
          timeZone: tz, hour: "numeric", hour12: false, weekday: "short",
        }).formatToParts(new Date(r.timestamp));
        const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0");
        const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
          parts.find((p) => p.type === "weekday")?.value || "",
        );
        if (hour >= 0 && hour < 24) hourBins[hour]++;
        if (wd >= 0) dayBins[wd]++;
      } catch {}
    }
    const cap = String(r.caption || "");
    capLenSum += cap.length; capCount++;
    for (const tag of cap.match(/#[\w]+/g) || []) {
      const t = tag.toLowerCase();
      hashtagFreq.set(t, (hashtagFreq.get(t) || 0) + 1);
    }
  }

  const argmax = (arr: number[]) => arr.reduce((best, v, i) => (v > arr[best] ? i : best), 0);
  const bestHour = hourBins.some((v) => v) ? argmax(hourBins) : null;
  const bestDay = dayBins.some((v) => v) ? argmax(dayBins) : null;
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const topHashtags = [...hashtagFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t);

  const avg = (k: string) => Math.round(top.reduce((s, r) => s + (r[k] || 0), 0) / top.length);

  return {
    sampleSize: top.length,
    bestHour, // 0..23 or null
    bestDay: bestDay != null ? days[bestDay] : null,
    avgCaptionLength: capCount ? Math.round(capLenSum / capCount) : 0,
    topHashtags,
    avgLikes: avg("likes"),
    avgComments: avg("comments"),
  };
}
