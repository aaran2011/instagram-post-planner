import { guard, json } from "@/lib/api";
import { currentAccountId, deleteUser } from "@/lib/db";
import { clearSessionCookie } from "@/lib/session";
import { removeUpload, removeThumb } from "@/lib/blobstore";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Permanently delete ONLY the signed-in account: its user, its isolated data,
// and its Instagram connection/token — nothing elsewhere. Other accounts are
// untouched. This removes the LOCAL Instagram connection for this account only;
// it does not (and cannot) alter the actual Instagram account. Then signs out.
export async function POST() {
  const denied = guard();
  if (denied) return denied;

  const uid = await currentAccountId();
  if (!uid) { clearSessionCookie(); return json({ ok: true }); }

  const removed = await deleteUser(uid);

  // Best-effort cleanup of this account's stored media files (so nothing is
  // left behind in storage). Only this account's media — it's isolated.
  if (removed) {
    for (const m of removed.media) {
      try { await removeUpload(m.file); } catch {}
      try { if (m.thumb) await removeThumb(m.thumb); } catch {}
      try { if (m.igUrl && /^https?:\/\//i.test(m.igUrl)) await removeUpload(m.igUrl); } catch {}
    }
  }

  clearSessionCookie();
  return json({ ok: true });
}
