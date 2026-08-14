// Client-side extraction of thumbnails, dimensions and duration so the server
// never needs image/video processing libraries. Keeps big uploads fast and
// avoids loading full-res files into the grid.

export interface Extracted {
  width: number | null;
  height: number | null;
  duration: number | null;
  thumb: Blob | null;
}

const MAX_THUMB = 512;

function canvasThumb(
  source: HTMLImageElement | HTMLVideoElement,
  w: number,
  h: number,
): Promise<Blob | null> {
  const scale = Math.min(1, MAX_THUMB / Math.max(w, h || 1));
  const cw = Math.max(1, Math.round((w || MAX_THUMB) * scale));
  const ch = Math.max(1, Math.round((h || MAX_THUMB) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(source as any, 0, 0, cw, ch);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.82));
}

export function extractPhoto(file: File): Promise<Extracted> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      let thumb: Blob | null = null;
      try {
        thumb = await canvasThumb(img, w, h);
      } catch {}
      URL.revokeObjectURL(url);
      resolve({ width: w, height: h, duration: null, thumb });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ width: null, height: null, duration: null, thumb: null });
    };
    img.src = url;
  });
}

export function extractVideo(file: File): Promise<Extracted> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    (video as any).playsInline = true;
    let done = false;
    const finish = (r: Extracted) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      resolve(r);
    };

    video.onloadedmetadata = () => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      const duration = isFinite(video.duration) ? video.duration : null;
      // Seek a little in to grab a representative frame.
      const seekTo = Math.min(1, (duration || 2) * 0.25);
      const grab = async () => {
        let thumb: Blob | null = null;
        try {
          thumb = await canvasThumb(video, w, h);
        } catch {}
        finish({ width: w, height: h, duration, thumb });
      };
      video.onseeked = grab;
      try {
        video.currentTime = seekTo;
      } catch {
        grab();
      }
    };
    video.onerror = () => finish({ width: null, height: null, duration: null, thumb: null });
    // Safety timeout for stubborn files.
    setTimeout(() => finish({ width: null, height: null, duration: null, thumb: null }), 8000);
    video.src = url;
  });
}

export function extract(file: File): Promise<Extracted> {
  if (file.type.startsWith("video/")) return extractVideo(file);
  return extractPhoto(file);
}

// Downscale a large photo to a max longest-side before upload — dramatically
// smaller files, and invisible on Instagram (which caps photos at ~1080px).
// Returns null for videos or images already small enough (upload the original).
export function optimizeImage(
  file: File,
  maxDim = 2048,
  quality = 0.9,
): Promise<{ blob: Blob; width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/")) return resolve(null);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const scale = Math.min(1, maxDim / Math.max(w, h));
      if (scale >= 1 || !w || !h) {
        URL.revokeObjectURL(url);
        return resolve(null); // already small enough
      }
      const cw = Math.round(w * scale);
      const ch = Math.round(h * scale);
      const canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        return resolve(null);
      }
      ctx.drawImage(img, 0, 0, cw, ch);
      canvas.toBlob(
        (b) => {
          URL.revokeObjectURL(url);
          resolve(b ? { blob: b, width: cw, height: ch } : null);
        },
        "image/jpeg",
        quality,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

// Instagram feed accepts aspect ratios between 4:5 (0.8) and 1.91:1. Images
// outside that get CENTER-CROPPED by Instagram (cutting the subject). To avoid
// that non-destructively, pad an out-of-range PHOTO onto a canvas of the nearest
// allowed ratio — the full original sits centered, with a blurred fill in the
// bars — and send that to Instagram. Returns null when no padding is needed
// (in-range images are sent untouched) or for non-images.
const IG_MIN_RATIO = 0.8; // 4:5 (tallest portrait)
const IG_MAX_RATIO = 1.91; // 1.91:1 (widest landscape)

export function padForInstagram(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/")) return resolve(null);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const ratio = w / h;
      if (!w || !h || (ratio >= IG_MIN_RATIO && ratio <= IG_MAX_RATIO)) {
        URL.revokeObjectURL(url);
        return resolve(null); // already valid — send the original
      }
      // Nearest allowed ratio; expand the OTHER dimension (never crop). Use a
      // tiny safety margin + ceil so rounding can never land just outside the
      // allowed range (which would make Instagram crop it again).
      let cw: number;
      let ch: number;
      if (ratio < IG_MIN_RATIO) {
        // too tall -> widen (pad left/right); target slightly inside 4:5
        ch = h;
        cw = Math.ceil((IG_MIN_RATIO + 0.01) * h);
      } else {
        // too wide -> heighten (pad top/bottom); target slightly inside 1.91:1
        cw = w;
        ch = Math.ceil(w / (IG_MAX_RATIO - 0.02));
      }
      const canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        return resolve(null);
      }
      // Solid base (in case blur is unsupported), then a blurred cover fill.
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, cw, ch);
      try {
        ctx.filter = "blur(28px)";
        const cover = Math.max(cw / w, ch / h);
        const dw = w * cover;
        const dh = h * cover;
        ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
        ctx.filter = "none";
      } catch {
        /* blur unsupported -> solid bars */
      }
      // The full, unscaled original, centered — nothing cropped.
      ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
      canvas.toBlob(
        (b) => {
          URL.revokeObjectURL(url);
          resolve(b);
        },
        "image/jpeg",
        0.95,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

export const ACCEPTED = [
  "image/jpeg", "image/jpg", "image/png", "image/webp", "video/mp4", "video/quicktime",
];
export const ACCEPT_ATTR = ".jpg,.jpeg,.png,.webp,.mp4,.mov,image/*,video/*";

export function isAccepted(file: File) {
  const t = (file.type || "").toLowerCase();
  if (ACCEPTED.includes(t)) return true;
  // Some browsers report empty type for .mov — fall back to extension.
  return /\.(jpe?g|png|webp|mp4|mov)$/i.test(file.name);
}
