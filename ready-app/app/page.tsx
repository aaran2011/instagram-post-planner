import Link from 'next/link';
import { EventIcon, Icon, Logo } from '@/components/icons';
import { EVENTS } from '@/lib/engine/events';
import { aiConfigured } from '@/lib/ai/config';

/*
 * Rendered per request, not at build time: both pages state whether a vision
 * model is connected, and that answer must track the deployment's current
 * environment rather than whatever was set when the build ran.
 */
export const dynamic = 'force-dynamic';

/**
 * The home screen has one job: make the promise, then get out of the way.
 *
 * Everything that is not the promise — how it works, what is measured, what is
 * private — sits below the fold in one band each. The brief asked not to
 * overcrowd this page, and the fastest way to break that is to explain the
 * product before someone has decided they want it.
 */

const JOURNEY = [
  { label: 'Look', detail: 'We see what you are wearing and how you are framed.', icon: 'eye' as const },
  { label: 'Prepare', detail: 'Questions and talking points for what is coming.', icon: 'layers' as const },
  { label: 'Practice', detail: 'A two-minute mock interview, if it applies.', icon: 'mic' as const },
  { label: 'Fix', detail: 'The two or three things worth changing. Ranked.', icon: 'bolt' as const },
  { label: 'Ready', detail: 'One score, one verdict, one short list.', icon: 'check' as const },
];

