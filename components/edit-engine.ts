// Client-side photographic editing engine.
//
// Two jobs:
//   1. LEARN a personal style by measuring the real differences between
//      before/after pairs (exposure, contrast, colour balance, saturation,
//      tone regions) and distilling them into normalized -1..1 adjustments.
//   2. APPLY those adjustments (or manual ones) to a new photo via standard
//      per-pixel photographic operations.
//
// It is deliberately NON-GENERATIVE: it only remaps existing pixels' tone and
// colour. It never adds, removes, or invents any content.

import type { EditAdjustments } from "@/lib/types";

export type { EditAdjustments };

export const ADJ_KEYS: (keyof EditAdjustments)[] = [
  "exposure", "contrast", "temperature", "tint", "saturation",
  "vibrance", "highlights", "shadows", "whites", "blacks",
];

export const ZERO_ADJUST: EditAdjustments = {
  exposure: 0, contrast: 0, temperature: 0, tint: 0, saturation: 0,
  vibrance: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
};

const clamp = (v: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---- image loading ----

export function loadImage(src: File | Blob | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = typeof src === "string" ? src : URL.createObjectURL(src);
    const img = new Image();
    if (typeof src === "string") img.crossOrigin = "anonymous";
    img.onload = () => {
      if (typeof src !== "string") URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      if (typeof src !== "string") URL.revokeObjectURL(url);
      reject(new Error("Could not load image"));
    };
    img.src = url;
  });
}

// ---- statistics ----

export interface ImageStats {
  meanR: number; meanG: number; meanB: number;
  meanL: number; // mean luma 0..255
  stdL: number; // luma spread (contrast proxy)
  meanS: number; // mean saturation 0..1
  black: number; // ~2nd percentile luma
  white: number; // ~98th percentile luma
  shadowMean: number; // mean luma of dark pixels (<85)
  highlightMean: number; // mean luma of bright pixels (>170)
}

const lumaOf = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// Downscale to a small canvas and measure. Small sample = fast + robust.
export function analyzeStats(img: HTMLImageElement, sample = 240): ImageStats {
  const scale = Math.min(1, sample / Math.max(img.naturalWidth, img.naturalHeight || 1));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const n = w * h;

  let sumR = 0, sumG = 0, sumB = 0, sumL = 0, sumL2 = 0, sumS = 0;
  let shSum = 0, shCount = 0, hiSum = 0, hiCount = 0;
  const hist = new Float64Array(256);

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const l = lumaOf(r, g, b);
    sumR += r; sumG += g; sumB += b; sumL += l; sumL2 += l * l;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    sumS += max === 0 ? 0 : (max - min) / max;
    hist[Math.max(0, Math.min(255, Math.round(l)))]++;
    if (l < 85) { shSum += l; shCount++; }
    if (l > 170) { hiSum += l; hiCount++; }
  }

  const meanL = sumL / n;
  const varL = Math.max(0, sumL2 / n - meanL * meanL);

  // percentiles from the histogram
  const pct = (p: number) => {
    const target = p * n;
    let acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= target) return v; }
    return 255;
  };

  return {
    meanR: sumR / n, meanG: sumG / n, meanB: sumB / n,
    meanL, stdL: Math.sqrt(varL), meanS: sumS / n,
    black: pct(0.02), white: pct(0.98),
    shadowMean: shCount ? shSum / shCount : meanL,
    highlightMean: hiCount ? hiSum / hiCount : meanL,
  };
}

// ---- learning ----

// Derive the adjustments that turn `before` into `after`, as normalized knobs.
// Each pair contributes one estimate; the caller averages across pairs.
export function deriveAdjustments(before: ImageStats, after: ImageStats): EditAdjustments {
  const dL = after.meanL - before.meanL; // overall brightness change
  const rmB = after.meanR - after.meanB;
  const rmBbefore = before.meanR - before.meanB;
  const gDevA = after.meanG - (after.meanR + after.meanB) / 2;
  const gDevB = before.meanG - (before.meanR + before.meanB) / 2;

  return {
    exposure: clamp(dL / 80),
    contrast: clamp((after.stdL / (before.stdL || 1) - 1) * 1.6),
    temperature: clamp((rmB - rmBbefore) / 55),
    // positive tint == magenta == LESS green
    tint: clamp(-(gDevA - gDevB) / 55),
    saturation: clamp((after.meanS / (before.meanS || 0.001) - 1) * 1.1),
    vibrance: 0, // kept for manual control; learning folds into saturation
    // highlight/shadow moves *beyond* the overall exposure shift
    highlights: clamp(((after.highlightMean - before.highlightMean) - dL) / 55),
    shadows: clamp(((after.shadowMean - before.shadowMean) - dL) / 55),
    whites: clamp((after.white - before.white) / 55),
    blacks: clamp((after.black - before.black) / 55),
  };
}

