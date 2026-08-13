"use client";
import React, { useRef, useState } from "react";
import { useApp } from "./ui";
import { api } from "./store";
import type { ClientMedia } from "./store";
import { uploadFile } from "./uploader";
import { ACCEPT_ATTR } from "./media-utils";
import GenerateOverlay from "./GenerateOverlay";
import { IconPlus, IconClose, IconChevronL, IconChevronR, IconSparkle, IconTrash } from "./icons";

interface Box { id: string; items: ClientMedia[]; uploading: number; }
let bseq = 0;

export default function PostComposer() {
  const { state, setState, toast, go } = useApp();
  const blobDirect = Boolean(state.config?.blobDirect);
  const [boxes, setBoxes] = useState<Box[]>([{ id: `b${++bseq}`, items: [], uploading: 0 }]);
  const [generating, setGenerating] = useState(false);

  const addBox = () => setBoxes((b) => [...b, { id: `b${++bseq}`, items: [], uploading: 0 }]);
  const removeBox = (id: string) => setBoxes((b) => (b.length > 1 ? b.filter((x) => x.id !== id) : b));
  const removeItem = (boxId: string, mediaId: string) =>
    setBoxes((b) => b.map((x) => (x.id === boxId ? { ...x, items: x.items.filter((i) => i.id !== mediaId) } : x)));

  async function addPhotos(boxId: string, files: FileList | null) {
    if (!files || !files.length) return;
    const list = Array.from(files);
    setBoxes((b) => b.map((x) => (x.id === boxId ? { ...x, uploading: x.uploading + list.length } : x)));
    for (const file of list) {
      try {
        const media = await uploadFile(file, blobDirect);
        setState((prev) => ({ ...prev, media: [media, ...prev.media] }));
        setBoxes((b) => b.map((x) => (x.id === boxId ? { ...x, items: [...x.items, media], uploading: Math.max(0, x.uploading - 1) } : x)));
      } catch (e: any) {
        toast(e?.message || "Upload failed", "err");
        setBoxes((b) => b.map((x) => (x.id === boxId ? { ...x, uploading: Math.max(0, x.uploading - 1) } : x)));
      }
    }
  }

  const readyGroups = boxes.filter((b) => b.items.length > 0);

  async function generate() {
    const groups = readyGroups.map((b) => b.items.map((i) => i.id));
    if (!groups.length) { toast("Add at least one photo to a post first", "err"); return; }
    setGenerating(true);
    try {
      const res = await api.post("/api/plan/generate", { groups });
      setState(res);
      toast(`Added ${res.generated} post${res.generated === 1 ? "" : "s"} to your calendar`, "ok");
      setBoxes([{ id: `b${++bseq}`, items: [], uploading: 0 }]);
      go("calendar");
    } catch (e: any) {
      toast(e?.message || "Could not generate", "err");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="mt24">
      {generating && <GenerateOverlay count={readyGroups.length} />}
      <div className="sectionhead" style={{ marginBottom: 16 }}>
        <div className="htext">
          <h1 style={{ fontSize: 22 }}>Build carousel posts</h1>
          <p className="muted tiny">Add 2+ photos to a box to make one swipeable carousel post. Use “New post” to start another. Generate adds them to your existing calendar.</p>
        </div>
        <div className="spacer" />
        <button className="btn primary" onClick={generate} disabled={generating || !readyGroups.length}>
          <IconSparkle size={16} /> Generate &amp; add to calendar{readyGroups.length ? ` (${readyGroups.length})` : ""}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16 }}>
        {boxes.map((box, i) => (
          <ComposerBox
            key={box.id}
            box={box}
            index={i}
            canRemove={boxes.length > 1}
            onAdd={(f) => addPhotos(box.id, f)}
            onRemoveItem={(mid) => removeItem(box.id, mid)}
            onRemoveBox={() => removeBox(box.id)}
          />
        ))}
        <button
          onClick={addBox}
          className="card"
          style={{ border: "2px dashed var(--border-strong)", background: "var(--surface-2)", aspectRatio: "1", display: "grid", placeItems: "center", cursor: "pointer", color: "var(--text-2)" }}
        >
          <div style={{ textAlign: "center" }}><IconPlus size={28} /><div className="tiny" style={{ marginTop: 6 }}>New post</div></div>
        </button>
      </div>
    </div>
  );
}

