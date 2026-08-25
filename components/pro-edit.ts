// Professional, per-image photographic editing — client-side, NON-GENERATIVE.
//
// Unlike the earlier global "fade" adjustments, this analyzes each image and
// computes an ADAPTIVE edit (auto levels, auto white balance, exposure,
// highlight/shadow recovery, adaptive contrast, clarity/local-contrast,
// sharpening, vibrance). The user's learned style is layered on top when it
// suits the image, but never at the cost of clipping or an unnatural look.
//
// It only remaps existing pixels' tone/colour and (optionally) crops. It never
// invents, adds, or removes content.

import type { EditStyle } from "@/lib/types";
import { loadImage } from "./edit-engine";

export { loadImage };

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lumaOf = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// ---------- Full parameter set the pro pipeline understands ----------
export interface ProParams {
  // auto levels (input black/white points, 0..1) — expand tonal range
  blackIn: number;
  whiteIn: number;
  // auto white balance channel gains (~1.0)
  wbR: number; wbG: number; wbB: number;
  // tone
  exposure: number; contrast: number; pivot: number; // pivot = luminance the contrast rotates around
  highlights: number; shadows: number; whites: number; blacks: number;
  // colour
  temperature: number; tint: number; saturation: number; vibrance: number;
  // detail
  clarity: number; sharpen: number;
}

export const NEUTRAL_PRO: ProParams = {
  blackIn: 0, whiteIn: 1, wbR: 1, wbG: 1, wbB: 1,
  exposure: 0, contrast: 0, pivot: 0.5, highlights: 0, shadows: 0, whites: 0, blacks: 0,
  temperature: 0, tint: 0, saturation: 0, vibrance: 0, clarity: 0, sharpen: 0,
};

// Manual sliders exposed in the editor (the auto levels/WB stay under the hood).
export const PRO_SLIDERS: { key: keyof ProParams; label: string }[] = [
  { key: "exposure", label: "Exposure" },
  { key: "contrast", label: "Contrast" },
  { key: "highlights", label: "Highlights" },
  { key: "shadows", label: "Shadows" },
  { key: "whites", label: "Whites" },
  { key: "blacks", label: "Blacks" },
  { key: "temperature", label: "Temperature" },
  { key: "tint", label: "Tint" },
  { key: "saturation", label: "Saturation" },
  { key: "vibrance", label: "Vibrance" },
  { key: "clarity", label: "Clarity" },
  { key: "sharpen", label: "Sharpness" },
];

// ---------- Analysis ----------
export interface ProStats {
  meanR: number; meanG: number; meanB: number; meanL: number; stdL: number;
  black: number; white: number; // 0..255 percentile points
  clipLow: number; clipHigh: number; // fraction of pixels clipped
  sharpness: number; // relative detail energy 0..~1
}

export function analyzePro(img: HTMLImageElement, sample = 320): ProStats {
  const scale = Math.min(1, sample / Math.max(img.naturalWidth, img.naturalHeight || 1));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const n = w * h;

  let sr = 0, sg = 0, sb = 0, sl = 0, sl2 = 0, clow = 0, chigh = 0;
  const hist = new Float64Array(256);
  const luma = new Float32Array(n);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const l = lumaOf(r, g, b);
    sr += r; sg += g; sb += b; sl += l; sl2 += l * l;
    luma[p] = l;
    hist[Math.max(0, Math.min(255, Math.round(l)))]++;
    if (l <= 2) clow++;
    if (l >= 253) chigh++;
  }
  const meanL = sl / n;
  const pct = (p: number) => {
    const t = p * n; let acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= t) return v; }
    return 255;
  };
  // sharpness: mean absolute horizontal luma gradient, normalized
  let grad = 0, gc = 0;
  for (let y = 0; y < h; y++) for (let x = 1; x < w; x++) {
    grad += Math.abs(luma[y * w + x] - luma[y * w + x - 1]); gc++;
  }
  return {
    meanR: sr / n, meanG: sg / n, meanB: sb / n, meanL,
    stdL: Math.sqrt(Math.max(0, sl2 / n - meanL * meanL)),
    black: pct(0.004), white: pct(0.996),
    clipLow: clow / n, clipHigh: chigh / n,
    sharpness: Math.min(1, (gc ? grad / gc : 0) / 18),
  };
}

