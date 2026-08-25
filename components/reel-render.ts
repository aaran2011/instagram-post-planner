// Real in-browser Reel renderer. Composites the user's own photos/videos onto a
// canvas with Ken Burns motion, transitions and text overlays, mixes a
// generated music bed (or the user's own track) plus transition SFX, and records
// the result to a video file via MediaRecorder — a genuine rendered Reel, not a
// slideshow. NON-GENERATIVE for imagery: it only moves/composites real pixels.
//
// Media MUST be loaded from SAME-ORIGIN urls (use /api/media/bytes/[id] → blob
// url) or the canvas taints and recording fails.

export type RTransition = "cut" | "dissolve" | "slide";

export interface RenderClip {
  type: "photo" | "video";
  url: string; // same-origin blob url
  duration: number; // seconds on screen
  transition: RTransition; // transition INTO this clip
  text?: string;
  motion: { zoomFrom: number; zoomTo: number; panX: number; panY: number };
}

export type MusicMood = "cinematic" | "upbeat" | "calm" | "none";

export interface RenderOpts {
  width?: number;
  height?: number;
  fps?: number;
  mood?: MusicMood;
  musicBuffer?: AudioBuffer | null; // the user's own decoded audio (overrides mood)
  sfx?: boolean;
  onStatus?: (s: string) => void;
  onProgress?: (pct: number) => void;
}

export interface RenderResult {
  blob: Blob; mime: string; width: number; height: number; duration: number;
}

const TRANS = 0.5; // transition length (s)

function loadEl(clip: RenderClip): Promise<HTMLImageElement | HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    if (clip.type === "video") {
      const v = document.createElement("video");
      v.src = clip.url; v.muted = true; (v as any).playsInline = true; v.preload = "auto";
      v.onloadeddata = () => resolve(v);
      v.onerror = () => reject(new Error("video load failed"));
    } else {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("image load failed"));
      img.src = clip.url;
    }
  });
}

function pickMime(): string {
  const cands = [
    "video/mp4;codecs=avc1.640028,mp4a.40.2",
    "video/mp4;codecs=h264,aac",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const c of cands) {
    try { if ((window as any).MediaRecorder?.isTypeSupported(c)) return c; } catch {}
  }
  return "";
}

function drawCover(
  ctx: CanvasRenderingContext2D, el: HTMLImageElement | HTMLVideoElement,
  cw: number, ch: number, zoom: number, panX: number, panY: number,
) {
  const mw = (el as HTMLVideoElement).videoWidth || (el as HTMLImageElement).naturalWidth || cw;
  const mh = (el as HTMLVideoElement).videoHeight || (el as HTMLImageElement).naturalHeight || ch;
  const base = Math.max(cw / mw, ch / mh);
  const scale = base * zoom;
  const dw = mw * scale, dh = mh * scale;
  const dx = (cw - dw) / 2 + panX * (dw - cw) / 2;
  const dy = (ch - dh) / 2 + panY * (dh - ch) / 2;
  ctx.drawImage(el as CanvasImageSource, dx, dy, dw, dh);
}

