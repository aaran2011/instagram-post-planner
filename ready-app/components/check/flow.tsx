'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { EventStep } from './event-step';
import { DetailsStep } from './details-step';
import { CameraStep } from './camera-step';
import { AnalysisStep } from './analysis-step';
import { PrepareStep } from './prepare-step';
import { PracticeStep } from './practice-step';
import { ResultStep } from './result-step';
import { Icon, Logo } from '../icons';
import { StageRail } from '../ui';
import { STAGE_LABELS, getEvent, stagesFor, type Stage } from '@/lib/engine/events';
import type { Answers, AppearanceReport, CheckContext, Depth, EventId, ReadinessReport } from '@/lib/engine/types';
import type { InterviewResult, PrepResult } from '@/lib/engine/readiness';
import type { PrepPack } from '@/lib/ai/claude';
import { saveEntry } from '@/lib/store/history';

/**
 * The whole check, as one state machine.
 *
 * It is a single client component on purpose. The steps share a lot of state
 * (context, the report, the previous report for before/after, the interview
 * result), and every one of them can send the user backwards — rescan, redo the
 * interview, change the occasion. Threading that through routes would mean
 * either a store or serialising a half-finished check into a URL, and both are
 * worse than one component that owns the flow and hands slices to its steps.
 *
 * Nothing here is persisted except a small history entry at the end.
 */
export function CheckFlow({ initialEvent, initialDepth }: { initialEvent: EventId | null; initialDepth: Depth }) {
  const [stage, setStage] = useState<Stage>(initialEvent ? 'details' : 'event');
  const [eventId, setEventId] = useState<EventId | null>(initialEvent);
  const [customEvent, setCustomEvent] = useState('');
  const [depth, setDepth] = useState<Depth>(initialDepth);
  const [answers, setAnswers] = useState<Answers>({});

  const [report, setReport] = useState<AppearanceReport | null>(null);
  const [previousReport, setPreviousReport] = useState<AppearanceReport | null>(null);
  const [visionAvailable, setVisionAvailable] = useState<boolean | null>(null);

  const [prep, setPrep] = useState<PrepPack | null>(null);
  const [prepResult, setPrepResult] = useState<PrepResult | null>(null);
  const [interview, setInterview] = useState<InterviewResult | null>(null);

  // Asked once, so every screen can be honest about this deployment's limits
  // before the user has invested time in the check.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) setVisionAvailable(Boolean(data?.vision));
      })
      .catch(() => {
        if (!cancelled) setVisionAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const ctx: CheckContext | null = useMemo(
    () => (eventId ? { eventId, customEvent: customEvent || undefined, depth, answers } : null),
    [eventId, customEvent, depth, answers],
  );

  const stages = useMemo(() => (ctx ? stagesFor(ctx) : (['event', 'details', 'camera', 'analysis', 'result'] as Stage[])), [ctx]);
  const railStages = useMemo(() => stages.map((s) => ({ id: s, label: STAGE_LABELS[s] })), [stages]);

  const goTo = useCallback((next: Stage) => {
    setStage(next);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, []);

  const advance = useCallback(() => {
    const index = stages.indexOf(stage);
    goTo(stages[Math.min(index + 1, stages.length - 1)]);
  }, [stage, stages, goTo]);

  const back = useCallback(() => {
    const index = stages.indexOf(stage);
    if (index <= 0) return;
    goTo(stages[index - 1]);
  }, [stage, stages, goTo]);

  /** A rescan keeps the old report so the before/after can be shown. */
  const rescan = useCallback(() => {
    setPreviousReport(report);
    setReport(null);
    goTo('camera');
  }, [report, goTo]);

  const finish = useCallback(
    (readiness: ReadinessReport) => {
      if (!ctx || !report) return;
      saveEntry({
        eventId: ctx.eventId,
        eventLabel: ctx.customEvent?.trim() || getEvent(ctx.eventId).label,
        depth: ctx.depth,
        appearance: report.overall,
        // A check with no honest score is recorded as having none, rather than
        // storing a number the app refused to show.
        readiness: readiness.inconclusive ? null : readiness.score,
        state: readiness.inconclusive ? null : readiness.state,
        buckets: readiness.buckets.map((b) => ({ label: b.label, score: b.score })),
      });
    },
    [ctx, report],
  );

  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4 pb-10 safe-t">
      <header className="flex items-center justify-between gap-3 py-2">
        {stage === 'event' ? (
          <Link href="/" className="btn btn-ghost !min-h-11 !px-3" aria-label="Back to home">
            <Icon.back size={18} />
          </Link>
        ) : (
          <button type="button" className="btn btn-ghost !min-h-11 !px-3" onClick={back} aria-label="Back a step">
            <Icon.back size={18} />
          </button>
        )}
        <Logo size={26} />
        <Link href="/privacy" className="btn btn-ghost !min-h-11 !px-3" aria-label="How your camera is used">
          <Icon.lock size={17} />
        </Link>
      </header>

      <div className="pb-4">
        <StageRail stages={railStages} current={stage} />
      </div>

      {stage === 'event' ? (
        <EventStep
          selected={eventId}
          depth={depth}
          customEvent={customEvent}
          onDepth={setDepth}
          onSelect={(id, custom) => {
            setEventId(id);
            setCustomEvent(custom ?? '');
            // Changing the occasion invalidates everything measured against it.
            setReport(null);
            setPreviousReport(null);
            setPrep(null);
            setInterview(null);
            goTo('details');
          }}
        />
      ) : null}

      {stage === 'details' && ctx ? (
        <DetailsStep
          ctx={ctx}
          onChange={setAnswers}
          onDepth={setDepth}
          onDone={advance}
        />
      ) : null}

      {stage === 'camera' && ctx ? (
        <CameraStep
          ctx={ctx}
          visionAvailable={visionAvailable}
          rescanOf={previousReport}
          onDone={(next) => {
            setReport(next);
            advance();
          }}
          onSkip={() => {
            // No camera, no appearance check — but the preparation and practice
            // stages are still worth doing, so the flow continues without it.
            setReport(null);
            const index = stages.indexOf('camera');
            const next = stages[Math.min(index + 2, stages.length - 1)];
            goTo(next === 'analysis' ? 'result' : next);
          }}
        />
      ) : null}

      {stage === 'analysis' && ctx && report ? (
        <AnalysisStep
          ctx={ctx}
          report={report}
          previous={previousReport}
          onRescan={rescan}
          onDone={advance}
          isLastStep={stages.indexOf('analysis') === stages.length - 1}
        />
      ) : null}

      {stage === 'prepare' && ctx ? (
        <PrepareStep
          ctx={ctx}
          pack={prep}
          onPack={setPrep}
          onDone={(result) => {
            setPrepResult(result);
            advance();
          }}
        />
      ) : null}

      {stage === 'practice' && ctx ? (
        <PracticeStep
          ctx={ctx}
          pack={prep}
          onDone={(result) => {
            setInterview(result);
            advance();
          }}
          onSkip={advance}
        />
      ) : null}

      {stage === 'result' && ctx ? (
        <ResultStep
          ctx={ctx}
          report={report}
          previous={previousReport}
          interview={interview}
          prep={prepResult}
          onRescan={rescan}
          onSaved={finish}
          onPracticeAgain={() => goTo('practice')}
        />
      ) : null}
    </main>
  );
}
