'use client';

import { useMemo, useState } from 'react';
import { eventName, timeBudget } from '@/lib/engine/events';
import { explain, verdictFor } from '@/lib/engine/scoring';
import { labelMinutes, pathToPerfect, planForTime, topFixes } from '@/lib/engine/recommendations';
import { compare } from '@/lib/store/history';
import { CATEGORY_BLURBS, type AppearanceReport, type CheckContext } from '@/lib/engine/types';
import { Icon } from '../icons';
import { Expandable, Pill, ScoreRing, SectionTitle, SourceTag } from '../ui';
import { FixCard } from './fix-card';

const TIME_CHOICES = [2, 5, 15, 30, 60];

/**
 * The results screen.
 *
 * Ordered by what someone standing at the door needs: the number, the verdict,
 * the two or three things to do about it — and only then the reasoning, the
 * category breakdown and the caveats. Nobody should have to scroll to find out
 * whether they are all right.
 */
export function AnalysisStep({
  ctx,
  report,
  previous,
  onRescan,
  onDone,
  isLastStep,
}: {
  ctx: CheckContext;
  report: AppearanceReport;
  previous: AppearanceReport | null;
  onRescan: () => void;
  onDone: () => void;
  isLastStep: boolean;
}) {
  const [minutes, setMinutes] = useState(() => timeBudget(ctx.answers));
  const [showPerfect, setShowPerfect] = useState(false);
  const [doneFixes, setDoneFixes] = useState<string[]>([]);

  const verdict = verdictFor(report.overall);
  const top = useMemo(() => topFixes(report, 3), [report]);
  const plan = useMemo(() => planForTime(report, minutes), [report, minutes]);
  const perfect = useMemo(() => pathToPerfect(report), [report]);
  // Before/after needs two scores that mean something. Comparing against a
  // check we just said we could not make would undo that statement one card
  // further down the page.
  const delta = previous && !previous.inconclusive && !report.inconclusive ? compare(previous, report) : null;

  return (
    <section className="rise pb-4">
      {/* ------------------------------------------------------- headline -- */}
      {report.inconclusive ? (
        // No score at all rather than a confident number built from whatever
        // happened to be measurable. This is the screen the whole product's
        // credibility rests on.
        <div className="flex flex-col items-center pt-2 text-center">
          <p className="eyebrow mb-3">{eventName(ctx)}</p>
          <span
            className="mb-4 grid h-20 w-20 place-items-center rounded-full"
            style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}
          >
            <Icon.eye size={34} />
          </span>
          <h1 className="headline text-[1.5rem]">Not enough to score you.</h1>
          <p className="mx-auto mt-2 max-w-sm text-[0.95rem] leading-snug text-[color:var(--ink-2)]">
            {report.inconclusive === 'no-person'
              ? 'We could not see enough of you to judge anything meaningful. Rather than put a number on two incidental measurements, here is what we did and did not manage to read.'
              : `For a ${eventName(ctx).toLowerCase()}, nearly everything that counts is the outfit itself — and nothing looked at it. A score built on what is left would be meaningless, so here is the list to run through yourself instead.`}
          </p>
          {report.inconclusive === 'no-person' ? (
            <button type="button" className="btn btn-primary mt-5" onClick={onRescan}>
              <Icon.camera size={18} />
              Try the scan again
            </button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col items-center pt-2 text-center">
          <p className="eyebrow mb-3">{eventName(ctx)}</p>
          <ScoreRing value={report.overall} max={10} size={172} label={verdict.headline} />
          <h1 className="headline mt-4 text-[1.6rem]">{verdict.headline}</h1>
          {report.appearanceScored ? null : (
            <p className="mt-1.5 text-[0.9rem] text-[color:var(--ink-2)]">
              This score covers your camera, lighting, background and posture. Your outfit was not looked at.
            </p>
          )}
        </div>
      )}

      {/* --------------------------------------------------- before/after -- */}
      {delta ? (
        <div
          className="pop mt-6 rounded-[var(--r-lg)] p-5 text-center"
          style={{ background: delta.delta >= 0 ? 'var(--ok-soft)' : 'var(--warn-soft)' }}
        >
          <p className="eyebrow mb-2">Since your last scan</p>
          <p className="numeric display text-[2.2rem]" style={{ color: delta.delta >= 0 ? 'var(--ok)' : 'var(--warn)' }}>
            {delta.delta >= 0 ? '+' : ''}
            {delta.delta.toFixed(1)}
          </p>
          <p className="mt-1 text-[0.95rem] font-semibold">
            {delta.before.toFixed(1)} → {delta.after.toFixed(1)}
          </p>
          {delta.improved.length ? (
            <ul className="mt-3 space-y-1 text-left text-[0.88rem] text-[color:var(--ink-2)]">
              {delta.improved.map((line) => (
                <li key={line} className="flex gap-2">
                  <span style={{ color: 'var(--ok)' }} aria-hidden="true">
                    <Icon.check size={15} />
                  </span>
                  {line}
                </li>
              ))}
            </ul>
          ) : null}
          {delta.regressed.length ? (
            <ul className="mt-2 space-y-1 text-left text-[0.88rem]" style={{ color: 'var(--warn)' }}>
              {delta.regressed.map((line) => (
                <li key={line}>↓ {line}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* ------------------------------------------------ honesty banners -- */}
      {report.demo ? (
        <div className="card mt-6 p-4" style={{ borderColor: 'var(--warn)' }}>
          <span className="mb-2 flex items-center gap-2">
            <Pill tone="warn">Demo Analysis</Pill>
          </span>
          <p className="text-[0.9rem] leading-snug text-[color:var(--ink-2)]">
            {report.degraded ??
              'No vision model is connected, so nothing has looked at your outfit. Rather than invent a verdict, we scored only what this device measured — and left the clothes out entirely.'}{' '}
            Add an <code className="rounded px-1" style={{ background: 'var(--surface-2)' }}>ANTHROPIC_API_KEY</code> to
            turn the outfit check on.
          </p>
        </div>
      ) : report.degraded ? (
        <div className="card mt-6 p-4" style={{ borderColor: 'var(--warn)' }}>
          <p className="text-[0.9rem] leading-snug text-[color:var(--ink-2)]">{report.degraded}</p>
        </div>
      ) : null}

      {/* ----------------------------------------------------- top fixes -- */}
      {top.length ? (
        <div className="mt-8">
          <SectionTitle
            eyebrow="Do these first"
            title={top.length === 1 ? 'One thing to fix' : `Top ${top.length} things to fix`}
            hint="Ranked by how much they change the result, not by how easy they are."
          />
          <ul className="space-y-2.5">
            {top.map((fix, i) => (
              <li key={fix.id}>
                <FixCard fix={fix} index={i + 1} />
              </li>
            ))}
          </ul>
        </div>
      ) : report.inconclusive ? null : (
        <div className="card mt-8 p-5 text-center">
          <span className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-full" style={{ background: 'var(--ok-soft)', color: 'var(--ok)' }}>
            <Icon.check size={20} />
          </span>
          <p className="headline text-[1.05rem]">Nothing came back that needs fixing.</p>
          <p className="mt-1 text-[0.9rem] text-[color:var(--ink-2)]">
            Everything measured came out where it should. Changing more would make this worse, not better.
          </p>
        </div>
      )}

      {/* ------------------------------------------------ make me a 10/10 -- */}
      <div className="mt-4" hidden={report.inconclusive !== false}>
        <button
          type="button"
          className="btn w-full text-white"
          style={{ background: 'var(--grad-violet)' }}
          onClick={() => setShowPerfect((v) => !v)}
          aria-expanded={showPerfect}
        >
          <Icon.sparkle size={18} />
          Make me a 10/10
        </button>

        {showPerfect ? (
          <div className="card rise mt-2.5 p-5">
            <p className="headline text-[1.05rem]">{perfect.message}</p>
            {perfect.alreadyThere ? (
              <p className="mt-2 text-[0.9rem] text-[color:var(--ink-2)]">
                We are not going to invent work for you. Go.
              </p>
            ) : (
              <>
                <ol className="mt-3 space-y-2">
                  {perfect.steps.map((fix, i) => (
                    <li key={fix.id} className="flex items-start gap-3">
                      <span
                        className="numeric mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[0.78rem] font-bold text-white"
                        style={{ background: 'var(--violet)' }}
                      >
                        {i + 1}
                      </span>
                      <span>
                        <span className="block text-[0.98rem] font-semibold leading-snug">{fix.title}</span>
                        <span className="block text-[0.82rem] text-[color:var(--ink-3)]">
                          {fix.minutes} min · worth about +{fix.impact.toFixed(1)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
                <p className="mt-3 text-[0.85rem] text-[color:var(--ink-3)]">
                  Same clothes, same you — these are adjustments, not a different outfit.
                </p>
              </>
            )}
          </div>
        ) : null}
      </div>

      {/* --------------------------------------------------- time planner -- */}
      {report.fixes.length ? (
        <div className="mt-8">
          <SectionTitle eyebrow="Time-based plan" title="How long have you got?" />
          <div className="rail -mx-4 mb-3 flex gap-2 overflow-x-auto px-4">
            {TIME_CHOICES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMinutes(m)}
                aria-pressed={minutes === m}
                className="tap shrink-0 rounded-full border px-4 text-[0.9rem] font-semibold transition-colors"
                style={{
                  background: minutes === m ? 'var(--ink)' : 'var(--surface)',
                  color: minutes === m ? 'var(--paper)' : 'var(--ink-2)',
                  borderColor: minutes === m ? 'var(--ink)' : 'var(--line-strong)',
                }}
              >
                {m >= 60 ? '1 hour' : `${m} min`}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setMinutes(999)}
              aria-pressed={minutes === 999}
              className="tap shrink-0 rounded-full border px-4 text-[0.9rem] font-semibold"
              style={{
                background: minutes === 999 ? 'var(--ink)' : 'var(--surface)',
                color: minutes === 999 ? 'var(--paper)' : 'var(--ink-2)',
                borderColor: minutes === 999 ? 'var(--ink)' : 'var(--line-strong)',
              }}
            >
              Plenty
            </button>
          </div>

          <p className="mb-3 text-[0.88rem] text-[color:var(--ink-2)]">{plan.note}</p>

          <ul className="space-y-2.5">
            {plan.fixes.map((fix) => (
              <li key={fix.id}>
                <FixCard
                  fix={fix}
                  done={doneFixes.includes(fix.id)}
                  onToggle={() =>
                    setDoneFixes((d) => (d.includes(fix.id) ? d.filter((id) => id !== fix.id) : [...d, fix.id]))
                  }
                />
              </li>
            ))}
          </ul>

          {plan.deferred.length ? (
            <details className="mt-3">
              <summary className="tap cursor-pointer text-[0.88rem] font-semibold text-[color:var(--ink-2)]">
                {plan.deferred.length} left out of this plan
              </summary>
              <ul className="mt-2 space-y-1.5 text-[0.88rem] text-[color:var(--ink-2)]">
                {plan.deferred.map((fix) => (
                  <li key={fix.id}>
                    · {fix.title} <span className="text-[color:var(--ink-3)]">({fix.minutes} min)</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      {/* ----------------------------------------------------- breakdown -- */}
      <div className="mt-9">
        <SectionTitle
          eyebrow="The breakdown"
          title="Where the score came from"
          hint="Tap any category to see exactly what it cost and why."
        />
        <ul className="space-y-2">
          {report.categories.map((category) => {
            const rows = explain(category);
            const tone = category.score >= 8.5 ? 'var(--ok)' : category.score >= 7 ? 'var(--warn)' : 'var(--bad)';
            return (
              <li key={category.id} className="card px-4 py-3">
                <Expandable
                  summary={
                    <span className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="block text-[1rem] font-semibold">{category.label}</span>
                        <span className="block text-[0.78rem] text-[color:var(--ink-3)]">
                          {CATEGORY_BLURBS[category.id]}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        {category.lowConfidence ? <Pill tone="neutral">Low confidence</Pill> : null}
                        <span className="numeric text-[1.15rem] font-bold" style={{ color: tone }}>
                          {category.score.toFixed(1)}
                        </span>
                      </span>
                    </span>
                  }
                >
                  <ul className="space-y-2.5 border-t pt-3 hairline">
                    {rows.map((row, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <span
                          className="numeric mt-0.5 w-12 shrink-0 text-right text-[0.86rem] font-bold"
                          style={{ color: row.delta < 0 ? 'var(--bad)' : i === 0 ? 'var(--ink-3)' : 'var(--ok)' }}
                        >
                          {i === 0 ? row.delta.toFixed(1) : `${row.delta > 0 ? '+' : ''}${row.delta.toFixed(1)}`}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[0.92rem] leading-snug">{row.label}</span>
                          {row.text ? (
                            <span className="mt-0.5 block text-[0.85rem] leading-snug text-[color:var(--ink-2)]">
                              → {row.text}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex flex-wrap gap-1.5 border-t pt-3 hairline">
                    {category.findings.slice(0, 1).map((f) => (
                      <SourceTag key={f.id} source={f.source} kind={f.kind} confidence={f.confidence} />
                    ))}
                    <span className="chip">Weight for this occasion: {category.weight}/5</span>
                  </div>
                </Expandable>
              </li>
            );
          })}
        </ul>
      </div>

      {/* --------------------------------------------------- not assessed -- */}
      {report.unavailable.length ? (
        <div className="mt-8">
          <SectionTitle eyebrow="Left out on purpose" title="What we could not judge" />
          <ul className="card divide-y p-0 hairline">
            {report.unavailable.map((u) => (
              <li key={u.category} className="px-4 py-3">
                <p className="text-[0.95rem] font-semibold capitalize">{u.category}</p>
                <p className="mt-0.5 text-[0.86rem] leading-snug text-[color:var(--ink-2)]">{u.reason}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* ------------------------------------------------------ checklist -- */}
      {report.checklist.length ? (
        <div className="mt-8">
          <SectionTitle
            eyebrow="Since nothing looked at your outfit"
            title="Check these yourself"
            hint="A mirror and thirty seconds. These are not scored — nothing has seen them."
          />
          <ul className="card divide-y p-0 hairline">
            {report.checklist.map((f) => (
              <li key={f.id} className="flex items-start gap-3 px-4 py-3">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: 'var(--ember)' }} aria-hidden="true" />
                <span className="text-[0.93rem] leading-snug">{f.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* --------------------------------------------------------- strong -- */}
      {report.strengths.length ? (
        <div className="mt-8">
          <SectionTitle eyebrow="Working already" title="Leave these alone" />
          <ul className="space-y-1.5">
            {report.strengths.map((f) => (
              <li key={f.id} className="flex items-start gap-2.5 text-[0.93rem] leading-snug">
                <span className="mt-0.5 shrink-0" style={{ color: 'var(--ok)' }} aria-hidden="true">
                  <Icon.check size={16} />
                </span>
                {f.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* --------------------------------------------------------- action -- */}
      <div className="sticky bottom-0 -mx-4 mt-9 border-t px-4 pt-3 hairline safe-b" style={{ background: 'var(--paper)' }}>
        <button type="button" className="btn btn-primary w-full" onClick={onDone}>
          {isLastStep ? 'See if I am ready' : 'Next'}
          <Icon.arrow size={18} />
        </button>
        <button type="button" className="btn btn-ghost mt-1.5 w-full text-[0.9rem]" onClick={onRescan}>
          <Icon.refresh size={16} />
          I fixed something — scan me again
        </button>
        <p className="mt-1 pb-1 text-center text-[0.78rem] text-[color:var(--ink-3)]">
          You have about {labelMinutes(minutes)}.
        </p>
      </div>
    </section>
  );
}
