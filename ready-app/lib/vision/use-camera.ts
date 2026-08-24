'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CAMERA_ERROR_COPY,
  classifyCameraError,
  hasMultipleCameras,
  openCamera,
  releaseCamera,
  type CameraError,
  type Facing,
} from './camera';
import { detectPose, loadPoseLandmarker, poseSupport, releasePoseLandmarker } from './pose-client';
import { judgeFraming, measureFraming, type FramingVerdict, type Landmark } from './framing';
import { boxesFromLandmarks, measureImage } from './image-metrics';
import type { FramingMetrics, ImageMetrics } from '../engine/types';
import type { PresenceMetrics } from '../engine/communication';

export type CameraStatus = 'idle' | 'starting' | 'live' | 'error' | 'stopped';

/**
 * Sampling rates.
 *
 * The pose model runs at 8fps rather than every frame: the guidance it drives
 * ("move back", "raise the phone") cannot be acted on faster than that, and on
 * a mid-range phone a 30fps loop heats the device and makes the preview stutter
 * — which is the one thing that must stay smooth. Pixel statistics are cheaper
 * still but change even more slowly, so they run at 2fps on a 160px copy.
 */
const POSE_INTERVAL_MS = 125;
const IMAGE_INTERVAL_MS = 500;
const METRIC_CANVAS_WIDTH = 160;
/** Sent frame: enough for a model to read a collar, small enough to be quick. */
const CAPTURE_WIDTH = 768;

export interface CaptureResult {
  /** For the on-screen thumbnail. Stays in memory only. */
  dataUrl: string;
  base64: string;
  mediaType: 'image/jpeg';
  framing: FramingMetrics | null;
  image: ImageMetrics | null;
  coverage: FramingVerdict['coverage'];
}

export interface CameraStage {
  /** Callback ref for the <video> element the preview should render into. */
  attachVideo: (element: HTMLVideoElement | null) => void;
  status: CameraStatus;
  error: CameraError | null;
  errorCopy: { title: string; detail: string } | null;
  mirrored: boolean;
  facing: Facing;
  canSwitch: boolean;
  poseReady: boolean;
  poseUnavailable: string | null;
  framing: FramingMetrics | null;
  image: ImageMetrics | null;
  verdict: FramingVerdict;
  /** Steady = framing has been acceptable for a moment, not just one frame. */
  steady: boolean;
  start: () => Promise<void>;
  stop: () => void;
  switchCamera: () => Promise<void>;
  capture: () => CaptureResult | null;
  startPresence: () => void;
  stopPresence: () => PresenceMetrics;
}

