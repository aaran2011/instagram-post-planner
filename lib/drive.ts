// Google Drive mirror. Uses the Google OAuth connection (drive.file scope) to
// create ONE app-owned folder and drop published Instagram images into it, with
// the exact caption stored as the file description. The user connects that
// folder to LinkedIn with a free connector (Zapier/Make) — this is how images
// reach LinkedIn without LinkedIn's (blocked) developer API.
//
// drive.file scope is deliberately minimal: the app can only touch files/folders
// it created itself, never the rest of the user's Drive.

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export const FOLDER_NAME = "Instagram → LinkedIn (via Planner)";

// Thrown when the token lacks the Drive scope (older connection) or the Drive
// API isn't enabled — both need a one-time user action, surfaced in the UI.
export class DriveSetupError extends Error {}

async function asError(res: Response): Promise<string> {
  const d = await res.json().catch(() => ({} as any));
  return d?.error?.message || d?.error_description || `Drive request failed (${res.status})`;
}

// Find the app's folder (created earlier) or create it. Returns id + shareable
// link. The folder is made readable by anyone with the link so a connector can
// pull the images.
export async function ensureDriveFolder(token: string): Promise<{ id: string; link: string }> {
  const q = `name = '${FOLDER_NAME.replace(/'/g, "\\'")}' and mimeType = '${FOLDER_MIME}' and trashed = false`;
  const find = await fetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,webViewLink)&spaces=drive&pageSize=1`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (find.status === 401 || find.status === 403) throw new DriveSetupError(await asError(find));
  if (find.ok) {
    const data = await find.json().catch(() => ({} as any));
    const existing = Array.isArray(data?.files) ? data.files[0] : null;
    if (existing?.id) return { id: existing.id, link: existing.webViewLink || folderLink(existing.id) };
  }

  const create = await fetch(`${DRIVE_API}/files?fields=id,webViewLink`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
  });
  if (!create.ok) throw new DriveSetupError(await asError(create));
  const folder = await create.json();
  // Best-effort: make the folder viewable by anyone with the link.
  try {
    await fetch(`${DRIVE_API}/files/${folder.id}/permissions`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ role: "reader", type: "anyone" }),
    });
  } catch { /* link sharing is a nicety, not required */ }
  return { id: folder.id, link: folder.webViewLink || folderLink(folder.id) };
}

function folderLink(id: string): string {
  return `https://drive.google.com/drive/folders/${id}`;
}

// Upload one image's bytes into the folder, with the caption as its description.
export async function uploadImageToDrive(
  token: string,
  folderId: string,
  file: { name: string; bytes: Buffer; mime: string; description: string },
): Promise<{ id: string; link: string }> {
  const boundary = "planner" + Date.now().toString(36);
  const metadata = { name: file.name, parents: [folderId], description: file.description.slice(0, 4000) };
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`),
    Buffer.from(JSON.stringify(metadata)),
    Buffer.from(`\r\n--${boundary}\r\nContent-Type: ${file.mime || "image/jpeg"}\r\n\r\n`),
    file.bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await fetch(`${DRIVE_UPLOAD}?uploadType=multipart&fields=id,webViewLink`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (res.status === 401 || res.status === 403) throw new DriveSetupError(await asError(res));
  if (!res.ok) throw new Error(await asError(res));
  const d = await res.json();
  return { id: d.id, link: d.webViewLink || `https://drive.google.com/file/d/${d.id}/view` };
}
