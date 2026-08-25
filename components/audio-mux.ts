// In-browser audio muxing via ffmpeg.wasm (single-threaded core — no
// SharedArrayBuffer / COOP-COEP needed). Merges a music track the user OWNS
// onto a finished video. The VIDEO STREAM IS COPIED (never re-encoded), so
// there is no quality loss and 4K is preserved; only the audio is encoded.
//
// This does NOT and cannot attach Instagram's licensed/trending catalog — Meta
// forbids that via any API. It only bakes in audio the user provides.

let ffmpeg: any = null;
let loadPromise: Promise<any> | null = null;

// Single-threaded core (no worker, no SAB). Loaded from CDN via blob URLs.
const CORE_BASE = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";

async function getFFmpeg(onStatus?: (s: string) => void): Promise<any> {
  if (ffmpeg) return ffmpeg;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    onStatus?.("Loading audio engine…");
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const { toBlobURL } = await import("@ffmpeg/util");
    const inst = new FFmpeg();
    await inst.load({
      coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
    });
    ffmpeg = inst;
    return inst;
  })();
  return loadPromise;
}

export interface MuxOptions {
  onStatus?: (s: string) => void;
  onProgress?: (pct: number) => void;
  loopAudio?: boolean; // repeat short music to cover the whole video
}

// Merge `audio` onto `video`, returning a new MP4 File with music baked in.
export async function muxAudioIntoVideo(
  video: File | Blob,
  audio: File | Blob,
  opts: MuxOptions = {},
): Promise<File> {
  const { fetchFile } = await import("@ffmpeg/util");
  const inst = await getFFmpeg(opts.onStatus);

  const onProg = ({ progress }: { progress: number }) =>
    opts.onProgress?.(Math.max(0, Math.min(100, Math.round((progress || 0) * 100))));
  inst.on("progress", onProg);

  opts.onStatus?.("Merging music into the video…");
  await inst.writeFile("in_video", await fetchFile(video));
  await inst.writeFile("in_audio", await fetchFile(audio));

  // Copy video (lossless, fast), encode audio to AAC. -shortest ends the file
  // at the shorter of the two streams so there's never trailing silence/black.
  const args = [
    ...(opts.loopAudio ? ["-stream_loop", "-1"] : []),
    "-i", "in_audio",
    "-i", "in_video",
    "-map", "1:v:0",
    "-map", "0:a:0",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    "-movflags", "+faststart",
    "out.mp4",
  ];

  try {
    await inst.exec(args);
  } catch (e) {
    inst.off?.("progress", onProg);
    throw new Error(
      "Couldn't merge the audio — the video may be in a format that can't be copied. Try an MP4 (H.264) video.",
    );
  }

  const data = await inst.readFile("out.mp4");
  inst.off?.("progress", onProg);
  // Clean up virtual FS to keep memory bounded across repeated merges.
  try { await inst.deleteFile("in_video"); await inst.deleteFile("in_audio"); await inst.deleteFile("out.mp4"); } catch {}

  const blob = new Blob([data], { type: "video/mp4" });
  return new File([blob], "reel-with-music.mp4", { type: "video/mp4" });
}

export function isAudioFile(f: File): boolean {
  return f.type.startsWith("audio/") || /\.(mp3|m4a|aac|wav|ogg)$/i.test(f.name);
}

// Transcode a rendered reel (often WebM from MediaRecorder) into an MP4/H.264
// file Instagram accepts. This RE-ENCODES the video, so it's the slow step —
// only used when scheduling a WebM reel to Instagram.
export async function transcodeToMp4(input: Blob, opts: MuxOptions = {}): Promise<File> {
  if ((input.type || "").includes("mp4")) {
    return new File([input], "reel.mp4", { type: "video/mp4" });
  }
  const { fetchFile } = await import("@ffmpeg/util");
  const inst = await getFFmpeg(opts.onStatus);
  const onProg = ({ progress }: { progress: number }) =>
    opts.onProgress?.(Math.max(0, Math.min(100, Math.round((progress || 0) * 100))));
  inst.on("progress", onProg);

  opts.onStatus?.("Converting to MP4 for Instagram…");
  await inst.writeFile("in.webm", await fetchFile(input));
  try {
    await inst.exec([
      "-i", "in.webm",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k",
      "-movflags", "+faststart",
      "out.mp4",
    ]);
  } catch (e) {
    inst.off?.("progress", onProg);
    throw new Error("Couldn't convert the reel to MP4 in the browser. You can still download the reel and upload it manually.");
  }
  const data = await inst.readFile("out.mp4");
  inst.off?.("progress", onProg);
  try { await inst.deleteFile("in.webm"); await inst.deleteFile("out.mp4"); } catch {}
  return new File([new Blob([data], { type: "video/mp4" })], "reel.mp4", { type: "video/mp4" });
}
