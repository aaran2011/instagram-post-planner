import { NextRequest } from "next/server";
import { guard, json } from "@/lib/api";
import { readDb, updateDb } from "@/lib/db";
import { processDue, publishOne } from "@/lib/publisher";
import { buildClientState } from "@/lib/state";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Two modes:
//  - { postId }        -> publish/retry that one post right now.
//  - {} (schedule all) -> mark all drafts "scheduled", then publish any due now.
export async function POST(req: NextRequest) {
  const denied = guard();
  if (denied) return denied;

  let body: any = {};
  try {
    body = await req.json();
  } catch {}

  if (body?.postId) {
    const outcome = await publishOne(String(body.postId), { force: true });
    return json({ outcome, ...(await buildClientState()) });
  }

  // Schedule-all: every draft becomes scheduled at its planned time.
  await updateDb((db) => {
    for (const p of db.posts) {
      if (p.status === "draft" || p.status === "failed") p.status = "scheduled";
    }
  });

  // Immediately publish anything already due (past-dated or now).
  const outcomes = await processDue();

  const db = await readDb();
  const summary = {
    total: db.posts.length,
    scheduled: db.posts.filter((p) => p.status === "scheduled").length,
    published: db.posts.filter((p) => p.status === "published").length,
    demoPublished: db.posts.filter((p) => p.status === "demo_published").length,
    failed: db.posts.filter((p) => p.status === "failed").length,
    demoMode: db.settings.demoMode,
  };

  return json({ outcomes, summary, ...(await buildClientState()) });
}
