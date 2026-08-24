import { NextResponse } from 'next/server';
import { analyzeSchema } from '@/lib/api/schema';
import { aiConfigured } from '@/lib/ai/config';
import { analyzeAppearance } from '@/lib/ai/claude';
import { selfChecklist } from '@/lib/ai/fallback';
import { deviceFindings, resetFindingIds } from '@/lib/engine/device-findings';
import { scoreAppearance } from '@/lib/engine/scoring';
import type { CheckContext, Finding, Unavailable } from '@/lib/engine/types';

export const runtime = 'nodejs';
/** Nothing here is cacheable, and nothing here is stored. */
export const dynamic = 'force-dynamic';

/**
 * The appearance check.
 *
 * The frame arrives, is passed to the vision model, and is dropped when the
 * response is written. It is never logged, never written to disk, and never
 * attached to anything that persists — the only things that survive this
 * function are numbers and sentences.
 *
 * The on-device measurements are scored whether or not the model answers, so a
 * failed API call degrades the check rather than ending it.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "We couldn't read that request." }, { status: 400 });
  }

  const parsed = analyzeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'That check was missing some details. Start it again.' }, { status: 400 });
  }

  const { ctx: rawCtx, metrics, coverage, image } = parsed.data;
  const ctx = rawCtx as CheckContext;

  resetFindingIds();
  const device = deviceFindings(ctx, metrics);

  const findings: Finding[] = [...device.findings];
  const unavailable: Unavailable[] = [...device.unavailable];
  let demo = true;
  let degraded: string | undefined;
  let summary = '';

  if (aiConfigured() && image?.data) {
    try {
      const vision = await analyzeAppearance({
        ctx,
        imageBase64: image.data,
        mediaType: image.mediaType,
        coverage,
      });
      findings.push(...vision.findings);
      // Device findings win on the categories they measure; the model is only
      // ever consulted about clothing, which it can see and the device cannot.
      for (const u of vision.unavailable) {
        if (!unavailable.some((x) => x.category === u.category)) unavailable.push(u);
      }
      summary = vision.summary;
      demo = false;
    } catch (error) {
      degraded =
        error instanceof Error && error.name === 'TimeoutError'
          ? 'The outfit check took too long to come back, so this score covers your setup only.'
          : 'We could not reach the outfit check, so this score covers your setup only.';
    }
  } else if (!aiConfigured()) {
    degraded = undefined;
  } else if (!image?.data) {
    degraded = 'You chose not to send the frame, so the outfit itself was not assessed.';
  }

  if (demo) {
    // Nothing looked at the clothes, so nothing is claimed about them. The
    // categories are marked unavailable and a self-check list is returned in
    // their place.
    for (const category of ['outfit', 'grooming', 'accessories'] as const) {
      if (!unavailable.some((u) => u.category === category)) {
        unavailable.push({
          category,
          reason: degraded ?? 'No vision model is connected, so nothing has looked at your outfit. Not scored.',
        });
      }
    }
    if (!unavailable.some((u) => u.category === 'footwear')) {
      unavailable.push({ category: 'footwear', reason: 'Not assessed — no vision model is connected.' });
    }
    findings.push(...selfChecklist(ctx));
  }

  const report = scoreAppearance({
    ctx,
    findings,
    unavailable,
    demo,
    degraded,
    personDetected: Boolean(metrics.framing?.personDetected),
  });

  return NextResponse.json(
    { report, summary },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
