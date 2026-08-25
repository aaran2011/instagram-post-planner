"use client";
import React, { useEffect, useRef, useState } from "react";
import { useApp, Spinner } from "../ui";
import { api } from "../store";
import { autoBuild } from "../reel-engine";
import {
  renderReel, decodeAudioFile, autoMotion, type RenderClip, type MusicMood, type RenderResult,
} from "../reel-render";
import { transcodeToMp4, isAudioFile } from "../audio-mux";
import { uploadFile } from "../uploader";
import {
  IconFilm, IconWand, IconUpload, IconClose, IconCheck, IconSparkle, IconHeart, IconComment,
  IconCalendar, IconDownload, IconRefresh, IconMusic,
} from "../icons";

const MOODS: { key: MusicMood; label: string }[] = [
  { key: "cinematic", label: "Cinematic" },
  { key: "upbeat", label: "Upbeat" },
  { key: "calm", label: "Calm" },
];
const TRANSITIONS: RenderClip["transition"][] = ["dissolve", "slide", "cut"];

export default function ReelView() {
  return (
    <div className="stack gap24" style={{ maxWidth: 1080 }}>
      <div className="sectionhead" style={{ marginBottom: 0 }}>
        <div className="htext">
          <h1>AI Reel Creator</h1>
          <p className="muted tiny">
            Pick your clips &amp; photos, hit Generate, and the AI assembles and <b>renders</b> a real Reel —
            motion, transitions, music and sound — from your own media. Preview it, then add to your calendar.
          </p>
        </div>
      </div>
      <InsightsPanel />
      <ReelBuilder />
    </div>
  );
}

