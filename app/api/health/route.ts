import { json } from "@/lib/api";
import { usingRedis, getLastTick } from "@/lib/kvstore";
import { usingBlob } from "@/lib/blobstore";
import { readDb } from "@/lib/db";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

// Diagnostic endpoint: reports storage wiring + the actual DB read result.
// Returns only booleans and an error message — never any secret values.
export async function GET() {
  let dbRead = "ok";
  let mediaCount = -1;
  const postsByStatus: Record<string, number> = {};
  let nextDue: string | null = null;
  try {
    const db = await readDb();
    mediaCount = db.media.length;
    for (const p of db.posts) postsByStatus[p.status] = (postsByStatus[p.status] || 0) + 1;
    const scheduled = db.posts
      .filter((p) => p.status === "scheduled")
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    nextDue = scheduled[0]?.scheduledAt ?? null;
  } catch (e: any) {
    dbRead = String(e?.message || e).slice(0, 300);
  }
  const lastTick = await getLastTick().catch(() => null);
  const now = Date.now();
  const lastTickSecondsAgo = lastTick
    ? Math.round((now - Date.parse(lastTick)) / 1000)
    : null;
  return json({
    now: new Date(now).toISOString(),
    lastTick,
    lastTickSecondsAgo,
    usingRedis: usingRedis(),
    usingBlob: usingBlob(),
    hasUpstashUrl: Boolean(process.env.UPSTASH_REDIS_REST_URL),
    hasUpstashToken: Boolean(process.env.UPSTASH_REDIS_REST_TOKEN),
    upstashUrlHost: (process.env.UPSTASH_REDIS_REST_URL || "").replace(/^https?:\/\//, "").split("/")[0],
    upstashTokenLen: (process.env.UPSTASH_REDIS_REST_TOKEN || "").length,
    hasBlobToken: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    dbRead,
    mediaCount,
    postsByStatus,
    nextScheduled: nextDue,
    // Instagram OAuth wiring (no secret value — only what the app sends/uses).
    instagramRedirectUri: config.ig.redirectUri,
    instagramAppId: config.ig.appId,
    instagramSecretLen: config.ig.appSecret.length,
  });
}
