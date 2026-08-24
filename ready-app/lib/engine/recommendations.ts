/**
 * The Recommendation Engine.
 *
 * Analysis is only worth anything if it ends in something to do, so every
 * function here returns a short, ordered list of actions — never prose.
 *
 * The one judgement call encoded here: a person with five minutes and a
 * critical problem should be told about the critical problem, even if two
 * smaller fixes would technically score better per minute. Triage beats
 * optimisation when someone is about to walk out of the door.
 */

import { costOf } from './scoring';
import type { AppearanceReport, Finding, Fix, Severity } from './types';

/**
 * Findings that did not go through the appearance scorer — the delivery
 * findings from the mock interview — still need to become actions on the final
 * list. Impact is scaled to the same 0–10 overall scale so the "do this now"
 * ordering can compare a filler-word habit against a crooked collar.
 */
export function fixesFromFindings(findings: Finding[], weight = 0.35): Fix[] {
  return findings
    .filter((f) => f.severity && f.recommendation)
    .map((f) => ({
      id: f.id,
      category: f.category,
      title: f.recommendation!,
      detail: f.text,
      severity: f.severity!,
      minutes: f.minutes ?? 2,
      impact: Math.round(costOf(f) * weight * 100) / 100,
    }));
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, improve: 1, polish: 2 };

/** Critical first, then by points-per-minute, then by raw points. */
export function prioritise(fixes: Fix[]): Fix[] {
  return [...fixes].sort((a, b) => {
    if (SEVERITY_RANK[a.severity] !== SEVERITY_RANK[b.severity]) {
      return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    }
    const rateA = a.impact / Math.max(a.minutes, 0.5);
    const rateB = b.impact / Math.max(b.minutes, 0.5);
    if (rateB !== rateA) return rateB - rateA;
    return b.impact - a.impact;
  });
}

/**
 * Breadth before depth.
 *
 * Straight priority order will happily hand someone "raise the camera" and
 * "tilt the camera up a little" as two of their three most important actions,
 * which reads as one instruction stuttered twice. A short list is more useful
 * when it spans the problem: one camera thing, one light thing, one outfit
 * thing. So the first pass takes the best fix from each category, and only then
 * do leftovers fill any remaining slots.
 */
function breadthFirst(fixes: Fix[], limit: number): Fix[] {
  const ordered = prioritise(fixes);
  const picked = new Set<Fix>();
  const categories = new Set<string>();

  for (const fix of ordered) {
    if (picked.size >= limit) break;
    if (categories.has(fix.category)) continue;
    categories.add(fix.category);
    picked.add(fix);
  }
  for (const fix of ordered) {
    if (picked.size >= limit) break;
    picked.add(fix);
  }
  return prioritise([...picked]);
}

export function topFixes(report: AppearanceReport, n = 3): Fix[] {
  return breadthFirst(report.fixes, n);
}

export interface TimedPlan {
  minutes: number;
  fixes: Fix[];
  /** What had to be left out, so the omission is visible rather than silent. */
  deferred: Fix[];
  note: string;
}

/**
 * What fits in the time they actually have.
 *
 * Greedy over the prioritised list rather than a knapsack: the numbers here
 * are estimates to one decimal place, so an optimal packing would be false
 * precision, and the order people fix things in matters to them.
 */
export function planForTime(report: AppearanceReport, minutes: number): TimedPlan {
  const ordered = prioritise(report.fixes);
  const budget = minutes >= 999 ? Infinity : minutes;
  const fixes: Fix[] = [];
  const deferred: Fix[] = [];
  let spent = 0;

  for (const fix of ordered) {
    if (spent + fix.minutes <= budget) {
      fixes.push(fix);
      spent += fix.minutes;
    } else {
      deferred.push(fix);
    }
  }

  // A critical problem is never quietly dropped for being slow. If it does not
  // fit, it still leads the list and the note says the time is tight.
  const droppedCritical = deferred.filter((f) => f.severity === 'critical');
  if (droppedCritical.length) {
    fixes.unshift(...droppedCritical);
    for (const f of droppedCritical) deferred.splice(deferred.indexOf(f), 1);
    spent += droppedCritical.reduce((s, f) => s + f.minutes, 0);
  }

  let note: string;
  if (!ordered.length) note = 'Nothing to fix. Go.';
  else if (!deferred.length && spent <= budget) note = `All of it fits in ${labelMinutes(minutes)}.`;
  else if (droppedCritical.length) note = `Tight, but the first one matters more than being on time by a minute.`;
  else note = `${deferred.length} smaller ${deferred.length === 1 ? 'thing' : 'things'} left out — they need more time than you have.`;

  return { minutes, fixes, deferred, note };
}

export function labelMinutes(minutes: number): string {
  if (minutes >= 999) return 'the time you have';
  if (minutes >= 60) return `${Math.round(minutes / 60)} hour${minutes >= 120 ? 's' : ''}`;
  return `${minutes} minutes`;
}

export interface PerfectPlan {
  /** Already there — the honest answer when nothing is worth changing. */
  alreadyThere: boolean;
  from: number;
  projected: number;
  steps: Fix[];
  message: string;
}

/**
 * "Make me a 10/10", read literally and answered minimally.
 *
 * The brief's instruction is the important part: do not invent work. If they
 * are at 9.5 the answer is that they are done. Otherwise take fixes in
 * descending impact until the projection stops moving meaningfully — the
 * smallest set of changes that gets there, not a wardrobe rebuild.
 */
export function pathToPerfect(report: AppearanceReport): PerfectPlan {
  const from = report.overall;
  if (from >= 9.5 || report.fixes.length === 0) {
    return {
      alreadyThere: true,
      from,
      projected: from,
      steps: [],
      message:
        from >= 9.5
          ? "You're already there. Changing more would make this worse, not better."
          : 'Nothing worth changing turned up. Go as you are.',
    };
  }

  const byImpact = [...report.fixes].sort((a, b) => b.impact - a.impact);
  const steps: Fix[] = [];
  let projected = from;

  for (const fix of byImpact) {
    if (projected >= 9.8) break;
    // Below a tenth of a point it is noise, not a recommendation.
    if (fix.impact < 0.1 && steps.length >= 2) break;
    steps.push(fix);
    projected = Math.min(10, Math.round((projected + fix.impact) * 10) / 10);
    if (steps.length >= 5) break;
  }

  const count = steps.length;
  const changes = count === 1 ? 'One change gets' : `${count} changes get`;
  return {
    alreadyThere: false,
    from,
    projected,
    steps: prioritise(steps),
    // Promising a 10 and delivering an 8.7 would be the same overclaiming this
    // app avoids everywhere else, so when the visible problems do not add up to
    // a perfect score, the ceiling is stated rather than glossed over.
    message:
      projected >= 9.5
        ? `You're at ${from}. ${changes} you to about ${projected}.`
        : `You're at ${from}. ${changes} you to about ${projected} — that is as far as what we can see will take you.`,
  };
}

/** The final "before you go" list: short, ordered, and never more than four. */
export function doNowList(fixes: Fix[], extras: Fix[] = []): Fix[] {
  const seen = new Set<string>();
  const unique = [...fixes, ...extras].filter((fix) => {
    const key = `${fix.category}:${fix.title.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return breadthFirst(unique, 4);
}
