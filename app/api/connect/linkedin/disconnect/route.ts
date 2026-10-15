import { guard, ok } from "@/lib/api";
import { updateDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST() {
  const denied = guard();
  if (denied) return denied;
  await updateDb((db) => {
    db.linkedin = { connected: false, name: null, memberId: null, connectedAt: null };
    db.secrets.linkedinAccessToken = null;
    db.secrets.linkedinExpiresAt = null;
  });
  return ok();
}
