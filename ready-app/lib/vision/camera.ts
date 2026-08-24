'use client';

/**
 * Opening the camera, as wide as the device will allow.
 *
 * The naive request — `{ facingMode: 'user', width: 640 }` — is the worst thing
 * you can ask for here. Browsers may satisfy a small request with a cropped
 * stream, and a cropped front camera is exactly wrong for someone standing back
 * to get their shoes in frame. So:
 *
 *   1. Ask for 4:3. Phone sensors are 4:3 and a 16:9 stream is a horizontal
 *      crop of one — widescreen throws away the top and bottom of the picture,
 *      which is where the head and the feet are.
 *   2. Ask for a large frame, so a cropped capture mode is not offered.
 *   3. Prefer the widest lens the device exposes, once labels are readable.
 *   4. Wind zoom back to its minimum where that control exists.
 *
 * None of this widens a fixed lens, so the analysis still has to cope with a
 * partial view — but it stops the browser from cropping a tight view further.
 */

export type Facing = 'user' | 'environment';

export interface CameraChoice {
  deviceId: string;
  label: string;
  facing: Facing | 'unknown';
  /** Scored from the label; higher means a wider field of view. */
  width: number;
}

const STORAGE_KEY = 'ready:camera-device';

function facingOf(label: string): Facing | 'unknown' {
  const l = label.toLowerCase();
  if (/front|user|self/.test(l)) return 'user';
  if (/back|rear|environment/.test(l)) return 'environment';
  return 'unknown';
}

export function widthScore(label: string): number {
  const l = label.toLowerCase();
  if (/ultra.?wide/.test(l)) return 3;
  if (/\bwide\b/.test(l)) return 2;
  if (/tele|zoom/.test(l)) return 0;
  return 1;
}

export async function listCameras(): Promise<CameraChoice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'videoinput')
    .map((d) => ({
      deviceId: d.deviceId,
      label: d.label || 'Camera',
      facing: facingOf(d.label),
      width: widthScore(d.label),
    }));
}

export function pickWidest(devices: CameraChoice[], facing: Facing): CameraChoice | null {
  const wanted = devices.filter((d) => d.facing === facing || d.facing === 'unknown');
  const pool = wanted.length ? wanted : devices;
  return [...pool].sort((a, b) => b.width - a.width)[0] ?? null;
}

function constraintsFor(facing: Facing, deviceId?: string): MediaStreamConstraints {
  const video: MediaTrackConstraints = {
    width: { ideal: 1280 },
    height: { ideal: 960 },
    aspectRatio: { ideal: 4 / 3 },
    frameRate: { ideal: 30, max: 30 },
  };
  if (deviceId) video.deviceId = { exact: deviceId };
  else video.facingMode = { ideal: facing };
  return { video, audio: false };
}

async function widenIfPossible(track: MediaStreamTrack): Promise<void> {
  try {
    const caps = track.getCapabilities?.() as (MediaTrackCapabilities & { zoom?: { min: number } }) | undefined;
    if (caps?.zoom && typeof caps.zoom.min === 'number') {
      await track.applyConstraints({ advanced: [{ zoom: caps.zoom.min } as MediaTrackConstraintSet] });
    }
  } catch {
    // Zoom is optional everywhere; failing here leaves it where it was.
  }
}

export interface OpenCamera {
  stream: MediaStream;
  deviceId: string | null;
  facing: Facing;
  /** Front cameras are mirrored so movement on screen matches the room. */
  mirrored: boolean;
  label: string;
  size: { width: number; height: number };
}

export type CameraError =
  | { kind: 'denied' }
  | { kind: 'none' }
  | { kind: 'busy' }
  | { kind: 'insecure' }
  | { kind: 'unsupported' }
  | { kind: 'unknown'; detail: string };

