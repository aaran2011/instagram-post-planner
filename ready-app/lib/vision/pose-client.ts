'use client';

/**
 * On-device body detection.
 *
 * The model and its WebAssembly runtime are served from this origin, so no
 * third party ever learns that someone is checking themselves, and framing
 * guidance keeps working on a bad connection. Frames go from the camera into
 * WebAssembly and come back as coordinates. They are never uploaded here — the
 * only frame that ever leaves the device is the single still the user
 * explicitly sends for the outfit check.
 */

import type { Landmark } from './framing';

export type PoseSupport = { supported: true } | { supported: false; reason: string };

export function poseSupport(): PoseSupport {
  if (typeof window === 'undefined') return { supported: false, reason: 'Not available on the server.' };
  if (typeof WebAssembly === 'undefined') {
    return { supported: false, reason: 'This browser cannot run the on-device body model.' };
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return { supported: false, reason: 'This browser does not give web apps camera access.' };
  }
  if (!window.isSecureContext) {
    return { supported: false, reason: 'Camera access needs a secure (https) connection.' };
  }
  return { supported: true };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Landmarker = any;

let landmarkerPromise: Promise<Landmarker> | null = null;

export async function loadPoseLandmarker(): Promise<Landmarker> {
  if (landmarkerPromise) return landmarkerPromise;

  landmarkerPromise = (async () => {
    const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
    const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
    return PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: '/models/pose_landmarker_lite.task', delegate: 'GPU' },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputSegmentationMasks: false,
    });
  })().catch((err) => {
    landmarkerPromise = null;
    throw err;
  });

  return landmarkerPromise;
}

export function releasePoseLandmarker() {
  const promise = landmarkerPromise;
  landmarkerPromise = null;
  void promise?.then((l) => l?.close?.()).catch(() => {});
}

export function detectPose(landmarker: Landmarker, video: HTMLVideoElement, timestampMs: number): Landmark[] | null {
  const result = landmarker.detectForVideo(video, timestampMs);
  const landmarks = result?.landmarks?.[0];
  return landmarks?.length ? (landmarks as Landmark[]) : null;
}
