// Real in-browser Reel renderer — cinematic, not a slideshow.
//
// Design goals (from direct feedback):
//  - Never force a bad Ken Burns move: images that can't fill the vertical frame
//    cleanly are DROPPED, not butchered.
//  - Cuts land on the music's beat (edits feel intentional).
//  - Transitions are minimal & professional and VARIED by shot: mostly gentle
//    dissolves, with fade-to-black / fade-to-white used only where a shot's
//    brightness makes it feel right. No wipes/slides/whips.
//  - Clean fade-in from black and fade-out to black bookend the reel.
//  - Subtle motion: slow push-in on portraits, slow pan across landscapes.
//  - Sound effects are soft, low, and synced to the fade points only.
//
// NON-GENERATIVE for imagery: it only moves/composites the user's real pixels.
// Media MUST be same-origin (fetch /api/media/bytes/[id] → blob url) or the
// canvas taints and recording fails.

export type MusicMood = "cinematic" | "upbeat" | "calm" | "none";

export interface RenderItem { type: "photo" | "video"; url: string }

export interface RenderOpts {
  width?: number; height?: number; fps?: number;
  mood?: MusicMood;
  musicBuffer?: AudioBuffer | null;
  sfx?: boolean;
  onStatus?: (s: string) => void;
  onProgress?: (pct: number) => void;
}

export interface RenderResult {
  blob: Blob; mime: string; width: number; height: number; duration: number; used: number; dropped: number;
}

type Transition = "cut" | "dissolve" | "fadeblack" | "fadewhite";

interface Clip {
  type: "photo" | "video";
  el: HTMLImageElement | HTMLVideoElement;
  ar: number; luma: number;
  duration: number; transition: Transition; // transition INTO this clip
  motion: { zoomFrom: number; zoomTo: number; panX: number; panY: number };
  start: number; end: number;
}

const TD = 0.5;        // transition length (s)
const FADE_IN = 0.5;   // cinematic fade from black at the start
const FADE_OUT = 0.8;  // fade to black at the end
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lumaOf = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function loadEl(item: RenderItem): Promise<HTMLImageElement | HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    if (item.type === "video") {
      const v = document.createElement("video");
      v.src = item.url; v.muted = true; (v as any).playsInline = true; v.preload = "auto";
      v.onloadeddata = () => resolve(v);
      v.onerror = () => reject(new Error("video load failed"));
    } else {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("image load failed"));
      img.src = item.url;
    }
  });
}

function elDims(el: HTMLImageElement | HTMLVideoElement) {
  const w = (el as HTMLVideoElement).videoWidth || (el as HTMLImageElement).naturalWidth || 1;
  const h = (el as HTMLVideoElement).videoHeight || (el as HTMLImageElement).naturalHeight || 1;
  return { w, h };
}

function meanLuma(el: HTMLImageElement | HTMLVideoElement): number {
  try {
    const c = document.createElement("canvas"); c.width = 16; c.height = 16;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(el as CanvasImageSource, 0, 0, 16, 16);
    const d = ctx.getImageData(0, 0, 16, 16).data;
    let s = 0; for (let i = 0; i < d.length; i += 4) s += lumaOf(d[i], d[i + 1], d[i + 2]);
    return s / (256 * 255);
  } catch { return 0.5; }
}

function pickMime(): string {
  const cands = [
    "video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4;codecs=h264,aac", "video/mp4",
    "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm",
  ];
  for (const c of cands) { try { if ((window as any).MediaRecorder?.isTypeSupported(c)) return c; } catch {} }
  return "";
}

