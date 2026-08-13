import { json } from "@/lib/api";
import { usingRedis } from "@/lib/kvstore";
import { usingBlob } from "@/lib/blobstore";
import { readDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// Diagnostic endpoint: reports storage wiring + the actual DB read result.
// Returns only booleans and an error message — never any secret values.
export async function GET() {
  let dbRead = "ok";
  let mediaCount = -1;
  try {
    const db = await readDb();
    mediaCount = db.media.length;
  } catch (e: any) {
    dbRead = String(e?.message || e).slice(0, 300);
  }
  return json({
    usingRedis: usingRedis(),
    usingBlob: usingBlob(),
    hasUpstashUrl: Boolean(process.env.UPSTASH_REDIS_REST_URL),
    hasUpstashToken: Boolean(process.env.UPSTASH_REDIS_REST_TOKEN),
    upstashUrlHost: (process.env.UPSTASH_REDIS_REST_URL || "").replace(/^https?:\/\//, "").split("/")[0],
    upstashTokenLen: (process.env.UPSTASH_REDIS_REST_TOKEN || "").length,
    hasBlobToken: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    dbRead,
    mediaCount,
  });
}
