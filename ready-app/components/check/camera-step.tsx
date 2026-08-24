'use client';

import { useCallback, useState } from 'react';
import { eventName, isOnline } from '@/lib/engine/events';
import type { AppearanceReport, CheckContext } from '@/lib/engine/types';
import { useCameraStage } from '@/lib/vision/use-camera';
import { Icon } from '../icons';
import { ErrorState, Pill, WorkingState } from '../ui';
import { FramingGuide } from './framing-guide';

/**
 * The camera stage.
 *
 * Three rules shaped this screen:
 *
 *  1. The camera does not open until someone asks it to, and what happens to
 *     the picture is stated before the prompt, not after.
 *  2. One instruction at a time. Someone holding a phone at arm's length and
 *     squinting at it cannot act on a list of five corrections.
 *  3. The chrome stays off the picture. A status line, a stop button and a
 *     shutter — everything else lives below the frame.
 */
export function CameraStep({
  ctx,
  visionAvailable,
  rescanOf,
  onDone,
  onSkip,
}: {
  ctx: CheckContext;
  visionAvailable: boolean | null;
  rescanOf: AppearanceReport | null;
  onDone: (report: AppearanceReport) => void;
  onSkip: () => void;
}) {
  const online = isOnline(ctx);
  const wantFullBody = !online;
  // Destructured rather than held as one object: the hook hands back state
  // alongside callbacks that touch refs, and reading state off that object in
  // render is indistinguishable from reading a ref to the compiler.
  const {
    attachVideo,
    status,
    errorCopy,
    mirrored,
    canSwitch,
    poseUnavailable,
    framing,
    image,
    verdict,
    steady,
    start: startCamera,
    stop: stopCamera,
    switchCamera,
    capture,
  } = useCameraStage({ wantFullBody });
  const [requested, setPhase] = useState<'intro' | 'live' | 'working' | 'failed'>('intro');
  const [sendFrame, setSendFrame] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  const [override, setOverride] = useState(false);

  const start = useCallback(async () => {
    setPhase('live');
    await startCamera();
  }, [startCamera]);

  // A camera failure is not a separate state to keep in sync — it is simply
  // what the screen shows while the camera is in an error state.
  const phase = status === 'error' ? 'failed' : requested;

  const analyse = useCallback(async () => {
    const shot = capture();
    setPhase('working');
    setFailure(null);

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ctx,
          coverage: shot?.coverage ?? 'none',
          metrics: { framing: shot?.framing ?? framing, image: shot?.image ?? image },
          image: sendFrame && shot ? { data: shot.base64, mediaType: shot.mediaType } : null,
        }),
      });

      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as { report: AppearanceReport };

      // The camera is switched off the moment it has nothing left to do.
      stopCamera();
      onDone(data.report);
    } catch {
      setFailure("We couldn't finish the analysis. Your connection may have dropped.");
      setPhase('live');
    }
  }, [ctx, sendFrame, capture, framing, image, stopCamera, onDone]);

  /* ------------------------------------------------------------- intro --- */
  if (phase === 'intro') {
    return (
      <section className="rise">
        <p className="eyebrow mb-2">{eventName(ctx)}</p>
        <h1 className="display text-[clamp(1.9rem,7vw,2.5rem)]">
          {rescanOf ? 'Let’s look again.' : online ? 'Set up like it’s the real call.' : 'Put your phone in front of you.'}
        </h1>
        <p className="mt-2.5 text-[1rem] leading-snug text-[color:var(--ink-2)]">
          {rescanOf
            ? `You scored ${rescanOf.overall}/10 last time. Make your changes, then scan again and we will show you the difference.`
            : online
              ? 'Sit where you will actually be sitting, with the same light and the same background. We check the setup, not just you.'
              : 'Lean it against something at about waist height and step back until your whole body — head to shoes — is in the frame.'}
        </p>

        <div className="card mt-6 p-5">
          <span className="mb-3 inline-grid h-10 w-10 place-items-center rounded-xl" style={{ background: 'var(--mint-soft)', color: 'var(--mint)' }}>
            <Icon.lock size={20} />
          </span>
          <h2 className="headline text-[1.05rem]">What happens to the picture</h2>
          <ul className="mt-2.5 space-y-2 text-[0.9rem] leading-snug text-[color:var(--ink-2)]">
            <li className="flex gap-2">
              <span className="mt-1 shrink-0" style={{ color: 'var(--mint)' }}>
                <Icon.check size={15} />
              </span>
              The live preview never leaves your device. Framing, lighting, background and posture are all measured here,
              in your browser.
            </li>
            <li className="flex gap-2">
              <span className="mt-1 shrink-0" style={{ color: visionAvailable ? 'var(--violet)' : 'var(--mint)' }}>
                <Icon.check size={15} />
              </span>
              {visionAvailable
                ? 'When you tap Analyse, one still frame is sent to Anthropic’s vision model to check the outfit. It is not stored by this app.'
                : 'No vision model is connected on this deployment, so no image is sent anywhere at all — and your outfit will not be scored.'}
            </li>
            <li className="flex gap-2">
              <span className="mt-1 shrink-0" style={{ color: 'var(--mint)' }}>
                <Icon.check size={15} />
              </span>
              Nothing is recorded. There is a Stop button on the camera at all times.
            </li>
          </ul>
        </div>

        <button type="button" className="btn btn-primary mt-5 w-full" onClick={start}>
          <Icon.camera size={19} />
          Turn on the camera
        </button>
        <button type="button" className="btn btn-ghost mt-2 w-full" onClick={onSkip}>
          Skip the visual check
        </button>
      </section>
    );
  }

  /* ----------------------------------------------------------- working --- */
  if (phase === 'working') {
    return (
      <WorkingState
        title="Working through it"
        steps={[
          'Reading your framing and lighting',
          sendFrame && visionAvailable ? 'Checking the outfit' : 'Checking your setup',
          `Weighting it for a ${eventName(ctx).toLowerCase()}`,
          'Building your readiness score',
        ]}
      />
    );
  }

  /* ------------------------------------------------------------ failed --- */
  if (phase === 'failed') {
    return (
      <div className="rise">
        <ErrorState
          title={errorCopy?.title ?? "The camera didn't start"}
          detail={errorCopy?.detail ?? 'Try again, or continue without the visual check.'}
          action="Try again"
          onAction={start}
          secondaryAction="Continue without it"
          onSecondary={onSkip}
        />
      </div>
    );
  }

  /* -------------------------------------------------------------- live --- */
  const coverage = verdict.coverage;
  const canAnalyse = steady || override;

  return (
    <section className="rise">
      <div className="viewfinder relative overflow-hidden rounded-[var(--r-xl)] bg-black" style={{ aspectRatio: wantFullBody ? '3 / 4' : '4 / 3' }}>
        <video
          ref={attachVideo}
          playsInline
          muted
          autoPlay
          className="h-full w-full object-cover"
          style={{ transform: mirrored ? 'scaleX(-1)' : undefined }}
        />

        <FramingGuide wantFullBody={wantFullBody} verdict={verdict} framing={framing} />

        {/* Top chrome: what we can see, and how to stop. */}
        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
          <span className="glass flex items-center gap-2 rounded-full px-3 py-1.5 text-[0.78rem] font-semibold text-white">
            <span className="live-dot h-1.5 w-1.5 rounded-full" style={{ background: '#ff5b4d' }} aria-hidden="true" />
            Camera on
          </span>
          <span className="flex gap-2">
            {canSwitch ? (
              <button
                type="button"
                onClick={() => void switchCamera()}
                className="glass tap grid h-11 w-11 place-items-center rounded-full text-white"
                aria-label="Switch camera"
              >
                <Icon.switch size={19} />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                stopCamera();
                setPhase('intro');
              }}
              className="glass tap grid h-11 w-11 place-items-center rounded-full text-white"
              aria-label="Stop the camera"
            >
              <Icon.stop size={18} />
            </button>
          </span>
        </div>

        {/* The single instruction. */}
        <div className="absolute inset-x-0 bottom-0 p-3">
          <p
            className="glass rounded-2xl px-4 py-3 text-center text-[0.98rem] font-semibold text-white"
            aria-live="polite"
          >
            {verdict.instruction ? (
              <span className="flex items-center justify-center gap-2">
                {verdict.instruction}
                <Icon.arrow size={17} />
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <span style={{ color: '#5ce6a5' }}>
                  <Icon.check size={17} />
                </span>
                {verdict.status}
              </span>
            )}
          </p>
        </div>
      </div>

      {/* What is actually in frame — stated, not implied. */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {(wantFullBody
          ? ([
              ['Head', framing?.headVisible],
              ['Upper body', framing?.torsoVisible],
              ['Legs', framing?.kneesVisible],
              ['Shoes', framing?.feetVisible],
            ] as const)
          : ([
              ['Face', framing?.headVisible],
              ['Shoulders', framing?.torsoVisible],
            ] as const)
        ).map(([label, visible]) => (
          <Pill key={label} tone={visible ? 'ok' : 'neutral'}>
            <span aria-hidden="true">{visible ? '✓' : '–'}</span>
            {label}
          </Pill>
        ))}
        {poseUnavailable ? <Pill tone="warn">Live guidance off</Pill> : null}
      </div>

      {!wantFullBody ? null : coverage === 'knees' ? (
        <p className="mt-2 text-[0.85rem] text-[color:var(--ink-2)]">
          Shoes are out of frame. You can still scan — footwear will be excluded from the score rather than guessed at.
        </p>
      ) : null}

      {poseUnavailable ? (
        <p className="mt-2 text-[0.85rem] text-[color:var(--ink-2)]">
          {poseUnavailable} You can still take the shot — camera height and posture just will not be measured.
        </p>
      ) : null}

      {failure ? (
        <p className="mt-3 rounded-2xl px-4 py-3 text-[0.9rem]" style={{ background: 'var(--bad-soft)', color: 'var(--bad)' }} role="alert">
          {failure}
        </p>
      ) : null}

      {visionAvailable ? (
        <label className="card-flat mt-3 flex cursor-pointer items-start gap-3 p-3.5">
          <input
            type="checkbox"
            checked={sendFrame}
            onChange={(e) => setSendFrame(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-[color:var(--flare)]"
          />
          <span>
            <span className="block text-[0.92rem] font-semibold">Send one frame for the outfit check</span>
            <span className="block text-[0.8rem] leading-snug text-[color:var(--ink-3)]">
              Turn this off to keep every pixel on your device. You will still get camera, lighting, background and
              posture — the outfit simply will not be scored.
            </span>
          </span>
        </label>
      ) : null}

      <button
        type="button"
        className="btn btn-primary mt-4 w-full"
        onClick={() => void analyse()}
        disabled={status !== 'live'}
      >
        <Icon.camera size={19} />
        {canAnalyse ? 'Analyse me' : 'Analyse anyway'}
      </button>

      {!canAnalyse && status === 'live' ? (
        <button type="button" className="btn btn-ghost mt-1.5 w-full text-[0.88rem]" onClick={() => setOverride(true)}>
          Framing is not perfect — I know
        </button>
      ) : null}
    </section>
  );
}
