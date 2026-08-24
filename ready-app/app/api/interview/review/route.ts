import { NextResponse } from 'next/server';
import { reviewSchema } from '@/lib/api/schema';
import { aiConfigured } from '@/lib/ai/config';
import { reviewInterview } from '@/lib/ai/claude';
import { heuristicReview } from '@/lib/ai/fallback';
import type { CheckContext } from '@/lib/engine/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Review of what was said.
 *
 * Only the substance of the answers is judged here. Pace, filler words and
 * camera presence are measured on the device and never sent — the transcript
 * is enough for the part a model is actually good at.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "We couldn't read that request." }, { status: 400 });
  }

  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'That interview could not be reviewed. Try recording it again.' }, { status: 400 });
  }

  const ctx = parsed.data.ctx as CheckContext;
  const turns = parsed.data.turns;
  const spoken = turns.some((t) => t.answer.trim().length > 10);

  // With no transcript there is nothing for a language model to read, so the
  // measurable review is the honest one.
  if (!aiConfigured() || !spoken) {
    return NextResponse.json({ review: heuristicReview(ctx, turns) }, { headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const review = await reviewInterview(ctx, turns);
    return NextResponse.json({ review }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json(
      {
        review: heuristicReview(ctx, turns),
        degraded: true,
        note: 'We could not reach the AI reviewer, so this covers what could be measured from your answers.',
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
