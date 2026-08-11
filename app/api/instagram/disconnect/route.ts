import { guard, ok } from "@/lib/api";
import { updateDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST() {
  const denied = guard();
  if (denied) return denied;

  await updateDb((db) => {
    db.instagram = {
      connected: false,
      username: null,
      igUserId: null,
      accountType: null,
      connectedAt: null,
      demo: false,
    };
    db.secrets.instagramAccessToken = null;
  });
  return ok();
}
