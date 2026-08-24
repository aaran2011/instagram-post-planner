import { NextResponse } from 'next/server';
import { prepareSchema } from '@/lib/api/schema';
import { aiConfigured } from '@/lib/ai/config';
import { generatePrep } from '@/lib/ai/claude';
import { questionBank } from '@/lib/ai/fallback';
import type { CheckContext } from '@/lib/engine/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Preparation material for whatever is about to happen.
 *
 * The fallback is a real question bank rather than a stub, so this endpoint is
 * useful with no key at all — the response just says where the questions came
 * from, and the UI repeats that to the user.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "We couldn't read that request." }, { status: 400 });
  }

  const parsed = prepareSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Some details were missing. Go back a step and try again.' }, { status: 400 });
  }
  const ctx = parsed.data.ctx as CheckContext;

  if (!aiConfigured()) {
    return NextResponse.json({ pack: questionBank(ctx) }, { headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const pack = await generatePrep(ctx);
    // An empty response is worse than a generic one that actually helps.
    if (!pack.likelyQuestions.length || !pack.mockQuestions.length) {
      return NextResponse.json({ pack: questionBank(ctx), degraded: true });
    }
    return NextResponse.json({ pack }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json(
      {
        pack: questionBank(ctx),
        degraded: true,
        note: 'We could not reach the AI, so these are the standard questions for this kind of interview.',
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
