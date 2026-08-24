'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { eventName } from '@/lib/engine/events';
import {
  analyzeDelivery,
  analyzeSpeech,
  paceLabel,
  EMPTY_PRESENCE,
  type AnswerMode,
  type PresenceMetrics,
} from '@/lib/engine/communication';
import { fixesFromFindings } from '@/lib/engine/recommendations';
import type { CheckContext } from '@/lib/engine/types';
import type { InterviewResult } from '@/lib/engine/readiness';
import type { ContentReview, PrepPack } from '@/lib/ai/claude';
import { createListener, speechSupported, type Listener } from '@/lib/speech/recognition';
import { useCameraStage } from '@/lib/vision/use-camera';
import { Icon } from '../icons';
import { ErrorState, Pill, ScoreRing, SectionTitle, WorkingState } from '../ui';

type Phase = 'intro' | 'running' | 'reviewing' | 'review' | 'failed';

interface Turn {
  question: string;
  answer: string;
  seconds: number;
}

const FALLBACK_QUESTIONS = [
  'Tell me about yourself.',
  'Why are you interested in this?',
  'Tell me about a time you solved a difficult problem.',
  'Why should we pick you?',
];

/**
 * The mock interview.
 *
 * Two minutes, four questions, one honest measurement pass. The hard part is
 * not asking the questions — it is being clear about what is being captured.
 * The transcript is produced by the browser's speech recognition (which on
 * Chrome means Google's service, said plainly on the intro screen), the answers
 * are sent for review, and the audio itself is never recorded or stored by this
 * app. When speech recognition is unavailable the interview still runs, with
 * typed answers, and every number that needed audio is reported as not
 * measured.
 */
