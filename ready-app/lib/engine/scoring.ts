/**
 * The Scoring Engine.
 *
 * Two rules make the numbers trustworthy:
 *
 *   1. The model never picks a number. It reports what it sees and how serious
 *      it thinks that is; the arithmetic below is the only thing that turns
 *      words into points. Same finding, same cost, every time.
 *   2. Everyone starts near the top. Someone who is dressed appropriately and
 *      has nothing flagged scores a 9-something, not a 6 — the score answers
 *      "is anything wrong?", not "how fashionable are you?".
 */

import { weightsFor } from './events';
import type {
  AppearanceReport,
  CategoryId,
  CategoryScore,
  CheckContext,
  Confidence,
  Finding,
  Fix,
  Severity,
  Unavailable,
} from './types';
import { CATEGORY_LABELS } from './types';

/** Points a problem costs, before confidence is taken into account. */
const SEVERITY_COST: Record<Severity, number> = {
  critical: 1.6,
  improve: 0.7,
  polish: 0.3,
};

/** An uncertain observation cannot cost as much as a certain one. */
const CONFIDENCE_FACTOR: Record<Confidence, number> = {
  high: 1,
  medium: 0.85,
  low: 0.5,
};

/** Nothing flagged means nothing wrong — not mediocrity. */
const BASE = 9.0;
const FLOOR = 2.5;
const CEIL = 10;
const STRENGTH_CREDIT = 0.2;
const MAX_STRENGTH_CREDIT = 0.7;

