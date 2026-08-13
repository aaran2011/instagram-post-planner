import { guard, json } from "@/lib/api";
import { updateDb } from "@/lib/db";
import { buildClientState } from "@/lib/state";

export const dynamic = "force-dynamic";

// Clears ALL planned posts (empties the calendar/grid). Uploaded media is KEPT
// in the library — this only removes the schedule.
export async function POST() {
  const denied = guard();
  if (denied) return denied;
  await updateDb((db) => {
    db.posts = [];
  });
  return json(await buildClientState());
}