export function PracticeStep({
  ctx,
  pack,
  onDone,
  onSkip,
}: {
  ctx: CheckContext;
  pack: PrepPack | null;
  onDone: (result: InterviewResult) => void;
  onSkip: () => void;
}) {
  const questions = useMemo(() => {
    const list = pack?.mockQuestions?.length ? pack.mockQuestions : FALLBACK_QUESTIONS;
    return list.slice(0, 5);
  }, [pack]);

  // Destructured for the same reason as the camera step: state read off the
  // hook's object is treated as a ref read by the compiler.
  const {
    attachVideo,
    mirrored,
    framing,
    start: startCamera,
    stop: stopCamera,
    startPresence,
    stopPresence,
  } = useCameraStage({ wantFullBody: false });
  const [phase, setPhase] = useState<Phase>('intro');
  const [index, setIndex] = useState(0);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [live, setLive] = useState({ final: '', interim: '' });
  const [typed, setTyped] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [armed, setArmed] = useState(false);
  const [useTyping, setUseTyping] = useState(!speechSupported());
  const [micError, setMicError] = useState<string | null>(null);
  const [review, setReview] = useState<ContentReview | null>(null);
  const [presence, setPresence] = useState<PresenceMetrics>(EMPTY_PRESENCE);
  const [reviewNote, setReviewNote] = useState<string | null>(null);

  const listenerRef = useRef<Listener | null>(null);
  const startedAt = useRef<number>(0);
  const supported = speechSupported();
  const answerMode: AnswerMode = !supported ? 'unsupported' : useTyping ? 'typed' : 'spoken';

  // Question clock, shown so nobody wonders how long they have been talking.
  useEffect(() => {
    if (phase !== 'running') return;
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - startedAt.current) / 1000)), 500);
    return () => clearInterval(timer);
  }, [phase, index]);

  const beginQuestion = useCallback(() => {
    startedAt.current = Date.now();
    setElapsed(0);
    // Guards against a double-tap skipping a question, without tying the
    // button's enabled state to the display clock (which a backgrounded tab
    // throttles, leaving the control stuck).
    setArmed(false);
    window.setTimeout(() => setArmed(true), 1200);
    setLive({ final: '', interim: '' });
    setTyped('');
    listenerRef.current?.reset();
    if (!useTyping) listenerRef.current?.start();
  }, [useTyping]);

  const start = useCallback(async () => {
    setMicError(null);
    await startCamera();
    startPresence();

    if (!useTyping && supported) {
      listenerRef.current = createListener({
        onUpdate: (final, interim) => setLive({ final, interim }),
        onError: (kind) => {
          if (kind === 'denied') {
            setUseTyping(true);
            setMicError('Microphone access was declined, so the rest of the interview is typed. Pace and filler words will not be measured.');
          } else if (kind === 'network') {
            setUseTyping(true);
            setMicError('Speech recognition needs a connection and could not reach it. Switching to typed answers.');
          }
        },
      });
    }

    setPhase('running');
    setIndex(0);
    setTurns([]);
    beginQuestion();
  }, [startCamera, startPresence, useTyping, supported, beginQuestion]);

  const finish = useCallback(
    async (allTurns: Turn[]) => {
      listenerRef.current?.stop();
      const measured = stopPresence();
      setPresence(measured);
      stopCamera();
      setPhase('reviewing');

      const speech = analyzeSpeech(allTurns);
      const delivery = analyzeDelivery(speech, measured, answerMode);

      try {
        const response = await fetch('/api/interview/review', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ctx, turns: allTurns }),
        });
        if (!response.ok) throw new Error(String(response.status));
        const data = (await response.json()) as { review: ContentReview; note?: string };
        setReview(data.review);
        if (data.note) setReviewNote(data.note);
      } catch {
        setPhase('failed');
        return;
      }

      setPhase('review');
      void delivery;
    },
    [ctx, stopPresence, stopCamera, answerMode],
  );

  const nextQuestion = useCallback(() => {
    const answer = (useTyping ? typed : `${live.final} ${live.interim}`).trim();
    const seconds = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000));
    const turn: Turn = { question: questions[index], answer, seconds };
    const allTurns = [...turns, turn];
    setTurns(allTurns);
    listenerRef.current?.stop();

    if (index + 1 >= questions.length) {
      void finish(allTurns);
    } else {
      setIndex(index + 1);
      beginQuestion();
    }
  }, [useTyping, typed, live, questions, index, turns, finish, beginQuestion]);

  useEffect(
    () => () => {
      listenerRef.current?.destroy();
    },
    [],
  );

  const speech = useMemo(() => analyzeSpeech(turns), [turns]);
  const delivery = useMemo(() => analyzeDelivery(speech, presence, answerMode), [speech, presence, answerMode]);

  /* -------------------------------------------------------------- intro -- */
  if (phase === 'intro') {
    return (
      <section className="rise">
        <p className="eyebrow mb-2">{eventName(ctx)}</p>
        <h1 className="display text-[clamp(1.9rem,7vw,2.5rem)]">Your interviewer is ready.</h1>
        <p className="mt-2.5 text-[1rem] leading-snug text-[color:var(--ink-2)]">
          {questions.length} questions, about two minutes. Answer out loud, the way you would on the day — we listen for
          pace, fillers and structure, and watch whether you stay facing the lens.
        </p>

        <ol className="mt-6 space-y-2">
          {questions.map((q, i) => (
            <li key={q} className="card-flat flex items-start gap-3 px-4 py-3">
              <span className="numeric mt-0.5 text-[0.8rem] font-bold text-[color:var(--ink-3)]">{i + 1}</span>
              <span className="text-[0.95rem] leading-snug">{q}</span>
            </li>
          ))}
        </ol>

        <div className="card mt-5 p-4">
          <span className="mb-2 flex items-center gap-2">
            <Pill tone="mint">
              <Icon.lock size={12} />
              Before you start
            </Pill>
          </span>
          <ul className="space-y-2 text-[0.88rem] leading-snug text-[color:var(--ink-2)]">
            <li>The camera runs during the interview and a red indicator stays on screen. Nothing is recorded.</li>
            <li>
              {supported
                ? 'Your speech is transcribed by your browser’s own recognition service — on Chrome that means audio goes to Google. The text of your answers is then sent for review; the audio is not.'
                : 'This browser has no speech recognition, so the interview runs with typed answers. Pace and filler words will be reported as not measured rather than estimated.'}
            </li>
          </ul>
        </div>

        {supported ? (
          <label className="card-flat mt-3 flex cursor-pointer items-center gap-3 p-3.5">
            <input
              type="checkbox"
              checked={useTyping}
              onChange={(e) => setUseTyping(e.target.checked)}
              className="h-5 w-5 accent-[color:var(--flare)]"
            />
            <span className="text-[0.92rem]">Type my answers instead of speaking</span>
          </label>
        ) : null}

        <button type="button" className="btn btn-primary mt-5 w-full" onClick={() => void start()}>
          <Icon.mic size={19} />
          Start the interview
        </button>
        <button type="button" className="btn btn-ghost mt-2 w-full" onClick={onSkip}>
          Skip the practice
        </button>
      </section>
    );
  }

  /* ------------------------------------------------------------ running -- */
  if (phase === 'running') {
    const heard = `${live.final} ${live.interim}`.trim();
    return (
      <section className="rise">
        <div className="mb-3 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Pill tone="danger">
              <span className="live-dot h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} aria-hidden="true" />
              Camera on
            </Pill>
            {!useTyping ? <Pill tone="violet">Listening</Pill> : null}
          </span>
          <span className="numeric text-[0.9rem] font-semibold text-[color:var(--ink-2)]">
            {String(Math.floor(elapsed / 60)).padStart(1, '0')}:{String(elapsed % 60).padStart(2, '0')}
          </span>
        </div>

        <div className="viewfinder relative overflow-hidden rounded-[var(--r-lg)] bg-black" style={{ aspectRatio: '4 / 3' }}>
          <video
            ref={attachVideo}
            playsInline
            muted
            autoPlay
            className="h-full w-full object-cover"
            style={{ transform: mirrored ? 'scaleX(-1)' : undefined }}
          />
          <button
            type="button"
            onClick={() => {
              listenerRef.current?.stop();
              stopPresence();
              stopCamera();
              setPhase('intro');
            }}
            className="glass tap absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-full text-white"
            aria-label="Stop the camera and end the interview"
          >
            <Icon.stop size={18} />
          </button>
          {framing && Math.abs(framing.headYaw) > 22 ? (
            <p className="glass absolute inset-x-3 bottom-3 rounded-xl px-3 py-2 text-center text-[0.85rem] font-semibold text-white">
              Look back towards the lens
            </p>
          ) : null}
        </div>

        <p className="eyebrow mt-5">
          Question {index + 1} of {questions.length}
        </p>
        <h1 className="headline mt-1.5 text-[1.5rem]" aria-live="polite">
          {questions[index]}
        </h1>

        {micError ? (
          <p className="mt-3 rounded-2xl px-4 py-3 text-[0.88rem]" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }} role="alert">
            {micError}
          </p>
        ) : null}

        {useTyping ? (
          <textarea
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            rows={5}
            autoFocus
            placeholder="Type your answer the way you would say it…"
            className="mt-4 w-full rounded-2xl border p-4 text-[1rem] outline-none hairline"
            style={{ background: 'var(--surface)' }}
          />
        ) : (
          <div className="card-flat mt-4 min-h-28 p-4">
            <p className="text-[0.95rem] leading-relaxed">
              {heard || <span className="text-[color:var(--ink-3)]">Start talking — your words will appear here.</span>}
              {live.interim ? <span className="text-[color:var(--ink-3)]"> {live.interim}</span> : null}
            </p>
          </div>
        )}

        <button
          type="button"
          className="btn btn-primary mt-4 w-full"
          onClick={nextQuestion}
          disabled={!armed}
        >
          {index + 1 >= questions.length ? 'Finish and review' : 'Next question'}
          <Icon.arrow size={18} />
        </button>
        <p className="mt-2 text-center text-[0.8rem] text-[color:var(--ink-3)]">
          Aim for about 90 seconds an answer. Nothing is being recorded.
        </p>
      </section>
    );
  }

  /* ---------------------------------------------------------- reviewing -- */
  if (phase === 'reviewing') {
    return (
      <WorkingState
        title="Reviewing your answers"
        steps={['Counting pace and filler words', 'Checking how you framed up', 'Reading what you actually said', 'Writing your review']}
      />
    );
  }

  if (phase === 'failed') {
    return (
      <div className="rise">
        <ErrorState
          title="We could not review the interview"
          detail="The connection dropped before the review came back. Nothing about your answers was lost — you can try again, or carry on without it."
          action="Try the review again"
          onAction={() => void finish(turns)}
          secondaryAction="Carry on without it"
          onSecondary={onSkip}
        />
      </div>
    );
  }

  /* ------------------------------------------------------------- review -- */
  const overall = Math.round(((review?.substance ?? 7) * 0.55 + delivery.delivery * 0.45) * 10) / 10;
  const notMeasured =
    answerMode === 'typed'
      ? 'Not measured — you typed these answers.'
      : answerMode === 'unsupported'
        ? 'Not measured — this browser has no speech recognition.'
        : 'Not measured — too little speech was captured.';

  return (
    <section className="rise pb-4">
      <div className="flex flex-col items-center pt-2 text-center">
        <p className="eyebrow mb-3">Interview review</p>
        <ScoreRing value={overall} max={10} size={160} tone="violet" />
        <h1 className="headline mt-4 text-[1.5rem]">
          {overall >= 8.5 ? 'Strong run.' : overall >= 7 ? 'Solid, with room to sharpen.' : 'Worth another go.'}
        </h1>
      </div>

      {reviewNote ? (
        <p className="mt-4 rounded-2xl px-4 py-3 text-[0.88rem]" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>
          {reviewNote}
        </p>
      ) : null}

      <div className="mt-6 grid grid-cols-2 gap-2.5">
        <div className="card p-4">
          <p className="eyebrow mb-1">Pace</p>
          {delivery.pace ? (
            <>
              <p className="numeric headline text-[1.35rem]">{delivery.pace.wpm}</p>
              <p className="text-[0.82rem] text-[color:var(--ink-2)]">words/min · {paceLabel(delivery.pace.verdict)}</p>
            </>
          ) : (
            <p className="text-[0.85rem] leading-snug text-[color:var(--ink-2)]">{notMeasured}</p>
          )}
        </div>
        <div className="card p-4">
          <p className="eyebrow mb-1">Filler words</p>
          {answerMode === 'spoken' && speech.transcriptAvailable ? (
            <>
              <p className="numeric headline text-[1.35rem]">{speech.fillerCount}</p>
              <p className="text-[0.82rem] text-[color:var(--ink-2)]">
                {speech.topFillers.length ? speech.topFillers.map((f) => f.word).join(', ') : 'none worth noting'}
              </p>
            </>
          ) : (
            <p className="text-[0.85rem] leading-snug text-[color:var(--ink-2)]">{notMeasured}</p>
          )}
        </div>
        <div className="card col-span-2 p-4">
          <p className="eyebrow mb-1">Facing the camera</p>
          {delivery.facing ? (
            <>
              <p className="numeric headline text-[1.35rem]">{delivery.facing.percent}%</p>
              <p className="mt-1 text-[0.8rem] leading-snug text-[color:var(--ink-3)]">{delivery.facing.note}</p>
            </>
          ) : (
            <p className="text-[0.85rem] text-[color:var(--ink-2)]">
              Not measured — the body model was not running during the interview.
            </p>
          )}
        </div>
      </div>

      {review?.strengths.length ? (
        <div className="mt-7">
          <SectionTitle eyebrow="Keep doing" title="What worked" />
          <ul className="space-y-1.5">
            {review.strengths.map((s) => (
              <li key={s} className="flex items-start gap-2.5 text-[0.95rem] leading-snug">
                <span className="mt-0.5 shrink-0" style={{ color: 'var(--ok)' }} aria-hidden="true">
                  <Icon.check size={16} />
                </span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {review?.improvements.length ? (
        <div className="mt-7">
          <SectionTitle eyebrow="Change this" title="What to sharpen" />
          <ul className="space-y-1.5">
            {review.improvements.map((s) => (
              <li key={s} className="flex items-start gap-2.5 text-[0.95rem] leading-snug text-[color:var(--ink-2)]">
                <span className="mt-0.5 shrink-0" style={{ color: 'var(--warn)' }} aria-hidden="true">
                  <Icon.arrow size={15} />
                </span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {review?.biggest ? (
        <div className="mt-6 rounded-[var(--r-lg)] p-5" style={{ background: 'var(--violet-soft)' }}>
          <p className="eyebrow mb-1.5">Your biggest single win</p>
          <p className="headline text-[1.1rem]" style={{ color: 'var(--violet)' }}>
            {review.biggest}
          </p>
        </div>
      ) : null}

      {delivery.findings.filter((f) => f.severity).length ? (
        <div className="mt-7">
          <SectionTitle eyebrow="Measured on device" title="Delivery notes" />
          <ul className="card divide-y p-0 hairline">
            {delivery.findings
              .filter((f) => f.severity)
              .map((f) => (
                <li key={f.id} className="px-4 py-3">
                  <p className="text-[0.93rem] leading-snug">{f.text}</p>
                  {f.recommendation ? (
                    <p className="mt-1 text-[0.87rem] leading-snug text-[color:var(--ink-2)]">→ {f.recommendation}</p>
                  ) : null}
                </li>
              ))}
          </ul>
        </div>
      ) : null}

      {review?.practiceAgain ? (
        <div className="card mt-6 p-5">
          <p className="eyebrow mb-1.5">Practise this one again</p>
          <p className="text-[1.02rem] font-semibold leading-snug">“{review.practiceAgain}”</p>
        </div>
      ) : null}

      {review?.source === 'heuristic' ? (
        <p className="mt-4 text-[0.85rem] leading-snug text-[color:var(--ink-3)]">
          This review was built from what could be measured in your answers — length, examples, results named — because
          no AI reviewer is connected. Nothing here is a judgement of content quality.
        </p>
      ) : null}

      <button
        type="button"
        className="btn btn-primary mt-7 w-full"
        onClick={() =>
          onDone({
            substance: review?.substance ?? 7,
            delivery: delivery.delivery,
            findings: delivery.findings,
            fixes: fixesFromFindings(delivery.findings),
          })
        }
      >
        See if I am ready
        <Icon.arrow size={18} />
      </button>
      <button
        type="button"
        className="btn btn-ghost mt-2 w-full"
        onClick={() => {
          setReview(null);
          setTurns([]);
          setPhase('intro');
        }}
      >
        <Icon.refresh size={16} />
        Practise again
      </button>
    </section>
  );
}