export function costOf(finding: Finding): number {
  if (!finding.severity) return 0;
  return SEVERITY_COST[finding.severity] * CONFIDENCE_FACTOR[finding.confidence];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Default time cost when a finding does not state one. */
function defaultMinutes(finding: Finding): number {
  if (finding.minutes != null) return finding.minutes;
  switch (finding.category) {
    case 'camera':
    case 'lighting':
    case 'posture':
      return 1;
    case 'background':
      return 3;
    case 'grooming':
      return 4;
    case 'accessories':
    case 'footwear':
      return 3;
    default:
      return 5;
  }
}

export interface ScoreInput {
  ctx: CheckContext;
  findings: Finding[];
  /** Categories that could not be judged, with the reason shown to the user. */
  unavailable: Unavailable[];
  /** True when no vision model looked at the frame. */
  demo: boolean;
  degraded?: string;
  /** Whether the on-device model actually found a person in the frame. */
  personDetected: boolean;
}

/** Categories that describe the person rather than their setup. */
const APPEARANCE: CategoryId[] = ['outfit', 'grooming', 'accessories', 'footwear'];

export function scoreAppearance(input: ScoreInput): AppearanceReport {
  const { ctx, demo, degraded } = input;
  // Checklist items are prompts to look at something yourself. Nothing has
  // actually looked at them, so they are shown but never scored.
  const findings = input.findings.filter((f) => f.source !== 'checklist');
  const checklist = input.findings.filter((f) => f.source === 'checklist');
  const weights = weightsFor(ctx);
  const blocked = new Map(input.unavailable.map((u) => [u.category, u]));

  const relevant = (Object.keys(CATEGORY_LABELS) as CategoryId[]).filter((id) => {
    if ((weights[id] ?? 0) <= 0) return false;
    if (blocked.has(id)) return false;
    // Preparation and communication are scored by their own stages, not here.
    return id !== 'preparation' && id !== 'communication';
  });

  /*
   * No evidence, no score.
   *
   * The starting point of 9.0 means "nothing wrong was found" — which is only
   * a meaningful statement if something actually looked. A category that came
   * back with not one observation, strength or criticism, was not assessed, and
   * scoring it 9.0 would quietly inflate the average with a category nobody
   * examined. It is reported as not assessed instead.
   */
  const active = relevant.filter((id) => findings.some((f) => f.category === id));
  const unexamined = relevant.filter((id) => !active.includes(id));

  const categories: CategoryScore[] = active.map((id) => {
    const own = findings.filter((f) => f.category === id);
    const problems = own.filter((f) => f.severity);
    const strengths = own.filter((f) => !f.severity);
    const credit = Math.min(strengths.length * STRENGTH_CREDIT, MAX_STRENGTH_CREDIT);
    const penalty = problems.reduce((sum, f) => sum + costOf(f), 0);
    return {
      id,
      label: CATEGORY_LABELS[id],
      score: round1(clamp(BASE + credit - penalty, FLOOR, CEIL)),
      weight: weights[id] ?? 0,
      findings: [...problems, ...strengths],
      lowConfidence: own.some((f) => f.confidence === 'low'),
    };
  });

  const appearanceScored = categories.some((c) => APPEARANCE.includes(c.id));
  const totalWeight = categories.reduce((s, c) => s + c.weight, 0);
  const overall = totalWeight
    ? round1(categories.reduce((s, c) => s + c.score * c.weight, 0) / totalWeight)
    : 0;

  // A fix's impact is exactly the overall-score points it gives back, which is
  // why the "make me a 10" maths later can be arithmetic rather than vibes.
  const fixes: Fix[] = findings
    .filter((f) => f.severity && f.recommendation)
    .filter((f) => active.includes(f.category))
    .map((f) => {
      const weight = weights[f.category] ?? 0;
      const impact = totalWeight ? (costOf(f) * weight) / totalWeight : 0;
      return {
        id: f.id,
        category: f.category,
        title: f.recommendation!,
        detail: f.text,
        severity: f.severity!,
        minutes: defaultMinutes(f),
        impact: Math.round(impact * 100) / 100,
      } satisfies Fix;
    })
    .sort((a, b) => b.impact - a.impact);

  const unavailable: Unavailable[] = [
    ...input.unavailable.filter((u) => (weights[u.category] ?? 0) > 0),
    ...unexamined.map((category) => ({
      category,
      reason: 'Nothing was reported about this, so it was left out rather than assumed to be fine.',
    })),
  ];

  return {
    categories: categories.sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label)),
    unavailable,
    overall,
    fixes,
    strengths: findings.filter((f) => !f.severity).slice(0, 6),
    demo,
    degraded,
    checklist,
    appearanceScored,
    // Two incidental measurements do not add up to a verdict on a person.
    inconclusive: !input.personDetected && !appearanceScored
      ? 'no-person'
      : categories.length < 2
        ? 'nothing-scored'
        : false,
  };
}

/**
 * Words for a number.
 *
 * The brief is explicit that this app coaches rather than grades, so even the
 * bottom of the range describes the work left, not the person.
 */
export function verdictFor(score: number): { headline: string; tone: 'ok' | 'warn' | 'danger' } {
  if (score >= 9.2) return { headline: "You're ready.", tone: 'ok' };
  if (score >= 8) return { headline: "You're basically there.", tone: 'ok' };
  if (score >= 6.5) return { headline: "You're close.", tone: 'warn' };
  if (score >= 5) return { headline: 'A few things to sort out first.', tone: 'warn' };
  return { headline: "Let's fix the big ones.", tone: 'danger' };
}

/** Explains one category as a ledger: base, credits, deductions. */
export function explain(category: CategoryScore): { label: string; delta: number; text: string }[] {
  const rows = [{ label: 'Starting point', delta: BASE, text: 'Nothing wrong until something is found.' }];
  for (const f of category.findings) {
    if (f.severity) {
      rows.push({ label: f.text, delta: -round1(costOf(f)), text: f.recommendation ?? '' });
    } else {
      rows.push({ label: f.text, delta: STRENGTH_CREDIT, text: '' });
    }
  }
  return rows;
}

export const SCORING_CONSTANTS = { BASE, FLOOR, CEIL, SEVERITY_COST, CONFIDENCE_FACTOR };
