import { upload } from "@vercel/blob/client";
import { extract } from "./media-utils";
import { api } from "./store";
import type { ClientMedia } from "./store";

const EXT_MAP: Record<string, string> = {
  "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/png": ".png",
  "image/webp": ".webp", "video/mp4": ".mp4", "video/quicktime": ".mov",
};
function extFor(file: File): string {
  const t = (file.type || "").toLowerCase();
  if (EXT_MAP[t]) return EXT_MAP[t];
  const m = file.name.match(/\.[a-z0-9]+$/i);
  return m ? m[0] : "";
}

// Upload one file and return its created media record. Uses direct-to-Blob for
// large files (>4MB) and the server route otherwise. Reusable by any UI.
export async function uploadFile(
  file: File,
  blobDirect: boolean,
  onProgress?: (pct: number) => void,
): Promise<ClientMedia> {
  const type: "photo" | "video" =
    file.type.startsWith("video/") || /\.mov$/i.test(file.name) ? "video" : "photo";
  const meta = await extract(file);

  if (blobDirect && file.size > 4 * 1024 * 1024) {
    const tmp = "u" + Math.random().toString(36).slice(2, 12);
    const ctrl = new AbortController();
    const stall = setTimeout(() => ctrl.abort(), 120000);
    try {
      const fileRes = await upload(`uploads/${tmp}${extFor(file)}`, file, {
        access: "public",
        handleUploadUrl: "/api/blob/upload",
        contentType: file.type || undefined,
        abortSignal: ctrl.signal,
        onUploadProgress: (p) => onProgress?.(Math.round(p.percentage)),
      });
      let thumbUrl: string | undefined;
      if (meta.thumb) {
        const t = await upload(`thumbs/${tmp}.jpg`, meta.thumb, {
          access: "public",
          handleUploadUrl: "/api/blob/upload",
          contentType: "image/jpeg",
          abortSignal: ctrl.signal,
        });
        thumbUrl = t.url;
      }
      const res = await api.post("/api/media/register", {
        fileUrl: fileRes.url, thumbUrl, type,
        originalName: file.name, mime: file.type, size: file.size,
        width: meta.width, height: meta.height, duration: meta.duration,
      });
      return res.media as ClientMedia;
    } finally {
      clearTimeout(stall);
    }
  }

  // Server route (normal-size files).
  const fd = new FormData();
  fd.append("file", file);
  if (meta.thumb) fd.append("thumb", meta.thumb, "thumb.jpg");
  fd.append("originalName", file.name);
  if (meta.width) fd.append("width", String(meta.width));
  if (meta.height) fd.append("height", String(meta.height));
  if (meta.duration) fd.append("duration", String(meta.duration));

  return new Promise<ClientMedia>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      try {
        const d = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && d.media) resolve(d.media as ClientMedia);
        else reject(new Error(d.error || `Upload failed (${xhr.status})`));
      } catch {
        reject(new Error(`Server error ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(fd);
  });
}
