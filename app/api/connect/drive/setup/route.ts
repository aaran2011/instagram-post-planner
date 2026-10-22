import { NextRequest } from "next/server";
import { guard, badRequest, json } from "@/lib/api";
import { currentAccountId, updateAccount } from "@/lib/db";
import { getValidYouTubeToken, NEEDS_RECONNECT } from "@/lib/oauth";
import { ensureDriveFolder, DriveSetupError } from "@/lib/drive";
import { buildClientState } from "@/lib/state";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Turn the Google Drive image-mirror on/off. Turning it on creates (or reuses)
// the app's Drive folder and returns its shareable link to wire to LinkedIn.
export async function POST(req: NextRequest) {
  const denied = guard();
  if (denied) return denied;
  const uid = await currentAccountId();
  if (!uid) return badRequest("Not signed in");

  let body: any = {};
  try { body = await req.json(); } catch {}
  const enable = body?.enabled !== false; // default: turn on

  if (!enable) {
    await updateAccount(uid, (d) => { d.crossPost.driveMirror = false; });
    return json({ ...(await buildClientState()) });
  }

  try {
    const token = await getValidYouTubeToken(uid); // Google connection (YouTube) carries Drive scope
    const folder = await ensureDriveFolder(token);
    await updateAccount(uid, (d) => {
      d.crossPost.driveMirror = true;
      d.crossPost.driveFolderId = folder.id;
      d.crossPost.driveFolderLink = folder.link;
    });
    return json({ folderLink: folder.link, ...(await buildClientState()) });
  } catch (e: any) {
    if (e?.message === NEEDS_RECONNECT) {
      return json({ error: "Connect Google (YouTube) first — the Drive folder uses that same connection." }, 400);
    }
    if (e instanceof DriveSetupError) {
      return json({ error: "Reconnect Google to grant Drive access (Disconnect then Connect YouTube), and make sure the Google Drive API is enabled for the project." }, 400);
    }
    return json({ error: e?.message || "Could not set up the Drive folder" }, 500);
  }
}
