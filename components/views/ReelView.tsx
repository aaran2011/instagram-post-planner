"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useApp, Spinner } from "../ui";
import { api } from "../store";
import type { ClientMedia } from "../store";
import {
  autoBuild, applyInstruction, totalDuration, type Storyboard, type Clip, type Transition, type ReelPatterns,
} from "../reel-engine";
import {
  IconFilm, IconWand, IconPlay, IconPause, IconTrash, IconArrowUp, IconArrowDown,
  IconDownload, IconCalendar, IconUpload, IconClose, IconCheck, IconSparkle, IconHeart, IconComment,
} from "../icons";

const TRANSITIONS: Transition[] = ["cut", "dissolve", "slide", "whip"];

export default function ReelView() {
  const { state, go } = useApp();
  const [sb, setSb] = useState<Storyboard | null>(null);

  return (
    <div className="stack gap24" style={{ maxWidth: 1080 }}>
      <div className="sectionhead" style={{ marginBottom: 0 }}>
        <div className="htext">
          <h1>AI Reel Creator</h1>
          <p className="muted tiny">
            Learn what works from your own reels, then auto-assemble an editable reel from your uploaded
            clips &amp; photos. Uses only your media — nothing generated.
          </p>
        </div>
      </div>

      <InsightsPanel />

      {!sb ? (
        <BuilderStart onBuild={setSb} />
      ) : (
        <StoryboardEditor sb={sb} setSb={setSb} onRestart={() => setSb(null)} />
      )}
    </div>
  );
}

// ------------------------------ INSIGHTS ------------------------------

