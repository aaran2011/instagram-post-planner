'use client';

import type { FramingVerdict } from '@/lib/vision/framing';
import type { FramingMetrics } from '@/lib/engine/types';

/**
 * The overlay on the viewfinder.
 *
 * Deliberately thin: an outline to stand inside, a target eye line, and a
 * marker showing where your eyes actually are. It turns "raise the camera" from
 * an instruction into something you can see yourself satisfy — and it is the
 * only thing drawn over the picture, because everything else competes with the
 * one thing the user is trying to look at, which is themselves.
 *
 * The colour tracks the verdict, and the shape changes with it too (dashed
 * while it is wrong, solid once it is right), so the state is not carried by
 * colour alone.
 */
export function FramingGuide({
  wantFullBody,
  verdict,
  framing,
}: {
  wantFullBody: boolean;
  verdict: FramingVerdict;
  framing: FramingMetrics | null;
}) {
  const ok = verdict.ok;
  const stroke = ok ? '#5ce6a5' : verdict.coverage === 'none' ? 'rgba(255,255,255,0.5)' : '#ffc45c';
  const targetEyeLine = wantFullBody ? 0.16 : 0.36;

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {wantFullBody ? (
        <>
          <rect
            x="17"
            y="5"
            width="66"
            height="90"
            rx="14"
            fill="none"
            stroke={stroke}
            strokeWidth="0.55"
            strokeDasharray={ok ? undefined : '3 2.2'}
            opacity={0.9}
          />
          {/* Head and feet marks: the two things people cut off. */}
          <line x1="30" y1="9" x2="70" y2="9" stroke={stroke} strokeWidth="0.4" strokeDasharray="2 2" opacity="0.55" />
          <line x1="30" y1="92" x2="70" y2="92" stroke={stroke} strokeWidth="0.4" strokeDasharray="2 2" opacity="0.55" />
        </>
      ) : (
        <>
          <ellipse cx="50" cy="42" rx="21" ry="27" fill="none" stroke={stroke} strokeWidth="0.55" strokeDasharray={ok ? undefined : '3 2.2'} opacity={0.9} />
          <path d="M22 96 C 28 74, 72 74, 78 96" fill="none" stroke={stroke} strokeWidth="0.5" strokeDasharray="3 2.2" opacity="0.5" />
        </>
      )}

      {/* Corner brackets, for a viewfinder that reads as an instrument. */}
      {[
        [6, 4, 1, 1],
        [94, 4, -1, 1],
        [6, 96, 1, -1],
        [94, 96, -1, -1],
      ].map(([x, y, dx, dy], i) => (
        <path
          key={i}
          d={`M ${x} ${y + dy * 7} L ${x} ${y} L ${x + dx * 7} ${y}`}
          fill="none"
          stroke="rgba(255,255,255,0.75)"
          strokeWidth="0.7"
          strokeLinecap="round"
        />
      ))}

      {/* Where the eyes should sit. */}
      <line
        x1="8"
        y1={targetEyeLine * 100}
        x2="92"
        y2={targetEyeLine * 100}
        stroke="rgba(255,255,255,0.45)"
        strokeWidth="0.35"
        strokeDasharray="1.5 2"
      />

      {/* Where they actually are. */}
      {framing?.personDetected && framing.headVisible ? (
        <g>
          <line
            x1="8"
            y1={framing.eyeLine * 100}
            x2="92"
            y2={framing.eyeLine * 100}
            stroke={stroke}
            strokeWidth="0.5"
            opacity="0.95"
          />
          <circle cx={framing.centerX * 100} cy={framing.eyeLine * 100} r="1.1" fill={stroke} />
        </g>
      ) : null}
    </svg>
  );
}
