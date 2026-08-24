'use client';

import { useState } from 'react';
import { EVENTS } from '@/lib/engine/events';
import type { Depth, EventId } from '@/lib/engine/types';
import { EventIcon, Icon } from '../icons';

/**
 * Occasion first, because it decides everything after it — which questions get
 * asked, which categories are scored, and what "appropriate" means. Grouped
 * rather than listed alphabetically: people arrive knowing roughly which
 * world they are in.
 */

const GROUPS: { id: 'work' | 'occasion' | 'social'; label: string }[] = [
  { id: 'work', label: 'Work & study' },
  { id: 'occasion', label: 'Occasions' },
  { id: 'social', label: 'Social' },
];

export function EventStep({
  selected,
  depth,
  customEvent,
  onSelect,
  onDepth,
}: {
  selected: EventId | null;
  depth: Depth;
  customEvent: string;
  onSelect: (id: EventId, custom?: string) => void;
  onDepth: (depth: Depth) => void;
}) {
  const [custom, setCustom] = useState(customEvent);
  const [customOpen, setCustomOpen] = useState(false);

  return (
    <section className="rise">
      <h1 className="display text-[clamp(2rem,8vw,2.7rem)]">What are you getting ready for?</h1>
      <p className="mt-2 text-[1rem] leading-snug text-[color:var(--ink-2)]">
        Pick one. We only ask the questions that change the answer.
      </p>

      <fieldset className="mt-6">
        <legend className="eyebrow mb-2">How thorough?</legend>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { id: 'quick' as const, label: 'Quick check', detail: 'Two questions, one scan, top fixes', icon: 'bolt' as const },
              { id: 'deep' as const, label: 'Deep check', detail: 'Full context, prep and practice', icon: 'layers' as const },
            ]
          ).map((option) => {
            const active = depth === option.id;
            const Glyph = Icon[option.icon];
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={active}
                onClick={() => onDepth(option.id)}
                className="card tap p-3.5 text-left transition-all"
                style={{
                  borderColor: active ? 'var(--flare)' : 'var(--line)',
                  boxShadow: active ? 'var(--shadow-md)' : 'var(--shadow-sm)',
                  background: active ? 'var(--surface)' : 'var(--surface-2)',
                }}
              >
                <span className="flex items-center gap-2">
                  <span style={{ color: active ? 'var(--flare)' : 'var(--ink-3)' }}>
                    <Glyph size={17} />
                  </span>
                  <span className="text-[0.95rem] font-semibold">{option.label}</span>
                  {active ? (
                    <span className="ml-auto" style={{ color: 'var(--flare)' }} aria-hidden="true">
                      <Icon.check size={16} />
                    </span>
                  ) : null}
                </span>
                <span className="mt-1 block text-[0.79rem] leading-snug text-[color:var(--ink-3)]">{option.detail}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {GROUPS.map((group) => (
        <div key={group.id} className="mt-7">
          <h2 className="eyebrow mb-2.5">{group.label}</h2>
          <ul className="grid grid-cols-2 gap-2.5">
            {EVENTS.filter((e) => e.group === group.id && e.id !== 'custom').map((event) => {
              const active = selected === event.id;
              return (
                <li key={event.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(event.id)}
                    className="card tap flex h-full w-full flex-col gap-1.5 p-4 text-left transition-transform active:scale-[0.99]"
                    style={{ borderColor: active ? 'var(--flare)' : 'var(--line)' }}
                  >
                    <span
                      className="grid h-9 w-9 place-items-center rounded-xl"
                      style={{ background: 'var(--violet-soft)', color: 'var(--violet)' }}
                    >
                      <EventIcon name={event.icon} size={19} />
                    </span>
                    <span className="text-[0.95rem] font-semibold leading-tight">{event.label}</span>
                    <span className="text-[0.77rem] leading-tight text-[color:var(--ink-3)]">{event.tagline}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <div className="mt-7">
        <h2 className="eyebrow mb-2.5">Not listed?</h2>
        {customOpen ? (
          <div className="card p-4">
            <label htmlFor="custom-event" className="text-[0.95rem] font-semibold">
              What is it?
            </label>
            <p className="mb-2.5 mt-0.5 text-[0.82rem] text-[color:var(--ink-3)]">
              Describe it the way you would to a friend — we judge the outfit against exactly that.
            </p>
            <input
              id="custom-event"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="e.g. visa interview at the consulate"
              maxLength={120}
              autoFocus
              className="tap w-full rounded-2xl border px-4 py-3 text-[1rem] outline-none hairline"
              style={{ background: 'var(--surface-2)' }}
            />
            <button
              type="button"
              className="btn btn-primary mt-3 w-full"
              disabled={custom.trim().length < 3}
              onClick={() => onSelect('custom', custom.trim())}
            >
              Continue
              <Icon.arrow size={18} />
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setCustomOpen(true)} className="card tap flex w-full items-center gap-3 p-4 text-left">
            <span className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>
              <Icon.star size={19} />
            </span>
            <span>
              <span className="block text-[0.95rem] font-semibold">Something else</span>
              <span className="block text-[0.77rem] text-[color:var(--ink-3)]">Tell us and we will grade against it</span>
            </span>
            <span className="ml-auto text-[color:var(--ink-3)]" aria-hidden="true">
              <Icon.arrow size={18} />
            </span>
          </button>
        )}
      </div>
    </section>
  );
}