// ---------- Adaptive edit decision ----------
// Produces a natural, professional edit for THIS image, then layers the learned
// style on top (attenuated so it refines rather than dominates).
export function computeEnhance(s: ProStats, style?: EditStyle | null): ProParams {
  const p: ProParams = { ...NEUTRAL_PRO };
  const meanN = s.meanL / 255;
  const stdN = s.stdL / 255;
  const dark = meanN < 0.42;
  const bright = meanN > 0.62;

  // Very gentle auto levels — only trim the extreme tails, keep lots of headroom
  // so nothing looks crushed or blown (aggressive levels read as "over-edited").
  // Skip the black-point lift on dark images so it can't fight the brightening.
  p.blackIn = clamp((s.black - 1) / 255, 0, dark ? 0.015 : 0.035);
  p.whiteIn = clamp((s.white + 1) / 255, 0.9, 1);

  // Auto white balance (gray-world), applied only ~40% so the mood is preserved.
  const grayTarget = (s.meanR + s.meanG + s.meanB) / 3 || 1;
  const gain = (m: number) => clamp(1 + ((grayTarget / (m || 1)) - 1) * 0.4, 0.88, 1.14);
  p.wbR = gain(s.meanR); p.wbG = gain(s.meanG); p.wbB = gain(s.meanB);

  // EXPOSURE leads: bring the image to a pleasing midtone. Dark photos get
  // brightened MORE (fixes "dark image getting darker"); bright ones eased down.
  p.exposure = clamp((0.48 - meanN) * (dark ? 1.35 : 0.7), -0.3, 0.62);

  // Open the SHADOWS (the single biggest "pro" move) — more when dark/clipped.
  p.shadows = clamp(0.12 + s.clipLow * 4 + (dark ? 0.12 : 0), 0, 0.42);
  // Tame HIGHLIGHTS only if actually clipping, or slightly if the image is hot.
  p.highlights = clamp(-s.clipHigh * 5 - (bright ? 0.08 : 0), -0.4, 0);

  // CONTRAST: gentle, and mostly OFF for dark images so it can't crush them.
  // It rotates around the image's own midtone (pivot) so overall brightness holds.
  let c = (0.15 - stdN) * 0.7;
  if (dark) c *= 0.3;
  p.contrast = clamp(c, -0.04, 0.12);
  p.pivot = clamp(meanN, 0.4, 0.52);

  p.whites = 0.03;
  p.blacks = -0.02;

  // DETAIL: subtle. More on soft images, little on already-crisp ones.
  const soft = 1 - s.sharpness;
  p.clarity = clamp(0.05 + 0.07 * soft, 0.03, 0.13);
  p.sharpen = clamp(0.14 + 0.2 * soft, 0.1, 0.34);

  // A touch of vibrance for life (protects already-saturated tones later).
  p.vibrance = 0.12;

  // Layer the learned style — attenuated, and CONTRAST especially gentle so a
  // punchy style can't blow out this image.
  if (style?.adjustments) {
    const a = style.adjustments;
    p.exposure = clamp(p.exposure + a.exposure * 0.5, -0.6, 0.6);
    p.contrast = clamp(p.contrast + a.contrast * 0.3, -0.15, 0.24);
    p.highlights = clamp(p.highlights + a.highlights * 0.45, -0.6, 0.3);
    p.shadows = clamp(p.shadows + a.shadows * 0.45, -0.2, 0.6);
    p.whites = clamp(p.whites + a.whites * 0.3, -0.3, 0.3);
    p.blacks = clamp(p.blacks + a.blacks * 0.3, -0.3, 0.3);
    p.temperature = clamp(p.temperature + a.temperature * 0.5, -0.5, 0.5);
    p.tint = clamp(p.tint + a.tint * 0.5, -0.5, 0.5);
    p.saturation = clamp(p.saturation + a.saturation * 0.45, -0.4, 0.5);
    p.vibrance = clamp(p.vibrance + a.vibrance * 0.45, -0.3, 0.5);
  }
  return p;
}