/** Browser errors, translated once, here, so no screen has to interpret them. */
export function classifyCameraError(err: unknown): CameraError {
  if (typeof window !== 'undefined' && !window.isSecureContext) return { kind: 'insecure' };
  if (!navigator.mediaDevices?.getUserMedia) return { kind: 'unsupported' };
  const name = err instanceof Error ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return { kind: 'denied' };
    case 'NotFoundError':
    case 'OverconstrainedError':
      return { kind: 'none' };
    case 'NotReadableError':
    case 'AbortError':
      return { kind: 'busy' };
    default:
      return { kind: 'unknown', detail: err instanceof Error ? err.message : String(err) };
  }
}

export const CAMERA_ERROR_COPY: Record<CameraError['kind'], { title: string; detail: string }> = {
  denied: {
    title: 'Camera access is off',
    detail:
      'The visual check needs the camera. Turn it back on in your browser settings for this site — or keep going without it and we will do the preparation and practice instead.',
  },
  none: {
    title: 'No camera found',
    detail: 'We could not find a camera on this device. You can still do the preparation and practice parts.',
  },
  busy: {
    title: 'The camera is in use',
    detail: 'Another app or tab has the camera. Close it, then try again.',
  },
  insecure: {
    title: 'Needs a secure connection',
    detail: 'Browsers only allow camera access over https. Open this site on https or on localhost.',
  },
  unsupported: {
    title: 'This browser cannot open the camera',
    detail: 'Try Safari or Chrome on your phone, which is where this works best anyway.',
  },
  unknown: {
    title: "The camera didn't start",
    detail: 'Something got in the way of opening the camera. Try again, or continue without the visual check.',
  },
};

let current: OpenCamera | null = null;

export function currentCamera(): OpenCamera | null {
  return current;
}

export async function openCamera(facing: Facing = 'user', preferredDeviceId?: string): Promise<OpenCamera> {
  releaseCamera();

  const remembered =
    preferredDeviceId ??
    (() => {
      try {
        return localStorage.getItem(`${STORAGE_KEY}:${facing}`) ?? undefined;
      } catch {
        return undefined;
      }
    })();

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraintsFor(facing, remembered));
  } catch (err) {
    // A remembered device can disappear between sessions; fall back rather
    // than showing a permission error for a stale id.
    if (remembered) stream = await navigator.mediaDevices.getUserMedia(constraintsFor(facing));
    else throw err;
  }

  // Labels only become readable after permission is granted, so the widest
  // lens can only be chosen on a second pass.
  if (!preferredDeviceId) {
    const cameras = await listCameras();
    const best = pickWidest(cameras, facing);
    const activeId = stream.getVideoTracks()[0]?.getSettings?.().deviceId;
    if (best && best.deviceId && best.deviceId !== activeId && best.width > 1) {
      try {
        const wider = await navigator.mediaDevices.getUserMedia(constraintsFor(facing, best.deviceId));
        stream.getTracks().forEach((t) => t.stop());
        stream = wider;
      } catch {
        // Keep the stream that already works.
      }
    }
  }

  const track = stream.getVideoTracks()[0];
  await widenIfPossible(track);

  const settings = track?.getSettings?.() ?? {};
  const label = track?.label ?? '';
  const actualFacing: Facing =
    settings.facingMode === 'environment' || facingOf(label) === 'environment' ? 'environment' : 'user';

  current = {
    stream,
    deviceId: settings.deviceId ?? null,
    facing: actualFacing,
    mirrored: actualFacing === 'user',
    label,
    size: { width: settings.width ?? 0, height: settings.height ?? 0 },
  };

  try {
    if (current.deviceId) localStorage.setItem(`${STORAGE_KEY}:${actualFacing}`, current.deviceId);
  } catch {
    /* storage may be unavailable */
  }

  return current;
}

export function releaseCamera() {
  current?.stream.getTracks().forEach((t) => t.stop());
  current = null;
}

export async function hasMultipleCameras(): Promise<boolean> {
  const cameras = await listCameras();
  return cameras.length > 1;
}
