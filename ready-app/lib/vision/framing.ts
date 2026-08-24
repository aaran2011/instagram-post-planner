/**
 * Turning pose landmarks into the handful of facts the coach actually needs:
 * can we see you, how much of you, and where is the lens relative to your eyes.
 *
 * All of it is pure geometry over normalised coordinates (0–1 across the frame,
 * y increasing downwards), so it is unit-testable and never touches the DOM.
 * Every derived angle here is an approximation from a 2D projection, and each
 * one is reported to the user as approximate — the numbers are good enough to
 * say "raise the phone", not good enough to print to a decimal place.
 */

import type { FramingMetrics } from '../engine/types';

export interface Landmark {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

// MediaPipe Pose landmark indices, named so the geometry below reads.
const NOSE = 0;
const LEFT_EYE = 2;
const RIGHT_EYE = 5;
const LEFT_EAR = 7;
const RIGHT_EAR = 8;
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
const LEFT_HIP = 23;
const RIGHT_HIP = 24;
const LEFT_KNEE = 25;
const RIGHT_KNEE = 26;
const LEFT_ANKLE = 27;
const RIGHT_ANKLE = 28;
const LEFT_FOOT = 31;
const RIGHT_FOOT = 32;

const VISIBLE = 0.5;

function seen(l: Landmark | undefined): boolean {
  if (!l) return false;
  if ((l.visibility ?? 1) < VISIBLE) return false;
  // A landmark the model places outside the frame is a guess, not a sighting.
  return l.x > -0.02 && l.x < 1.02 && l.y > -0.02 && l.y < 1.02;
}

function mid(a: Landmark, b: Landmark) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const deg = (rad: number) => (rad * 180) / Math.PI;

export function measureFraming(landmarks: Landmark[]): FramingMetrics {
  const get = (i: number) => landmarks[i] as Landmark | undefined;

  const nose = get(NOSE);
  const leftEye = get(LEFT_EYE);
  const rightEye = get(RIGHT_EYE);
  const leftEar = get(LEFT_EAR);
  const rightEar = get(RIGHT_EAR);
  const leftShoulder = get(LEFT_SHOULDER);
  const rightShoulder = get(RIGHT_SHOULDER);
  const leftHip = get(LEFT_HIP);
  const rightHip = get(RIGHT_HIP);

  const headVisible = seen(nose) && (seen(leftEye) || seen(rightEye));
  const torsoVisible = seen(leftShoulder) && seen(rightShoulder) && (seen(leftHip) || seen(rightHip));
  const kneesVisible = seen(get(LEFT_KNEE)) || seen(get(RIGHT_KNEE));
  const feetVisible =
    seen(get(LEFT_ANKLE)) || seen(get(RIGHT_ANKLE)) || seen(get(LEFT_FOOT)) || seen(get(RIGHT_FOOT));

  const visible = landmarks.filter(seen);
  const ys = visible.map((l) => l.y);
  const xs = visible.map((l) => l.x);
  const bodyFill = ys.length ? clamp(Math.max(...ys) - Math.min(...ys), 0, 1) : 0;
  const centerX = xs.length ? clamp((Math.min(...xs) + Math.max(...xs)) / 2, 0, 1) : 0.5;

  const eyes = leftEye && rightEye ? mid(leftEye, rightEye) : nose ? { x: nose.x, y: nose.y } : null;
  const eyeLine = eyes ? clamp(eyes.y, 0, 1) : 0.5;

  // Camera height, from the oldest trick in portrait photography: with the lens
  // at eye level the ears sit level with the eyes. Shoot from below and the
  // ears ride up the frame; shoot from above and they drop. Normalised by head
  // width so it does not change with distance.
  let cameraPitch = 0;
  if (eyes && leftEar && rightEar && seen(leftEar) && seen(rightEar)) {
    const ears = mid(leftEar, rightEar);
    const headWidth = Math.abs(leftEar.x - rightEar.x) || 0.08;
    cameraPitch = clamp(deg(Math.atan2(eyes.y - ears.y, headWidth * 0.9)), -60, 60);
  }

  // Head turn, from how far the nose sits from each ear horizontally.
  let headYaw = 0;
  if (nose && leftEar && rightEar && seen(leftEar) && seen(rightEar)) {
    const dl = Math.abs(nose.x - leftEar.x);
    const dr = Math.abs(nose.x - rightEar.x);
    const total = dl + dr;
    if (total > 0.001) headYaw = clamp(((dl - dr) / total) * 90, -90, 90);
  }

  let shoulderTilt = 0;
  if (leftShoulder && rightShoulder && seen(leftShoulder) && seen(rightShoulder)) {
    shoulderTilt = deg(Math.atan2(leftShoulder.y - rightShoulder.y, Math.abs(leftShoulder.x - rightShoulder.x) || 0.2));
  }

  // Slouch proxy: how much neck is showing between ears and shoulders, scaled
  // by shoulder width. Sitting tall gives roughly 0.55–0.9; a collapsed spine
  // pulls the head down towards the shoulder line and the ratio falls.
  let slouch = 0;
  if (leftShoulder && rightShoulder && leftEar && rightEar && seen(leftShoulder) && seen(rightShoulder) && seen(leftEar)) {
    const shoulders = mid(leftShoulder, rightShoulder);
    const ears = mid(leftEar, rightEar);
    const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x) || 0.25;
    const neckRatio = (shoulders.y - ears.y) / shoulderWidth;
    slouch = clamp((0.62 - neckRatio) / 0.4, 0, 1);
  }