// ---------- Separable box blur on a single channel (fast local contrast) ----------
function boxBlur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  if (radius < 1) return src.slice();
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const win = radius * 2 + 1;
  // horizontal
  for (let y = 0; y < h; y++) {
    let acc = 0; const row = y * w;
    for (let x = -radius; x <= radius; x++) acc += src[row + Math.max(0, Math.min(w - 1, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / win;
      const add = row + Math.min(w - 1, x + radius + 1);
      const sub = row + Math.max(0, x - radius);
      acc += src[add] - src[sub];
    }
  }
  // vertical
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -radius; y <= radius; y++) acc += tmp[Math.max(0, Math.min(h - 1, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / win;
      const add = Math.min(h - 1, y + radius + 1) * w + x;
      const sub = Math.max(0, y - radius) * w + x;
      acc += tmp[add] - tmp[sub];
    }
  }
  return out;
}

// ---------- Render ----------
export function renderPro(img: HTMLImageElement, p: ProParams, maxDim = Infinity): HTMLCanvasElement {
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight || 1));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;
  const n = w * h;

  const expF = Math.pow(2, p.exposure * 0.6);
  const range = Math.max(0.4, p.whiteIn - p.blackIn);
  const pivot = p.pivot ?? 0.5;
  const cAmt = p.contrast;
  // Midtone-weighted contrast: strongest near the pivot, ~0 at the extremes, so
  // it shapes midtones without crushing shadows or blowing highlights.
  const applyC = (v: number) => {
    if (cAmt === 0) return v;
    const x = v - pivot;
    const wgt = 1 - Math.min(1, Math.abs(x) / 0.55);
    return clamp01(v + x * cAmt * 1.15 * wgt);
  };

  // Pass 1: tone + colour → RGB, and capture resulting luma for detail pass.
  const luma = new Float32Array(n);
  for (let i = 0, pi = 0; i < d.length; i += 4, pi++) {
    let r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    // white balance
    r *= p.wbR; g *= p.wbG; b *= p.wbB;
    // gentle levels
    r = (r - p.blackIn) / range; g = (g - p.blackIn) / range; b = (b - p.blackIn) / range;
    // exposure
    r *= expF; g *= expF; b *= expF;
    r = clamp01(r); g = clamp01(g); b = clamp01(b);
    // tone regions — lift shadows / recover highlights
    let l = lumaOf(r, g, b);
    const sw = clamp01(1 - l / 0.5), hw = clamp01((l - 0.5) / 0.5);
    const bw = clamp01(1 - l / 0.2), ww = clamp01((l - 0.8) / 0.2);
    const lift = p.shadows * 0.22 * sw + p.highlights * 0.22 * hw + p.blacks * 0.1 * bw + p.whites * 0.1 * ww;
    r = clamp01(r + lift); g = clamp01(g + lift); b = clamp01(b + lift);
    // gentle midtone contrast (never crushes darks)
    r = applyC(r); g = applyC(g); b = applyC(b);
    // temperature / tint
    r = clamp01(r + p.temperature * 0.08); b = clamp01(b - p.temperature * 0.08); g = clamp01(g - p.tint * 0.07);
    // saturation + vibrance (vibrance protects already-saturated pixels)
    l = clamp01(lumaOf(r, g, b));
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    const satF = 1 + p.saturation * 0.7 + p.vibrance * 0.7 * (1 - sat);
    r = clamp01(l + (r - l) * satF); g = clamp01(l + (g - l) * satF); b = clamp01(l + (b - l) * satF);

    d[i] = r * 255; d[i + 1] = g * 255; d[i + 2] = b * 255;
    luma[pi] = lumaOf(r, g, b); // 0..1
  }

  // Pass 2: detail — ADDITIVE unsharp (adds local contrast/detail symmetrically,
  // so it never globally darkens the image the way a multiply ratio would).
  if (p.clarity > 0.001 || p.sharpen > 0.001) {
    const rBig = Math.max(2, Math.round(Math.min(w, h) / 60));
    const rSmall = Math.max(1, Math.round(Math.min(w, h) / 900));
    const blurBig = p.clarity > 0.001 ? boxBlur(luma, w, h, rBig) : null;
    const blurSmall = p.sharpen > 0.001 ? boxBlur(luma, w, h, rSmall) : null;
    for (let i = 0, pi = 0; i < d.length; i += 4, pi++) {
      let delta = 0;
      if (blurBig) delta += p.clarity * 0.7 * (luma[pi] - blurBig[pi]);
      if (blurSmall) delta += p.sharpen * 0.9 * (luma[pi] - blurSmall[pi]);
      if (delta === 0) continue;
      d[i] = clamp01(d[i] / 255 + delta) * 255;
      d[i + 1] = clamp01(d[i + 1] / 255 + delta) * 255;
      d[i + 2] = clamp01(d[i + 2] / 255 + delta) * 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

// ---------- Subject-aware crop suggestion ----------
// Detects the in-focus SUBJECT (the sharp region against a softer background —
// exactly how wildlife/portrait shots are composed) via a smoothed focus map,
// then frames it with breathing room and rule-of-thirds. Returns a crop rect in
// original px, or null when the subject already fills the frame.
export function suggestCrop(img: HTMLImageElement, sample = 256):
  { x: number; y: number; w: number; h: number } | null {
  const W = img.naturalWidth, H = img.naturalHeight;
  if (!W || !H) return null;
  const scale = Math.min(1, sample / Math.max(W, H));
  const w = Math.max(16, Math.round(W * scale));
  const h = Math.max(16, Math.round(H * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;

  // Focus map: local gradient magnitude = detail/sharpness. The subject is sharp;
  // a blurred background scores low, so this localizes the subject.
  const focus = new Float32Array(w * h);
  const L = (x: number, y: number) => { const i = (y * w + x) * 4; return lumaOf(d[i], d[i + 1], d[i + 2]); };
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const gx = L(x + 1, y) - L(x - 1, y);
    const gy = L(x, y + 1) - L(x, y - 1);
    focus[y * w + x] = Math.abs(gx) + Math.abs(gy);
  }
  // Smooth into regions so a single busy area (the subject) dominates.
  const sm = boxBlur(focus, w, h, Math.max(2, Math.round(Math.min(w, h) / 26)));

  const colW = new Float32Array(w), rowW = new Float32Array(h);
  let total = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = sm[y * w + x]; colW[x] += v; rowW[y] += v; total += v;
  }
  if (total <= 0) return null;

  // Weighted percentile positions bounding the central mass of subject focus.
  const bounds = (prof: Float32Array, len: number, loP: number, hiP: number): [number, number] => {
    let sum = 0; for (let i = 0; i < len; i++) sum += prof[i];
    let acc = 0, lo = 0, hi = len - 1; const loT = sum * loP, hiT = sum * hiP;
    for (let i = 0; i < len; i++) { acc += prof[i]; if (acc >= loT) { lo = i; break; } }
    acc = 0; for (let i = 0; i < len; i++) { acc += prof[i]; if (acc >= hiT) { hi = i; break; } }
    return [lo, Math.max(lo + 1, hi)];
  };
  let [x0, x1] = bounds(colW, w, 0.1, 0.9);
  let [y0, y1] = bounds(rowW, h, 0.1, 0.9);

  // normalize + breathing room around the subject
  let nx0 = x0 / w, nx1 = x1 / w, ny0 = y0 / h, ny1 = y1 / h;
  const padX = (nx1 - nx0) * 0.28 + 0.04, padY = (ny1 - ny0) * 0.28 + 0.04;
  nx0 = Math.max(0, nx0 - padX); nx1 = Math.min(1, nx1 + padX);
  ny0 = Math.max(0, ny0 - padY); ny1 = Math.min(1, ny1 + padY);

  // don't crop too tight — keep at least 55% of each dimension
  const ensureMin = (a: number, b: number, min: number): [number, number] => {
    if (b - a >= min) return [a, b];
    const mid = (a + b) / 2; let na = mid - min / 2, nb = mid + min / 2;
    if (na < 0) { nb -= na; na = 0; } if (nb > 1) { na -= nb - 1; nb = 1; }
    return [Math.max(0, na), Math.min(1, nb)];
  };
  [nx0, nx1] = ensureMin(nx0, nx1, 0.55);
  [ny0, ny1] = ensureMin(ny0, ny1, 0.55);

  const cw = nx1 - nx0, ch = ny1 - ny0;
  // If the subject already fills the frame, no crop is worth it.
  if (cw > 0.9 && ch > 0.9) return null;
  // Guard against a degenerate/near-full crop.
  if (cw * ch > 0.86) return null;

  return {
    x: Math.round(nx0 * W), y: Math.round(ny0 * H),
    w: Math.round(cw * W), h: Math.round(ch * H),
  };
}

export function cropCanvas(source: HTMLCanvasElement, rect: { x: number; y: number; w: number; h: number }): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = Math.max(1, rect.w); out.height = Math.max(1, rect.h);
  out.getContext("2d")!.drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  return out;
}

// ---------- Perceptual hash (duplicate detection) ----------
// dHash: 9x8 grayscale, compare adjacent columns → 64-bit hex string.
export function dHash(img: HTMLImageElement): string {
  const w = 9, h = 8;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  let bits = "";
  for (let y = 0; y < h; y++) for (let x = 0; x < w - 1; x++) {
    const i = (y * w + x) * 4, j = (y * w + x + 1) * 4;
    bits += lumaOf(d[i], d[i + 1], d[i + 2]) > lumaOf(d[j], d[j + 1], d[j + 2]) ? "1" : "0";
  }
  let hex = "";
  for (let k = 0; k < 64; k += 4) hex += parseInt(bits.slice(k, k + 4), 2).toString(16);
  return hex;
}

export function hamming(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { dist += x & 1; x >>= 1; }
  }
  return dist;
}

// Assign a duplicate-group index to each hash (same index = looks identical).
// threshold ~5 tolerates re-encoding; 0 means exact.
export function groupDuplicates(hashes: string[], threshold = 6): number[] {
  const group = new Array(hashes.length).fill(-1);
  let next = 0;
  for (let i = 0; i < hashes.length; i++) {
    if (group[i] !== -1) continue;
    let assigned = -1;
    for (let j = 0; j < i; j++) {
      if (group[j] !== -1 && hamming(hashes[i], hashes[j]) <= threshold) { assigned = group[j]; break; }
    }
    group[i] = assigned !== -1 ? assigned : next++;
  }
  // Mark singletons as -1 (not a duplicate); only groups with >1 member count.
  const counts: Record<number, number> = {};
  group.forEach((g) => (counts[g] = (counts[g] || 0) + 1));
  return group.map((g) => (counts[g] > 1 ? g : -1));
}

export function canvasToBlob(canvas: HTMLCanvasElement, quality = 0.95): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", quality));
}