function drawText(ctx: CanvasRenderingContext2D, text: string, cw: number, ch: number, alpha: number) {
  if (!text) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  const size = Math.round(ch * 0.045);
  ctx.font = `800 ${size}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = size * 0.5;
  ctx.fillStyle = "#fff";
  const y = ch * 0.8;
  // simple word wrap
  const words = text.split(/\s+/); const lines: string[] = []; let line = "";
  for (const w of words) {
    if (ctx.measureText(line + " " + w).width > cw * 0.86 && line) { lines.push(line); line = w; }
    else line = line ? line + " " + w : w;
  }
  if (line) lines.push(line);
  lines.forEach((ln, i) => ctx.fillText(ln, cw / 2, y + (i - (lines.length - 1) / 2) * size * 1.2));
  ctx.restore();
}

// ---- generated royalty-free music bed (OfflineAudioContext) ----
async function makeMusic(mood: MusicMood, duration: number): Promise<AudioBuffer | null> {
  if (mood === "none") return null;
  const sr = 44100;
  const OAC: any = (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  if (!OAC) return null;
  const ctx: OfflineAudioContext = new OAC(2, Math.ceil(sr * duration), sr);

  // scales / progressions per mood
  const A = 220;
  const prog = mood === "upbeat"
    ? [[0, 4, 7], [5, 9, 12], [7, 11, 14], [2, 5, 9]]  // major-ish
    : mood === "calm"
    ? [[0, 3, 7], [-2, 2, 5], [3, 7, 10], [-2, 2, 5]]
    : [[0, 3, 7], [5, 8, 12], [3, 7, 10], [-2, 3, 7]]; // cinematic minor
  const semis = (n: number) => A * Math.pow(2, n / 12);
  const barLen = mood === "upbeat" ? 1.7 : 2.4;
  const master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);

  for (let t = 0, bar = 0; t < duration; t += barLen, bar++) {
    const chord = prog[bar % prog.length];
    for (const n of chord) {
      const osc = ctx.createOscillator();
      osc.type = mood === "upbeat" ? "sawtooth" : "triangle";
      osc.frequency.value = semis(n) / (mood === "cinematic" ? 2 : 1);
      const g = ctx.createGain();
      const a = 0.25, rel = barLen * 0.9;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.16, t + a);
      g.gain.linearRampToValueAtTime(0.0001, t + rel);
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1800;
      osc.connect(g); g.connect(lp); lp.connect(master);
      osc.start(t); osc.stop(t + barLen);
    }
    // soft rhythmic pulse for upbeat/cinematic
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

function makeWhoosh(ctx: AudioContext): AudioBuffer {
  const sr = ctx.sampleRate; const len = Math.floor(sr * 0.35);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const p = i / len;
    const env = Math.sin(Math.PI * p);
    d[i] = (Math.random() * 2 - 1) * env * 0.5;
  }
  return buf;
}

export async function renderReel(clips: RenderClip[], opts: RenderOpts = {}): Promise<RenderResult> {
  const W = opts.width ?? 1080, H = opts.height ?? 1920, fps = opts.fps ?? 30;
  const status = opts.onStatus ?? (() => {});
  const clean = clips.filter((c) => c.duration > 0);
  if (!clean.length) throw new Error("No clips to render");

  status("Loading media…");
  const els = await Promise.all(clean.map(loadEl));
  const total = clean.reduce((s, c) => s + c.duration, 0);

  status("Preparing audio…");
  const AC: any = (window as any).AudioContext || (window as any).webkitAudioContext;
  const actx: AudioContext = new AC();
  const audioDest = actx.createMediaStreamDestination();
  const musicBuf = opts.musicBuffer ?? await makeMusic(opts.mood ?? "cinematic", total);
  if (musicBuf) {
    const src = actx.createBufferSource(); src.buffer = musicBuf; src.loop = true;
    const g = actx.createGain(); g.gain.value = opts.musicBuffer ? 0.9 : 0.7;
    // gentle fade out at the end
    g.gain.setValueAtTime(g.gain.value, Math.max(0, total - 0.6));
    g.gain.linearRampToValueAtTime(0.0001, total);
    src.connect(g); g.connect(audioDest); src.start();
  }
  const whoosh = opts.sfx !== false ? makeWhoosh(actx) : null;

  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);

  const stream = (canvas as any).captureStream(fps) as MediaStream;
  const at = audioDest.stream.getAudioTracks()[0];
  if (at) stream.addTrack(at);

  const mime = pickMime();
  const rec = new MediaRecorder(stream, {
    ...(mime ? { mimeType: mime } : {}),
    videoBitsPerSecond: 10_000_000,
  } as MediaRecorderOptions);
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

  // clip time boundaries
  const starts: number[] = []; let acc = 0;
  for (const c of clean) { starts.push(acc); acc += c.duration; }

  // schedule SFX whooshes at each transition (start of clips 2..n)
  if (whoosh) {
    for (let i = 1; i < clean.length; i++) {
      const s = actx.createBufferSource(); s.buffer = whoosh;
      const g = actx.createGain(); g.gain.value = 0.35;
      s.connect(g); g.connect(audioDest);
      s.start(actx.currentTime + Math.max(0, starts[i] - TRANS * 0.5));
    }
  }

  const startedVideos = new Set<number>();
  const t0 = performance.now();

  return await new Promise<RenderResult>((resolve, reject) => {
    rec.onstop = () => {
      try { actx.close(); } catch {}
      const outMime = mime || "video/webm";
      resolve({ blob: new Blob(chunks, { type: outMime.split(";")[0] }), mime: outMime.split(";")[0], width: W, height: H, duration: total });
    };
    rec.onerror = (e: any) => reject(e?.error || new Error("Recording failed"));

    status("Rendering…");
    rec.start();

    // Drive frames with a timer (not requestAnimationFrame) so rendering keeps
    // running even if the tab is briefly backgrounded (rAF hard-pauses; timers
    // only throttle). captureStream samples the canvas as we redraw it.
    const interval = 1000 / fps;
    const timer = setInterval(() => { try { frame(); } catch (e) { clearInterval(timer); reject(e); } }, interval);

    function frame() {
      const t = (performance.now() - t0) / 1000;
      if (t >= total) {
        clearInterval(timer);
        ctx.globalAlpha = 1;
        try { rec.stop(); } catch {}
        return;
      }
      opts.onProgress?.(Math.min(99, Math.round((t / total) * 100)));

      // active clip
      let idx = clean.length - 1;
      for (let i = 0; i < clean.length; i++) {
        if (t >= starts[i] && t < starts[i] + clean[i].duration) { idx = i; break; }
      }
      const c = clean[idx]; const el = els[idx];
      const local = (t - starts[idx]) / c.duration; // 0..1

      // start videos when they become active
      if (c.type === "video" && !startedVideos.has(idx)) {
        startedVideos.add(idx);
        try { (el as HTMLVideoElement).currentTime = 0; (el as HTMLVideoElement).play().catch(() => {}); } catch {}
      }

      ctx.globalAlpha = 1;
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);

      // Ken Burns zoom/pan for current clip
      const zoom = c.motion.zoomFrom + (c.motion.zoomTo - c.motion.zoomFrom) * local;
      const px = c.motion.panX * (local - 0.5) * 2;
      const py = c.motion.panY * (local - 0.5) * 2;
      drawCover(ctx, el, W, H, zoom, px, py);

      // transition INTO the NEXT clip during this clip's tail
      const next = clean[idx + 1];
      const tailStart = c.duration - TRANS;
      const localT = t - starts[idx];
      if (next && localT >= tailStart) {
        const p = (localT - tailStart) / TRANS; // 0..1
        const nEl = els[idx + 1];
        if (next.type === "video" && !startedVideos.has(idx + 1)) {
          startedVideos.add(idx + 1);
          try { (nEl as HTMLVideoElement).currentTime = 0; (nEl as HTMLVideoElement).play().catch(() => {}); } catch {}
        }
        const nzoom = next.motion.zoomFrom;
        if (next.transition === "slide") {
          ctx.save();
          ctx.translate((1 - p) * W, 0);
          drawCover(ctx, nEl, W, H, nzoom, 0, 0);
          ctx.restore();
        } else if (next.transition === "dissolve") {
          ctx.globalAlpha = p;
          drawCover(ctx, nEl, W, H, nzoom, 0, 0);
          ctx.globalAlpha = 1;
        }
        // "cut": do nothing (next clip simply takes over next frame)
      }

      // text overlay (fade in/out)
      if (c.text) {
        const fade = Math.min(1, local / 0.15, (1 - local) / 0.15);
        drawText(ctx, c.text, W, H, Math.max(0, fade));
      }
    }
  });
}

// Decode an audio File the user supplied into an AudioBuffer for muxing.
export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const AC: any = (window as any).AudioContext || (window as any).webkitAudioContext;
  const actx: AudioContext = new AC();
  const buf = await actx.decodeAudioData(await file.arrayBuffer());
  try { actx.close(); } catch {}
  return buf;
}

// Assign varied Ken Burns motion + transitions to clips (deterministic by index).
export function autoMotion(i: number): RenderClip["motion"] {
  const zoomIn = i % 2 === 0;
  const panDir = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]][i % 6];
  return {
    zoomFrom: zoomIn ? 1.0 : 1.12,
    zoomTo: zoomIn ? 1.12 : 1.0,
    panX: panDir[0] * 0.06,
    panY: panDir[1] * 0.06,
  };
}
