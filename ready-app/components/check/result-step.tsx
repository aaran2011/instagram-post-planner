'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { buildReadiness, READY_STATES, type InterviewResult, type PrepResult } from '@/lib/engine/readiness';
import { eventName } from '@/lib/engine/events';
import type { AppearanceReport, CheckContext, ReadinessReport } from '@/lib/engine/types';
import { Icon } from '../icons';
import { Pill, ScoreRing, SectionTitle } from '../ui';

const EMPTY_REPORT: AppearanceReport = {
  categories: [],
  unavailable: [],
  overall: 0,
  fixes: [],
  strengths: [],
  demo: true,
  checklist: [],
  appearanceScored: false,
  inconclusive: 'no-person',
};

/**
 * The last screen.
 *
 * The brief calls this the final moment of the product, and the design follows
 * that literally: one number, one verdict, and a list short enough to hold in
 * your head on the way to the door. Everything analytical is behind the fold or
 * back on the previous screen — by now, more detail is not more useful.
 */
export function ResultStep({
  ctx,
  report,
  previous,
  interview,
  prep,
  onRescan,
  onSaved,
  onPracticeAgain,
}: {
  ctx: CheckContext;
  report: AppearanceReport | null;
  previous: AppearanceReport | null;
  interview: InterviewResult | null;
  prep: PrepResult | null;
  onRescan: () => void;
  onSaved: (readiness: ReadinessReport) => void;
  onPracticeAgain: () => void;
}) {
  const readiness = useMemo(
    () => buildReadiness({ ctx, appearance: report ?? EMPTY_REPORT, interview, prep }),
    [ctx, report, interview, prep],
  );
  const [done, setDone] = useState<string[]>([]);
  const [finished, setFinished] = useState(false);
  const state = READY_STATES[readiness.state];

  // One history entry per completed check. The ref survives StrictMode's
  // deliberate double-invocation of effects in development, which would
  // otherwise write the same check twice.
  const saved = useRef(false);
  useEffect(() => {
    if (saved.current) return;
    saved.current = true;
    onSaved(readiness);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tone = readiness.state === 'ready' ? 'ok' : readiness.state === 'almost' ? 'warn' : 'danger';
  const allDone = readiness.doNow.every((f) => done.includes(f.id));

  if (finished) {
    return (
      <section className="pop flex min-h-[70vh] flex-col items-center justify-center text-center">
        <span
          className="mb-6 grid h-20 w-20 place-items-center rounded-full"
          style={{ background: 'var(--grad-flare)', color: 'var(--on-flare)' }}
        >
          <Icon.check size={38} />
        </span>
        <h1 className="display text-[clamp(2.4rem,10vw,3.4rem)]">Go.</h1>
        <p className="mt-3 max-w-xs text-[1.05rem] leading-snug text-[color:var(--ink-2)]">
          {readiness.state === 'ready'
            ? 'You did the work. Trust it and stop checking the mirror.'
            : 'You know exactly what to watch for. That is most of the battle.'}
        </p>
        <div className="mt-8 flex w-full max-w-xs flex-col gap-2">
          <Link href="/" className="btn btn-quiet w-full">
            Back to the start
          </Link>
          <Link href="/history" className="btn btn-ghost w-full">
            <Icon.history size={16} />
            See this in your history
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="rise pb-4">
      <div className="relative flex flex-col items-center overflow-hidden rounded-[var(--r-xl)] px-5 pb-7 pt-8 text-center">
        <div className="aurora" aria-hidden="true">
          <span
            className="left-[10%] top-[-20%] h-[30vh] w-[30vh]"
            style={{ background: tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--ember)' : 'var(--bad)' }}
          />
          <span className="right-[5%] top-[10%] h-[24vh] w-[24vh]" style={{ background: 'var(--violet)', animationDelay: '-8s' }} />
        </div>

        <div className="relative">
          <p className="eyebrow mb-3">{eventName(ctx)}</p>
          {readiness.inconclusive ? (
            <>
              <span
                className="mx-auto mb-4 grid h-20 w-20 place-items-center rounded-full"
                style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}
              >
                <Icon.eye size={34} />
              </span>
              <h1 className="headline text-[1.5rem]">No score for this one.</h1>
            </>
          ) : (
            <>
              <ScoreRing value={readiness.score} max={100} size={182} sublabel="/ 100" label={state.label} />
              <div className="mt-5 flex justify-center">
                <span
                  className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-[0.95rem] font-bold"
                  style={{
                    background: tone === 'ok' ? 'var(--ok-soft)' : tone === 'warn' ? 'var(--warn-soft)' : 'var(--bad-soft)',
                    color: tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--warn)' : 'var(--bad)',
                  }}
                >
                  <span aria-hidden="true">
                    {readiness.state === 'ready' ? '✓' : readiness.state === 'almost' ? '●' : '▲'}
                  </span>
                  {state.label}
                </span>
              </div>
            </>
          )}
          <p className="mt-3 text-[1rem] leading-snug text-[color:var(--ink-2)]">{readiness.closing}</p>
        </div>
      </div>

      {/* -------------------------------------------------------- buckets -- */}
      {readiness.buckets.length ? (
        <ul className="mt-6 space-y-2">
          {readiness.buckets.map((bucket) => (
            <li key={bucket.id} className="card px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[0.98rem] font-semibold">{bucket.label}</span>
                <span className="numeric text-[1.05rem] font-bold">{bucket.score}</span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--line)' }}>
                <span
                  className="block h-full rounded-full transition-all"
                  style={{
                    width: `${Math.max(3, Math.min(100, bucket.score))}%`,
                    background: bucket.score >= 82 ? 'var(--grad-mint)' : bucket.score >= 62 ? 'var(--grad-flare)' : 'var(--bad)',
                  }}
                />
              </div>
              <p className="mt-1.5 text-[0.82rem] leading-snug text-[color:var(--ink-3)]">{bucket.detail}</p>
            </li>
          ))}
        </ul>
      ) : (
        <div className="card mt-6 p-5 text-center">
          <p className="headline text-[1.05rem]">There was not enough to score.</p>
          <p className="mt-1.5 text-[0.9rem] text-[color:var(--ink-2)]">
            The visual check was skipped, so nothing measurable came back. Run it again with the camera on for a real
            readiness score.
          </p>
        </div>
      )}

      {/* --------------------------------------------------- do this now -- */}
      {readiness.doNow.length ? (
        <div className="mt-8">
          <SectionTitle eyebrow="Before you start" title="Do this now" hint="Tick them off. Nothing else matters right now." />
          <ul className="space-y-2">
            {readiness.doNow.map((fix, i) => {
              const isDone = done.includes(fix.id);
              return (
                <li key={fix.id}>
                  <button
                    type="button"
                    onClick={() => setDone((d) => (d.includes(fix.id) ? d.filter((x) => x !== fix.id) : [...d, fix.id]))}
                    aria-pressed={isDone}
                    className="card tap flex w-full items-center gap-3 p-4 text-left"
                    style={{ borderColor: isDone ? 'var(--ok)' : 'var(--line)' }}
                  >
                    <span
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 text-white"
                      style={{
                        borderColor: isDone ? 'var(--ok)' : 'var(--line-strong)',
                        background: isDone ? 'var(--ok)' : 'transparent',
                      }}
                      aria-hidden="true"
                    >
                      {isDone ? <Icon.check size={15} /> : <span className="numeric text-[0.78rem] font-bold text-[color:var(--ink-3)]">{i + 1}</span>}
                    </span>
                    <span
                      className="text-[1rem] font-semibold leading-snug"
                      style={isDone ? { textDecoration: 'line-through', color: 'var(--ink-3)' } : undefined}
                    >
                      {fix.title}
                    </span>
                  </button>
                </li>
              );
            })}
            <li>
              <div className="card flex items-center gap-3 p-4">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full" style={{ background: 'var(--violet-soft)', color: 'var(--violet)' }} aria-hidden="true">
                  <Icon.check size={15} />
                </span>
                <span className="text-[1rem] font-semibold leading-snug">Take one breath before you begin.</span>
              </div>
            </li>
          </ul>
        </div>
      ) : null}

      {/* --------------------------------------------------------- extras -- */}
      <div className="mt-8 flex flex-wrap gap-2">
        {report?.demo ? <Pill tone="warn">Outfit not scored — demo mode</Pill> : null}
        {interview ? <Pill tone="violet">Mock interview completed</Pill> : null}
        {prep?.reviewed ? <Pill tone="mint">Preparation reviewed</Pill> : null}
        {previous ? <Pill tone="ok">Rescanned</Pill> : null}
      </div>

      <div className="sticky bottom-0 -mx-4 mt-8 border-t px-4 pt-3 hairline safe-b" style={{ background: 'var(--paper)' }}>
        <button type="button" className="btn btn-primary w-full" onClick={() => setFinished(true)}>
          {allDone || !readiness.doNow.length ? "I'm ready" : "I'll do these — I'm ready"}
          <Icon.arrow size={18} />
        </button>
        <div className="mt-1.5 flex gap-2">
          <button type="button" className="btn btn-ghost flex-1 text-[0.88rem]" onClick={onRescan}>
            <Icon.refresh size={15} />
            Scan again
          </button>
          {interview ? (
            <button type="button" className="btn btn-ghost flex-1 text-[0.88rem]" onClick={onPracticeAgain}>
              <Icon.mic size={15} />
              Practise again
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
