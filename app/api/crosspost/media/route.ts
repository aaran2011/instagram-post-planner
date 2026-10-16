import { guard, json, serverError } from "@/lib/api";
import { currentAccountId } from "@/lib/db";
import { listIgMediaForReview } from "@/lib/crosspost";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Lists the signed-in account's recent Instagram media for the Automation
// builder's review step (reels + images/carousels), with per-item status flags.
export async function GET() {
  const denied = guard();
  if (denied) return denied;
  const uid = await currentAccountId();
  if (!uid) return json({ items: [] });
  try {
    const items = await listIgMediaForReview(uid);
    return json({ items });
  } catch (e: any) {
    return serverError(e?.message || "Could not load Instagram media");
  }
}
