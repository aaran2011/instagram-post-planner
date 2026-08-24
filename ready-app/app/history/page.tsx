'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import {
  clearHistory,
  historyServerSnapshot,
  historySnapshot,
  subscribeHistory,
  type HistoryEntry,
} from '@/lib/store/history';
import { Icon, Logo } from '@/components/icons';
import { Pill } from '@/components/ui';

/**
 * History, kept deliberately small.
 *
 * Enough to answer "am I getting better at this?" — the scores, the occasion,
 * the date, and the trend between checks of the same kind. No images, no
 * transcripts, and one button that really does delete it.
 */
export default function HistoryPage() {
  // Null while rendering on the server, where localStorage does not exist — the
  // skeleton shows rather than an "empty" state that might be wrong.
  const entries = useSyncExternalStore<HistoryEntry[] | null>(
    subscribeHistory,
    historySnapshot,
    historyServerSnapshot,
  );

  const trend = (entry: HistoryEntry, index: number) => {
    const earlier = entries?.slice(index + 1).find((e) => e.eventId === entry.eventId);
    if (!earlier || earlier.readiness == null || entry.readiness == null) return null;
    const delta = entry.readiness - earlier.readiness;
    if (Math.abs(delta) < 2) return null;
    return delta;
  };

  return (
    <main id="main" className="mx-auto w-full max-w-2xl px-5 pb-16 safe-t">
      <header className="flex items-center justify-between py-3">
        <Link href="/" className="btn btn-ghost !min-h-11 !px-3" aria-label="Back to home">
          <Icon.back size={18} />
        </Link>
        <Logo size={26} />
        <span className="w-11" />
      </header>

      <p className="eyebrow mt-6 mb-3">Saved in this browser only</p>
      <h1 className="display text-[clamp(2rem,8vw,2.8rem)]">Your checks.</h1>

      {entries === null ? (
        <div className="mt-8 space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="shimmer h-20 rounded-[var(--r-lg)]" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="card mt-8 p-6 text-center">
          <span className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full" style={{ background: 'var(--violet-soft)', color: 'var(--violet)' }}>
            <Icon.history size={21} />
          </span>
          <p className="headline text-[1.1rem]">Nothing here yet.</p>
          <p className="mx-auto mt-1.5 max-w-xs text-[0.93rem] leading-snug text-[color:var(--ink-2)]">
            Run a check and it will show up here, so you can see whether the second interview went better than the first.
          </p>
          <Link href="/check" className="btn btn-primary mt-5">
            Check if I&apos;m ready
            <Icon.arrow size={18} />
          </Link>
        </div>
      ) : (
        <>
          <ul className="mt-8 space-y-2.5">
            {entries.map((entry, i) => {
              const delta = trend(entry, i);
              return (
                <li key={entry.id} className="card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[1.02rem] font-semibold leading-tight">{entry.eventLabel}</p>
                      <p className="mt-0.5 text-[0.82rem] text-[color:var(--ink-3)]">
                        {new Date(entry.at).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        {' · '}
                        {entry.depth === 'quick' ? 'Quick check' : 'Deep check'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="numeric headline text-[1.4rem]">{entry.readiness ?? '—'}</p>
                      <p className="text-[0.72rem] text-[color:var(--ink-3)]">/ 100</p>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {entry.buckets.map((b) => (
                      <span key={b.label} className="chip numeric">
                        {b.label} {b.score}
                      </span>
                    ))}
                    {entry.state ? (
                      <Pill tone={entry.state === 'ready' ? 'ok' : entry.state === 'almost' ? 'warn' : 'danger'}>
                        {entry.state === 'ready' ? 'Ready' : entry.state === 'almost' ? 'Almost' : 'Not ready'}
                      </Pill>
                    ) : null}
                    {delta ? (
                      <Pill tone={delta > 0 ? 'ok' : 'warn'}>
                        {delta > 0 ? '↑' : '↓'} {Math.abs(Math.round(delta))} vs last {entry.eventLabel.toLowerCase()}
                      </Pill>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            className="btn btn-quiet mt-6 w-full"
            onClick={() => clearHistory()}
          >
            Delete all history
          </button>
          <p className="mt-2 text-center text-[0.8rem] text-[color:var(--ink-3)]">
            Stored in this browser only. Never uploaded.
          </p>
        </>
      )}
    </main>
  );
}