  const quality = landmarks.length
    ? landmarks.reduce((s, l) => s + (l.visibility ?? 1), 0) / landmarks.length
    : 0;

  return {
    personDetected: visible.length > 4,
    bodyFill,
    headVisible,
    torsoVisible,
    kneesVisible,
    feetVisible,
    eyeLine,
    centerX,
    cameraPitch: Math.round(cameraPitch),
    headYaw: Math.round(headYaw),
    shoulderTilt: Math.round(shoulderTilt),
    slouch: Math.round(slouch * 100) / 100,
    quality: Math.round(quality * 100) / 100,
  };
}

export type FramingVerdict = {
  /** Good enough to analyse. */
  ok: boolean;
  /** One instruction, in the imperative, or null when the framing is fine. */
  instruction: string | null;
  /** Short status for the camera overlay. */
  status: string;
  /** How much of the body we can work with. */
  coverage: 'none' | 'head' | 'upper' | 'knees' | 'full';
};

/**
 * The live coaching line under the viewfinder.
 *
 * Only ever one instruction at a time: someone holding a phone at arm's length
 * cannot act on a list. Ordered by what blocks the check most.
 */
export function judgeFraming(m: FramingMetrics | null, wantFullBody: boolean): FramingVerdict {
  if (!m || !m.personDetected) {
    return { ok: false, instruction: 'Step into the frame', status: "We can't see you yet", coverage: 'none' };
  }

  const coverage: FramingVerdict['coverage'] = m.feetVisible
    ? 'full'
    : m.kneesVisible
      ? 'knees'
      : m.torsoVisible
        ? 'upper'
        : 'head';

  if (!m.headVisible) {
    return { ok: false, instruction: 'Move the camera down a little', status: 'Your head is out of frame', coverage };
  }

  if (wantFullBody) {
    if (!m.torsoVisible) {
      return { ok: false, instruction: 'Move the phone farther away', status: 'Too close for a full outfit', coverage };
    }
    if (!m.feetVisible) {
      return {
        ok: coverage === 'knees',
        instruction: 'Move the phone farther away',
        status: coverage === 'knees' ? "We can see most of you — shoes are still cut off" : "We can't see your full outfit yet",
        coverage,
      };
    }
    if (m.bodyFill < 0.45) {
      return { ok: false, instruction: 'Move slightly closer', status: "You're too small in the frame", coverage };
    }
  } else {
    if (m.bodyFill < 0.25) {
      return { ok: false, instruction: 'Move slightly closer', status: "You're too far from the camera", coverage };
    }
    if (!m.torsoVisible && m.bodyFill > 0.85) {
      return { ok: false, instruction: 'Move the phone farther away', status: 'A bit close for a video call', coverage };
    }
  }

  if (Math.abs(m.centerX - 0.5) > 0.22) {
    return {
      ok: false,
      instruction: m.centerX < 0.5 ? 'Move slightly right' : 'Move slightly left',
      status: "You're off to one side",
      coverage,
    };
  }

  return { ok: true, instruction: null, status: 'Perfect. We can see you.', coverage };
}
