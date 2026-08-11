import fs2 from "fs/promises";
import { put, del } from "@vercel/blob";
import { ensureDirs, uploadPath, thumbPath } from "./paths";

// Media storage backend.
//  - Production (Vercel): Vercel Blob (public CDN URLs Instagram can fetch).
//  - Local dev: files under ./data/uploads + ./data/thumbs.
// Chosen by presence of BLOB_READ_WRITE_TOKEN.

export function usingBlob() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export interface Stored {
  key: string; // used for deletion (blob URL in blob mode, filename on disk)
  url: string | null; // absolute public URL in blob mode; null on disk
}

export async function saveUpload(storedName: string, data: Buffer, contentType: string): Promise<Stored> {
  if (usingBlob()) {
    const res = await put(`uploads/${storedName}`, data, {
      access: "public",
      contentType,
      addRandomSuffix: false,
    });
    return { key: res.url, url: res.url };
  }
  ensureDirs();
  await fs2.writeFile(uploadPath(storedName), data);
  return { key: storedName, url: null };
}

export async function saveThumb(thumbName: string, data: Buffer): Promise<Stored> {
  if (usingBlob()) {
    const res = await put(`thumbs/${thumbName}`, data, {
      access: "public",
      contentType: "image/jpeg",
      addRandomSuffix: false,
    });
    return { key: res.url, url: res.url };
  }
  ensureDirs();
  await fs2.writeFile(thumbPath(thumbName), data);
  return { key: thumbName, url: null };
}

export async function removeUpload(key: string) {
  if (usingBlob()) {
    try { await del(key); } catch {}
    return;
  }
  try { await fs2.unlink(uploadPath(key)); } catch {}
}

export async function removeThumb(key: string) {
  if (usingBlob()) {
    try { await del(key); } catch {}
    return;
  }
  try { await fs2.unlink(thumbPath(key)); } catch {}
}
