import Link from 'next/link';
import { Icon, Logo } from '@/components/icons';
import { aiConfigured } from '@/lib/ai/config';

/*
 * Rendered per request, not at build time: both pages state whether a vision
 * model is connected, and that answer must track the deployment's current
 * environment rather than whatever was set when the build ran.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'How your camera is used — Ready?' };

/**
 * Written as answers to the questions someone actually has when an app asks
 * for their camera, in the order they think of them — not as a policy.
 */
export default function PrivacyPage() {
  const visionOn = aiConfigured();

  const sections = [
    {
      q: 'Is anything recorded?',
      a: 'No. The camera preview is live only. There is no recording, no video file, and no upload of the stream. A red "Camera on" indicator stays visible the whole time it is open, and a Stop button is always on screen.',
    },
    {
      q: 'What happens on my device?',
      a: 'Framing, camera height, posture, lighting, backlight, colour cast and background clutter are all computed in your browser from the video frames, using a body-detection model served from this site. Those numbers never leave the device — they are the same numbers whether or not you are online.',
    },
    {
      q: 'Does any image get sent anywhere?',
      a: visionOn
        ? 'One still frame, once, when you tap Analyse — and only if the "send one frame" box is ticked. It goes to Anthropic\'s API for the outfit check and comes back as text. This app does not store it, log it, or write it to disk. Untick the box and no image leaves your device at all; you keep every on-device measurement and simply lose the outfit score.'
        : 'Not on this deployment. No vision model is configured, so no image is ever sent anywhere — and the app will tell you plainly that your outfit was not scored, rather than inventing a verdict.',
    },
    {
      q: 'What about the mock interview?',
      a: 'The camera runs so head position can be measured, and your speech is transcribed by your browser\'s own speech recognition. On Chrome that means audio is processed by Google\'s service — that is the browser\'s behaviour, not ours, and it is why the interview screen says so before you start. The text of your answers is sent for review. The audio is never recorded or stored by this app.',
    },
    {
      q: 'What is saved?',
      a: 'A short history entry per check — the occasion, the scores, and the date — kept in this browser\'s local storage. No images, no transcripts, no account. Clearing it on the history page deletes it for good.',
    },
    {
      q: 'Will it comment on how I look?',
      a: 'No. The vision prompt forbids any assessment of attractiveness, facial features, body shape or weight, and any finding that mentions them is filtered out before it reaches your screen. What is judged is grooming, fit, coordination, appropriateness for the occasion, and your setup.',
    },
  ];

  return (
    <main id="main" className="mx-auto w-full max-w-2xl px-5 pb-16 safe-t">
      <header className="flex items-center justify-between py-3">
        <Link href="/" className="btn btn-ghost !min-h-11 !px-3" aria-label="Back to home">
          <Icon.back size={18} />
        </Link>
        <Logo size={26} />
        <span className="w-11" />
      </header>

      <p className="eyebrow mt-6 mb-3">Camera, microphone and data</p>
      <h1 className="display text-[clamp(2rem,8vw,2.8rem)]">What we do with what we see.</h1>
      <p className="mt-3 text-[1.02rem] leading-relaxed text-[color:var(--ink-2)]">
        This app points a camera at you, so it owes you a straight answer about every part of that.
      </p>

      <div className="mt-9 space-y-3">
        {sections.map((section) => (
          <article key={section.q} className="card p-5">
            <h2 className="headline text-[1.08rem]">{section.q}</h2>
            <p className="mt-2 text-[0.95rem] leading-relaxed text-[color:var(--ink-2)]">{section.a}</p>
          </article>
        ))}
      </div>

      <div className="card mt-8 p-5" style={{ background: 'var(--mint-soft)', borderColor: 'var(--mint)' }}>
        <span className="mb-2 inline-grid h-9 w-9 place-items-center rounded-xl" style={{ background: 'var(--surface)', color: 'var(--mint)' }}>
          <Icon.shield size={18} />
        </span>
        <h2 className="headline text-[1.05rem]">The rule underneath all of it</h2>
        <p className="mt-1.5 text-[0.95rem] leading-relaxed">
          Anything the app cannot actually see, it says it cannot see. Shoes out of frame means footwear is excluded and
          labelled — not guessed. That rule is worth more to you than any score.
        </p>
      </div>

      <Link href="/check" className="btn btn-primary mt-8 w-full">
        Start a check
        <Icon.arrow size={18} />
      </Link>
    </main>
  );
}