// ---- generated royalty-free music bed ----
async function makeMusic(mood: MusicMood, duration: number, barLen: number): Promise<AudioBuffer | null> {
  if (mood === "none") return null;
  const sr = 44100;
  const OAC: any = (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  if (!OAC) return null;
  const ctx: OfflineAudioContext = new OAC(2, Math.ceil(sr * (duration + 0.5)), sr);
  const A = 220;
  const prog = mood === "upbeat"
    ? [[0, 4, 7], [5, 9, 12], [7, 11, 14], [2, 5, 9]]
    : mood === "calm"
    ? [[0, 3, 7], [-2, 2, 5], [3, 7, 10], [-2, 2, 5]]
    : [[0, 3, 7], [5, 8, 12], [3, 7, 10], [-2, 3, 7]];
  const semis = (n: number) => A * Math.pow(2, n / 12);
  const master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
  for (let t = 0, bar = 0; t < duration; t += barLen, bar++) {
    const chord = prog[bar % prog.length];
    for (const n of chord) {
      const osc = ctx.createOscillator();
      osc.type = mood === "upbeat" ? "sawtooth" : "triangle";
      osc.frequency.value = semis(n) / (mood === "cinematic" ? 2 : 1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.16, t + 0.25);
      g.gain.linearRampToValueAtTime(0.0001, t + barLen * 0.9);
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1800;
      osc.connect(g); g.connect(lp); lp.connect(master);
      osc.start(t); osc.stop(t + barLen);
    }
    if (mood !== "calm") {
      const beats = mood === "upbeat" ? 4 : 2;
      for (let b = 0; b < beats; b++) {
        const bt = t + (b * barLen) / beats;
        const k = ctx.createOscillator(); k.frequency.setValueAtTime(140, bt); k.frequency.exponentialRampToValueAtTime(50, bt + 0.12);
        const kg = ctx.createGain(); kg.gain.setValueAtTime(0.5, bt); kg.gain.exponentialRampToValueAtTime(0.001, bt + 0.16);
        k.connect(kg); kg.connect(master); k.start(bt); k.stop(bt + 0.18);
      }
    }
  }
  return await ctx.startRendering();
}

function makeSoftImpact(ctx: AudioContext): AudioBuffer {
  const sr = ctx.sampleRate; const len = Math.floor(sr * 0.5);
  const buf = ctx.createBuffer(1, len, sr); const d = buf.getChannelData(0);
  // low, soft noise swell (lowpassed at playback) — a gentle "breath", not a whoosh
  let last = 0;
  for (let i = 0; i < len; i++) {
    const p = i / len;
    const env = Math.sin(Math.PI * p) ** 2;
    last = last * 0.96 + (Math.random() * 2 - 1) * 0.04; // brownish
    d[i] = last * env;
  }
  return buf;
}

function drawCover(
  ctx: CanvasRenderingContext2D, el: HTMLImageElement | HTMLVideoElement,
  cw: number, ch: number, zoom: number, panX: number, panY: number,
) {
  const { w: mw, h: mh } = elDims(el);
  const base = Math.max(cw / mw, ch / mh) * zoom;
  const dw = mw * base, dh = mh * base;
  const dx = (cw - dw) / 2 + panX * (dw - cw) / 2;
  const dy = (ch - dh) / 2 + panY * (dh - ch) / 2;
  ctx.drawImage(el as CanvasImageSource, dx, dy, dw, dh);
}

export async function renderReel(items: RenderItem[], opts: RenderOpts = {}): Promise<RenderResult> {
  const W = opts.width ?? 1080, H = opts.height ?? 1920, fps = opts.fps ?? 30;
  const status = opts.onStatus ?? (() => {});
  const mood = opts.mood ?? "cinematic";
  const barLen = mood === "upbeat" ? 1.7 : mood === "calm" ? 2.6 : 2.2;

  status("Loading media…");
  const els = await Promise.all(items.map(loadEl));

  // Build clips, DROPPING photos that can't fill 9:16 cleanly (extreme aspect).
  status("Choosing the strongest shots…");
  const clips: Clip[] = [];
  let dropped = 0;
  for (let i = 0; i < items.length; i++) {
    const el = els[i]; const { w, h } = elDims(el); const ar = w / h;
    if (items[i].type === "photo" && (ar > 2.35 || ar < 0.42 || Math.min(w, h) < 320)) { dropped++; continue; }
    const dir = clips.length % 2 === 0 ? 1 : -1;
    let motion;
    if (items[i].type === "video") motion = { zoomFrom: 1, zoomTo: 1.02, panX: 0, panY: 0 };
    else if (ar >= 1.12) motion = { zoomFrom: 1.02, zoomTo: 1.05, panX: 0.5 * dir, panY: 0 };
    else if (ar <= 0.9) motion = { zoomFrom: 1, zoomTo: 1.06, panX: 0, panY: 0.32 * dir };
    else motion = { zoomFrom: 1, zoomTo: 1.05, panX: 0.12 * dir, panY: 0 };
    clips.push({
      type: items[i].type, el, ar, luma: meanLuma(el),
      duration: 0, transition: "dissolve", motion, start: 0, end: 0,
    });
  }
  if (clips.length < 2) throw new Error("Not enough usable images for a reel — try adding more (portrait or landscape shots, not extreme panoramas).");

  // Durations snapped to the beat; transitions chosen by shot brightness.
  const maxSeconds = 24;
  let lastFade = -99;
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    if (c.type === "video") {
      const vd = (c.el as HTMLVideoElement).duration || barLen;
      const bars = Math.max(1, Math.min(3, Math.round(vd / barLen)));
      c.duration = bars * barLen;
    } else {
      const bars = i === 0 ? 1.5 : (i % 3 === 2 ? 1.5 : 1); // subtle rhythm
      c.duration = bars * barLen;
    }
    if (i === 0) { c.transition = "cut"; continue; }
    // choose a VARIED, appropriate transition (spaced out so fades stay special)
    if (i - lastFade >= 3 && c.luma > 0.66) { c.transition = "fadewhite"; lastFade = i; }
    else if (i - lastFade >= 3 && c.luma < 0.26) { c.transition = "fadeblack"; lastFade = i; }
    else c.transition = "dissolve";
  }
  // cap total length (drop trailing clips, never force a rushed cut)
  let acc = 0; const kept: Clip[] = [];
  for (const c of clips) { if (acc + c.duration > maxSeconds && kept.length >= 3) break; c.start = acc; c.end = acc + c.duration; acc += c.duration; kept.push(c); }
  const used = kept;
  const total = acc;

  // ---- audio ----
  status("Preparing audio…");
  const AC: any = (window as any).AudioContext || (window as any).webkitAudioContext;
  const actx: AudioContext = new AC();
  try { await actx.resume(); } catch {}
  const audioDest = actx.createMediaStreamDestination();
  const musicBuf = opts.musicBuffer ?? await makeMusic(mood, total, barLen);
  const impact = opts.sfx !== false ? makeSoftImpact(actx) : null;

  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
  const stream = (canvas as any).captureStream(fps) as MediaStream;
  const at = audioDest.stream.getAudioTracks()[0];
  if (at) stream.addTrack(at);

  const mime = pickMime();
  const rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 12_000_000 } as MediaRecorderOptions);
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

  const drawClip = (c: Clip, t: number, alpha: number) => {
    const local = clamp01((t - c.start) / Math.max(0.001, c.end - c.start));
    const zoom = c.motion.zoomFrom + (c.motion.zoomTo - c.motion.zoomFrom) * local;
    const px = c.motion.panX * (local - 0.5) * 2;
    const py = c.motion.panY * (local - 0.5) * 2;
    ctx.globalAlpha = alpha;
    drawCover(ctx, c.el, W, H, zoom, px, py);
    ctx.globalAlpha = 1;
  };
  const overlay = (color: string, alpha: number) => {
    if (alpha <= 0) return;
    ctx.globalAlpha = Math.min(1, alpha); ctx.fillStyle = color; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
  };
  const started = new Set<number>();
  const ensureVideo = (idx: number) => {
    const c = used[idx];
    if (c.type === "video" && !started.has(idx)) { started.add(idx); try { (c.el as HTMLVideoElement).currentTime = 0; (c.el as HTMLVideoElement).play().catch(() => {}); } catch {} }
  };

  return await new Promise<RenderResult>((resolve, reject) => {
    rec.onstop = () => {
      try { actx.close(); } catch {}
      const outMime = (mime || "video/webm").split(";")[0];
      resolve({ blob: new Blob(chunks, { type: outMime }), mime: outMime, width: W, height: H, duration: total, used: used.length, dropped });
    };
    rec.onerror = (e: any) => reject(e?.error || new Error("Recording failed"));

    status("Rendering…");
    rec.start();

    // Common start reference keeps audio and video in sync.
    const audioStart = actx.currentTime;
    const t0 = performance.now();
    if (musicBuf) {
      const src = actx.createBufferSource(); src.buffer = musicBuf; src.loop = true;
      const g = actx.createGain(); g.gain.value = opts.musicBuffer ? 0.85 : 0.7;
      g.gain.setValueAtTime(g.gain.value, audioStart + Math.max(0, total - 0.7));
      g.gain.linearRampToValueAtTime(0.0001, audioStart + total);
      src.connect(g); g.connect(audioDest); src.start(audioStart);
    }
    // Soft impact synced to each FADE transition only (dissolves stay clean).
    if (impact) {
      for (let i = 1; i < used.length; i++) {
        if (used[i].transition === "fadeblack" || used[i].transition === "fadewhite") {
          const s = actx.createBufferSource(); s.buffer = impact;
          const lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 700;
          const g = actx.createGain(); g.gain.value = 0.12;
          s.connect(lp); lp.connect(g); g.connect(audioDest);
          s.start(audioStart + Math.max(0, used[i].start - TD * 0.5));
        }
      }
    }

    const interval = 1000 / fps;
    const timer = setInterval(() => { try { frame(); } catch (e) { clearInterval(timer); reject(e); } }, interval);

    function frame() {
      const t = (performance.now() - t0) / 1000;
      if (t >= total) { clearInterval(timer); try { rec.stop(); } catch {} return; }
      opts.onProgress?.(Math.min(99, Math.round((t / total) * 100)));

      ctx.globalAlpha = 1; ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);

      // Which boundary (if any) are we transitioning across?
      let inWindow = -1;
      for (let k = 0; k < used.length - 1; k++) {
        const B = used[k].end;
        if (t >= B - TD / 2 && t < B + TD / 2 && used[k + 1].transition !== "cut") { inWindow = k; break; }
      }

      if (inWindow >= 0) {
        const k = inWindow; const B = used[k].end; const p = clamp01((t - (B - TD / 2)) / TD);
        const tr = used[k + 1].transition;
        ensureVideo(k); ensureVideo(k + 1);
        if (tr === "dissolve") {
          drawClip(used[k], t, 1);
          drawClip(used[k + 1], t, p);
        } else {
          const col = tr === "fadewhite" ? "#fff" : "#000";
          if (p < 0.5) { drawClip(used[k], t, 1); overlay(col, p * 2); }
          else { drawClip(used[k + 1], t, 1); overlay(col, (1 - p) * 2); }
        }
      } else {
        let i = used.length - 1;
        for (let j = 0; j < used.length; j++) { if (t >= used[j].start && t < used[j].end) { i = j; break; } }
        ensureVideo(i);
        drawClip(used[i], t, 1);
      }

      // cinematic bookend fades
      if (t < FADE_IN) overlay("#000", 1 - t / FADE_IN);
      if (t > total - FADE_OUT) overlay("#000", (t - (total - FADE_OUT)) / FADE_OUT);
    }
  });
}

export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const AC: any = (window as any).AudioContext || (window as any).webkitAudioContext;
  const actx: AudioContext = new AC();
  const buf = await actx.decodeAudioData(await file.arrayBuffer());
  try { actx.close(); } catch {}
  return buf;
}