export default function HomePage() {
  const visionOn = aiConfigured();
  const featured = EVENTS.filter((e) =>
    ['online-interview', 'job-interview', 'wedding', 'presentation', 'date', 'business-meeting', 'party', 'travel'].includes(e.id),
  );

  return (
    <main id="main">
      {/* ------------------------------------------------------------ hero -- */}
      <section className="relative overflow-hidden px-5 pb-16 pt-6 safe-t">
        <div className="aurora" aria-hidden="true">
          <span className="left-[-5%] top-[-10%] h-[46vh] w-[46vh]" style={{ background: 'var(--flare)' }} />
          <span
            className="right-[-10%] top-[6%] h-[38vh] w-[38vh]"
            style={{ background: 'var(--violet)', animationDelay: '-6s' }}
          />
          <span
            className="bottom-[-12%] left-[24%] h-[34vh] w-[34vh]"
            style={{ background: 'var(--mint)', animationDelay: '-12s' }}
          />
        </div>

        <div className="relative mx-auto w-full max-w-5xl">
          <header className="flex items-center justify-between">
            <Logo />
            <nav className="flex items-center gap-1">
              <Link href="/history" className="btn btn-ghost !min-h-11 !px-4 text-[0.9rem]">
                <Icon.history size={17} />
                History
              </Link>
              <Link href="/privacy" className="btn btn-ghost !min-h-11 !px-4 text-[0.9rem]">
                Privacy
              </Link>
            </nav>
          </header>

          <div className="pt-14 sm:pt-20">
            <p className="eyebrow mb-4">Look · Prepare · Practice · Fix · Ready</p>
            <h1 className="display text-[clamp(3.2rem,13vw,7rem)]">
              Are you
              <br />
              <span className="gradient-text">really</span> ready?
            </h1>
            <p className="mt-6 max-w-xl text-[1.12rem] leading-relaxed text-[color:var(--ink-2)]">
              Point your camera at yourself. We check your outfit, grooming, camera setup, lighting, background and
              preparation — against the thing you are actually about to walk into.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link href="/check" className="btn btn-primary text-[1.02rem]">
                Check if I&apos;m ready
                <Icon.arrow size={19} />
              </Link>
              <div className="flex gap-2">
                <Link href="/check?depth=quick" className="btn btn-quiet flex-1 whitespace-nowrap !px-5 sm:flex-none">
                  <Icon.bolt size={17} />
                  Quick check
                </Link>
                <Link href="/check?depth=deep" className="btn btn-quiet flex-1 whitespace-nowrap !px-5 sm:flex-none">
                  <Icon.layers size={17} />
                  Deep check
                </Link>
              </div>
            </div>

            <p className="mt-5 flex items-center gap-2 text-[0.86rem] text-[color:var(--ink-3)]">
              <Icon.clock size={15} />
              Quick check takes about 40 seconds. Deep check, about five minutes.
            </p>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- occasions -- */}
      <section className="px-5 pb-14">
        <div className="mx-auto w-full max-w-5xl">
          <h2 className="eyebrow mb-4">What are you getting ready for?</h2>
          <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {featured.map((event) => (
              <li key={event.id}>
                <Link
                  href={`/check?event=${event.id}`}
                  className="card flex h-full flex-col gap-2 p-4 transition-transform hover:-translate-y-0.5"
                >
                  <span
                    className="grid h-9 w-9 place-items-center rounded-xl"
                    style={{ background: 'var(--violet-soft)', color: 'var(--violet)' }}
                  >
                    <EventIcon name={event.icon} size={19} />
                  </span>
                  <span className="text-[0.95rem] font-semibold leading-tight">{event.label}</span>
                  <span className="text-[0.78rem] text-[color:var(--ink-3)]">{event.tagline}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* --------------------------------------------------------- journey -- */}
      <section className="px-5 pb-16">
        <div className="mx-auto w-full max-w-5xl">
          <div className="card overflow-hidden p-0">
            <ol className="grid gap-px sm:grid-cols-5" style={{ background: 'var(--line)' }}>
              {JOURNEY.map((step, i) => {
                const Glyph = Icon[step.icon];
                return (
                  <li key={step.label} className="bg-[color:var(--surface)] p-5">
                    <span className="mb-3 flex items-center gap-2">
                      <span
                        className="grid h-7 w-7 place-items-center rounded-lg"
                        style={{
                          background: i === JOURNEY.length - 1 ? 'var(--grad-mint)' : 'var(--grad-flare)',
                          // White on the amber end of the flare gradient is a
                          // 2.2:1 glyph. Dark ink reads on both ends.
                          color: i === JOURNEY.length - 1 ? '#fff' : 'var(--on-flare)',
                        }}
                      >
                        <Glyph size={15} />
                      </span>
                      <span className="text-[0.7rem] font-bold uppercase tracking-widest text-[color:var(--ink-3)]">
                        Step {i + 1}
                      </span>
                    </span>
                    <p className="headline text-[1.05rem]">{step.label}</p>
                    <p className="mt-1 text-[0.86rem] leading-snug text-[color:var(--ink-2)]">{step.detail}</p>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- honesty -- */}
      <section className="px-5 pb-20">
        <div className="mx-auto grid w-full max-w-5xl gap-3 sm:grid-cols-3">
          <article className="card p-5">
            <span className="mb-3 inline-grid h-9 w-9 place-items-center rounded-xl" style={{ background: 'var(--mint-soft)', color: 'var(--mint)' }}>
              <Icon.shield size={19} />
            </span>
            <h3 className="headline text-[1.02rem]">Measured, not guessed</h3>
            <p className="mt-1.5 text-[0.88rem] leading-snug text-[color:var(--ink-2)]">
              Camera height, lighting, background clutter and posture are computed on your device from the video — real
              numbers, no model involved, nothing uploaded.
            </p>
          </article>
          <article className="card p-5">
            <span className="mb-3 inline-grid h-9 w-9 place-items-center rounded-xl" style={{ background: 'var(--violet-soft)', color: 'var(--violet)' }}>
              <Icon.eye size={19} />
            </span>
            <h3 className="headline text-[1.02rem]">It says what it cannot see</h3>
            <p className="mt-1.5 text-[0.88rem] leading-snug text-[color:var(--ink-2)]">
              Shoes out of frame? Footwear is excluded from the score and labelled as such. Nothing is invented to fill
              a gap.
              {visionOn ? '' : ' Right now no vision model is connected, so the outfit itself is not scored at all.'}
            </p>
          </article>
          <article className="card p-5">
            <span className="mb-3 inline-grid h-9 w-9 place-items-center rounded-xl" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>
              <Icon.heart size={19} />
            </span>
            <h3 className="headline text-[1.02rem]">Never about your looks</h3>
            <p className="mt-1.5 text-[0.88rem] leading-snug text-[color:var(--ink-2)]">
              No beauty score, no body commentary. Grooming, fit, coordination and preparation — the things you can
              actually change before you leave.
            </p>
          </article>
        </div>
      </section>

      <footer className="border-t px-5 py-8 hairline">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Logo size={24} />
          <p className="flex items-center gap-2 text-[0.82rem] text-[color:var(--ink-3)]">
            <Icon.lock size={14} />
            {visionOn
              ? 'One still frame is sent for the outfit check, only when you tap Analyse.'
              : 'Demo mode: no vision model connected, so no image ever leaves your device.'}
          </p>
          <div className="flex gap-4 text-[0.85rem]">
            <Link href="/privacy" className="underline underline-offset-4">
              How your camera is used
            </Link>
            <Link href="/history" className="underline underline-offset-4">
              History
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