function InsightsPanel() {
  const { state } = useApp();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api.get("/api/reels/insights")
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setData({ error: e.message }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return (
    <div className="card" style={{ padding: 20 }}>
      <div className="flex gap8 mb12"><IconSparkle size={18} /><b>What performs best on your account</b></div>
      {loading && <div className="flex gap8 tiny muted"><Spinner /> Analyzing your reel history…</div>}
      {!loading && data?.error && <div className="banner warn"><div>{data.error}</div></div>}
      {!loading && data && !data.error && !data.connected && (
        <div className="banner warn"><div>{data.note}</div></div>
      )}
      {!loading && data?.connected && (
        <>
          {data.patterns ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 10 }}>
              <Stat label="Reels analyzed" value={String(data.count)} />
              <Stat label="Best day" value={data.patterns.bestDay || "—"} />
              <Stat label="Best hour" value={data.patterns.bestHour != null ? `${data.patterns.bestHour}:00` : "—"} />
              <Stat label="Avg caption" value={`${data.patterns.avgCaptionLength} chars`} />
              <Stat label="Avg likes (top)" value={String(data.patterns.avgLikes)} />
              <Stat label="Avg comments (top)" value={String(data.patterns.avgComments)} />
            </div>
          ) : (
            <div className="tiny muted">No reels found on your account yet.</div>
          )}
          {data.patterns?.topHashtags?.length > 0 && (
            <div className="taglist mt12">
              {data.patterns.topHashtags.map((t: string) => <span key={t} className="tag" style={{ paddingRight: 10 }}>{t}</span>)}
            </div>
          )}
          {data.note && <p className="tiny muted mt12">{data.note}</p>}
          {data.reels?.length > 0 && (
            <>
              <div className="tiny" style={{ fontWeight: 700, margin: "16px 0 8px" }}>Top reels</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(96px,1fr))", gap: 8 }}>
                {data.reels.slice(0, 8).map((r: any) => (
                  <a key={r.id} href={r.permalink || "#"} target="_blank" rel="noreferrer"
                    className="card" style={{ padding: 0, overflow: "hidden", textDecoration: "none" }}>
                    <div style={{ aspectRatio: "9/16", background: "var(--surface-2)" }}>
                      {r.thumbnailUrl && <img src={r.thumbnailUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                    </div>
                    <div className="tiny" style={{ padding: "4px 6px", display: "flex", gap: 8, color: "var(--text-2)" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><IconHeart size={12} /> {r.likes}</span>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><IconComment size={12} /> {r.comments}</span>
                    </div>
                  </a>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "var(--surface-2)", borderRadius: 10, padding: "10px 12px" }}>
      <div className="tiny muted">{label}</div>
      <div style={{ fontWeight: 700, fontSize: 16 }}>{value}</div>
    </div>
  );
}

// ------------------------------ BUILDER START ------------------------------

function BuilderStart({ onBuild }: { onBuild: (sb: Storyboard) => void }) {
  const { state, go, toast } = useApp();
  const media = state.media;
  const [selected, setSelected] = useState<Set<string>>(new Set(media.map((m) => m.id)));

  const patterns: ReelPatterns | null = null; // insights are shown above; selection is heuristic
  const chosen = media.filter((m) => selected.has(m.id));
  const vids = chosen.filter((m) => m.type === "video").length;
  const pics = chosen.filter((m) => m.type === "photo").length;

  function toggle(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function build() {
    if (chosen.length < 2) { toast("Select at least 2 clips/photos", "err"); return; }
    onBuild(autoBuild(chosen, patterns));
  }

  if (!media.length) {
    return (
      <div className="card" style={{ padding: 24, textAlign: "center" }}>
        <IconFilm size={28} />
        <div style={{ fontWeight: 650, marginTop: 8 }}>No media yet</div>
        <p className="tiny muted">Upload your BTS videos and photos first, then come back to auto-build a reel.</p>
        <button className="btn primary sm mt12" onClick={() => go("upload")}><IconUpload size={15} /> Go to Upload</button>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 20 }}>
      <div className="flex">
        <div className="grow">
          <b>Build a reel from your media</b>
          <p className="tiny muted mt8">Select the clips &amp; photos to consider. The strongest video opens as the hook; the rest interleave automatically. You can fully edit the result.</p>
        </div>
        <button className="btn subtle sm" onClick={() => go("upload")}><IconUpload size={14} /> Add media</button>
      </div>
      <div className="flex gap8 mt12 tiny muted">
        <span>{chosen.length} selected · {vids} video{vids === 1 ? "" : "s"}, {pics} photo{pics === 1 ? "" : "s"}</span>
        <div className="grow" />
        <button className="btn ghost sm" onClick={() => setSelected(new Set(media.map((m) => m.id)))}>All</button>
        <button className="btn ghost sm" onClick={() => setSelected(new Set())}>None</button>
      </div>
      <div className="mt12" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(84px,1fr))", gap: 8 }}>
        {media.map((m) => (
          <button key={m.id} onClick={() => toggle(m.id)}
            style={{ padding: 0, border: selected.has(m.id) ? "2px solid var(--accent)" : "2px solid transparent", borderRadius: 10, overflow: "hidden", cursor: "pointer", background: "var(--surface-2)", position: "relative", aspectRatio: "1" }}>
            <img src={m.thumbUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: selected.has(m.id) ? 1 : 0.5 }} />
            {m.type === "video" && <span style={{ position: "absolute", bottom: 3, left: 3, background: "rgba(0,0,0,.6)", color: "#fff", borderRadius: 5, padding: "1px 5px", fontSize: 9, fontWeight: 700 }}>VIDEO</span>}
            {selected.has(m.id) && <span style={{ position: "absolute", top: 3, right: 3, background: "var(--accent)", color: "#fff", borderRadius: "50%", width: 16, height: 16, display: "grid", placeItems: "center" }}><IconCheck size={10} /></span>}
          </button>
        ))}
      </div>
      <div className="flex mt16">
        <div className="grow" />
        <button className="btn primary" onClick={build}><IconWand size={16} /> Auto-create reel</button>
      </div>
    </div>
  );
}

// ------------------------------ STORYBOARD EDITOR ------------------------------

function StoryboardEditor({ sb, setSb, onRestart }: {
  sb: Storyboard; setSb: (s: Storyboard) => void; onRestart: () => void;
}) {
  const { state, toast } = useApp();
  const [instruction, setInstruction] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);

  function update(clips: Clip[]) { setSb({ ...sb, clips }); }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= sb.clips.length) return;
    const clips = sb.clips.slice();
    [clips[i], clips[j]] = [clips[j], clips[i]];
    update(clips);
  }
  function remove(id: string) { update(sb.clips.filter((c) => c.id !== id)); }
  function patch(id: string, p: Partial<Clip>) { update(sb.clips.map((c) => (c.id === id ? { ...c, ...p } : c))); }

  function runInstruction() {
    if (!instruction.trim()) return;
    const { sb: next, message } = applyInstruction(sb, instruction);
    setSb(next); setInstruction(""); toast(message, "ok");
  }

  function exportPlan() {
    const plan = {
      title: "Reel edit plan",
      aspect: sb.aspect,
      exportTarget: "2160×3840 (vertical 4K)",
      totalSeconds: totalDuration(sb),
      music: sb.music,
      clips: sb.clips.map((c, i) => ({
        order: i + 1, type: c.type, mediaId: c.mediaId,
        seconds: c.duration, speed: c.speed, transitionIn: c.transition, text: c.text, source: c.url,
      })),
      note: "Shot list / edit plan. Assemble in your editor at 2160×3840, then schedule the finished video below.",
    };
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "reel-edit-plan.json"; a.click();
    URL.revokeObjectURL(url);
    toast("Edit plan downloaded", "ok");
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 20, alignItems: "start" }} className="reel-grid">
      {/* Left: timeline */}
      <div className="stack gap16">
        <div className="card" style={{ padding: 16 }}>
          <div className="flex">
            <div className="grow"><b>Storyboard</b> <span className="tiny muted">· {sb.clips.length} clips · {totalDuration(sb)}s</span></div>
            <button className="btn ghost sm" onClick={onRestart}>Start over</button>
          </div>
          <div className="stack gap8 mt12">
            {sb.clips.map((c, i) => (
              <div key={c.id} className="flex gap12" style={{ alignItems: "center", background: "var(--surface-2)", borderRadius: 10, padding: 8 }}>
                <div style={{ width: 44, height: 60, borderRadius: 8, overflow: "hidden", background: "#000", flex: "none", position: "relative" }}>
                  <img src={c.thumbUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  <span style={{ position: "absolute", top: 2, left: 2, background: "rgba(0,0,0,.6)", color: "#fff", borderRadius: 4, fontSize: 9, padding: "0 4px", fontWeight: 700 }}>{i + 1}</span>
                </div>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="flex gap8 tiny" style={{ marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, textTransform: "uppercase", color: "var(--text-2)" }}>{c.type}</span>
                    <span className="muted">{c.duration}s</span>
                  </div>
                  <div className="flex gap6 wrap">
                    <label className="tiny muted" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      Dur
                      <input type="range" min={0.6} max={6} step={0.1} value={c.duration}
                        onChange={(e) => patch(c.id, { duration: Number(e.target.value) })} style={{ width: 70 }} />
                    </label>
                    <select className="select" style={{ height: 26, fontSize: 12, padding: "0 6px" }} value={c.transition}
                      onChange={(e) => patch(c.id, { transition: e.target.value as Transition })}>
                      {TRANSITIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    {c.type === "video" && (
                      <select className="select" style={{ height: 26, fontSize: 12, padding: "0 6px" }} value={c.speed}
                        onChange={(e) => patch(c.id, { speed: Number(e.target.value) })}>
                        {[0.5, 1, 1.5, 2].map((s) => <option key={s} value={s}>{s}×</option>)}
                      </select>
                    )}
                  </div>
                  <input className="input mt6" style={{ height: 28, fontSize: 12 }} placeholder="On-screen text (optional)"
                    value={c.text} onChange={(e) => patch(c.id, { text: e.target.value })} />
                </div>
                <div className="stack" style={{ gap: 2, flex: "none" }}>
                  <button className="btn ghost sm" style={{ padding: 4 }} onClick={() => move(i, -1)} disabled={i === 0}><IconArrowUp size={14} /></button>
                  <button className="btn ghost sm" style={{ padding: 4 }} onClick={() => move(i, 1)} disabled={i === sb.clips.length - 1}><IconArrowDown size={14} /></button>
                  <button className="btn ghost sm" style={{ padding: 4, color: "var(--danger)" }} onClick={() => remove(c.id)}><IconTrash size={14} /></button>
                </div>
              </div>
            ))}
            {!sb.clips.length && <div className="tiny muted">No clips left. Start over to rebuild.</div>}
          </div>
        </div>

        <div className="card" style={{ padding: 16 }}>
          <b className="tiny">Tell me what to change</b>
          <div className="flex gap8 mt8">
            <input className="input grow" placeholder='e.g. "make it faster" or "remove the third clip"'
              value={instruction} onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") runInstruction(); }} />
            <button className="btn subtle sm" onClick={runInstruction}><IconWand size={14} /> Apply</button>
          </div>
        </div>
      </div>

      {/* Right: preview + actions */}
      <div className="stack gap16">
        <div className="card" style={{ padding: 16 }}>
          <Preview sb={sb} />
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div className="tiny muted" style={{ marginBottom: 8 }}>
            Export target: <b>2160×3840 vertical 4K</b>. This tool produces the edit plan &amp; preview; assemble the final video in your editor, then schedule it below.
          </div>
          <button className="btn subtle sm" style={{ width: "100%", justifyContent: "center", marginBottom: 8 }} onClick={exportPlan}>
            <IconDownload size={15} /> Export edit plan (4K shot list)
          </button>
          <button className="btn primary sm" style={{ width: "100%", justifyContent: "center" }} onClick={() => setScheduleOpen(true)}>
            <IconCalendar size={15} /> Add to Calendar
          </button>
        </div>
      </div>

      {scheduleOpen && <ScheduleReelModal sb={sb} onClose={() => setScheduleOpen(false)} />}
    </div>
  );
}

// A real 9:16 sequenced preview player using the user's own media.
function Preview({ sb }: { sb: Storyboard }) {
  const [playing, setPlaying] = useState(false);
  const [idx, setIdx] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timer = useRef<any>(null);

  const clip = sb.clips[idx];

  useEffect(() => {
    if (!playing || !sb.clips.length) return;
    const c = sb.clips[idx];
    if (!c) { setPlaying(false); return; }
    const ms = (c.duration / (c.speed || 1)) * 1000;
    if (c.type === "video" && videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.playbackRate = c.speed || 1;
      videoRef.current.play().catch(() => {});
    }
    timer.current = setTimeout(() => {
      if (idx + 1 < sb.clips.length) setIdx(idx + 1);
      else { setPlaying(false); setIdx(0); }
    }, ms);
    return () => clearTimeout(timer.current);
  }, [playing, idx, sb.clips]);

  function toggle() {
    if (playing) { setPlaying(false); clearTimeout(timer.current); }
    else { setIdx(0); setPlaying(true); }
  }

  return (
    <div>
      <div style={{ position: "relative", aspectRatio: "9/16", borderRadius: 12, overflow: "hidden", background: "#000" }}>
        {clip && (clip.type === "video"
          ? <video ref={videoRef} src={clip.url} muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <img src={clip.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />)}
        {clip?.text && (
          <div style={{ position: "absolute", left: 0, right: 0, bottom: "16%", textAlign: "center", color: "#fff", fontWeight: 800, fontSize: 18, textShadow: "0 2px 8px rgba(0,0,0,.6)", padding: "0 16px" }}>
            {clip.text}
          </div>
        )}
        <div style={{ position: "absolute", top: 8, left: 8, right: 8, display: "flex", gap: 3 }}>
          {sb.clips.map((_, i) => (
            <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= idx ? "#fff" : "rgba(255,255,255,.35)" }} />
          ))}
        </div>
        <button onClick={toggle}
          style={{ position: "absolute", inset: 0, margin: "auto", width: 54, height: 54, borderRadius: "50%", border: "none", background: "rgba(0,0,0,.5)", color: "#fff", display: "grid", placeItems: "center", cursor: "pointer" }}>
          {playing ? <IconPause size={22} /> : <IconPlay size={22} />}
        </button>
      </div>
      <div className="tiny muted mt8" style={{ textAlign: "center" }}>Sequenced preview · {totalDuration(sb)}s · {sb.aspect}</div>
    </div>
  );
}

