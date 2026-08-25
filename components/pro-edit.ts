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
  exposure: number; contrast: number;
  highlights: number; shadows: number; whites: number; blacks: number;
  // colour
  temperature: number; tint: number; saturation: number; vibrance: number;
  // detail
  clarity: number; sharpen: number;
}

export const NEUTRAL_PRO: ProParams = {
  blackIn: 0, whiteIn: 1, wbR: 1, wbG: 1, wbB: 1,
  exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
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

  // Auto levels: pull the black/white input points to the image's real range,
  // but leave a little headroom so it never looks crushed/blown.
  p.blackIn = clamp((s.black - 4) / 255, 0, 0.16);
  p.whiteIn = clamp((s.white + 4) / 255, 0.82, 1);

  // Auto white balance (gray-world), applied only ~55% so mood is preserved.
  const grayTarget = (s.meanR + s.meanG + s.meanB) / 3 || 1;
  const gain = (m: number) => clamp(1 + ((grayTarget / (m || 1)) - 1) * 0.55, 0.82, 1.22);
  p.wbR = gain(s.meanR); p.wbG = gain(s.meanG); p.wbB = gain(s.meanB);

  const meanN = s.meanL / 255;
  const stdN = s.stdL / 255;

  // Exposure toward a pleasing midtone, gently.
  p.exposure = clamp((0.47 - meanN) * 0.7, -0.35, 0.35);
  // Contrast: boost flat images, ease already-punchy ones.
  p.contrast = clamp((0.17 - stdN) * 1.9, -0.12, 0.42);
  // Recover blown highlights / lift blocked shadows based on real clipping.
  p.highlights = clamp(-s.clipHigh * 6 - 0.06, -0.6, 0);
  p.shadows = clamp(s.clipLow * 6 + 0.08, 0, 0.55);
  p.whites = 0.05;
  p.blacks = -0.04;
  // Detail: clarity + sharpening scaled down when the image is already crisp.
  const crispRoom = 1 - s.sharpness;
  p.clarity = clamp(0.1 + 0.12 * crispRoom, 0.06, 0.24);
  p.sharpen = clamp(0.18 + 0.28 * crispRoom, 0.12, 0.5);
  // A little vibrance for life, protecting skin/already-saturated tones later.
  p.vibrance = 0.14;

  // Layer the learned style (attenuated). Auto handles per-image correctness;
  // the style adds the owner's consistent taste.
  if (style?.adjustments) {
    const a = style.adjustments, wgt = 0.7;
    p.exposure = clamp(p.exposure + a.exposure * wgt, -0.6, 0.6);
    p.contrast = clamp(p.contrast + a.contrast * wgt, -0.5, 0.6);
    p.highlights = clamp(p.highlights + a.highlights * wgt, -0.8, 0.4);
    p.shadows = clamp(p.shadows + a.shadows * wgt, -0.4, 0.8);
    p.whites = clamp(p.whites + a.whites * wgt, -0.5, 0.5);
    p.blacks = clamp(p.blacks + a.blacks * wgt, -0.5, 0.5);
    p.temperature = clamp(p.temperature + a.temperature * wgt, -0.6, 0.6);
    p.tint = clamp(p.tint + a.tint * wgt, -0.6, 0.6);
    p.saturation = clamp(p.saturation + a.saturation * wgt, -0.6, 0.6);
    p.vibrance = clamp(p.vibrance + a.vibrance * wgt, -0.4, 0.6);
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

  const expF = Math.pow(2, p.exposure * 0.7);
  const contrastF = 1 + p.contrast * 0.6;
  const range = Math.max(0.15, p.whiteIn - p.blackIn);

  // Pass 1: tone + colour → RGB, and capture resulting luma for detail pass.
  const luma = new Float32Array(n);
  for (let i = 0, pi = 0; i < d.length; i += 4, pi++) {
    let r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    // white balance
    r *= p.wbR; g *= p.wbG; b *= p.wbB;
    // levels (expand tonal range)
    r = (r - p.blackIn) / range; g = (g - p.blackIn) / range; b = (b - p.blackIn) / range;
    // exposure
    r *= expF; g *= expF; b *= expF;
    // tone regions
    let l = clamp01(lumaOf(r, g, b));
    const sw = clamp01(1 - l / 0.5), hw = clamp01((l - 0.5) / 0.5);
    const bw = clamp01(1 - l / 0.18), ww = clamp01((l - 0.82) / 0.18);
    const lift = p.shadows * 0.18 * sw + p.highlights * 0.18 * hw + p.blacks * 0.12 * bw + p.whites * 0.12 * ww;
    r += lift; g += lift; b += lift;
    // contrast around mid
    r = 0.5 + (r - 0.5) * contrastF; g = 0.5 + (g - 0.5) * contrastF; b = 0.5 + (b - 0.5) * contrastF;
    // temperature / tint
    r += p.temperature * 0.10; b -= p.temperature * 0.10; g -= p.tint * 0.09;
    r = clamp01(r); g = clamp01(g); b = clamp01(b);
    // saturation + vibrance (vibrance protects already-saturated pixels)
    l = clamp01(lumaOf(r, g, b));
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    const satF = 1 + p.saturation * 0.8 + p.vibrance * 0.85 * (1 - sat);
    r = clamp01(l + (r - l) * satF); g = clamp01(l + (g - l) * satF); b = clamp01(l + (b - l) * satF);

    d[i] = r * 255; d[i + 1] = g * 255; d[i + 2] = b * 255;
    luma[pi] = lumaOf(r, g, b); // 0..1
  }

  // Pass 2: detail — clarity (large-radius local contrast) + sharpen (fine).
  if (p.clarity > 0.001 || p.sharpen > 0.001) {
    const rBig = Math.max(2, Math.round(Math.min(w, h) / 55));
    const rSmall = Math.max(1, Math.round(Math.min(w, h) / 900));
    const blurBig = p.clarity > 0.001 ? boxBlur(luma, w, h, rBig) : null;
    const blurSmall = p.sharpen > 0.001 ? boxBlur(luma, w, h, rSmall) : null;
    for (let i = 0, pi = 0; i < d.length; i += 4, pi++) {
      const lo = luma[pi] || 0.0001;
      let target = lo;
      if (blurBig) target += p.clarity * 0.9 * (lo - blurBig[pi]);
      if (blurSmall) target += p.sharpen * 1.1 * (lo - blurSmall[pi]);
      const ratio = clamp(target / lo, 0.5, 1.8);
      d[i] = clamp01((d[i] / 255) * ratio) * 255;
      d[i + 1] = clamp01((d[i + 1] / 255) * ratio) * 255;
      d[i + 2] = clamp01((d[i + 2] / 255) * ratio) * 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

// ---------- Saliency-based crop suggestion ----------
// Returns a crop rect (in original px) that trims dead space toward the busiest
// region, or null when the framing is already tight. Never crops aggressively.
export function suggestCrop(img: HTMLImageElement, sample = 200):
  { x: number; y: number; w: number; h: number } | null {
  const W = img.naturalWidth, H = img.naturalHeight;
  if (!W || !H) return null;
  const scale = Math.min(1, sample / Math.max(W, H));
  const w = Math.max(8, Math.round(W * scale));
  const h = Math.max(8, Math.round(H * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;

  // saliency = gradient magnitude per pixel
  const sal = new Float32Array(w * h);
  const L = (x: number, y: number) => {
    const i = (y * w + x) * 4; return lumaOf(d[i], d[i + 1], d[i + 2]);
  };
  let total = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const gx = L(x + 1, y) - L(x - 1, y);
    const gy = L(x, y + 1) - L(x, y - 1);
    const m = Math.abs(gx) + Math.abs(gy);
    sal[y * w + x] = m; total += m;
  }
  if (total <= 0) return null;

  // column/row saliency profiles → trim low-energy borders (keep >=90% energy)
  const colE = new Float32Array(w), rowE = new Float32Array(h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = sal[y * w + x]; colE[x] += v; rowE[y] += v;
  }
  const trim = (energy: Float32Array, len: number, keep: number) => {
    let sum = 0; for (let i = 0; i < len; i++) sum += energy[i];
    const drop = sum * (1 - keep);
    let lo = 0, hi = len - 1, dl = 0, dh = 0;
    while (lo < hi) {
      if (energy[lo] <= energy[hi]) { if (dl + energy[lo] > drop / 2) break; dl += energy[lo]; lo++; }
      else { if (dh + energy[hi] > drop / 2) break; dh += energy[hi]; hi--; }
    }
    return [lo, hi] as [number, number];
  };
  const [x0, x1] = trim(colE, w, 0.92);
  const [y0, y1] = trim(rowE, h, 0.92);

  const cropW = (x1 - x0 + 1) / w, cropH = (y1 - y0 + 1) / h;
  // Only suggest when it removes a meaningful border (>8% on some side).
  if (cropW > 0.9 && cropH > 0.9) return null;
  return {
    x: Math.round((x0 / w) * W),
    y: Math.round((y0 / h) * H),
    w: Math.round(cropW * W),
    h: Math.round(cropH * H),
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
