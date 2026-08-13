"use client";
import React, { useMemo, useRef, useState } from "react";
import { useApp, Modal, CloseButton, Segmented, Spinner } from "./ui";
import { api, mediaById, postMediaIds } from "./store";
import type { Post } from "./store";
import { localParts, zonedTimeToUtc, formatLocal, tzAbbrev } from "@/lib/schedule";
import { tzListWith } from "./tz";
import {
  IconHeart, IconComment, IconShare, IconBookmark, IconMusic, IconPlay, IconPause,
  IconRefresh, IconPlus, IconClose, IconSparkle, IconAlert, IconClock, IconReel,
} from "./icons";

function VideoReel({ src, poster }: { src: string; poster?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  function toggle() {
    const v = ref.current;
    if (!v) return;
    if (v.paused) { v.play(); setPlaying(true); }
    else { v.pause(); setPlaying(false); }
  }
  return (
    <div className="reel">
      <video
        ref={ref}
        src={src}
        poster={poster}
        playsInline
        onClick={toggle}
        onEnded={() => setPlaying(false)}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
      />
      {!playing && (
        <button className="playbtn" onClick={toggle} aria-label="Play">
          <span style={{ width: 66, height: 66, borderRadius: "50%", background: "rgba(0,0,0,0.45)", display: "grid", placeItems: "center", backdropFilter: "blur(2px)" }}>
            <IconPlay size={30} />
          </span>
        </button>
      )}
      {playing && (
        <button className="playbtn" onClick={toggle} aria-label="Pause" style={{ opacity: 0 }}>
          <IconPause size={30} />
        </button>
      )}
    </div>
  );
}

export default function PostModal({ postId, onClose }: { postId: string; onClose: () => void }) {
  const { state, setState, toast } = useApp();
  const post = state.posts.find((p) => p.id === postId);
  const media = post ? mediaById(state, post.mediaId) : undefined;

  const [caption, setCaption] = useState(post?.caption ?? "");
  const [cta, setCta] = useState(post?.cta ?? "");
  const [hashtags, setHashtags] = useState<string[]>(post?.hashtags ?? []);
  const [category, setCategory] = useState(post?.category ?? "");
  const [format, setFormat] = useState<"post" | "reel">(post?.format ?? "post");
  const [music, setMusic] = useState(post?.music ?? null);
  const [newTag, setNewTag] = useState("");

  const initialTz = post?.timezone ?? state.settings.timezone;
  const initLocal = post ? localParts(new Date(post.scheduledAt), initialTz) : null;
  const [tz, setTz] = useState(initialTz);
  const [dateStr, setDateStr] = useState(
    initLocal ? `${initLocal.year}-${String(initLocal.month).padStart(2, "0")}-${String(initLocal.day).padStart(2, "0")}` : "",
  );
  const [timeStr, setTimeStr] = useState(
    initLocal ? `${String(initLocal.hour).padStart(2, "0")}:${String(initLocal.minute).padStart(2, "0")}` : "",
  );

  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ at: string } | null>(null);
  const [carIdx, setCarIdx] = useState(0);

  const isVideo = media?.type === "video";

  const scheduledIso = useMemo(() => {
    const [y, m, d] = dateStr.split("-").map(Number);
    const [hh, mm] = timeStr.split(":").map(Number);
    if (!y || !m || !d || isNaN(hh) || isNaN(mm)) return post?.scheduledAt ?? new Date().toISOString();
    return zonedTimeToUtc(y, m, d, hh, mm, tz).toISOString();
  }, [dateStr, timeStr, tz, post?.scheduledAt]);

  const previewWhen = formatLocal(scheduledIso, tz);

  if (!post || !media) {
    return (
      <Modal onClose={onClose} className="narrow">
        <div style={{ padding: 24 }}>
          <div className="flex" style={{ justifyContent: "space-between" }}><b>Post</b><CloseButton onClose={onClose} /></div>
          <p className="muted mt16">This post or its media is no longer available.</p>
        </div>
      </Modal>
    );
  }

  const carItems = postMediaIds(post)
    .map((id) => mediaById(state, id))
    .filter((x): x is NonNullable<typeof x> => Boolean(x));
  const isCarousel = carItems.length > 1;
  const shown = carItems[Math.min(carIdx, carItems.length - 1)] || media;

  async function removeFromPlan() {
    if (!confirm("Remove this post from your plan? Your uploaded file stays in the library — nothing is deleted.")) return;
    try {
      await fetch(`/api/posts/${post!.id}`, { method: "DELETE" });
      setState((prev) => ({
        ...prev,
        posts: prev.posts.filter((p) => p.id !== post!.id).map((p, i) => ({ ...p, order: i })),
      }));
      toast("Removed from plan", "ok");
      onClose();
    } catch {
      toast("Could not remove", "err");
    }
  }

  function addTag(raw: string) {
    const t = raw.trim().replace(/\s+/g, "");
    if (!t) return;
    const tag = t.startsWith("#") ? t : "#" + t;
    if (!hashtags.includes(tag)) setHashtags((h) => [...h, tag]);
    setNewTag("");
  }
  function removeTag(tag: string) { setHashtags((h) => h.filter((x) => x !== tag)); }

  function applyPost(updated: Post) {
    setState((prev) => ({ ...prev, posts: prev.posts.map((p) => (p.id === updated.id ? updated : p)) }));
  }

  async function regen(field: "caption" | "hashtags" | "music" | "recommendation") {
    setBusy(field);
    try {
      const res = await api.post(`/api/posts/${post!.id}/regenerate`, { field });
      const up: Post = res.post;
      applyPost(up);
      if (field === "caption") { setCaption(up.caption); setCta(up.cta); }
      if (field === "hashtags") setHashtags(up.hashtags);
      if (field === "music") setMusic(up.music);
      if (field === "recommendation") { setCategory(up.category); setFormat(up.format); }
      toast(`Regenerated ${field}`, "ok");
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(null);
    }
  }

  async function save(force = false) {
    setSaving(true);
    setConflict(null);
    try {
      // 1) Content fields via PATCH.
      const patch = await api.patch(`/api/posts/${post!.id}`, {
        caption, cta, hashtags, category, format,
        music: isVideo ? null : music,
      });
      applyPost(patch.post);

      // 2) Schedule via dedicated endpoint (conflict-aware).
      if (scheduledIso !== post!.scheduledAt || tz !== post!.timezone) {
        const sres = await api.post(`/api/posts/${post!.id}/schedule`, {
          scheduledAt: scheduledIso, timezone: tz, force,
        });
        if (sres.conflict && !force) {
          setConflict({ at: sres.conflictAt });
          setSaving(false);
          return;
        }
        applyPost(sres.post);
      }
      toast("Saved", "ok");
      onClose();
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setSaving(false);
    }
  }

  const previewCaptionParts = [caption, cta].filter(Boolean).join("\n\n");

  return (
    <Modal onClose={onClose} className="postmodal">
      {/* Left: Instagram-style preview */}
      <div className="previewpane">
        {isVideo ? (
          <VideoReel src={media.url} poster={media.thumbUrl} />
        ) : (
          <div className="igpost" style={{ maxWidth: 460 }}>
            <div className="ightop">
              <div className="avatar"><div>{(state.instagram.username || "me").slice(0, 1).toUpperCase()}</div></div>
              <div className="uname">{state.instagram.username ? `@${state.instagram.username}` : "your_handle"}</div>
              <div className="right muted" style={{ fontSize: 18, lineHeight: 0 }}>⋯</div>
            </div>
            <div className="igmedia" style={{ position: "relative" }}>
              <img src={shown.url} alt="" />
              {isCarousel && (
                <>
                  <button onClick={() => setCarIdx((i) => Math.max(0, Math.min(carItems.length - 1, i) - 1))} disabled={carIdx <= 0}
                    style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", background: "rgba(0,0,0,0.5)", color: "#fff", border: "none", borderRadius: "50%", width: 30, height: 30, display: "grid", placeItems: "center", cursor: "pointer" }}>‹</button>
                  <button onClick={() => setCarIdx((i) => Math.min(carItems.length - 1, i + 1))} disabled={carIdx >= carItems.length - 1}
                    style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "rgba(0,0,0,0.5)", color: "#fff", border: "none", borderRadius: "50%", width: 30, height: 30, display: "grid", placeItems: "center", cursor: "pointer" }}>›</button>
                  <div style={{ position: "absolute", top: 10, right: 10, background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 12, padding: "2px 9px", borderRadius: 999 }}>{Math.min(carIdx, carItems.length - 1) + 1}/{carItems.length}</div>
                  <div style={{ position: "absolute", bottom: 10, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 5 }}>
                    {carItems.map((_, k) => <span key={k} style={{ width: 6, height: 6, borderRadius: "50%", background: k === Math.min(carIdx, carItems.length - 1) ? "#fff" : "rgba(255,255,255,0.5)" }} />)}
                  </div>
                </>
              )}
            </div>
            {music && (
              <div className="igmusic"><IconMusic size={15} /> <span><b>{music.name}</b> · {music.artist}</span></div>
            )}
            <div className="igactions">
              <IconHeart size={24} /><IconComment size={24} /><IconShare size={23} />
              <span className="save"><IconBookmark size={24} /></span>
            </div>
            <div className="igcaption">
              <span className="u">{state.instagram.username ? state.instagram.username : "your_handle"}</span>
              {caption}
              {cta ? <div style={{ marginTop: 6 }}>{cta}</div> : null}
              {hashtags.length > 0 && <div className="igtags" style={{ marginTop: 6 }}>{hashtags.join(" ")}</div>}
            </div>
            <div className="igtime">{previewWhen.date} · {previewWhen.time}</div>
          </div>
        )}
        {isVideo && (
          <div className="reel" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            <div className="roverlay">
              <div className="rbottom">
                <div className="ruser">
                  <span className="avatar" style={{ width: 28, height: 28 }}><div style={{ fontSize: 12 }}>{(state.instagram.username || "me").slice(0, 1).toUpperCase()}</div></span>
                  {state.instagram.username ? `@${state.instagram.username}` : "your_handle"}
                </div>
                <div className="rcap">
                  {caption}
                  {cta ? `\n\n${cta}` : ""}
                  {hashtags.length ? <div style={{ opacity: 0.85, marginTop: 6 }}>{hashtags.join(" ")}</div> : null}
                </div>
                <div className="tiny" style={{ opacity: 0.75, marginTop: 8 }}>{previewWhen.date} · {previewWhen.time} · original audio</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Right: edit panel */}
      <div className="editpane">
        <div className="ehead">
          <span className="pill accent">{isVideo ? <><IconReel size={13} /> {format === "reel" ? "Reel" : "Video"}</> : "Photo post"}</span>
          <span className="pill">{category || "Uncategorized"}</span>
          <div className="right" />
          <CloseButton onClose={onClose} />
        </div>

        <div className="escroll stack gap16">
          {/* Caption */}
          <div>
            <div className="flex mb8"><span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>CAPTION</span>
              <button className="btn ghost sm right" onClick={() => regen("caption")} disabled={busy === "caption"}>
                {busy === "caption" ? <Spinner dark /> : <IconRefresh size={14} />} Regenerate
              </button>
            </div>
            <textarea className="textarea" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Write a caption…" />
          </div>

          {/* CTA */}
          <label className="field">
            <span>CALL TO ACTION (optional)</span>
            <input className="input" value={cta} onChange={(e) => setCta(e.target.value)} placeholder="e.g. Save this for later" />
          </label>

          {/* Hashtags */}
          <div>
            <div className="flex mb8"><span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>HASHTAGS · {hashtags.length}</span>
              <button className="btn ghost sm right" onClick={() => regen("hashtags")} disabled={busy === "hashtags"}>
                {busy === "hashtags" ? <Spinner dark /> : <IconRefresh size={14} />} Regenerate
              </button>
            </div>
            <div className="taglist mb8">
              {hashtags.map((t) => (
                <span key={t} className="tag">{t}<button onClick={() => removeTag(t)} aria-label={`Remove ${t}`}><IconClose size={13} /></button></span>
              ))}
              {hashtags.length === 0 && <span className="tiny muted">No hashtags.</span>}
            </div>
            <div className="flex gap8">
              <input className="input" value={newTag} placeholder="Add a hashtag" onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(newTag); } }} />
              <button className="btn subtle sm" onClick={() => addTag(newTag)}><IconPlus size={15} /></button>
            </div>
          </div>

          {/* Schedule */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)", marginBottom: 8 }}>
              <IconClock size={13} style={{ verticalAlign: -2 }} /> SCHEDULE
            </div>
            <div className="flex gap8 wrap">
              <input className="input" type="date" style={{ flex: "1 1 140px" }} value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
              <input className="input" type="time" style={{ flex: "1 1 110px" }} value={timeStr} onChange={(e) => setTimeStr(e.target.value)} />
            </div>
            <select className="select mt8" value={tz} onChange={(e) => setTz(e.target.value)}>
              {tzListWith(tz).map((z) => <option key={z} value={z}>{z} ({tzAbbrev(z, new Date(scheduledIso))})</option>)}
            </select>
            {conflict && (
              <div className="banner warn mt8">
                <IconAlert size={16} className="bicon" />
                <div>
                  Another post is within 30 minutes ({formatLocal(conflict.at, tz).time}).{" "}
                  <button className="btn sm danger" style={{ marginLeft: 6 }} onClick={() => save(true)}>Schedule anyway</button>
                </div>
              </div>
            )}
          </div>

          {/* Music (photos only) */}
          {!isVideo && (
            <div>
              <div className="flex mb8"><span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}><IconMusic size={13} style={{ verticalAlign: -2 }} /> SUGGESTED MUSIC</span>
                <div className="right flex gap6">
                  <button className="btn ghost sm" onClick={() => regen("music")} disabled={busy === "music"}>{busy === "music" ? <Spinner dark /> : <IconRefresh size={14} />}</button>
                  {music && <button className="btn ghost sm" onClick={() => setMusic(null)}><IconClose size={14} /></button>}
                </div>
              </div>
              {music ? (
                <>
                  <div className="flex gap8 wrap">
                    <input className="input" style={{ flex: "1 1 140px" }} value={music.name} onChange={(e) => setMusic({ ...music!, name: e.target.value })} placeholder="Song" />
                    <input className="input" style={{ flex: "1 1 120px" }} value={music.artist} onChange={(e) => setMusic({ ...music!, artist: e.target.value })} placeholder="Artist" />
                  </div>
                  <div className="banner info mt8" style={{ fontSize: 12.5 }}>
                    <IconAlert size={15} className="bicon" />
                    <div>Instagram’s API can’t attach music automatically. <b>Add this song manually</b> in Instagram — search “{music.name} {music.artist}”.</div>
                  </div>
                </>
              ) : (
                <button className="btn subtle sm" onClick={() => regen("music")}><IconPlus size={14} /> Suggest a song</button>
              )}
            </div>
          )}
          {isVideo && (
            <div className="banner info" style={{ fontSize: 12.5 }}>
              <IconMusic size={15} className="bicon" />
              <div>This is a video — its <b>original audio is kept</b>. No music is added or replaced by this app.</div>
            </div>
          )}

          {/* Recommendation */}
          <div>
            <div className="flex mb8"><span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>RECOMMENDATION</span>
              <button className="btn ghost sm right" onClick={() => regen("recommendation")} disabled={busy === "recommendation"}>
                {busy === "recommendation" ? <Spinner dark /> : <IconSparkle size={14} />} Regenerate
              </button>
            </div>
            <div className="flex gap8 wrap mb8">
              <label className="field" style={{ flex: "1 1 140px" }}>
                <span>Category</span>
                <input className="input" value={category} onChange={(e) => setCategory(e.target.value)} />
              </label>
              <div style={{ flex: "1 1 140px" }}>
                <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-2)", marginBottom: 6 }}>Format</span>
                <Segmented value={format} onChange={setFormat} options={[{ value: "post", label: "Post" }, { value: "reel", label: "Reel" }]} />
              </div>
            </div>
            <p className="tiny muted">{post.subject} · mood: {post.mood} · for {media.analysis?.audience || "your audience"}. Suggestions only — not guaranteed results.</p>
          </div>
        </div>

        <div className="efoot">
          <button className="btn ghost sm danger" onClick={removeFromPlan} title="Removes this post from the plan; your uploaded file stays">
            <IconClose size={14} /> Remove from plan
          </button>
          <div className="right" />
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => save(false)} disabled={saving}>
            {saving ? <Spinner /> : null} Save Changes
          </button>
        </div>
      </div>
    </Modal>
  );
}