// Average per-pair adjustments and gently damp toward "subtle & realistic".
export function averageAdjustments(list: EditAdjustments[]): EditAdjustments {
  if (!list.length) return { ...ZERO_ADJUST };
  const out = { ...ZERO_ADJUST };
  for (const a of list) for (const k of ADJ_KEYS) out[k] += a[k];
  for (const k of ADJ_KEYS) out[k] = clamp((out[k] / list.length) * 0.92, -0.85, 0.85);
  return out;
}

export function describeStyle(a: EditAdjustments): string {
  const bits: string[] = [];
  const push = (v: number, pos: string, neg: string, t = 0.06) => {
    if (v > t) bits.push(pos); else if (v < -t) bits.push(neg);
  };
  push(a.exposure, "brighter", "darker", 0.05);
  push(a.contrast, "punchier contrast", "softer contrast");
  push(a.temperature, "warmer", "cooler", 0.05);
  push(a.tint, "magenta lean", "green lean", 0.08);
  push(a.saturation, "richer colour", "muted colour");
  push(a.shadows, "lifted shadows", "deeper shadows");
  push(a.highlights, "lifted highlights", "recovered highlights");
  if (!bits.length) return "A subtle, natural clean-up.";
  return bits.slice(0, 4).join(", ").replace(/^./, (c) => c.toUpperCase()) + ".";
}

// ---- applying ----

// Region weights for tone-targeted moves. v is 0..1 luma.
const shadowWeight = (v: number) => clamp01(1 - v / 0.5);
const highlightWeight = (v: number) => clamp01((v - 0.5) / 0.5);
const blackWeight = (v: number) => clamp01(1 - v / 0.18);
const whiteWeight = (v: number) => clamp01((v - 0.82) / 0.18);

// Render the image with adjustments applied. `maxDim` downsizes for fast live
// previews; pass Infinity (default) to keep full resolution for export/save.
export function renderAdjusted(
  img: HTMLImageElement,
  adj: EditAdjustments,
  maxDim = Infinity,
): HTMLCanvasElement {
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight || 1));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);

  const expF = Math.pow(2, adj.exposure * 0.7);
  const contrastF = 1 + adj.contrast * 0.55;
  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;

  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;

    // 1) exposure
    r *= expF; g *= expF; b *= expF;

    // 2) tone regions (shadows/highlights/blacks/whites)
    let l = lumaOf(r * 255, g * 255, b * 255) / 255;
    const sw = shadowWeight(l), hw = highlightWeight(l), bw = blackWeight(l), ww = whiteWeight(l);
    const lift =
      adj.shadows * 0.18 * sw +
      adj.highlights * 0.18 * hw +
      adj.blacks * 0.12 * bw +
      adj.whites * 0.12 * ww;
    r += lift; g += lift; b += lift;

    // 3) contrast around mid grey
    r = 0.5 + (r - 0.5) * contrastF;
    g = 0.5 + (g - 0.5) * contrastF;
    b = 0.5 + (b - 0.5) * contrastF;

    // 4) white balance: temperature (warm=+R,-B), tint (magenta=-G)
    r += adj.temperature * 0.10;
    b -= adj.temperature * 0.10;
    g -= adj.tint * 0.09;

    r = clamp01(r); g = clamp01(g); b = clamp01(b);

    // 5) saturation + vibrance (vibrance weighted toward muted pixels)
    l = clamp01(lumaOf(r * 255, g * 255, b * 255) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const curSat = max === 0 ? 0 : (max - min) / max;
    const satF = 1 + adj.saturation * 0.8 + adj.vibrance * 0.8 * (1 - curSat);
    r = clamp01(l + (r - l) * satF);
    g = clamp01(l + (g - l) * satF);
    b = clamp01(l + (b - l) * satF);

    d[i] = Math.round(r * 255);
    d[i + 1] = Math.round(g * 255);
    d[i + 2] = Math.round(b * 255);
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, quality = 0.95): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", quality));
}

const isZero = (a: EditAdjustments) => ADJ_KEYS.every((k) => Math.abs(a[k]) < 0.005);
export { isZero };
