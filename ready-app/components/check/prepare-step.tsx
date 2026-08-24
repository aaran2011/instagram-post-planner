'use client';

import { useEffect, useState } from 'react';
import { eventName, isInterview } from '@/lib/engine/events';
import type { CheckContext } from '@/lib/engine/types';
import type { PrepPack } from '@/lib/ai/claude';
import type { PrepResult } from '@/lib/engine/readiness';
import { Icon } from '../icons';
import { ErrorState, Expandable, Pill, SectionTitle, WorkingState } from '../ui';

/**
 * Preparation.
 *
 * The appearance check is the part people come for; this is the part that
 * changes the outcome. Topics are tickable so the readiness score can reflect
 * what the person says they are ready for — clearly labelled as self-reported,
 * because the app cannot see inside anyone's head and should not pretend to.
 */
export function PrepareStep({
  ctx,
  pack,
  onPack,
  onDone,
}: {
  ctx: CheckContext;
  pack: PrepPack | null;
  onPack: (pack: PrepPack) => void;
  onDone: (result: PrepResult) => void;
}) {
  const [loading, setLoading] = useState(!pack);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [ready, setReady] = useState<string[]>([]);

  useEffect(() => {
    if (pack) return;
    let cancelled = false;

    fetch('/api/prepare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ctx }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { pack: PrepPack; note?: string }) => {
        if (cancelled) return;
        onPack(data.pack);
        if (data.note) setNote(data.note);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [ctx, pack, onPack, attempt]);

  if (loading) {
    return (
      <WorkingState
        title="Getting you ready"
        steps={[
          'Reading what you told us',
          isInterview(ctx) ? 'Working out what they will ask' : 'Working out what matters here',
          'Picking your talking points',
          'Choosing practice questions',
        ]}
      />
    );
  }

  if (failed || !pack) {
    return (
      <div className="rise">
        <ErrorState
          title="We could not build your prep"
          detail="The connection dropped on the way. Your appearance check is safe — try this part again."
          action="Try again"
          onAction={() => {
            setFailed(false);
            setLoading(true);
            setAttempt((n) => n + 1);
          }}
          secondaryAction="Skip preparation"
          onSecondary={() => onDone({ reviewed: false, ready: 0, total: 0 })}
        />
      </div>
    );
  }

  const toggle = (topic: string) =>
    setReady((r) => (r.includes(topic) ? r.filter((t) => t !== topic) : [...r, topic]));

  return (
    <section className="rise pb-4">
      <p className="eyebrow mb-2">{eventName(ctx)}</p>
      <h1 className="display text-[clamp(1.9rem,7vw,2.5rem)]">Now the part that decides it.</h1>
      <p className="mt-2.5 text-[1rem] leading-snug text-[color:var(--ink-2)]">
        {pack.source === 'model'
          ? 'Built from the details you gave us.'
          : 'From the standard question bank for this kind of interview — no AI model is connected, so these are not tailored to your organisation.'}
      </p>
      {note ? (
        <p className="mt-3 rounded-2xl px-4 py-3 text-[0.88rem]" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>
          {note}
        </p>
      ) : null}

      {pack.topics.length ? (
        <div className="mt-7">
          <SectionTitle
            eyebrow="Cover these"
            title="Tick what you are ready for"
            hint="This feeds your final score as a self-report — we cannot check what you know."
          />
          <ul className="space-y-2">
            {pack.topics.map((topic) => {
              const on = ready.includes(topic);
              return (
                <li key={topic}>
                  <button
                    type="button"
                    onClick={() => toggle(topic)}
                    aria-pressed={on}
                    className="card tap flex w-full items-center gap-3 p-4 text-left"
                    style={{ borderColor: on ? 'var(--ok)' : 'var(--line)' }}
                  >
                    <span
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 text-white"
                      style={{ borderColor: on ? 'var(--ok)' : 'var(--line-strong)', background: on ? 'var(--ok)' : 'transparent' }}
                      aria-hidden="true"
                    >
                      {on ? <Icon.check size={13} /> : null}
                    </span>
                    <span className="text-[0.97rem] leading-snug">{topic}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {pack.likelyQuestions.length ? (
        <div className="mt-8">
          <SectionTitle eyebrow="Expect these" title="Questions you are likely to get" />
          <ul className="card divide-y p-0 hairline">
            {pack.likelyQuestions.map((q) => (
              <li key={q.question} className="px-4 py-3">
                <Expandable
                  summary={<span className="flex-1 text-[0.97rem] font-semibold leading-snug">{q.question}</span>}
                >
                  <p className="text-[0.88rem] leading-snug text-[color:var(--ink-2)]">{q.why}</p>
                </Expandable>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {pack.talkingPoints.length ? (
        <div className="mt-8">
          <SectionTitle eyebrow="Have these ready" title="Your talking points" />
          <ul className="space-y-1.5">
            {pack.talkingPoints.map((point) => (
              <li key={point} className="flex items-start gap-2.5 text-[0.95rem] leading-snug">
                <span className="mt-0.5 shrink-0" style={{ color: 'var(--violet)' }} aria-hidden="true">
                  <Icon.bolt size={15} />
                </span>
                {point}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {pack.askThem.length ? (
        <div className="mt-8">
          <SectionTitle eyebrow="Never say “no questions”" title="Ask them this" />
          <ul className="space-y-2">
            {pack.askThem.map((q) => (
              <li key={q} className="card-flat px-4 py-3 text-[0.95rem] leading-snug">
                “{q}”
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {pack.mistakes.length ? (
        <div className="mt-8">
          <SectionTitle eyebrow="Avoid" title="Common mistakes here" />
          <ul className="space-y-1.5">
            {pack.mistakes.map((m) => (
              <li key={m} className="flex items-start gap-2.5 text-[0.95rem] leading-snug text-[color:var(--ink-2)]">
                <span className="mt-0.5 shrink-0" style={{ color: 'var(--warn)' }} aria-hidden="true">
                  <Icon.alert size={15} />
                </span>
                {m}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-9 flex flex-wrap items-center gap-2">
        <Pill tone={pack.source === 'model' ? 'violet' : 'neutral'}>
          {pack.source === 'model' ? 'Generated for you' : 'Standard question bank'}
        </Pill>
        <span className="chip">{ready.length}/{pack.topics.length} topics ticked</span>
      </div>

      <button
        type="button"
        className="btn btn-primary mt-4 w-full"
        onClick={() => onDone({ reviewed: true, ready: ready.length, total: pack.topics.length })}
      >
        <Icon.mic size={18} />
        Practise it out loud
      </button>
    </section>
  );
}
