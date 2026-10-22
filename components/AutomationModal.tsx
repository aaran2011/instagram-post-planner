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

// Suggest an editable post time: the next preferred posting time, staggered one
// per day (matching the "one per day" rule). Returned as a datetime-local value.
function suggestWhen(index: number, times: string[]): string {
  const [h, m] = ((times && times[0]) || "11:00").split(":").map((n) => parseInt(n, 10));
  const d = new Date();
  d.setHours(isNaN(h) ? 11 : h, isNaN(m) ? 0 : m, 0, 0);
  if (d.getTime() < Date.now() + 5 * 60 * 1000) d.setDate(d.getDate() + 1); // past today → tomorrow
  d.setDate(d.getDate() + index); // one item per day
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function AutomationModal({ onClose }: { onClose: () => void }) {
  const { state, setState, toast } = useApp();
  const cp = state.crossPost;
  const liConnected = state.linkedin.connected;
  const ytConnected = state.youtube.connected;

  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Backfill tool: schedule all past posts from a chosen date, one per day.
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const ninetyAgo = (() => { const d = new Date(); d.setDate(d.getDate() - 90); return ymd(d); })();
  const [bfSince, setBfSince] = useState(ninetyAgo);
  const [bfTime, setBfTime] = useState((state.settings.defaultTimes && state.settings.defaultTimes[0]) || "11:00");
  const [bfLi, setBfLi] = useState(liConnected);
  const [bfYt, setBfYt] = useState(ytConnected);
  const [bfBusy, setBfBusy] = useState(false);
  const [bfResult, setBfResult] = useState<string | null>(null);

  async function runBackfill() {
    if (!bfSince) { toast("Pick a start date", "err"); return; }
    const dests = [...(bfLi ? ["linkedin"] : []), ...(bfYt ? ["youtube"] : [])];
    if (!dests.length) { toast("Pick at least one destination", "err"); return; }
    const sinceIso = new Date(`${bfSince}T00:00:00`).toISOString();
    const [h, m] = (bfTime || "11:00").split(":").map((n) => parseInt(n, 10));
    const f = new Date();
    f.setHours(isNaN(h) ? 11 : h, isNaN(m) ? 0 : m, 0, 0);
    if (f.getTime() < Date.now() + 5 * 60 * 1000) f.setDate(f.getDate() + 1); // first slot not in the past
    setBfBusy(true);
    setBfResult(null);
    try {
      const res = await api.post("/api/crosspost/backfill", { since: sinceIso, firstAt: f.toISOString(), destinations: dests });
      if (res.error) { toast(res.error, "err"); return; }
      setState(res);
      // One action covers BOTH past and future: also switch on the standing
      // auto-repost rule so everything posted from now on is reposted too.
      await patchCrossPost({ enabled: true, destinations: { linkedin: bfLi, youtube: bfYt } });
      if (res.scheduled > 0) {
        const first = res.firstAt ? new Date(res.firstAt).toLocaleDateString() : "";
        const last = res.lastAt ? new Date(res.lastAt).toLocaleDateString() : "";
        setBfResult(`Scheduled ${res.scheduled} past post${res.scheduled > 1 ? "s" : ""}, one per day — ${first} → ${last}. Auto-repost is now ON for new posts too.`);
        toast(`Scheduled ${res.scheduled} post${res.scheduled > 1 ? "s" : ""} + turned on auto-repost`, "ok");
      } else {
        setBfResult("No past posts to schedule in that range — but auto-repost is now ON, so everything you post from now on will be reposted.");
        toast("Auto-repost turned on", "ok");
      }
    } catch (e: any) { toast(e.message || "Failed", "err"); }
    finally { setBfBusy(false); }
  }

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
                  Nothing is changed — same video, music and caption. <b>At most one post per day</b>, within ~15 min. Applies to <i>new</i> posts; use “Schedule your past posts” below to catch up on older ones.
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

          {/* backfill + standing rule in one action: from a date, past AND future */}
          <div className="card" style={{ padding: 16, borderColor: "var(--accent)" }}>
            <b>Repost everything from a date onward</b>
            <p className="tiny muted mt8">
              Pick a start date. Every Instagram post from that date up to today gets queued and reposted
              <b> one per day</b> (oldest first), <b>and</b> everything you post from now on is auto‑reposted too — one action covers past &amp; future.
              Reels/videos → LinkedIn + YouTube Shorts; photos &amp; carousels → LinkedIn only (YouTube can't take images). Captions, video &amp; music are never changed.
            </p>
            <div className="flex gap12 mt12 wrap" style={{ alignItems: "flex-end" }}>
              <label className="stack" style={{ gap: 4 }}>
                <span className="tiny muted">From date</span>
                <input className="input" type="date" value={bfSince} max={ymd(new Date())}
                  onChange={(e) => setBfSince(e.target.value)} style={{ height: 32, fontSize: 13 }} />
              </label>
              <label className="stack" style={{ gap: 4 }}>
                <span className="tiny muted">Daily time</span>
                <input className="input" type="time" value={bfTime}
                  onChange={(e) => setBfTime(e.target.value)} style={{ height: 32, fontSize: 13, width: 120 }} />
              </label>
              <div className="flex gap12" style={{ alignItems: "center", paddingBottom: 6 }}>
                <label className="flex gap6 tiny" style={{ cursor: liConnected ? "pointer" : "not-allowed", alignItems: "center", opacity: liConnected ? 1 : 0.5 }}>
                  <input type="checkbox" checked={bfLi} disabled={!liConnected} onChange={(e) => setBfLi(e.target.checked)} style={{ accentColor: "var(--accent)" }} />
                  <IconLinkedIn size={13} /> LinkedIn
                </label>
                <label className="flex gap6 tiny" style={{ cursor: ytConnected ? "pointer" : "not-allowed", alignItems: "center", opacity: ytConnected ? 1 : 0.5 }}
                  title="YouTube takes reels/videos only">
                  <input type="checkbox" checked={bfYt} disabled={!ytConnected} onChange={(e) => setBfYt(e.target.checked)} style={{ accentColor: "var(--accent)" }} />
                  <IconYouTube size={13} /> YouTube
                </label>
              </div>
              <div className="grow" />
              <button className="btn primary sm" onClick={runBackfill} disabled={bfBusy} style={{ marginBottom: 2 }}>
                {bfBusy ? <Spinner /> : "Start reposting"}
              </button>
            </div>
            {bfResult && <div className="tiny mt12" style={{ color: "var(--success)" }}>{bfResult}</div>}
            {!liConnected && !ytConnected && (
              <div className="tiny muted mt8">Connect LinkedIn or YouTube first to use this.</div>
            )}
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
              {items.map((it, i) => (
                <ReviewRow key={it.id} item={it} liConnected={liConnected} ytConnected={ytConnected}
                  defaultWhen={suggestWhen(i, state.settings.defaultTimes)}
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

function ReviewRow({ item, liConnected, ytConnected, defaultWhen, onDone, onState, toast }: {
  item: ReviewItem; liConnected: boolean; ytConnected: boolean; defaultWhen: string;
  onDone: (reposted: boolean) => void; onState: (s: any) => void; toast: (m: string, t?: "ok" | "err" | "info") => void;
}) {
  const [li, setLi] = useState(liConnected);
  const [yt, setYt] = useState(ytConnected && item.isVideo);
  const [when, setWhen] = useState(defaultWhen); // suggested time, editable
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
        if (ok) { toast("Posted ✓", "ok"); onDone(true); }
        else {
          const why =
            (e.youtube && !e.youtube.ok && (e.youtube.error || e.youtube.skipped)) ||
            (e.linkedin && !e.linkedin.ok && (e.linkedin.error || e.linkedin.skipped)) ||
            "no destination handled this item";
          toast("Couldn't post: " + why, "err");
        }
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
          <span className="tiny muted" title="Suggested time — edit if you like">at</span>
          <input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}
            title="Suggested time — editable" style={{ height: 28, fontSize: 12, width: 178 }} />
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
