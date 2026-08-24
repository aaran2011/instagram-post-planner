'use client';

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from './icons';
import type { Severity } from '@/lib/engine/types';

/* -------------------------------------------------------------------------- */
/* Score ring                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The number, counted up.
 *
 * Fast on purpose — 700ms. A slow count-up reads as the app thinking, and by
 * this point the thinking is done; dragging it out just delays the answer the
 * person came for. Screen readers get the final value immediately via
 * aria-label rather than a stream of changing digits.
 */
export function ScoreRing({
  value,
  max = 10,
  size = 168,
  label,
  tone = 'auto',
  sublabel,
}: {
  value: number;
  max?: number;
  size?: number;
  label?: string;
  tone?: 'auto' | 'flare' | 'violet';
  sublabel?: string;
}) {
  const gradientId = useId();
  const [shown, setShown] = useState(0);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    // Reduced motion still goes through the same path — it just arrives on the
    // first frame instead of over 700ms.
    const duration = reduced ? 0 : 700;
    const tick = (now: number) => {
      const t = duration ? Math.min(1, (now - start) / duration) : 1;
      // easeOutCubic — quick, then settles.
      setShown(value * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // Animation frames do not run in a backgrounded tab, and someone who looks
    // away while the check runs must not come back to a score of 0.0. The
    // timer always lands the final number, whether or not the count-up ran.
    const settle = setTimeout(() => setShown(value), duration + 150);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(settle);
    };
  }, [value, reduced]);

  const radius = size / 2 - 11;
  const circumference = 2 * Math.PI * radius;
  const ratio = Math.max(0, Math.min(1, shown / max));
  // Literal values because SVG gradient stops cannot take CSS custom
  // properties; they mirror the tokens in globals.css.
  const stops =
    tone === 'violet'
      ? ['#5A35F0', '#9333EA']
      : tone === 'flare'
        ? ['#F2542D', '#F79C10']
        : value / max >= 0.82
          ? ['#0A7A47', '#17A086']
          : value / max >= 0.62
            ? ['#F79C10', '#F2542D']
            : ['#C02430', '#F2542D'];

  const decimals = max === 10 ? 1 : 0;

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${value.toFixed(decimals)} out of ${max}${label ? `. ${label}` : ''}`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={stops[0]} />
            <stop offset="100%" stopColor={stops[1]} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="var(--line)" strokeWidth="9" fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={`url(#${gradientId})`}
          strokeWidth="9"
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
        />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="display numeric" style={{ fontSize: size * 0.29 }}>
          {shown.toFixed(decimals)}
        </span>
        <span className="text-[0.68rem] font-semibold tracking-widest text-[color:var(--ink-3)]">
          {sublabel ?? `/ ${max}`}
        </span>
      </span>
    </div>
  );
}

/**
 * Read straight from the media query rather than mirrored into state, so it is
 * correct on the very first client render and follows the system setting if it
 * changes mid-session.
 */
export function usePrefersReducedMotion() {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  );
}

/* -------------------------------------------------------------------------- */
/* Status                                                                      */
/* -------------------------------------------------------------------------- */

const TONE_STYLES = {
  ok: { bg: 'var(--ok-soft)', fg: 'var(--ok)' },
  warn: { bg: 'var(--warn-soft)', fg: 'var(--warn)' },
  danger: { bg: 'var(--bad-soft)', fg: 'var(--bad)' },
  neutral: { bg: 'var(--surface-2)', fg: 'var(--ink-2)' },
  violet: { bg: 'var(--violet-soft)', fg: 'var(--violet)' },
  mint: { bg: 'var(--mint-soft)', fg: 'var(--mint)' },
} as const;

export type Tone = keyof typeof TONE_STYLES;

/**
 * Status never rides on colour alone: every pill carries a word, and the
 * severity variants carry a shape too (● ▲ ○), so the meaning survives a
 * greyscale screen or a red-green colour deficiency.
 */
export function Pill({
  tone = 'neutral',
  children,
  icon,
}: {
  tone?: Tone;
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  const style = TONE_STYLES[tone];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.74rem] font-semibold"
      style={{ background: style.bg, color: style.fg }}
    >
      {icon}
      {children}
    </span>
  );
}

const SEVERITY_UI: Record<Severity, { tone: Tone; label: string; glyph: string }> = {
  critical: { tone: 'danger', label: 'Fix now', glyph: '▲' },
  improve: { tone: 'warn', label: 'Improve', glyph: '●' },
  polish: { tone: 'ok', label: 'Optional', glyph: '○' },
};

export function SeverityTag({ severity }: { severity: Severity }) {
  const ui = SEVERITY_UI[severity];
  return (
    <Pill tone={ui.tone}>
      <span aria-hidden="true">{ui.glyph}</span>
      {ui.label}
    </Pill>
  );
}

