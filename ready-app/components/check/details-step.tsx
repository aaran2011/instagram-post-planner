'use client';

import { useMemo, useState } from 'react';
import { eventName, questionsFor, type Question } from '@/lib/engine/events';
import type { Answers, CheckContext, Depth } from '@/lib/engine/types';
import { Icon } from '../icons';

/**
 * One question at a time.
 *
 * A form with twelve fields gets abandoned; twelve screens with one tap each
 * gets finished. The list is recomputed from the answers on every change, so
 * choosing "online" removes the indoor/outdoor question before it is ever seen
 * — that is the progressive disclosure the brief asks for, and it falls out of
 * the context engine rather than being hand-wired here.
 */
export function DetailsStep({
  ctx,
  onChange,
  onDepth,
  onDone,
}: {
  ctx: CheckContext;
  onChange: (answers: Answers) => void;
  onDepth: (depth: Depth) => void;
  onDone: () => void;
}) {
  const [answers, setAnswers] = useState<Answers>(ctx.answers);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [draft, setDraft] = useState('');

  const questions = useMemo(() => questionsFor({ ...ctx, answers }, answers), [ctx, answers]);
  const pending = questions.filter((q) => answers[q.id] === undefined && !skipped.includes(q.id));
  const current: Question | undefined = pending[0];
  const done = questions.length - pending.length;

  // The parent is told at the moment an answer changes, rather than from an
  // effect watching the state it just set.
  const commit = (next: Answers) => {
    setAnswers(next);
    onChange(next);
  };

  const answer = (id: string, value: string) => {
    commit({ ...answers, [id]: value });
    setDraft('');
  };

  if (!current) {
    return (
      <section className="rise">
        <p className="eyebrow mb-2">{eventName(ctx)}</p>
        <h1 className="display text-[clamp(1.9rem,7vw,2.5rem)]">That is everything we need.</h1>
        <p className="mt-2 text-[1rem] text-[color:var(--ink-2)]">
          Change anything below, or go and stand in front of the camera.
        </p>

        <ul className="mt-6 space-y-2">
          {questions.map((q) => {
            const value = answers[q.id];
            const label =
              q.options?.find((o) => o.value === value)?.label ?? (value || (skipped.includes(q.id) ? 'Skipped' : '—'));
            return (
              <li key={q.id} className="card-flat flex items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.78rem] text-[color:var(--ink-3)]">{q.prompt}</span>
                  <span className="block truncate text-[0.95rem] font-semibold">{label}</span>
                </span>
                <button
                  type="button"
                  className="btn btn-ghost !min-h-9 !px-3 text-[0.82rem]"
                  onClick={() => {
                    setSkipped((s) => s.filter((id) => id !== q.id));
                    const next = { ...answers };
                    delete next[q.id];
                    commit(next);
                    setDraft(answers[q.id] ?? '');
                  }}
                >
                  Change
                </button>
              </li>
            );
          })}
        </ul>

        {ctx.depth === 'quick' ? (
          <button
            type="button"
            className="btn btn-quiet mt-4 w-full"
            onClick={() => onDepth('deep')}
          >
            <Icon.layers size={17} />
            Switch to a deep check
          </button>
        ) : null}

        <button type="button" className="btn btn-primary mt-4 w-full" onClick={onDone}>
          Set up the camera
          <Icon.arrow size={18} />
        </button>
      </section>
    );
  }

  return (
    <section className="rise" key={current.id}>
      <div className="mb-6 flex items-center gap-2" aria-hidden="true">
        {questions.map((q, i) => (
          <span
            key={q.id}
            className="h-1.5 flex-1 rounded-full transition-colors"
            style={{ background: i < done ? 'var(--flare)' : i === done ? 'var(--ember)' : 'var(--line)' }}
          />
        ))}
      </div>
      <p className="sr-only" aria-live="polite">
        Question {done + 1} of {questions.length}
      </p>

      <p className="eyebrow mb-2">{eventName(ctx)}</p>
      <h1 className="display text-[clamp(1.9rem,7vw,2.5rem)]">{current.prompt}</h1>
      {current.help ? <p className="mt-2.5 text-[0.98rem] leading-snug text-[color:var(--ink-2)]">{current.help}</p> : null}

      {current.kind === 'choice' ? (
        <ul className="mt-7 space-y-2.5">
          {current.options?.map((option) => (
            <li key={option.value}>
              <button
                type="button"
                onClick={() => answer(current.id, option.value)}
                className="card tap flex w-full items-center gap-3 p-4 text-left transition-transform active:scale-[0.995]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[1.02rem] font-semibold leading-tight">{option.label}</span>
                  {option.hint ? (
                    <span className="mt-0.5 block text-[0.82rem] leading-snug text-[color:var(--ink-3)]">{option.hint}</span>
                  ) : null}
                </span>
                <span className="text-[color:var(--ink-3)]" aria-hidden="true">
                  <Icon.arrow size={18} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <form
          className="mt-7"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) answer(current.id, draft.trim());
            else if (current.optional) setSkipped((s) => [...s, current.id]);
          }}
        >
          <label htmlFor={current.id} className="sr-only">
            {current.prompt}
          </label>
          <input
            id={current.id}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={current.placeholder}
            maxLength={200}
            autoFocus
            autoComplete="off"
            className="tap w-full rounded-2xl border px-4 py-3.5 text-[1.05rem] outline-none hairline"
            style={{ background: 'var(--surface)' }}
          />
          <button type="submit" className="btn btn-primary mt-3 w-full" disabled={!draft.trim() && !current.optional}>
            Continue
            <Icon.arrow size={18} />
          </button>
        </form>
      )}

      {current.optional ? (
        <button
          type="button"
          className="btn btn-ghost mt-3 w-full"
          onClick={() => setSkipped((s) => [...s, current.id])}
        >
          Skip — it does not matter here
        </button>
      ) : null}
    </section>
  );
}
