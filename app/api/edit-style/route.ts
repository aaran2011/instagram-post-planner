import { NextRequest } from "next/server";
import { guard, badRequest, json } from "@/lib/api";
import { updateDb } from "@/lib/db";
import type { EditAdjustments, EditStyle } from "@/lib/types";

export const dynamic = "force-dynamic";

const KEYS: (keyof EditAdjustments)[] = [
  "exposure", "contrast", "temperature", "tint", "saturation",
  "vibrance", "highlights", "shadows", "whites", "blacks",
];

const clamp = (n: any) => {
  const v = typeof n === "number" && isFinite(n) ? n : 0;
  return Math.max(-1, Math.min(1, v));
};

// Save a learned editing style (POST) or reset it (DELETE). The heavy lifting
// (analyzing before/after pairs) happens client-side; this only persists the
// resulting normalized adjustments so future edits apply them automatically.
export async function POST(req: NextRequest) {
  const denied = guard();
  if (denied) return denied;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid body");
  }

  const src = body?.adjustments ?? {};
  const adjustments = {} as EditAdjustments;
  for (const k of KEYS) adjustments[k] = clamp(src[k]);

  const pairs = Math.max(0, Math.min(50, parseInt(String(body?.pairs ?? 0)) || 0));
  const notes = String(body?.notes || "").slice(0, 240);

  const style: EditStyle = {
    adjustments,
    pairs,
    notes,
    trainedAt: new Date().toISOString(),
  };

  await updateDb((db) => { db.editStyle = style; });
  return json({ editStyle: style });
}

export async function DELETE() {
  const denied = guard();
  if (denied) return denied;
  await updateDb((db) => { db.editStyle = null; });
  return json({ editStyle: null });
}
