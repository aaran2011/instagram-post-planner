'use client';

import type { Fix } from '@/lib/engine/types';
import { CATEGORY_LABELS } from '@/lib/engine/types';
import { Icon } from '../icons';
import { SeverityTag } from '../ui';

/**
 * A fix, as a thing to do rather than a thing to read.
 *
 * The imperative is the headline and everything else is secondary: the reason
 * it is being suggested, what it costs in minutes, and how much of the score it
 * returns. Numbers stay small and grey — they justify the order, they are not
 * the point.
 */
export function FixCard({ fix, index, done, onToggle }: { fix: Fix; index?: number; done?: boolean; onToggle?: () => void }) {
  const body = (
    <>
      <span className="flex items-start gap-3">
        {onToggle ? (
          <span
            className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition-colors"
            style={{
              borderColor: done ? 'var(--ok)' : 'var(--line-strong)',
              background: done ? 'var(--ok)' : 'transparent',
              color: '#fff',
            }}
            aria-hidden="true"
          >
            {done ? <Icon.check size={13} /> : null}
          </span>
        ) : index != null ? (
          <span
            className="numeric mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[0.78rem] font-bold"
            style={{ background: 'var(--ink)', color: 'var(--paper)' }}
          >
            {index}
          </span>
        ) : null}

        <span className="min-w-0 flex-1">
          <span
            className="block text-[1.02rem] font-semibold leading-snug"
            style={done ? { textDecoration: 'line-through', color: 'var(--ink-3)' } : undefined}
          >
            {fix.title}
          </span>
          {fix.detail ? (
            <span className="mt-1 block text-[0.86rem] leading-snug text-[color:var(--ink-2)]">{fix.detail}</span>
          ) : null}
          <span className="mt-2 flex flex-wrap items-center gap-1.5">
            <SeverityTag severity={fix.severity} />
            <span className="chip">
              <Icon.clock size={12} />
              {fix.minutes} min
            </span>
            <span className="chip">{CATEGORY_LABELS[fix.category]}</span>
            {fix.impact >= 0.1 ? <span className="chip numeric">+{fix.impact.toFixed(1)} pts</span> : null}
          </span>
        </span>
      </span>
    </>
  );

  if (onToggle) {
    return (
      <button type="button" onClick={onToggle} className="card w-full p-4 text-left" aria-pressed={done}>
        {body}
      </button>
    );
  }
  return <div className="card p-4">{body}</div>;
}