export function useCameraStage({ wantFullBody }: { wantFullBody: boolean }): CameraStage {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef(0);
  const runningRef = useRef(false);
  const landmarksRef = useRef<Landmark[] | null>(null);

  const [status, setStatus] = useState<CameraStatus>('idle');
  const [error, setError] = useState<CameraError | null>(null);
  const [mirrored, setMirrored] = useState(true);
  const [facing, setFacing] = useState<Facing>('user');
  const [canSwitch, setCanSwitch] = useState(false);
  const [poseReady, setPoseReady] = useState(false);
  const [poseUnavailable, setPoseUnavailable] = useState<string | null>(null);
  const [framing, setFraming] = useState<FramingMetrics | null>(null);
  const [image, setImage] = useState<ImageMetrics | null>(null);

  // Presence accumulates during the mock interview.
  const presenceRef = useRef<{ collecting: boolean; samples: number; facing: number; inFrame: number; slouch: number; lastX: number | null; motion: number }>(
    { collecting: false, samples: 0, facing: 0, inFrame: 0, slouch: 0, lastX: null, motion: 0 },
  );

  const attachVideo = useCallback((element: HTMLVideoElement | null) => {
    videoRef.current = element;
  }, []);

  const getCanvas = () => {
    if (!canvasRef.current) canvasRef.current = document.createElement('canvas');
    return canvasRef.current;
  };

  const loop = useCallback(() => {
    const video = videoRef.current;
    if (!runningRef.current || !video) return;

    let lastPose = 0;
    let lastImage = 0;
    let landmarker: unknown = null;

    void (async () => {
      const support = poseSupport();
      if (!support.supported) {
        setPoseUnavailable(support.reason);
        return;
      }
      try {
        landmarker = await loadPoseLandmarker();
        setPoseReady(true);
      } catch {
        // The framing coach is a bonus, not a prerequisite: without it the user
        // still gets a viewfinder, a guide outline and a capture button, and
        // the app says plainly that live guidance is off.
        setPoseUnavailable('Live framing guidance could not start on this device.');
      }
    })();

    const tick = (now: number) => {
      if (!runningRef.current) return;
      rafRef.current = requestAnimationFrame(tick);

      const el = videoRef.current;
      if (!el || el.readyState < 2 || !el.videoWidth) return;

      if (landmarker && now - lastPose >= POSE_INTERVAL_MS) {
        lastPose = now;
        try {
          const landmarks = detectPose(landmarker, el, now);
          landmarksRef.current = landmarks;
          const metrics = landmarks ? measureFraming(landmarks) : null;
          setFraming(metrics);

          const presence = presenceRef.current;
          if (presence.collecting && metrics) {
            presence.samples += 1;
            if (metrics.personDetected) presence.inFrame += 1;
            if (Math.abs(metrics.headYaw) < 16) presence.facing += 1;
            presence.slouch += metrics.slouch;
            if (presence.lastX !== null) presence.motion += Math.abs(metrics.centerX - presence.lastX);
            presence.lastX = metrics.centerX;
          }
        } catch {
          // A single failed inference is not worth surfacing; the next frame
          // usually succeeds, and the overlay keeps its last known state.
        }
      }

      if (now - lastImage >= IMAGE_INTERVAL_MS) {
        lastImage = now;
        const canvas = getCanvas();
        const width = METRIC_CANVAS_WIDTH;
        const height = Math.max(1, Math.round((el.videoHeight / el.videoWidth) * width));
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(el, 0, 0, width, height);
          try {
            const pixels = ctx.getImageData(0, 0, width, height);
            const boxes = landmarksRef.current ? boxesFromLandmarks(landmarksRef.current) : { face: null, person: null };
            setImage(measureImage(pixels, boxes.face, boxes.person));
          } catch {
            // Reading pixels can throw if the stream is not ready yet.
          }
        }
      }
    };

    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const start = useCallback(async () => {
    setStatus('starting');
    setError(null);
    try {
      // Full-body checks work better on the rear camera, which is wider on
      // almost every phone — but only if there is one to switch to.
      const camera = await openCamera(facing);
      const video = videoRef.current;
      if (video) {
        video.srcObject = camera.stream;
        video.muted = true;
        video.playsInline = true;
        await video.play().catch(() => {});
      }
      setMirrored(camera.mirrored);
      setFacing(camera.facing);
      setStatus('live');
      setCanSwitch(await hasMultipleCameras());
      runningRef.current = true;
      loop();
    } catch (err) {
      setError(classifyCameraError(err));
      setStatus('error');
    }
  }, [facing, loop]);

  const stop = useCallback(() => {
    runningRef.current = false;
    cancelAnimationFrame(rafRef.current);
    releaseCamera();
    const video = videoRef.current;
    if (video) video.srcObject = null;
    setStatus('stopped');
    setFraming(null);
    setImage(null);
  }, []);

  const switchCamera = useCallback(async () => {
    const next: Facing = facing === 'user' ? 'environment' : 'user';
    runningRef.current = false;
    cancelAnimationFrame(rafRef.current);
    setFacing(next);
    setStatus('starting');
    try {
      const camera = await openCamera(next);
      const video = videoRef.current;
      if (video) {
        video.srcObject = camera.stream;
        await video.play().catch(() => {});
      }
      setMirrored(camera.mirrored);
      setFacing(camera.facing);
      setStatus('live');
      runningRef.current = true;
      loop();
    } catch (err) {
      setError(classifyCameraError(err));
      setStatus('error');
    }
  }, [facing, loop]);

  const capture = useCallback((): CaptureResult | null => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;

    const canvas = document.createElement('canvas');
    const scale = Math.min(1, CAPTURE_WIDTH / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // Captured unmirrored: the analysis should see the room as it is, even
    // though the preview is flipped so movement feels natural.
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);

    return {
      dataUrl,
      base64: dataUrl.slice(dataUrl.indexOf(',') + 1),
      mediaType: 'image/jpeg',
      framing,
      image,
      coverage: judgeFraming(framing, wantFullBody).coverage,
    };
  }, [framing, image, wantFullBody]);

  const startPresence = useCallback(() => {
    presenceRef.current = { collecting: true, samples: 0, facing: 0, inFrame: 0, slouch: 0, lastX: null, motion: 0 };
  }, []);

  const stopPresence = useCallback((): PresenceMetrics => {
    const p = presenceRef.current;
    p.collecting = false;
    const samples = p.samples || 0;
    return {
      samples,
      facingRatio: samples ? p.facing / samples : 0,
      inFrameRatio: samples ? p.inFrame / samples : 0,
      meanSlouch: samples ? Math.round((p.slouch / samples) * 100) / 100 : 0,
      restlessness: samples > 1 ? Math.round((p.motion / (samples - 1)) * 1000) / 1000 : 0,
    };
  }, []);

  // Hardware is always released when the screen goes away, whatever route the
  // user took to leave it.
  useEffect(
    () => () => {
      runningRef.current = false;
      cancelAnimationFrame(rafRef.current);
      releaseCamera();
      releasePoseLandmarker();
    },
    [],
  );

  const verdict = useMemo(() => judgeFraming(framing, wantFullBody), [framing, wantFullBody]);

  /*
   * A single good frame is not "ready" — someone walking past the lens would
   * trigger it. Nearly a second of an acceptable frame is. Both transitions run
   * off a timer rather than firing during the effect, so a jittering verdict
   * cannot thrash the shutter button.
   */
  const [steady, setSteady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSteady(verdict.ok), verdict.ok ? 900 : 0);
    return () => clearTimeout(timer);
  }, [verdict.ok, verdict.status]);

  return {
    attachVideo,
    status,
    error,
    errorCopy: error ? CAMERA_ERROR_COPY[error.kind] : null,
    mirrored,
    facing,
    canSwitch,
    poseReady,
    poseUnavailable,
    framing,
    image,
    verdict,
    steady,
    start,
    stop,
    switchCamera,
    capture,
    startPresence,
    stopPresence,
  };
}
