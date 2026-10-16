"use client";
import React, { useEffect, useMemo, useState } from "react";
import { useApp, Spinner } from "./ui";
import { api } from "./store";
import {
  IconClose, IconInstagram, IconLinkedIn, IconYouTube, IconCheck, IconBolt,
} from "./icons";

interface ReviewItem {
  id: string; mediaType: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM"; caption: string;
  thumbUrl: string | null; permalink: string | null; timestamp: string | null;
  isVideo: boolean; reposted: boolean; queued: boolean;
}

export default function AutomationModal({ onClose }: { onClose: () => void }) {
  const { state, setState, toast } = useApp();
  const cp = state.crossPost;
  const liConnected = state.linkedin.connected;
  const ytConnected = state.youtube.connected;

  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.get("/api/crosspost/media")
      .then((d) => { if (alive) setItems(d.items || []); })
      .catch((e) => { if (alive) setErr(e.message || "Could not load Instagram media"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  async function patchCrossPost(partial: any) {
    try {
      const res = await api.patch("/api/settings", { crossPost: partial });
      setState((prev) => ({ ...prev, crossPost: res.crossPost }));
    } catch (e: any) { toast(e.message, "err"); }
  }

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 760, width: "96%", maxHeight: "92vh", display: "flex", flexDirection: "column" }}>
        <div className="flex" style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <div className="flex gap8"><IconBolt size={18} /><b>Automation</b></div>
          <div className="grow" />
          <button className="btn ghost sm" onClick={onClose}><IconClose size={18} /></button>
        </div>

        <div style={{ padding: 18, overflowY: "auto" }} className="stack gap16">
          {/* connected platforms */}
          <div className="flex gap8 wrap">
            <PlatformChip icon={<IconInstagram size={14} />} label="Instagram" sub="source" on={state.instagram.connected} />
            <PlatformChip icon={<IconLinkedIn size={14} />} label="LinkedIn" sub="reels + images" on={liConnected} />
            <PlatformChip icon={<IconYouTube size={14} />} label="YouTube" sub="reels only" on={ytConnected} />
          </div>

          {/* standing rule */}
          <div className="card" style={{ padding: 16 }}>
            <div className="flex gap12">
              <div className="grow">
                <b>Auto-repost new Instagram posts</b>
                <p className="tiny muted mt8">
                  Reels/videos → LinkedIn + YouTube Shorts · Photos &amp; carousels → LinkedIn only.
                  Nothing is changed — same video, music and caption. Runs within ~15 min; starts from now (no backfill).
                </p>
              </div>
              <ToggleSm on={cp.enabled} onChange={(v) => patchCrossPost({ enabled: v })} />
            </div>
            <div className="flex gap16 mt12 wrap">
              <label className="flex gap6 tiny" style={{ cursor: "pointer", alignItems: "center" }}>
                <input type="checkbox" checked={cp.destinations.linkedin} onChange={(e) => patchCrossPost({ destinations: { linkedin: e.target.checked } })} style={{ accentColor: "var(--accent)" }} />
                <IconLinkedIn size={13} /> LinkedIn
              </label>
              <label className="flex gap6 tiny" style={{ cursor: "pointer", alignItems: "center" }}>
                <input type="checkbox" checked={cp.destinations.youtube} onChange={(e) => patchCrossPost({ destinations: { youtube: e.target.checked } })} style={{ accentColor: "var(--accent)" }} />
                <IconYouTube size={13} /> YouTube Shorts (reels)
              </label>
            </div>
          </div>

          {/* review + schedule specific posts */}
          <div>
            <div className="flex">
              <b className="grow">Your Instagram posts</b>
              <span className="tiny muted" style={{ alignSelf: "center" }}>pick where &amp; when each goes</span>
            </div>
            <p className="tiny muted mt8">Choose destinations and post now, or set a date &amp; time to schedule it. Videos can go to both; photos/carousels go to LinkedIn only.</p>

            {loading && <div className="flex gap8 tiny muted mt12"><Spinner /> Loading your Instagram posts…</div>}
            {err && <div className="banner warn mt12"><div>{err}</div></div>}
            {!loading && !err && items.length === 0 && <div className="tiny muted mt12">No Instagram posts found (connect a real Instagram account — demo mode has none).</div>}

            <div className="stack gap8 mt12">
              {items.map((it) => (
                <ReviewRow key={it.id} item={it} liConnected={liConnected} ytConnected={ytConnected}
                  onDone={(reposted) => setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, reposted: reposted || x.reposted } : x)))}
                  onState={(res) => setState(res)} toast={toast} />
              ))}
            </div>
          </div>

          {/* scheduled jobs */}
          {cp.jobs.filter((j) => j.status === "scheduled").length > 0 && (
            <div className="card" style={{ padding: 16 }}>
              <b className="tiny">Scheduled reposts</b>
              <div className="rows mt8">
                {cp.jobs.filter((j) => j.status === "scheduled").slice(0, 10).map((j) => (
                  <div key={j.id} className="row">
                    <div className="rowmain">
                      <div className="rowtitle tiny">{j.caption?.slice(0, 50) || j.igId}</div>
                      <div className="rowsub tiny">{new Date(j.scheduledAt).toLocaleString()} · {j.destinations.join(" + ")}</div>
                    </div>
                    <span className="pill tiny"><span className="dot" /> {j.mediaType === "VIDEO" ? "reel" : "photo"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewRow({ item, liConnected, ytConnected, onDone, onState, toast }: {
  item: ReviewItem; liConnected: boolean; ytConnected: boolean;
  onDone: (reposted: boolean) => void; onState: (s: any) => void; toast: (m: string, t?: "ok" | "err" | "info") => void;
}) {
  const [li, setLi] = useState(liConnected);
  const [yt, setYt] = useState(ytConnected && item.isVideo);
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);

  const destinations = [...(li ? ["linkedin"] : []), ...(yt && item.isVideo ? ["youtube"] : [])];

  async function run(schedule: boolean) {
    if (!destinations.length) { toast("Pick at least one destination", "err"); return; }
    if (schedule && !when) { toast("Choose a date & time", "err"); return; }
    setBusy(true);
    try {
      const res = await api.post("/api/crosspost/run", {
        igId: item.id, destinations, scheduledAt: schedule ? new Date(when).toISOString() : undefined,
      });
      if (res.error) { toast(res.error, "err"); return; }
      onState(res);
      if (res.scheduled) toast("Scheduled", "ok");
      else {
        const e = res.entry || {};
        const ok = e.linkedin?.ok || e.youtube?.ok;
        toast(ok ? "Posted" : "Couldn't post — check connections", ok ? "ok" : "err");
        onDone(Boolean(ok));
      }
    } catch (e: any) { toast(e.message || "Failed", "err"); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex gap12" style={{ alignItems: "center", background: "var(--surface-2)", borderRadius: 10, padding: 8 }}>
      <div style={{ width: 46, height: 60, borderRadius: 8, overflow: "hidden", background: "#000", flex: "none", position: "relative" }}>
        {item.thumbUrl ? <img src={item.thumbUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
        <span style={{ position: "absolute", top: 2, left: 2, background: "rgba(0,0,0,.6)", color: "#fff", borderRadius: 4, padding: "0 4px", fontSize: 9, fontWeight: 700 }}>
          {item.isVideo ? "REEL" : item.mediaType === "CAROUSEL_ALBUM" ? "ALBUM" : "PHOTO"}
        </span>
      </div>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="tiny" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.caption?.slice(0, 80) || "(no caption)"}</div>
        {item.reposted && <span className="pill ok tiny mt6"><span className="dot" /> reposted</span>}
        {item.queued && !item.reposted && <span className="pill tiny mt6"><span className="dot" /> scheduled</span>}
        <div className="flex gap8 mt6 wrap" style={{ alignItems: "center" }}>
          <label className="flex gap4 tiny" style={{ cursor: "pointer", alignItems: "center" }}>
            <input type="checkbox" checked={li} disabled={!liConnected} onChange={(e) => setLi(e.target.checked)} style={{ accentColor: "var(--accent)" }} />
            <IconLinkedIn size={12} /> LinkedIn
          </label>
          <label className="flex gap4 tiny" style={{ cursor: item.isVideo ? "pointer" : "not-allowed", alignItems: "center", opacity: item.isVideo ? 1 : 0.5 }}
            title={item.isVideo ? "" : "YouTube takes videos only"}>
            <input type="checkbox" checked={yt} disabled={!ytConnected || !item.isVideo} onChange={(e) => setYt(e.target.checked)} style={{ accentColor: "var(--accent)" }} />
            <IconYouTube size={12} /> YouTube
          </label>
          <input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} style={{ height: 28, fontSize: 12, width: 180 }} />
        </div>
      </div>
      <div className="stack" style={{ gap: 4, flex: "none" }}>
        <button className="btn primary sm" onClick={() => run(false)} disabled={busy}>{busy ? <Spinner /> : "Post now"}</button>
        <button className="btn subtle sm" onClick={() => run(true)} disabled={busy}>Schedule</button>
      </div>
    </div>
  );
}

function PlatformChip({ icon, label, sub, on }: { icon: React.ReactNode; label: string; sub: string; on: boolean }) {
  return (
    <div className="flex gap6" style={{ alignItems: "center", background: on ? "var(--accent-soft)" : "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 999, padding: "5px 12px" }}>
      {icon}
      <span className="tiny" style={{ fontWeight: 650 }}>{label}</span>
      <span className="tiny muted">· {on ? sub : "not connected"}</span>
      {on && <IconCheck size={12} />}
    </div>
  );
}

function ToggleSm({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} aria-pressed={on}
      style={{ width: 46, height: 27, borderRadius: 999, border: "none", padding: 3, cursor: "pointer", background: on ? "var(--accent)" : "var(--border-strong)", transition: "background .2s", flex: "none" }}>
      <span style={{ display: "block", width: 21, height: 21, borderRadius: "50%", background: "#fff", transform: on ? "translateX(19px)" : "none", transition: "transform .2s", boxShadow: "0 1px 3px rgba(0,0,0,.3)" }} />
    </button>
  );
}
