import { guard, ok } from "@/lib/api";
import { updateDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST() {
  const denied = guard();
  if (denied) return denied;
  await updateDb((db) => {
    db.youtube = { connected: false, channelTitle: null, channelId: null, connectedAt: null };
    db.secrets.youtubeAccessToken = null;
    db.secrets.youtubeRefreshToken = null;
    db.secrets.youtubeExpiresAt = null;
  });
  return ok();
}