// ------------------------------ INSIGHTS ------------------------------
function InsightsPanel() {
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
      {!loading && data && !data.error && !data.connected && <div className="banner warn"><div>{data.note}</div></div>}
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
          ) : <div className="tiny muted">No reels found on your account yet.</div>}
          {data.patterns?.topHashtags?.length > 0 && (
            <div className="taglist mt12">{data.patterns.topHashtags.map((t: string) => <span key={t} className="tag" style={{ paddingRight: 10 }}>{t}</span>)}</div>
          )}
          {data.note && <p className="tiny muted mt12">{data.note}</p>}
          {data.reels?.length > 0 && (
            <>
              <div className="tiny" style={{ fontWeight: 700, margin: "16px 0 8px" }}>Top reels</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(96px,1fr))", gap: 8 }}>
                {data.reels.slice(0, 8).map((r: any) => (
                  <a key={r.id} href={r.permalink || "#"} target="_blank" rel="noreferrer" className="card" style={{ padding: 0, overflow: "hidden", textDecoration: "none" }}>
                    <div style={{ aspectRatio: "9/16", background: "var(--surface-2)" }}>{r.thumbnailUrl && <img src={r.thumbnailUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}</div>
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

// ------------------------------ BUILDER ------------------------------
function ReelBuilder() {
  const { state, go, toast } = useApp();
  const media = state.media;
  const [selected, setSelected] = useState<Set<string>>(new Set(media.map((m) => m.id)));
  const [mood, setMood] = useState<MusicMood>("cinematic");
  const [ownAudio, setOwnAudio] = useState<File | null>(null);
  const [stage, setStage] = useState<"select" | "rendering" | "done">("select");
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<(RenderResult & { url: string }) | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const audioRef = useRef<HTMLInputElement>(null);
  const objectUrls = useRef<string[]>([]);

  const chosen = media.filter((m) => selected.has(m.id));
  const vids = chosen.filter((m) => m.type === "video").length;
  const pics = chosen.filter((m) => m.type === "photo").length;

  function toggle(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function cleanupUrls() {
    objectUrls.current.forEach((u) => URL.revokeObjectURL(u));
    objectUrls.current = [];
  }

  async function generate() {
    if (chosen.length < 2) { toast("Select at least 2 clips/photos", "err"); return; }
    setStage("rendering"); setProgress(0); setStatus("Planning your reel…");
    try {
      // AI picks order/timing/pacing.
      const sb = autoBuild(chosen, null, { maxSeconds: 24 });
      // Fetch each clip's bytes SAME-ORIGIN (so the canvas can record without tainting).
      setStatus("Loading your media…");
      cleanupUrls();
      const clips: RenderClip[] = [];
      for (let i = 0; i < sb.clips.length; i++) {
        const c = sb.clips[i];
        const res = await fetch(`/api/media/bytes/${c.mediaId}`);
        if (!res.ok) continue;
        const url = URL.createObjectURL(await res.blob());
        objectUrls.current.push(url);
        clips.push({
          type: c.type, url, duration: c.duration,
          transition: TRANSITIONS[i % TRANSITIONS.length], text: "", motion: autoMotion(i),
        });
      }
      if (clips.length < 2) throw new Error("Couldn't load enough media");

      const musicBuffer = ownAudio ? await decodeAudioFile(ownAudio) : null;
      // auto-pick mood if the user hasn't (more video => upbeat)
      const useMood: MusicMood = ownAudio ? "none" : mood;

      if (result?.url) URL.revokeObjectURL(result.url);
      const r = await renderReel(clips, {
        mood: useMood, musicBuffer, sfx: true,
        onStatus: setStatus, onProgress: setProgress,
      });
      const url = URL.createObjectURL(r.blob);
      setResult({ ...r, url });
      setStage("done");
      toast("Reel created", "ok");
    } catch (e: any) {
      toast(e.message || "Could not render the reel", "err");
      setStage("select");
    } finally { setStatus(""); }
  }

  function attachAudio(list: FileList | null) {
    const f = list?.[0];
    if (!f) return;
    if (!isAudioFile(f)) { toast("Choose an audio file (mp3, m4a, wav…)", "err"); return; }
    setOwnAudio(f);
    toast("Your audio will be used as the soundtrack", "ok");
  }

  function download() {
    if (!result) return;
    const ext = result.mime.includes("mp4") ? "mp4" : "webm";
    const a = document.createElement("a");
    a.href = result.url; a.download = `reel.${ext}`; a.click();
  }

  if (!media.length) {
    return (
      <div className="card" style={{ padding: 24, textAlign: "center" }}>
        <IconFilm size={28} />
        <div style={{ fontWeight: 650, marginTop: 8 }}>No media yet</div>
        <p className="tiny muted">Upload your BTS videos and photos first, then generate a reel.</p>
        <button className="btn primary sm mt12" onClick={() => go("upload")}><IconUpload size={15} /> Go to Upload</button>
      </div>
    );
  }

  // -------- RENDERING --------
  if (stage === "rendering") {
    return (
      <div className="card" style={{ padding: 28, textAlign: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 17 }}><IconWand size={18} /> Creating your reel…</div>
        <p className="tiny muted mt8">{status || "Working…"}</p>
        <div style={{ height: 8, background: "var(--surface-2)", borderRadius: 999, overflow: "hidden", maxWidth: 360, margin: "16px auto 0" }}>
          <div style={{ width: `${progress}%`, height: "100%", background: "var(--accent-grad)", transition: "width .2s" }} />
        </div>
        <p className="tiny muted mt12">Rendering happens live in your browser and plays in real time — keep this tab in front.</p>
      </div>
    );
  }

  // -------- DONE --------
  if (stage === "done" && result) {
    return (
      <>
        <div className="card" style={{ padding: 18 }}>
          <div className="flex gap8" style={{ alignItems: "center" }}>
            <span className="pill ok"><span className="dot" /> Reel Created</span>
            <span className="tiny muted">{Math.round(result.duration)}s · 1080×1920 · {result.mime.includes("mp4") ? "MP4" : "WebM"}{ownAudio ? " · your audio" : ` · ${mood} music`}</span>
            <div className="grow" />
            <button className="btn subtle sm" onClick={() => setStage("select")}><IconRefresh size={14} /> Start over</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 18, marginTop: 14 }} className="reel-done">
            <video src={result.url} controls playsInline style={{ width: "100%", aspectRatio: "9/16", background: "#000", borderRadius: 12 }} />
            <div className="stack gap12">
              <div>
                <b>Your reel is ready</b>
                <p className="tiny muted mt8">The AI chose the order, pacing, motion (zoom/pan), transitions and sound. Preview on the left. Add it straight to your calendar, or regenerate for a different cut.</p>
              </div>
              <div className="flex gap8 wrap">
                <button className="btn primary" onClick={() => setScheduleOpen(true)}><IconCalendar size={16} /> Add to Calendar</button>
                <button className="btn subtle" onClick={generate}><IconRefresh size={15} /> Regenerate</button>
                <button className="btn subtle" onClick={download}><IconDownload size={15} /> Download</button>
              </div>
              <p className="tiny muted" style={{ lineHeight: 1.5 }}>
                Music is {ownAudio ? "your uploaded track" : "an original generated soundtrack"}. Instagram's trending
                catalog can't be attached by any API — add one manually in-app if you prefer. Adding to the calendar
                converts the video to Instagram-ready MP4 automatically.
              </p>
            </div>
          </div>
        </div>
        {scheduleOpen && result && (
          <ScheduleRenderedModal result={result} onClose={() => setScheduleOpen(false)} />
        )}
      </>
    );
  }

  // -------- SELECT --------
  return (
    <div className="card" style={{ padding: 20 }}>
      <div className="flex">
        <div className="grow">
          <b>Build a reel from your media</b>
          <p className="tiny muted mt8">Select the clips &amp; photos to use. The AI picks the strongest, orders them, and renders a finished reel with motion, transitions and sound.</p>
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

      {/* Music */}
      <div style={{ background: "var(--surface-2)", borderRadius: 10, padding: 12, marginTop: 14 }}>
        <div className="flex gap8" style={{ alignItems: "center" }}>
          <IconMusic size={15} /><b className="tiny grow">Soundtrack</b>
          {ownAudio && <span className="tiny" style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>🎵 {ownAudio.name}</span>}
        </div>
        <div className="flex gap8 mt8 wrap" style={{ alignItems: "center" }}>
          {!ownAudio && MOODS.map((m) => (
            <button key={m.key} className={`btn sm ${mood === m.key ? "primary" : "subtle"}`} onClick={() => setMood(m.key)}>{m.label}</button>
          ))}
          <div className="grow" />
          {ownAudio
            ? <button className="btn ghost sm" onClick={() => setOwnAudio(null)}><IconClose size={13} /> Use generated music</button>
            : <button className="btn subtle sm" onClick={() => audioRef.current?.click()}><IconMusic size={13} /> Use my own audio</button>}
          <input ref={audioRef} type="file" accept="audio/*,.mp3,.m4a,.wav" hidden onChange={(e) => { attachAudio(e.target.files); e.currentTarget.value = ""; }} />
        </div>
      </div>

      <div className="flex mt16">
        <div className="grow" />
        <button className="btn primary lg" onClick={generate}><IconWand size={18} /> Generate Reel</button>
      </div>
    </div>
  );
}

function ScheduleRenderedModal({ result, onClose }: { result: RenderResult & { url: string }; onClose: () => void }) {
  const { state, setState, toast, go } = useApp();
  const [caption, setCaption] = useState("");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  async function schedule() {
    if (!when) { toast("Choose a date & time", "err"); return; }
    setBusy(true);
    try {
      setStatus("Preparing video…");
      const mp4 = await transcodeToMp4(result.blob, { onStatus: setStatus, onProgress: (p) => setStatus(`Converting to MP4… ${p}%`) });
      setStatus("Uploading…");
      const media = await uploadFile(mp4, Boolean(state.config.blobDirect));
      setState((prev) => ({ ...prev, media: [media, ...prev.media] }));
      setStatus("Scheduling…");
      const res = await api.post("/api/posts/create", {
        mediaIds: [media.id], caption, format: "reel", scheduledAt: new Date(when).toISOString(),
      });
      setState(res);
      toast("Reel added to your calendar — it will auto-post at that time", "ok");
      onClose();
      go("calendar");
    } catch (e: any) {
      toast(e.message || "Could not schedule", "err");
    } finally { setBusy(false); setStatus(""); }
  }

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 460, width: "94%" }}>
        <div className="flex" style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <b className="grow">Add reel to calendar</b>
          <button className="btn ghost sm" onClick={onClose}><IconClose size={18} /></button>
        </div>
        <div style={{ padding: 18 }} className="stack gap16">
          <div className="banner"><div className="tiny">Your rendered reel (with music &amp; effects baked in) will be converted to Instagram-ready MP4, then scheduled through your existing calendar &amp; auto-poster.</div></div>
          <label className="field">
            <span>Caption</span>
            <textarea className="input" rows={3} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Write your caption…" />
          </label>
          <label className="field">
            <span>Date &amp; time</span>
            <input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </label>
          <div className="flex" style={{ alignItems: "center" }}>
            <div className="grow tiny muted">{status}</div>
            <button className="btn primary" onClick={schedule} disabled={busy}>
              {busy ? <Spinner /> : <IconCalendar size={16} />} Add to Calendar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