/** Says where a claim came from — the honesty rail of the whole product. */
export function SourceTag({ source, kind, confidence }: { source: string; kind?: string; confidence?: string }) {
  const label =
    source === 'device' ? 'Measured on device' : source === 'model' ? 'AI vision' : 'Worth checking yourself';
  const tone: Tone = source === 'device' ? 'mint' : source === 'model' ? 'violet' : 'neutral';
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Pill tone={tone}>{label}</Pill>
      {kind ? <span className="chip">{kind === 'observed' ? 'Observed' : 'Inferred'}</span> : null}
      {confidence === 'low' ? <span className="chip">Low confidence</span> : null}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Layout bits                                                                 */
/* -------------------------------------------------------------------------- */

export function Card({
  children,
  className = '',
  as: As = 'div',
}: {
  children: React.ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'li';
}) {
  return <As className={`card p-5 ${className}`}>{children}</As>;
}

export function SectionTitle({ eyebrow, title, hint }: { eyebrow?: string; title: string; hint?: string }) {
  return (
    <div className="mb-3.5">
      {eyebrow ? <p className="eyebrow mb-1.5">{eyebrow}</p> : null}
      <h2 className="headline text-[1.35rem]">{title}</h2>
      {hint ? <p className="mt-1 text-[0.9rem] leading-snug text-[color:var(--ink-2)]">{hint}</p> : null}
    </div>
  );
}

/**
 * The stage rail. Named steps rather than a percentage bar, because "you are
 * on Practice, one step from Ready" tells someone something a 71% does not.
 */
export function StageRail({ stages, current }: { stages: { id: string; label: string }[]; current: string }) {
  const index = stages.findIndex((s) => s.id === current);
  return (
    <nav aria-label="Progress" className="rail -mx-4 overflow-x-auto px-4">
      <ol className="flex min-w-max items-center gap-1.5">
        {stages.map((stage, i) => {
          const state = i < index ? 'done' : i === index ? 'current' : 'todo';
          return (
            <li key={stage.id} className="flex items-center gap-1.5">
              <span
                aria-current={state === 'current' ? 'step' : undefined}
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.72rem] font-bold uppercase tracking-wider"
                style={{
                  background: state === 'current' ? 'var(--ink)' : state === 'done' ? 'var(--violet-soft)' : 'transparent',
                  color: state === 'current' ? 'var(--paper)' : state === 'done' ? 'var(--violet)' : 'var(--ink-3)',
                  border: state === 'todo' ? '1px dashed var(--line-strong)' : '1px solid transparent',
                }}
              >
                {state === 'done' ? <Icon.check size={12} /> : null}
                {stage.label}
                <span className="sr-only">{state === 'done' ? ' (done)' : state === 'current' ? ' (current step)' : ''}</span>
              </span>
              {i < stages.length - 1 ? <span aria-hidden="true" className="h-px w-3 bg-[color:var(--line-strong)]" /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* -------------------------------------------------------------------------- */
/* States                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Loading with something to read.
 *
 * The steps are real phases of the request, ticked off as the elapsed time
 * passes each one, so a slow network looks like progress rather than a hang.
 */
export function WorkingState({ steps, title }: { steps: string[]; title: string }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setStep((s) => Math.min(s + 1, steps.length - 1)), 1100);
    return () => clearInterval(timer);
  }, [steps.length]);

  return (
    <div className="flex flex-col items-center gap-6 py-14 text-center" role="status" aria-live="polite">
      <div className="relative">
        <span className="absolute inset-0 rounded-full" style={{ background: 'var(--grad-flare)', animation: 'pulse-ring 1.8s ease-out infinite' }} />
        <span
          className="relative grid h-16 w-16 place-items-center rounded-full"
          style={{ background: 'var(--grad-flare)', color: 'var(--on-flare)' }}
        >
          <Icon.bolt size={26} />
        </span>
      </div>
      <div>
        <p className="headline text-[1.2rem]">{title}</p>
        <ul className="mt-3 space-y-1.5">
          {steps.map((s, i) => (
            <li
              key={s}
              className="flex items-center justify-center gap-2 text-[0.92rem] transition-opacity"
              style={{ opacity: i <= step ? 1 : 0.32, color: i < step ? 'var(--ink-2)' : 'var(--ink)' }}
            >
              {i < step ? (
                <span style={{ color: 'var(--ok)' }}>
                  <Icon.check size={15} />
                </span>
              ) : (
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--flare)' }} />
              )}
              {s}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Never shows a stack trace. Always offers the next move. */
export function ErrorState({
  title,
  detail,
  action,
  onAction,
  secondaryAction,
  onSecondary,
}: {
  title: string;
  detail: string;
  action?: string;
  onAction?: () => void;
  secondaryAction?: string;
  onSecondary?: () => void;
}) {
  return (
    <div className="card p-6 text-center" role="alert">
      <span
        className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full"
        style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}
      >
        <Icon.alert size={22} />
      </span>
      <h2 className="headline text-[1.15rem]">{title}</h2>
      <p className="mx-auto mt-1.5 max-w-sm text-[0.94rem] leading-snug text-[color:var(--ink-2)]">{detail}</p>
      {action || secondaryAction ? (
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
          {action ? (
            <button type="button" className="btn btn-primary" onClick={onAction}>
              {action}
            </button>
          ) : null}
          {secondaryAction ? (
            <button type="button" className="btn btn-quiet" onClick={onSecondary}>
              {secondaryAction}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Disclosure that keeps keyboard and screen-reader semantics for free. */
export function Expandable({
  summary,
  children,
  defaultOpen = false,
}: {
  summary: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  return (
    <details ref={ref} open={defaultOpen} className="group">
      <summary className="tap flex cursor-pointer list-none items-center justify-between gap-3 py-1 [&::-webkit-details-marker]:hidden">
        {summary}
        <span
          className="shrink-0 text-[color:var(--ink-3)] transition-transform group-open:rotate-90"
          aria-hidden="true"
        >
          <Icon.arrow size={17} />
        </span>
      </summary>
      <div className="rise pt-2">{children}</div>
    </details>
  );
}
