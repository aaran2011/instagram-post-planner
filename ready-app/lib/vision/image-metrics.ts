/**
 * Light and background, measured rather than guessed.
 *
 * A vision model asked "is this well lit?" will happily answer "yes, slightly
 * warm" about a frame it has no real opinion on. Luma arithmetic will not: it
 * either is backlit or it is not. So everything on this page — brightness,
 * backlight, side-lighting, colour cast, clipping, how busy the room is — comes
 * from the pixels on the device, costs nothing, leaks nothing, and is available
 * before the network is even touched.
 *
 * Runs on a downscaled frame (160px wide is plenty), so it is a fraction of a
 * millisecond and can be called on every sampled frame.
 */

import type { ImageMetrics } from '../engine/types';

export interface Pixels {
  data: Uint8ClampedArray | number[];
  width: number;
  height: number;
}

/** Normalised box, 0–1, in frame coordinates. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const luma = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

function toPx(box: Box, width: number, height: number) {
  return {
    x0: Math.max(0, Math.floor(box.x0 * width)),
    y0: Math.max(0, Math.floor(box.y0 * height)),
    x1: Math.min(width, Math.ceil(box.x1 * width)),
    y1: Math.min(height, Math.ceil(box.y1 * height)),
  };
}

function inBox(x: number, y: number, b: { x0: number; y0: number; x1: number; y1: number }) {
  return x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1;
}

export function measureImage(px: Pixels, face?: Box | null, person?: Box | null): ImageMetrics {
  const { data, width, height } = px;
  const lumaMap = new Float32Array(width * height);

  let sum = 0;
  let sumSq = 0;
  let clipped = 0;
  let warmth = 0;

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const l = luma(data[i], data[i + 1], data[i + 2]);
    lumaMap[p] = l;
    sum += l;
    sumSq += l * l;
    if (l > 0.97) clipped += 1;
    warmth += (data[i] - data[i + 2]) / 255;
  }

  const n = width * height || 1;
  const brightness = sum / n;
  const contrast = Math.sqrt(Math.max(0, sumSq / n - brightness * brightness));

  const faceBox = face ? toPx(face, width, height) : null;
  const personBox = person ? toPx(person, width, height) : null;

  let faceSum = 0;
  let faceCount = 0;
  let leftSum = 0;
  let leftCount = 0;
  let rightSum = 0;
  let rightCount = 0;
  if (faceBox) {
    const midX = (faceBox.x0 + faceBox.x1) / 2;
    for (let y = faceBox.y0; y < faceBox.y1; y += 1) {
      for (let x = faceBox.x0; x < faceBox.x1; x += 1) {
        const l = lumaMap[y * width + x];
        faceSum += l;
        faceCount += 1;
        if (x < midX) {
          leftSum += l;
          leftCount += 1;
        } else {
          rightSum += l;
          rightCount += 1;
        }
      }
    }
  }

  // "Background" is everything outside the person, so a bright window behind a
  // correctly exposed face reads as backlight rather than as a bright room.
  let bgSum = 0;
  let bgCount = 0;
  let edges = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      if (personBox && inBox(x, y, personBox)) continue;
      const p = y * width + x;
      bgSum += lumaMap[p];
      bgCount += 1;
      // Cheap gradient magnitude — enough to tell a blank wall from a bookshelf.
      const gx = lumaMap[p + 1] - lumaMap[p - 1];
      const gy = lumaMap[p + width] - lumaMap[p - width];
      if (Math.abs(gx) + Math.abs(gy) > 0.16) edges += 1;
    }
  }

  const faceBrightness = faceCount ? faceSum / faceCount : null;
  const bgBrightness = bgCount ? bgSum / bgCount : null;

  return {
    brightness: round(brightness),
    faceBrightness: faceBrightness === null ? null : round(faceBrightness),
    faceVsBackground: faceBrightness !== null && bgBrightness !== null ? round(faceBrightness - bgBrightness) : null,
    faceSideDelta:
      leftCount && rightCount ? round(Math.abs(leftSum / leftCount - rightSum / rightCount)) : null,
    colorTemp: round(warmth / n),
    clipped: round(clipped / n),
    backgroundBusyness: bgCount ? round(edges / bgCount) : 0,
    contrast: round(contrast),
  };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Face and body boxes derived from pose landmarks, padded to real coverage. */
export function boxesFromLandmarks(landmarks: { x: number; y: number; visibility?: number }[]): {
  face: Box | null;
  person: Box | null;
} {
  const visible = landmarks.filter((l) => (l.visibility ?? 1) >= 0.5);
  if (!visible.length) return { face: null, person: null };

  const xs = visible.map((l) => l.x);
  const ys = visible.map((l) => l.y);
  const person: Box = {
    x0: clamp01(Math.min(...xs) - 0.04),
    y0: clamp01(Math.min(...ys) - 0.06),
    x1: clamp01(Math.max(...xs) + 0.04),
    y1: clamp01(Math.max(...ys) + 0.04),
  };

  // Landmarks 0–10 are the face. Padded outwards because the model marks
  // features, not the outline of a head.
  const facePoints = landmarks.slice(0, 11).filter((l) => (l.visibility ?? 1) >= 0.5);
  if (facePoints.length < 3) return { face: null, person };
  const fxs = facePoints.map((l) => l.x);
  const fys = facePoints.map((l) => l.y);
  const w = Math.max(...fxs) - Math.min(...fxs);
  const h = Math.max(...fys) - Math.min(...fys);
  const face: Box = {
    x0: clamp01(Math.min(...fxs) - w * 0.15),
    y0: clamp01(Math.min(...fys) - h * 0.6),
    x1: clamp01(Math.max(...fxs) + w * 0.15),
    y1: clamp01(Math.max(...fys) + h * 0.9),
  };
  return { face, person };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
