"use client";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { useApp } from "../ui";
import { Segmented } from "../ui";
import { api, fmtDuration } from "../store";
import type { ClientMedia } from "../store";
import { extract, isAccepted, ACCEPT_ATTR } from "../media-utils";
import GenerateOverlay from "../GenerateOverlay";
import {
  IconUpload, IconPlus, IconTrash, IconVideo, IconCheck, IconSparkle,
  IconAlert, IconGrid,
} from "../icons";

interface QItem {
  id: string;
  name: string;
  type: "photo" | "video";
  progress: number;
  status: "processing" | "uploading" | "done" | "error";
  error?: string;
  thumbUrl?: string;
}

let qseq = 0;

const EXT_MAP: Record<string, string> = {
  "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/png": ".png",
  "image/webp": ".webp", "video/mp4": ".mp4", "video/quicktime": ".mov",
};
function extFor(file: File): string {
  const t = (file.type || "").toLowerCase();
  if (EXT_MAP[t]) return EXT_MAP[t];
  const m = file.name.match(/\.[a-z0-9]+$/i);
  return m ? m[0] : "";
}

export default function UploadView({ onConnect }: { onConnect: () => void }) {
  const { state, setState, toast, go } = useApp();
  const blobDirect = Boolean(state.config?.blobDirect);
  const [drag, setDrag] = useState(false);
  const [queue, setQueue] = useState<QItem[]>([]);
  const [filter, setFilter] = useState<"all" | "photo" | "video">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const media = state.media;
  const filtered = useMemo(
    () => media.filter((m) => (filter === "all" ? true : m.type === filter)),
    [media, filter],
  );

  const updateQ = (id: string, patch: Partial<QItem>) =>
    setQueue((q) => q.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  const uploadOne = useCallback(
    (file: File, item: QItem) =>
      new Promise<void>(async (resolve) => {
        try {
          updateQ(item.id, { status: "processing" });
          const meta = await extract(file);
          if (meta.thumb) {
            const turl = URL.createObjectURL(meta.thumb);
            updateQ(item.id, { thumbUrl: turl });
          }

          // Only genuinely large files (> 4MB) need the direct-to-Blob path
          // (which bypasses the serverless size limit). Normal-size files go
          // through the reliable server route below.
          if (blobDirect && file.size > 4 * 1024 * 1024) {
            const ctrl = new AbortController();
            const stall = setTimeout(() => ctrl.abort(), 120000); // fail fast, never hang
            try {
              updateQ(item.id, { status: "uploading", progress: 0 });
              const ext = extFor(file);
              const fileRes = await upload(`uploads/${item.id}${ext}`, file, {
                access: "public",
                handleUploadUrl: "/api/blob/upload",
                contentType: file.type || undefined,
                abortSignal: ctrl.signal,
                onUploadProgress: (p) =>
                  updateQ(item.id, { status: "uploading", progress: Math.round(p.percentage) }),
              });
              let thumbUrl: string | undefined;
              if (meta.thumb) {
                const tRes = await upload(`thumbs/${item.id}.jpg`, meta.thumb, {
                  access: "public",
                  handleUploadUrl: "/api/blob/upload",
                  contentType: "image/jpeg",
                  abortSignal: ctrl.signal,
                });
                thumbUrl = tRes.url;
              }
              const res = await api.post("/api/media/register", {
                fileUrl: fileRes.url,
                thumbUrl,
                type: item.type,
                originalName: file.name,
                mime: file.type,
                size: file.size,
                width: meta.width,
                height: meta.height,
                duration: meta.duration,
              });
              setState((prev) => ({ ...prev, media: [res.media as ClientMedia, ...prev.media] }));
              updateQ(item.id, { status: "done", progress: 100 });
              setTimeout(() => setQueue((q) => q.filter((x) => x.id !== item.id)), 700);
            } catch (e: any) {
              updateQ(item.id, {
                status: "error",
                error: (ctrl.signal.aborted ? "Upload stalled (timed out)." : e?.message || "Upload failed").slice(0, 140),
              });
            } finally {
              clearTimeout(stall);
            }
            resolve();
            return;
          }

          const fd = new FormData();
          fd.append("file", file);
          if (meta.thumb) fd.append("thumb", meta.thumb, "thumb.jpg");
          fd.append("originalName", file.name);
          if (meta.width) fd.append("width", String(meta.width));
          if (meta.height) fd.append("height", String(meta.height));
          if (meta.duration) fd.append("duration", String(meta.duration));

          const xhr = new XMLHttpRequest();
          xhr.open("POST", "/api/upload");
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              updateQ(item.id, { status: "uploading", progress: Math.round((e.loaded / e.total) * 100) });
            }
          };
          xhr.onload = () => {
            try {
              const data = JSON.parse(xhr.responseText);
              if (xhr.status >= 200 && xhr.status < 300 && data.media) {
                setState((prev) => ({ ...prev, media: [data.media as ClientMedia, ...prev.media] }));
                updateQ(item.id, { status: "done", progress: 100 });
                setTimeout(() => setQueue((q) => q.filter((x) => x.id !== item.id)), 700);
              } else {
                updateQ(item.id, { status: "error", error: data.error || "Upload failed" });
              }
            } catch {
              updateQ(item.id, { status: "error", error: "Bad server response" });
            }
            resolve();
          };
          xhr.onerror = () => {
            updateQ(item.id, { status: "error", error: "Network error" });
            resolve();
          };
          xhr.send(fd);
        } catch (e: any) {
          updateQ(item.id, { status: "error", error: e?.message || "Failed" });
          resolve();
        }
      }),
    [setState, blobDirect],
  );

  const handleFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      const good: { file: File; item: QItem }[] = [];
      let rejected = 0;
      for (const file of files) {
        if (!isAccepted(file)) {
          rejected++;
          continue;
        }
        const type: "photo" | "video" = file.type.startsWith("video/") || /\.mov$/i.test(file.name) ? "video" : "photo";
        const item: QItem = { id: `q${++qseq}`, name: file.name, type, progress: 0, status: "processing" };
        good.push({ file, item });
      }
      if (rejected > 0) toast(`${rejected} file${rejected > 1 ? "s" : ""} skipped (unsupported type)`, "err");
      if (!good.length) return;

      setQueue((q) => [...good.map((g) => g.item), ...q]);

      // Upload with a concurrency pool (more parallelism for direct-to-Blob).
      const CONC = blobDirect ? 6 : 3;
      let idx = 0;
      const workers = new Array(Math.min(CONC, good.length)).fill(0).map(async () => {
        while (idx < good.length) {
          const cur = idx++;
          await uploadOne(good[cur].file, good[cur].item);
        }
      });
      await Promise.all(workers);
    },
    [toast, uploadOne],
  );

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDrag(false);
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  }

  function toggleSelect(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  const selectAll = () => setSelected(new Set(filtered.map((m) => m.id)));
  const clearSel = () => setSelected(new Set());

  async function deleteSelected() {
    if (!selected.size) return;
    if (!confirm(`Delete ${selected.size} item${selected.size > 1 ? "s" : ""}? This also removes any planned posts using them.`)) return;
    const ids = Array.from(selected);
    try {
      await api.post("/api/media/delete", { ids });
      setState((prev) => ({
        ...prev,
        media: prev.media.filter((m) => !selected.has(m.id)),
        posts: prev.posts.filter((p) => !selected.has(p.mediaId)),
      }));
      clearSel();
      toast("Deleted", "ok");
    } catch (e: any) {
      toast(e.message, "err");
    }
  }

  async function deleteAll() {
    if (!media.length) return;
    if (!confirm(`Delete ALL ${media.length} item${media.length > 1 ? "s" : ""}? This removes every uploaded photo/video and any planned posts. This can’t be undone.`)) return;
    const ids = media.map((m) => m.id);
    try {
      await api.post("/api/media/delete", { ids });
      setState((prev) => ({ ...prev, media: [], posts: [] }));
      clearSel();
      toast("All items deleted", "ok");
    } catch (e: any) {
      toast(e.message, "err");
    }
  }

  async function generate() {
    if (!media.length) return;
    const ids = selected.size ? Array.from(selected) : media.map((m) => m.id);
    setGenerating(true);
    try {
      const started = Date.now();
      const res = await api.post("/api/plan/generate", { mediaIds: ids });
      // Keep the overlay visible at least a moment so steps read naturally.
      const elapsed = Date.now() - started;
      if (elapsed < 2600) await new Promise((r) => setTimeout(r, 2600 - elapsed));
      setState(res);
      toast(`Plan ready — ${res.generated} posts`, "ok");
      go("plan");
    } catch (e: any) {
      toast(e.message || "Could not generate plan", "err");
    } finally {
      setGenerating(false);
    }
  }

  const photoCount = media.filter((m) => m.type === "photo").length;
  const videoCount = media.filter((m) => m.type === "video").length;

  return (
    <div>
      {generating && <GenerateOverlay count={selected.size || media.length} />}

      {/* Hero dropzone */}
      <div
        className={`dropzone ${drag ? "drag" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={(e) => { e.preventDefault(); setDrag(false); }}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        style={{ cursor: "pointer" }}
      >
        <div className="zicon"><IconUpload size={30} /></div>
        <h2>Drop your content. We’ll build your Instagram plan.</h2>
        <p className="muted" style={{ maxWidth: 520, margin: "0 auto 20px" }}>
          Upload your photos and videos and let AI organize your content, write your captions,
          and create your posting schedule.
        </p>
        <div className="flex gap12" style={{ justifyContent: "center" }}>
          <button className="btn primary" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>
            <IconPlus size={17} /> Browse Files
          </button>
          <span className="tiny muted">or drag &amp; drop • JPG, PNG, WEBP, MP4, MOV</span>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTR}
          style={{ display: "none" }}
          onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.currentTarget.value = ""; }}
        />
      </div>

      {/* Active upload queue */}
      {queue.length > 0 && (
        <div className="mt24">
          <div className="flex gap8 mb16">
            <b>Uploading</b>
            <span className="pill">{queue.filter((q) => q.status !== "error").length} in progress</span>
          </div>
          <div className="mgrid">
            {queue.map((q) => (
              <div key={q.id} className={`mtile ${q.status === "error" ? "err" : ""}`} style={{ cursor: "default" }}>
                {q.thumbUrl ? <img src={q.thumbUrl} alt="" /> : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "var(--text-3)" }}>{q.status === "error" ? <IconAlert /> : <span className="spin dark" />}</div>}
                {q.type === "video" && <span className="vbadge"><IconVideo size={12} /></span>}
                <div className="fname">{q.name}</div>
                {q.status === "error" ? (
                  <div className="fname" style={{ background: "var(--danger)", top: 0, bottom: "auto" }}>{q.error}</div>
                ) : q.status === "done" ? (
                  <span className="vbadge" style={{ left: 8, right: "auto", background: "var(--success)" }}><IconCheck size={12} /></span>
                ) : (
                  <div className="prog"><i style={{ width: `${q.progress}%` }} /></div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Prominent Generate Plan call-to-action */}
      {media.length > 0 && (
        <div className="card mt24" style={{ padding: 18, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", borderColor: "var(--accent)" }}>
          <div className="grow">
            <b style={{ fontSize: 16 }}>Ready to plan {selected.size || media.length} {(selected.size || media.length) === 1 ? "item" : "items"}</b>
            <div className="tiny muted mt8">AI writes a caption, hashtags, and a posting time for every photo & video, then builds your Instagram grid.</div>
          </div>
          <button className="btn primary lg" onClick={generate} disabled={generating}>
            <IconSparkle size={18} /> Generate Plan
          </button>
        </div>
      )}

      {/* Content library */}
      {media.length > 0 && (
        <div className="mt24">
          <div className="sectionhead">
            <div className="htext">
              <h1 style={{ fontSize: 22 }}>Content Library</h1>
              <p className="muted tiny">{media.length} items · {photoCount} photos · {videoCount} videos</p>
            </div>
            <div className="spacer" />
            <div className="toolbar">
              <Segmented
                value={filter}
                onChange={setFilter as any}
                options={[
                  { value: "all", label: "All" },
                  { value: "photo", label: "Photos" },
                  { value: "video", label: "Videos" },
                ]}
              />
            </div>
          </div>

          <div className="toolbar mb16">
            {selected.size > 0 ? (
              <>
                <span className="pill accent">{selected.size} selected</span>
                <button className="btn sm subtle" onClick={clearSel}>Clear</button>
                <button className="btn sm danger" onClick={deleteSelected}><IconTrash size={15} /> Delete</button>
              </>
            ) : (
              <button className="btn sm subtle" onClick={selectAll}>Select all</button>
            )}
            <button className="btn sm subtle" onClick={() => inputRef.current?.click()}><IconPlus size={15} /> Add more</button>
            <button className="btn sm danger" onClick={deleteAll}><IconTrash size={15} /> Delete all</button>
            <div className="right" />
            <button className="btn primary" onClick={generate} disabled={generating}>
              <IconSparkle size={16} /> Generate Plan{selected.size ? ` (${selected.size})` : ""}
            </button>
          </div>

          <div className="mgrid">
            {filtered.map((m) => (
              <div
                key={m.id}
                className={`mtile ${selected.has(m.id) ? "selected" : ""}`}
                onClick={() => toggleSelect(m.id)}
              >
                <img src={m.thumbUrl} alt={m.originalName} loading="lazy" />
                <div className="sel">{selected.has(m.id) ? <IconCheck size={13} /> : null}</div>
                {m.type === "video" && (
                  <span className="vbadge"><IconVideo size={12} /> {fmtDuration(m.duration) || "video"}</span>
                )}
                <div className="fname">{m.originalName}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {media.length === 0 && queue.length === 0 && (
        <div className="empty mt24">
          <div className="eicon"><IconGrid /></div>
          <p>Your library is empty. Drop some photos and videos above to begin.</p>
          {!state.instagram.connected && (
            <button className="btn subtle mt16" onClick={onConnect}>Connect Instagram first</button>
          )}
        </div>
      )}
    </div>
  );
}
