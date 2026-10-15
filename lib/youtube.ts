// YouTube upload via the Data API v3 resumable endpoint. A vertical, short
// (<=3 min) video is automatically classified as a Short; we also add #Shorts.

const UPLOAD = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";

export class QuotaError extends Error {
  constructor() { super("quotaExceeded"); this.name = "QuotaError"; }
}

export async function uploadShort(
  token: string,
  opts: { title: string; description: string; videoBytes: Buffer; mime?: string },
): Promise<{ videoId: string }> {
  const title = (opts.title || "Reel").slice(0, 100);
  const description = `${opts.description || ""}\n\n#Shorts`.trim().slice(0, 4900);
  const mime = opts.mime || "video/mp4";

  // 1) start a resumable session
  const startRes = await fetch(UPLOAD, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-upload-content-type": mime,
      "x-upload-content-length": String(opts.videoBytes.length),
    },
    body: JSON.stringify({
      snippet: { title, description, categoryId: "22" },
      status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
    }),
  });
  if (startRes.status === 403) {
    const t = await startRes.text();
    if (/quota/i.test(t)) throw new QuotaError();
    throw new Error(`YouTube start forbidden: ${t.slice(0, 160)}`);
  }
  if (!startRes.ok) {
    const t = await startRes.text();
    throw new Error(`YouTube resumable start failed (${startRes.status}): ${t.slice(0, 160)}`);
  }
  const location = startRes.headers.get("location");
  if (!location) throw new Error("YouTube did not return a resumable upload URL");

  // 2) upload the bytes in one PUT
  const putRes = await fetch(location, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": mime },
    body: opts.videoBytes,
  });
  const data = await putRes.json().catch(() => ({}));
  if (putRes.status === 403 && /quota/i.test(JSON.stringify(data))) throw new QuotaError();
  if (!putRes.ok || !data.id) {
    throw new Error(data?.error?.message || `YouTube upload failed (${putRes.status})`);
  }
  return { videoId: data.id };
}