function ScheduleReelModal({ sb, onClose }: { sb: Storyboard; onClose: () => void }) {
  const { state, setState, toast, go } = useApp();
  const videos = state.media.filter((m) => m.type === "video");
  const firstVid = sb.clips.find((c) => c.type === "video")?.mediaId;
  const [mediaId, setMediaId] = useState<string>(firstVid || videos[0]?.id || "");
  const [caption, setCaption] = useState("");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);

  async function schedule() {
    if (!mediaId) { toast("Pick the finished vertical video to publish as the reel", "err"); return; }
    if (!when) { toast("Choose a date & time", "err"); return; }
    setBusy(true);
    try {
      const res = await api.post("/api/posts/create", {
        mediaIds: [mediaId],
        caption,
        format: "reel",
        scheduledAt: new Date(when).toISOString(),
      });
      setState(res);
      toast("Reel added to your calendar — it will auto-post at that time", "ok");
      onClose();
      go("calendar");
    } catch (e: any) {
      toast(e.message || "Could not schedule", "err");
    } finally { setBusy(false); }
  }

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 460, width: "94%" }}>
        <div className="flex" style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <b className="grow">Schedule reel</b>
          <button className="btn ghost sm" onClick={onClose}><IconClose size={18} /></button>
        </div>
        <div style={{ padding: 18 }} className="stack gap16">
          <div className="banner"><div className="tiny">Instagram publishes a real video file. Pick your finished vertical video (assembled from the edit plan) to post as the reel at your chosen time — using your existing calendar &amp; auto-scheduler.</div></div>
          <label className="field">
            <span>Finished reel video</span>
            {videos.length ? (
              <select className="select" value={mediaId} onChange={(e) => setMediaId(e.target.value)}>
                {videos.map((v) => <option key={v.id} value={v.id}>{v.originalName}</option>)}
              </select>
            ) : (
              <div className="tiny muted">No videos in your library yet. Upload your finished vertical reel first.</div>
            )}
          </label>
          <label className="field">
            <span>Caption</span>
            <textarea className="input" rows={3} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Write your caption…" />
          </label>
          <label className="field">
            <span>Date &amp; time</span>
            <input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </label>
          <div className="flex">
            <div className="grow" />
            <button className="btn primary" onClick={schedule} disabled={busy || !videos.length}>
              {busy ? <Spinner /> : <IconCalendar size={16} />} Add to Calendar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
