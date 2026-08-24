/**
 * One stroke-weight, one grid, one visual family.
 *
 * Drawn in-house rather than pulled from an icon package: this app needs about
 * twenty glyphs, several of them specific to it (a mortar board next to a
 * wedding ring next to a lectern), and a consistent 1.7 stroke across all of
 * them does more for the product's identity than any library would.
 */

type Props = { className?: string; size?: number };

function Svg({ children, size = 24, className }: Props & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const Icon = {
  briefcase: (p: Props) => (
    <Svg {...p}>
      <rect x="2.5" y="7" width="19" height="13" rx="2.5" />
      <path d="M8.5 7V5.5A1.5 1.5 0 0 1 10 4h4a1.5 1.5 0 0 1 1.5 1.5V7" />
      <path d="M2.5 12.5h19" />
      <path d="M10.5 12.5v2h3v-2" />
    </Svg>
  ),
  video: (p: Props) => (
    <Svg {...p}>
      <rect x="2.5" y="6" width="13" height="12" rx="2.5" />
      <path d="M15.5 10.5 21.5 7v10l-6-3.5z" />
    </Svg>
  ),
  cap: (p: Props) => (
    <Svg {...p}>
      <path d="M12 4 2.5 8.5 12 13l9.5-4.5L12 4Z" />
      <path d="M6.5 10.8V15c0 1.7 2.5 3 5.5 3s5.5-1.3 5.5-3v-4.2" />
      <path d="M21.5 8.5v5" />
    </Svg>
  ),
  handshake: (p: Props) => (
    <Svg {...p}>
      <path d="m3 11 3-3 3.5 1.5L13 8l4 3" />
      <path d="M17 11l4-3" />
      <path d="m9 13 2 2 2-2 2 2 2-2" />
      <path d="M3 11v3l4 4 3-1" />
    </Svg>
  ),
  podium: (p: Props) => (
    <Svg {...p}>
      <circle cx="12" cy="4.5" r="2" />
      <path d="M8 21V11a4 4 0 0 1 8 0v10" />
      <path d="M6.5 21h11" />
      <path d="M9.5 14.5h5" />
    </Svg>
  ),
  rings: (p: Props) => (
    <Svg {...p}>
      <circle cx="9" cy="14.5" r="5" />
      <circle cx="15" cy="14.5" r="5" />
      <path d="m12 6.5 1.8-2.5h-3.6L12 6.5Z" />
    </Svg>
  ),
  sparkle: (p: Props) => (
    <Svg {...p}>
      <path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9 12 3.5Z" />
      <path d="M18.5 17.5 19.2 19.7 21.4 20.4 19.2 21.1 18.5 23.3" />
    </Svg>
  ),
  heart: (p: Props) => (
    <Svg {...p}>
      <path d="M12 20.2 4.6 13a4.6 4.6 0 1 1 7.4-5.2A4.6 4.6 0 1 1 19.4 13Z" />
    </Svg>
  ),
  plate: (p: Props) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4" />
    </Svg>
  ),
  home: (p: Props) => (
    <Svg {...p}>
      <path d="m3.5 10.5 8.5-6.5 8.5 6.5" />
      <path d="M5.5 9.5V20h13V9.5" />
      <path d="M10 20v-5h4v5" />
    </Svg>
  ),
  sun: (p: Props) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" />
    </Svg>
  ),
  plane: (p: Props) => (
    <Svg {...p}>
      <path d="M10.5 20.5 12 15l7.5-1.5a2 2 0 1 0-.6-3.9L12 11 8.5 4.5l-2 .5L8 11.6l-3.5.7-1.7-2-1.3.4L3 14.5l-.5 2 1.3.4 1.6-2 3.4.8-1.2 5.2 1.9.6Z" />
    </Svg>
  ),
  star: (p: Props) => (
    <Svg {...p}>
      <path d="m12 3.8 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.8Z" />
    </Svg>
  ),
  camera: (p: Props) => (
    <Svg {...p}>
      <path d="M3 8.5h3l1.5-2.5h9L18 8.5h3v10.5H3z" />
      <circle cx="12" cy="13" r="3.6" />
    </Svg>
  ),
  mic: (p: Props) => (
    <Svg {...p}>
      <rect x="9" y="2.8" width="6" height="11" rx="3" />
      <path d="M5.5 12a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18.5V21.5M9 21.5h6" />
    </Svg>
  ),
  check: (p: Props) => (
    <Svg {...p}>
      <path d="m4.5 12.5 5 5 10-11" />
    </Svg>
  ),
  alert: (p: Props) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.3v.2" />
    </Svg>
  ),
  arrow: (p: Props) => (
    <Svg {...p}>
      <path d="M4.5 12h15M13.5 6l6 6-6 6" />
    </Svg>
  ),
  back: (p: Props) => (
    <Svg {...p}>
      <path d="M19.5 12h-15M10.5 6l-6 6 6 6" />
    </Svg>
  ),
  refresh: (p: Props) => (
    <Svg {...p}>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20.5 4v4.5H16" />
    </Svg>
  ),
  lock: (p: Props) => (
    <Svg {...p}>
      <rect x="4.5" y="10" width="15" height="10" rx="2.5" />
      <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
    </Svg>
  ),
  eye: (p: Props) => (
    <Svg {...p}>
      <path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </Svg>
  ),
  clock: (p: Props) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.3l3.2 2" />
    </Svg>
  ),
  bolt: (p: Props) => (
    <Svg {...p}>
      <path d="M13.5 2.5 4.5 13.8h6.2L10 21.5l9.3-11.4h-6.4l.6-7.6Z" />
    </Svg>
  ),
  layers: (p: Props) => (
    <Svg {...p}>
      <path d="m12 3.5 8.5 4.3L12 12 3.5 7.8 12 3.5Z" />
      <path d="m3.5 12.2 8.5 4.3 8.5-4.3" />
      <path d="m3.5 16.4 8.5 4.3 8.5-4.3" />
    </Svg>
  ),
  switch: (p: Props) => (
    <Svg {...p}>
      <path d="M4 8.5h13.5M14 5l3.5 3.5L14 12" />
      <path d="M20 15.5H6.5M10 12l-3.5 3.5L10 19" />
    </Svg>
  ),
  stop: (p: Props) => (
    <Svg {...p}>
      <rect x="6" y="6" width="12" height="12" rx="2.5" />
    </Svg>
  ),
  shield: (p: Props) => (
    <Svg {...p}>
      <path d="M12 3 5 6v6c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </Svg>
  ),
  history: (p: Props) => (
    <Svg {...p}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3.5 4.5V9H8" />
      <path d="M12 8v4.4l3 1.8" />
    </Svg>
  ),
};

export type IconName = keyof typeof Icon;

export function EventIcon({ name, size = 24, className }: { name: string; size?: number; className?: string }) {
  const Component = Icon[(name as IconName) in Icon ? (name as IconName) : 'star'];
  return <Component size={size} className={className} />;
}

/** The wordmark: a lens ring that closes into a tick. */
export function Logo({ size = 30, withWord = true }: { size?: number; withWord?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="ready-mark" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
            <stop stopColor="#F2542D" />
            <stop offset="1" stopColor="#F79C10" />
          </linearGradient>
        </defs>
        <circle cx="16" cy="16" r="13" stroke="url(#ready-mark)" strokeWidth="2.6" strokeLinecap="round" strokeDasharray="60 22" transform="rotate(-96 16 16)" />
        <path d="m10.5 16.4 3.9 3.9 7.4-8.2" stroke="url(#ready-mark)" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {withWord ? (
        <span className="headline text-[1.15rem] tracking-[-0.03em]">
          Ready<span className="text-[color:var(--flare)]">?</span>
        </span>
      ) : null}
    </span>
  );
}
