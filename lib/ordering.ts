import type { MediaItem, MediaAnalysis } from "./types";

// Sequence optimizer: order posts so the feed looks intentional and varied.
// Greedy — each next item is the remaining one least similar to what was
// just placed, with a nudge toward photo/video balance.

interface Analyzed {
  item: MediaItem;
  a: MediaAnalysis;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

function penalty(prev: Analyzed, cand: Analyzed): number {
  let p = 0;
  if (prev.a.similarityGroup === cand.a.similarityGroup) p += 6;
  if (prev.a.category === cand.a.category) p += 2.5;
  if (prev.item.type === cand.item.type) p += 1.2; // avoid long photo/video runs
  // Color similarity (closer colors => higher penalty). Colors may be absent
  // if an AI response omitted them, so guard the read.
  const c1 = prev.a.colors?.[0];
  const c2 = cand.a.colors?.[0];
  if (c1 && c2) {
    const d = colorDistance(c1, c2); // 0..441
    p += Math.max(0, 1.5 - d / 200);
  }
  return p;
}

export function optimizeOrder(
  analyzed: Analyzed[],
): string[] {
  if (analyzed.length <= 2) return analyzed.map((x) => x.item.id);

  const remaining = [...analyzed];
  // Start with a photo if available (photos tend to anchor a grid well).
  let startIdx = remaining.findIndex((x) => x.item.type === "photo");
  if (startIdx < 0) startIdx = 0;
  const result: Analyzed[] = [remaining.splice(startIdx, 1)[0]];

  let photoCount = result[0].item.type === "photo" ? 1 : 0;
  let videoCount = result[0].item.type === "video" ? 1 : 0;

  while (remaining.length) {
    const prev = result[result.length - 1];
    let best = 0;
    let bestScore = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      let score = penalty(prev, cand);
      // Look back two to avoid ABA color/category patterns.
      if (result.length >= 2) score += penalty(result[result.length - 2], cand) * 0.4;
      // Balance nudge: prefer the under-represented media type.
      if (cand.item.type === "photo" && photoCount > videoCount) score += 0.6;
      if (cand.item.type === "video" && videoCount > photoCount) score += 0.6;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    const chosen = remaining.splice(best, 1)[0];
    if (chosen.item.type === "photo") photoCount++;
    else videoCount++;
    result.push(chosen);
  }

  return result.map((x) => x.item.id);
}
