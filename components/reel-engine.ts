// Client-side reel assembly. Builds an editable STORYBOARD (an edit plan) from
// the user's own uploaded media using patterns learned from their best reels.
// It never renders new pixels or invents content — it only sequences, times and
// annotates the user's real clips/photos.

import type { ClientMedia } from "./store";

export type Transition = "cut" | "dissolve" | "slide" | "whip";

export interface Clip {
  id: string;
  mediaId: string;
  type: "photo" | "video";
  url: string;
  thumbUrl: string;
  duration: number; // seconds shown in the reel
  transition: Transition; // transition INTO this clip
  text: string; // on-screen text overlay
  speed: number; // playback speed for videos (1 = normal)
}

export interface Storyboard {
  clips: Clip[];
  music: string;
  aspect: "9:16";
  targetHeight: 3840; // documents the intended 2160×3840 export target
}

export interface ReelPatterns {
  bestHour: number | null;
  bestDay: string | null;
  avgCaptionLength: number;
  topHashtags: string[];
  sampleSize: number;
}

const uid = () => Math.random().toString(36).slice(2, 10);

// Score media strength for auto-selection. Videos anchor a reel; sharp,
// well-analyzed, correctly-oriented media rank higher. Purely heuristic.
function score(m: ClientMedia): number {
  let s = 0;
  if (m.type === "video") s += 5;
  if (m.analysis) s += 2;
  const ar = m.width && m.height ? m.width / m.height : 1;
  if (ar < 1) s += 1.5; // vertical suits reels
  if ((m.width || 0) >= 1080) s += 1;
  if (m.type === "video" && (m.duration || 0) >= 2) s += 1;
  return s;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Auto-build a storyboard from selected media. Strongest video opens (the hook);
// remaining videos and best photos interleave. Total capped to a reel length.
export function autoBuild(
  media: ClientMedia[],
  patterns: ReelPatterns | null,
  opts?: { maxSeconds?: number },
): Storyboard {
  const maxSeconds = opts?.maxSeconds ?? 22;
  const videos = media.filter((m) => m.type === "video").sort((a, b) => score(b) - score(a));
  const photos = media.filter((m) => m.type === "photo").sort((a, b) => score(b) - score(a));

  // Interleave: video, photo, photo, video, photo… keeping motion frequent.
  const ordered: ClientMedia[] = [];
  let vi = 0, pi = 0;
  if (videos.length) ordered.push(videos[vi++]); // hook = strongest video
  while (vi < videos.length || pi < photos.length) {
    if (pi < photos.length) ordered.push(photos[pi++]);
    if (pi < photos.length) ordered.push(photos[pi++]);
    if (vi < videos.length) ordered.push(videos[vi++]);
  }

  const clips: Clip[] = [];
  let total = 0;
  for (let i = 0; i < ordered.length; i++) {
    const m = ordered[i];
    const dur = m.type === "video" ? clamp(m.duration || 3, 1.5, 5) : 2.0;
    if (total + dur > maxSeconds && clips.length >= 3) break;
    total += dur;
    clips.push({
      id: uid(),
      mediaId: m.id,
      type: m.type,
      url: m.url,
      thumbUrl: m.thumbUrl,
      duration: Math.round(dur * 10) / 10,
      transition: i === 0 ? "cut" : i % 3 === 0 ? "dissolve" : "cut",
      text: i === 0 ? "Add your hook here" : "",
      speed: 1,
    });
  }

  return {
    clips,
    music: "Pick a trending audio in Instagram at upload (the API can't attach audio).",
    aspect: "9:16",
    targetHeight: 3840,
  };
}

export function totalDuration(sb: Storyboard): number {
  return Math.round(sb.clips.reduce((s, c) => s + c.duration / (c.speed || 1), 0) * 10) / 10;
}

// Parse a simple natural-language instruction and return an updated storyboard.
export function applyInstruction(sb: Storyboard, raw: string): { sb: Storyboard; message: string } {
  const text = raw.toLowerCase().trim();
  const clips = sb.clips.map((c) => ({ ...c }));
  const ordinals: Record<string, number> = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6,
    seventh: 7, eighth: 8, ninth: 9, tenth: 10, last: -1,
  };

  const removeMatch = text.match(/remove|delete|drop/);
  if (removeMatch) {
    let idx = -2;
    const numMatch = text.match(/(?:clip|number|#)?\s*(\d+)/);
    for (const [word, n] of Object.entries(ordinals)) if (text.includes(word)) idx = n;
    if (numMatch) idx = parseInt(numMatch[1]);
    if (idx === -1) idx = clips.length; // last
    if (idx >= 1 && idx <= clips.length) {
      const removed = clips.splice(idx - 1, 1);
      return { sb: { ...sb, clips }, message: `Removed clip ${idx}.` };
    }
    return { sb, message: "Tell me which clip to remove, e.g. \"remove the third clip\"." };
  }

  if (/faster|speed up|snappier|quicker/.test(text)) {
    clips.forEach((c) => (c.duration = Math.max(0.6, Math.round(c.duration * 0.75 * 10) / 10)));
    return { sb: { ...sb, clips }, message: "Tightened the pacing." };
  }
  if (/slower|slow down|calmer|longer holds/.test(text)) {
    clips.forEach((c) => (c.duration = Math.round(c.duration * 1.3 * 10) / 10));
    return { sb: { ...sb, clips }, message: "Slowed the pacing." };
  }
  if (/dissolve|crossfade|smooth transition/.test(text)) {
    clips.forEach((c, i) => (c.transition = i === 0 ? "cut" : "dissolve"));
    return { sb: { ...sb, clips }, message: "Set smooth dissolves between clips." };
  }
  if (/hard cut|cuts only|no transition/.test(text)) {
    clips.forEach((c) => (c.transition = "cut"));
    return { sb: { ...sb, clips }, message: "Switched to hard cuts." };
  }
  if (/reverse|flip order|backwards/.test(text)) {
    clips.reverse();
    return { sb: { ...sb, clips }, message: "Reversed the clip order." };
  }
  if (/shorter|trim it down|cut it down/.test(text)) {
    clips.forEach((c) => (c.duration = Math.max(0.8, Math.round(c.duration * 0.85 * 10) / 10)));
    return { sb: { ...sb, clips }, message: "Made it shorter." };
  }

  return { sb, message: "I didn't catch that. Try: \"make it faster\", \"remove the third clip\", \"use dissolves\", or \"reverse the order\"." };
}
