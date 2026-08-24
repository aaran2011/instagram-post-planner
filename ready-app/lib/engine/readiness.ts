/**
 * The Final Readiness Engine.
 *
 * Everything the app learned, collapsed into one number and one word. The
 * number is a weighted mean of whatever was actually measured — a check that
 * skipped the mock interview simply has no communication bucket, rather than a
 * zero or an invented average.
 *
 * The word is deliberately harder to earn than the number: a single critical
 * problem caps you at ALMOST no matter how well everything else scored,
 * because "91/100, ready" while your camera points at the ceiling would be a
 * lie of composition.
 */

import { eventName, getEvent, isOnline } from './events';
import { doNowList } from './recommendations';
import type { AppearanceReport, CheckContext, Finding, Fix, ReadinessBucket, ReadinessReport, ReadyState } from './types';

export interface InterviewResult {
  /** 0–10 from the AI review of the answers themselves. */
  substance: number;
  /** 0–10 measured on-device from pace, fillers and camera presence. */
  delivery: number;
  findings: Finding[];
  fixes: Fix[];
}

export interface PrepResult {
  /** The user opened the prep stage and had questions generated. */
  reviewed: boolean;
  /** How many of the suggested topics they marked as ready. */
  ready: number;
  total: number;
}

export interface ReadinessInput {
  ctx: CheckContext;
  appearance: AppearanceReport;
  interview?: InterviewResult | null;
  prep?: PrepResult | null;
}

const SETUP = ['camera', 'lighting', 'background'] as const;
const APPEARANCE = ['outfit', 'grooming', 'accessories', 'footwear'] as const;

export function buildReadiness(input: ReadinessInput): ReadinessReport {
  const { ctx, appearance, interview, prep } = input;
  const online = isOnline(ctx);
  const profile = getEvent(ctx.eventId);

  const pick = (ids: readonly string[]) => appearance.categories.filter((c) => ids.includes(c.id));
  const mean = (list: { score: number; weight: number }[]) => {
    const w = list.reduce((s, c) => s + c.weight, 0);
    return w ? list.reduce((s, c) => s + c.score * c.weight, 0) / w : null;
  };

  const buckets: (ReadinessBucket & { weight: number })[] = [];

  const look = mean(pick(APPEARANCE));
  if (look !== null) {
    buckets.push({
      id: 'appearance',
      label: 'Appearance',
      score: Math.round(look * 10),
      weight: 3,
      detail: appearance.appearanceScored ? 'Outfit, grooming and how it fits the occasion.' : 'Partial — some of it was out of frame.',
    });
  }

  const setup = mean(pick(SETUP));
  if (setup !== null) {
    buckets.push({
      id: 'setup',
      label: online ? 'Camera & room' : 'Setup',
      score: Math.round(setup * 10),
      weight: online ? 3 : 1,
      detail: online ? 'Height, framing, light on your face, and what is behind you.' : 'Measured while you were in frame.',
    });
  }

  const posture = pick(['posture']);
  if (posture.length) {
    buckets.push({
      id: 'presence',
      label: 'Presence',
      score: Math.round(posture[0].score * 10),
      weight: 1.5,
      detail: 'How you are holding yourself.',
    });
  }

  if (prep?.reviewed) {
    // Preparation is self-reported: the app cannot know what is in someone's
    // head, so this measures engagement with the prep, and says so.
    const ratio = prep.total ? prep.ready / prep.total : 0.6;
    buckets.push({
      id: 'preparation',
      label: 'Preparation',
      score: Math.round((6.5 + ratio * 3.5) * 10),
      weight: 2.5,
      detail: prep.total
        ? `You marked ${prep.ready} of ${prep.total} topics ready. Self-reported.`
        : 'You went through the preparation for this.',
    });
  }

  if (interview) {
    buckets.push({
      id: 'communication',
      label: 'Communication',
      score: Math.round(((interview.substance * 0.55 + interview.delivery * 0.45) / 1) * 10),
      weight: 3,
      detail: 'What you said, and how it came across.',
    });
  }

  const totalWeight = buckets.reduce((s, b) => s + b.weight, 0);
  const score = totalWeight ? Math.round(buckets.reduce((s, b) => s + b.score * b.weight, 0) / totalWeight) : 0;

  const allFixes = [...appearance.fixes, ...(interview?.fixes ?? [])];
  const hasCritical = allFixes.some((f) => f.severity === 'critical');

  // "Ready" is a claim about the whole person, so it needs a check that
  // actually looked at them. A critical fix, or a scan that saw too little,
  // both cap the verdict — the number can still be high, the word cannot.
  let state: ReadyState;
  if (score >= 82 && !hasCritical && !appearance.inconclusive) state = 'ready';
  else if (score >= 62) state = 'almost';
  else state = 'not-ready';

  const doNow = doNowList(allFixes);

  /*
   * Camera framing and posture are real measurements, but on their own they are
   * a reading of a room and a spine — not an answer to "am I ready?". If the
   * appearance check was inconclusive and neither preparation nor an interview
   * filled the gap, the final screen shows no number at all.
   */
  const substantive = buckets.some((b) => b.id === 'appearance' || b.id === 'preparation' || b.id === 'communication');
  const inconclusive = appearance.inconclusive !== false && !substantive;

  return {
    score,
    state,
    inconclusive,
    buckets: buckets.map(({ weight: _weight, ...b }) => b),
    doNow,
    closing:
      appearance.inconclusive === 'no-person'
        ? 'The camera could not see enough of you to call this properly — scan again with your whole self in frame.'
        : appearance.inconclusive === 'nothing-scored' && inconclusive
          ? 'Nothing looked at the part that actually matters here, so there is no honest score to give you.'
          : closingLine(state, ctx, doNow.length, profile.practice),
  };
}

function closingLine(state: ReadyState, ctx: CheckContext, fixes: number, isPractice: boolean): string {
  const what = eventName(ctx).toLowerCase();
  if (state === 'ready') {
    return fixes
      ? `Small things only. Do them, then go — you're ready for this ${what}.`
      : `Nothing left to fix. Go and enjoy your ${what}.`;
  }
  if (state === 'almost') {
    return fixes === 1
      ? 'One thing stands between you and ready. It takes a minute.'
      : `${fixes} things to sort out, then you're good.`;
  }
  return isPractice
    ? "There's real work here, but none of it is hard — start at the top of the list."
    : 'Start at the top of the list. The first two make the biggest difference.';
}

export const READY_STATES: Record<ReadyState, { label: string; blurb: string; tone: 'ok' | 'warn' | 'danger' }> = {
  ready: { label: "You're ready", blurb: "You're good to go.", tone: 'ok' },
  almost: { label: 'Almost ready', blurb: 'A few things to fix first.', tone: 'warn' },
  'not-ready': { label: 'Not ready yet', blurb: 'Some important things to address before you go.', tone: 'danger' },
};
