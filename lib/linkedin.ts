// LinkedIn member posting via the versioned REST API. Posts text+image,
// multi-image (carousel) and video on behalf of the authenticated member.
// Bytes are uploaded directly (not by handing LinkedIn a URL), which also
// sidesteps Instagram's time-limited CDN URLs.

const REST = "https://api.linkedin.com/rest";
// LinkedIn versions monthly; override via env if this one is rotated out.
const VERSION = process.env.LINKEDIN_API_VERSION || "202608";

function headers(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "linkedin-version": VERSION,
    "x-restli-protocol-version": "2.0.0",
    "content-type": "application/json",
  };
}

// LinkedIn "commentary" uses a little-text format where these are reserved and
// must be escaped to render literally.
function escapeText(s: string): string {
  return (s || "").replace(/[\\<>#~_|{}@\[\]()*]/g, (c) => "\\" + c).slice(0, 2900);
}

async function liJson(res: Response, ctx: string) {
  const text = await res.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data?.message || data?.raw || `${ctx} (${res.status})`);
  return data;
}

async function registerImage(token: string, owner: string): Promise<{ uploadUrl: string; urn: string }> {
  const res = await fetch(`${REST}/images?action=initializeUpload`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ initializeUploadRequest: { owner } }),
  });
  const data = await liJson(res, "LinkedIn image init");
  return { uploadUrl: data.value.uploadUrl, urn: data.value.image };
}

async function putBytes(uploadUrl: string, token: string, bytes: Buffer, mime: string): Promise<string | null> {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": mime || "application/octet-stream" },
    body: bytes,
  });
  if (!res.ok) throw new Error(`LinkedIn upload PUT failed (${res.status})`);
  return res.headers.get("etag");
}

function createPostBody(author: string, caption: string, content: any) {
  return {
    author,
    commentary: escapeText(caption),
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    content,
    lifecycleState: "PUBLISHED",
    isReblogDisabledByAuthor: false,
  };
}

async function createPost(token: string, body: any): Promise<string> {
  const res = await fetch(`${REST}/posts`, { method: "POST", headers: headers(token), body: JSON.stringify(body) });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`LinkedIn post create failed (${res.status}): ${t.slice(0, 160)}`);
  }
  return res.headers.get("x-restli-id") || res.headers.get("x-linkedin-id") || "posted";
}

export async function postImage(token: string, author: string, caption: string, bytes: Buffer, mime: string): Promise<{ id: string }> {
  const { uploadUrl, urn } = await registerImage(token, author);
  await putBytes(uploadUrl, token, bytes, mime);
  const id = await createPost(token, createPostBody(author, caption, { media: { id: urn } }));
  return { id };
}

export async function postMultiImage(
  token: string, author: string, caption: string, images: { bytes: Buffer; mime: string }[],
): Promise<{ id: string }> {
  if (images.length === 1) return postImage(token, author, caption, images[0].bytes, images[0].mime);
  const urns: string[] = [];
  for (const img of images) {
    const { uploadUrl, urn } = await registerImage(token, author);
    await putBytes(uploadUrl, token, img.bytes, img.mime);
    urns.push(urn);
  }
  const id = await createPost(
    token,
    createPostBody(author, caption, { multiImage: { images: urns.map((u) => ({ id: u })) } }),
  );
  return { id };
}

export async function postVideo(token: string, author: string, caption: string, bytes: Buffer): Promise<{ id: string }> {
  // 1) initialize upload
  const initRes = await fetch(`${REST}/videos?action=initializeUpload`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({
      initializeUploadRequest: { owner: author, fileSizeBytes: bytes.length, uploadCaptions: false, uploadThumbnail: false },
    }),
  });
  const init = await liJson(initRes, "LinkedIn video init");
  const videoUrn: string = init.value.video;
  const instructions: any[] = init.value.uploadInstructions || [];
  const uploadToken: string = init.value.uploadToken ?? "";

  // 2) upload each part, collecting ETags
  const etags: string[] = [];
  for (const inst of instructions) {
    const first = Number(inst.firstByte) || 0;
    const last = inst.lastByte != null ? Number(inst.lastByte) : bytes.length - 1;
    const slice = bytes.subarray(first, last + 1);
    const etag = await putBytes(inst.uploadUrl, token, slice, "application/octet-stream");
    if (etag) etags.push(etag);
  }

  // 3) finalize
  const finRes = await fetch(`${REST}/videos?action=finalizeUpload`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ finalizeUploadRequest: { video: videoUrn, uploadToken, uploadedPartIds: etags } }),
  });
  if (!finRes.ok) throw new Error(`LinkedIn video finalize failed (${finRes.status})`);

  // 4) create the post referencing the video urn (processing continues async)
  const id = await createPost(token, createPostBody(author, caption, { media: { id: videoUrn } }));
  return { id };
}

// Fallback when member video posting isn't available: a plain text post with a link.
export async function postText(token: string, author: string, caption: string): Promise<{ id: string }> {
  const id = await createPost(token, {
    author,
    commentary: escapeText(caption),
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED",
    isReblogDisabledByAuthor: false,
  });
  return { id };
}