function ComposerBox({
  box, index, canRemove, onAdd, onRemoveItem, onRemoveBox,
}: {
  box: Box; index: number; canRemove: boolean;
  onAdd: (f: FileList | null) => void; onRemoveItem: (id: string) => void; onRemoveBox: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [idx, setIdx] = useState(0);
  const [drag, setDrag] = useState(false);
  const items = box.items;
  const cur = Math.min(idx, Math.max(0, items.length - 1));
  const btnStyle: React.CSSProperties = { position: "absolute", top: "50%", transform: "translateY(-50%)", background: "rgba(0,0,0,0.45)", color: "#fff", border: "none", padding: 6, borderRadius: "50%", cursor: "pointer", display: "grid", placeItems: "center" };

  return (
    <div
      className="card"
      style={{ overflow: "hidden", outline: drag ? "2px solid var(--accent)" : "none", outlineOffset: -2 }}
      onDragOver={(e) => { e.preventDefault(); if (!drag) setDrag(true); }}
      onDragLeave={(e) => { e.preventDefault(); setDrag(false); }}
      onDrop={(e) => { e.preventDefault(); setDrag(false); onAdd(e.dataTransfer.files); }}
    >
      <div style={{ position: "relative", aspectRatio: "1", background: "var(--surface-2)" }}>
        {items.length ? (
          <>
            <img src={items[cur].thumbUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            {items.length > 1 && (
              <>
                <button style={{ ...btnStyle, left: 6 }} onClick={() => setIdx(Math.max(0, cur - 1))} disabled={cur === 0}><IconChevronL size={16} /></button>
                <button style={{ ...btnStyle, right: 6 }} onClick={() => setIdx(Math.min(items.length - 1, cur + 1))} disabled={cur === items.length - 1}><IconChevronR size={16} /></button>
                <div style={{ position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 11, padding: "2px 7px", borderRadius: 999 }}>{cur + 1}/{items.length}</div>
                <div style={{ position: "absolute", bottom: 8, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 5 }}>
                  {items.map((_, k) => <span key={k} style={{ width: 6, height: 6, borderRadius: "50%", background: k === cur ? "#fff" : "rgba(255,255,255,0.5)" }} />)}
                </div>
              </>
            )}
            <button title="Remove this image" onClick={() => onRemoveItem(items[cur].id)} style={{ position: "absolute", top: 8, left: 8, background: "rgba(0,0,0,0.55)", color: "#fff", border: "none", borderRadius: "50%", width: 24, height: 24, display: "grid", placeItems: "center", cursor: "pointer" }}><IconClose size={14} /></button>
          </>
        ) : (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "var(--text-3)", textAlign: "center", padding: 16 }}>
            <div className="tiny">{drag ? "Drop to add" : <>Drag photos here or tap <b>Add</b><br />(2+ = carousel)</>}</div>
          </div>
        )}
        {box.uploading > 0 && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.25)" }}><span className="spin" /></div>
        )}
      </div>
      <div className="flex gap8" style={{ padding: 10 }}>
        <span className="tiny muted">Post {index + 1}{items.length ? ` · ${items.length} photo${items.length > 1 ? "s" : ""}` : ""}{items.length > 1 ? " · carousel" : ""}</span>
        <div className="right" />
        <button className="btn subtle sm" onClick={() => inputRef.current?.click()}><IconPlus size={14} /> Add</button>
        {canRemove && <button className="btn ghost sm danger" onClick={onRemoveBox}><IconTrash size={14} /></button>}
      </div>
      <input ref={inputRef} type="file" multiple accept={ACCEPT_ATTR} style={{ display: "none" }} onChange={(e) => { onAdd(e.target.files); e.currentTarget.value = ""; }} />
    </div>
  );
}
