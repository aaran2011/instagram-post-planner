"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp, Spinner } from "../ui";
import { api } from "../store";
import type { EditAdjustments } from "../store";
import {
  ADJ_KEYS, ZERO_ADJUST, loadImage, analyzeStats, deriveAdjustments,
  averageAdjustments, renderAdjusted, canvasToBlob, describeStyle, isZero,
} from "../edit-engine";
import { uploadFile } from "../uploader";
import { isAccepted } from "../media-utils";
import { IconWand, IconUpload, IconCheck, IconTrash, IconRefresh, IconSparkle, IconClose } from "../icons";

const SLIDERS: { key: keyof EditAdjustments; label: string }[] = [
  { key: "exposure", label: "Exposure" },
  { key: "contrast", label: "Contrast" },
  { key: "highlights", label: "Highlights" },
  { key: "shadows", label: "Shadows" },
  { key: "whites", label: "Whites" },
  { key: "blacks", label: "Blacks" },
  { key: "temperature", label: "Temperature" },
  { key: "tint", label: "Tint" },
  { key: "saturation", label: "Saturation" },
  { key: "vibrance", label: "Vibrance" },
];

const PREVIEW_MAX = 1400; // px for on-screen previews; full-res used on save

export default function EditView() {
  const { state, setState, toast, go } = useApp();
  const [mode, setMode] = useState<"edit" | "train">(state.editStyle ? "edit" : "train");

  return (
    <div className="stack gap24" style={{ maxWidth: 1080 }}>
      <div className="sectionhead" style={{ marginBottom: 0 }}>
        <div className="htext">
          <h1>Edit Images</h1>
          <p className="muted tiny">
            Train your personal editing style from before/after pairs, then apply it to new photos.
            Only real photographic adjustments — never generated or invented detail.
          </p>
        </div>
      </div>

      <div className="flex gap8 wrap">
        <button className={`btn sm ${mode === "edit" ? "primary" : "subtle"}`} onClick={() => setMode("edit")}>
          <IconWand size={15} /> Edit photos
        </button>
        <button className={`btn sm ${mode === "train" ? "primary" : "subtle"}`} onClick={() => setMode("train")}>
          <IconSparkle size={15} /> Train style
        </button>
        <div className="grow" />
        <StyleBadge />
      </div>

      {mode === "train" ? <TrainPanel onDone={() => setMode("edit")} /> : <EditPanel />}
    </div>
  );
}

function StyleBadge() {
  const { state } = useApp();
  const s = state.editStyle;
  if (!s) return <span className="pill warn"><span className="dot" /> No style yet</span>;
  return (
    <span className="pill ok" title={s.notes}>
      <span className="dot" /> Style trained · {s.pairs} pairs
    </span>
  );
}

// ------------------------------ TRAIN ------------------------------

function TrainPanel({ onDone }: { onDone: () => void }) {
  const { state, setState, toast } = useApp();
  const [before, setBefore] = useState<File[]>([]);
  const [after, setAfter] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ adj: EditAdjustments; notes: string } | null>(null);

  const ready = before.length === 5 && after.length === 5;

  async function learn() {
    if (!ready) { toast("Add exactly 5 before and 5 matching edited photos", "err"); return; }
    setBusy(true);
    try {
      const perPair: EditAdjustments[] = [];
      for (let i = 0; i < 5; i++) {
        const [bImg, aImg] = await Promise.all([loadImage(before[i]), loadImage(after[i])]);
        perPair.push(deriveAdjustments(analyzeStats(bImg), analyzeStats(aImg)));
      }
      const adj = averageAdjustments(perPair);
      const notes = describeStyle(adj);
      const res = await api.post("/api/edit-style", { adjustments: adj, pairs: 5, notes });
      setState((prev) => ({ ...prev, editStyle: res.editStyle }));
      setResult({ adj, notes });
      toast("Style learned and saved", "ok");
    } catch (e: any) {
      toast(e.message || "Could not analyze the pairs", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack gap16">
      <div className="card" style={{ padding: 20 }}>
        <b>Teach the app your look</b>
        <p className="tiny muted mt8">
          Upload <b>5 unedited</b> photos and the <b>5 matching edited</b> versions in the same order.
          The app measures the real differences (exposure, contrast, colour, tone) and saves them as your
          reusable style. JPG / JPEG / PNG.
        </p>
        <div className="grid2 mt16" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <PairColumn title="Before (unedited)" files={before} setFiles={setBefore} accent="var(--text-2)" />
          <PairColumn title="After (your edit)" files={after} setFiles={setAfter} accent="var(--accent)" />
        </div>
        {before.length !== after.length && (
          <div className="banner warn mt16"><div>Add the same number of before and after photos, matched in order.</div></div>
        )}
        <div className="flex mt16">
          <div className="grow tiny muted">{before.length}/5 before · {after.length}/5 after</div>
          <button className="btn primary" onClick={learn} disabled={!ready || busy}>
            {busy ? <Spinner /> : <IconSparkle size={16} />} Learn my style
          </button>
        </div>
      </div>

      {result && (
        <div className="card" style={{ padding: 20 }}>
          <div className="flex gap8"><IconCheck size={18} /><b>Learned style</b></div>
          <p className="tiny muted mt8">{result.notes}</p>
          <div className="mt12" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 8 }}>
            {SLIDERS.map((s) => (
              <div key={s.key} className="tiny" style={{ display: "flex", justifyContent: "space-between", background: "var(--surface-2)", borderRadius: 8, padding: "6px 10px" }}>
                <span className="muted">{s.label}</span>
                <b>{fmtVal(result.adj[s.key])}</b>
              </div>
            ))}
          </div>
          <div className="flex mt16">
            <div className="grow" />
            <button className="btn subtle sm" onClick={onDone}><IconWand size={15} /> Start editing photos</button>
          </div>
        </div>
      )}
    </div>
  );
}

function PairColumn({ title, files, setFiles, accent }: {
  title: string; files: File[]; setFiles: (f: File[]) => void; accent: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  function add(list: FileList | null) {
    if (!list) return;
    const imgs = Array.from(list).filter((f) => isAccepted(f) && f.type.startsWith("image/"));
    setFiles([...files, ...imgs].slice(0, 5));
  }
  return (
    <div>
      <div className="tiny" style={{ fontWeight: 700, color: accent, marginBottom: 8 }}>{title}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 6 }}>
        {Array.from({ length: 5 }).map((_, i) => {
          const f = files[i];
          return (
            <div key={i} style={{ aspectRatio: "1", borderRadius: 8, overflow: "hidden", background: "var(--surface-2)", border: "1px dashed var(--border)", position: "relative", display: "grid", placeItems: "center" }}>
              {f ? (
                <>
                  <img src={URL.createObjectURL(f)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  <button onClick={() => setFiles(files.filter((_, j) => j !== i))}
                    style={{ position: "absolute", top: 2, right: 2, background: "rgba(0,0,0,.6)", color: "#fff", border: "none", borderRadius: 6, width: 20, height: 20, cursor: "pointer", display: "grid", placeItems: "center" }}>
                    <IconClose size={12} />
                  </button>
                </>
              ) : <span className="tiny muted">{i + 1}</span>}
            </div>
          );
        })}
      </div>
      <button className="btn subtle sm mt8" onClick={() => inputRef.current?.click()} disabled={files.length >= 5}>
        <IconUpload size={14} /> Add
      </button>
      <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(e) => { add(e.target.files); e.currentTarget.value = ""; }} />
    </div>
  );
}

// ------------------------------ EDIT ------------------------------

interface EditItem {
  id: string;
  file: File;
  img: HTMLImageElement;
  origUrl: string;
  adj: EditAdjustments;
  afterUrl: string;
  saved: boolean;
}

function EditPanel() {
  const { state, setState, toast, go } = useApp();
  const base = state.editStyle?.adjustments ?? ZERO_ADJUST;
  const [items, setItems] = useState<EditItem[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const renderAfter = useCallback(async (img: HTMLImageElement, adj: EditAdjustments) => {
    const canvas = renderAdjusted(img, adj, PREVIEW_MAX);
    const blob = await canvasToBlob(canvas, 0.9);
    return blob ? URL.createObjectURL(blob) : "";
  }, []);

  const addFiles = useCallback(async (list: FileList | File[] | null) => {
    if (!list) return;
    const files = Array.from(list).filter((f) => isAccepted(f) && f.type.startsWith("image/"));
    if (!files.length) return;
    setBusy(true);
    try {
      const next: EditItem[] = [];
      for (const file of files) {
        const img = await loadImage(file);
        const adj = { ...base };
        const afterUrl = await renderAfter(img, adj);
        next.push({ id: Math.random().toString(36).slice(2), file, img, origUrl: URL.createObjectURL(file), adj, afterUrl, saved: false });
      }
      setItems((prev) => [...prev, ...next]);
    } catch (e: any) {
      toast(e.message || "Could not load images", "err");
    } finally {
      setBusy(false);
    }
  }, [base, renderAfter, toast]);

  const open = items.find((i) => i.id === openId) || null;

  async function updateAdj(id: string, adj: EditAdjustments) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, adj } : i)));
    const it = items.find((i) => i.id === id);
    if (!it) return;
    const url = await renderAfter(it.img, adj);
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, afterUrl: url, saved: false } : i)));
  }

  function applyToAll(adj: EditAdjustments) {
    items.forEach(async (it) => {
      const url = await renderAfter(it.img, adj);
      setItems((prev) => prev.map((i) => (i.id === it.id ? { ...i, adj: { ...adj }, afterUrl: url, saved: false } : i)));
    });
    toast("Applied to all photos", "ok");
  }

  async function saveOne(it: EditItem): Promise<boolean> {
    const canvas = renderAdjusted(it.img, it.adj, Infinity); // full resolution
    const blob = await canvasToBlob(canvas, 0.95);
    if (!blob) return false;
    const name = it.file.name.replace(/\.(\w+)$/, "") + "-edited.jpg";
    const edited = new File([blob], name, { type: "image/jpeg" });
    const media = await uploadFile(edited, Boolean(state.config.blobDirect));
    setState((prev) => ({ ...prev, media: [media, ...prev.media] }));
    return true;
  }

  async function saveToLibrary(id: string) {
    const it = items.find((i) => i.id === id);
    if (!it) return;
    setBusy(true);
    try {
      const okSaved = await saveOne(it);
      if (okSaved) { setItems((prev) => prev.map((i) => (i.id === id ? { ...i, saved: true } : i))); toast("Saved to library", "ok"); }
    } catch (e: any) { toast(e.message || "Save failed", "err"); } finally { setBusy(false); }
  }

  async function saveAll() {
    setBusy(true);
    let count = 0;
    try {
      for (const it of items) {
        if (it.saved) continue;
        if (await saveOne(it)) count++;
      }
      setItems((prev) => prev.map((i) => ({ ...i, saved: true })));
      toast(`Saved ${count} edited photo${count === 1 ? "" : "s"} to library`, "ok");
    } catch (e: any) { toast(e.message || "Save failed", "err"); } finally { setBusy(false); }
  }

  return (
    <div className="stack gap16">
      {!state.editStyle && (
        <div className="banner warn"><div>No editing style trained yet — photos below use neutral settings. Switch to <b>Train style</b> to teach the app your look, or adjust manually.</div></div>
      )}

      <div
        className="dropzone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        style={{ cursor: "pointer", padding: 28, textAlign: "center", border: "2px dashed var(--border)", borderRadius: 14, background: "var(--surface)" }}
      >
        <IconUpload size={26} />
        <div style={{ fontWeight: 650, marginTop: 8 }}>Drop photos or click to upload</div>
        <div className="tiny muted">Batch upload · your style is applied automatically · edit any photo before saving</div>
        <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.currentTarget.value = ""; }} />
      </div>

      {busy && <div className="flex gap8 tiny muted"><Spinner /> Working…</div>}

      {items.length > 0 && (
        <>
          <div className="flex">
            <div className="grow tiny muted">{items.length} photo{items.length === 1 ? "" : "s"} · {items.filter((i) => i.saved).length} saved</div>
            <button className="btn subtle sm" onClick={() => setItems([])} style={{ marginRight: 8 }}><IconTrash size={14} /> Clear</button>
            <button className="btn primary sm" onClick={saveAll} disabled={busy}><IconCheck size={15} /> Save all to library</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 14 }}>
            {items.map((it) => (
              <div key={it.id} className="card" style={{ padding: 10 }}>
                <CompareBox origUrl={it.origUrl} afterUrl={it.afterUrl} />
                <div className="flex gap8 mt8">
                  <button className="btn subtle sm grow" onClick={() => setOpenId(it.id)}><IconWand size={14} /> Adjust</button>
                  <button className="btn sm grow" onClick={() => saveToLibrary(it.id)} disabled={it.saved}>
                    {it.saved ? <><IconCheck size={14} /> Saved</> : "Save"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {open && (
        <AdjustModal
          item={open}
          onChange={(adj) => updateAdj(open.id, adj)}
          onApplyAll={(adj) => applyToAll(adj)}
          resetTo={base}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

// A before/after compare slider.
function CompareBox({ origUrl, afterUrl }: { origUrl: string; afterUrl: string }) {
  const [pos, setPos] = useState(50);
  return (
    <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", background: "var(--surface-2)", aspectRatio: "1" }}>
      <img src={origUrl} alt="before" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
      <div style={{ position: "absolute", inset: 0, width: `${pos}%`, overflow: "hidden" }}>
        {afterUrl && <img src={afterUrl} alt="after" style={{ width: `${100 / (pos / 100)}%`, maxWidth: "none", height: "100%", objectFit: "cover" }} />}
      </div>
      <div style={{ position: "absolute", top: 0, bottom: 0, left: `${pos}%`, width: 2, background: "#fff", boxShadow: "0 0 0 1px rgba(0,0,0,.3)" }} />
      <span style={{ position: "absolute", top: 6, left: 6, fontSize: 10, fontWeight: 700, color: "#fff", background: "rgba(0,0,0,.55)", padding: "2px 6px", borderRadius: 5 }}>BEFORE</span>
      <span style={{ position: "absolute", top: 6, right: 6, fontSize: 10, fontWeight: 700, color: "#fff", background: "rgba(0,0,0,.55)", padding: "2px 6px", borderRadius: 5 }}>AFTER</span>
      <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))}
        style={{ position: "absolute", bottom: 6, left: "10%", width: "80%" }} />
    </div>
  );
}

function AdjustModal({ item, onChange, onApplyAll, resetTo, onClose }: {
  item: EditItem; onChange: (a: EditAdjustments) => void; onApplyAll: (a: EditAdjustments) => void;
  resetTo: EditAdjustments; onClose: () => void;
}) {
  const [adj, setAdj] = useState<EditAdjustments>(item.adj);
  const set = (k: keyof EditAdjustments, v: number) => {
    const next = { ...adj, [k]: v };
    setAdj(next); onChange(next);
  };
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 860, width: "94%" }}>
        <div className="flex" style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <b className="grow">Adjust photo</b>
          <button className="btn ghost sm" onClick={onClose}><IconClose size={18} /></button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 0 }}>
          <div style={{ padding: 16, background: "var(--surface-2)" }}>
            <CompareBox origUrl={item.origUrl} afterUrl={item.afterUrl} />
          </div>
          <div style={{ padding: 16, maxHeight: "70vh", overflowY: "auto" }}>
            {SLIDERS.map((s) => (
              <div key={s.key} style={{ marginBottom: 12 }}>
                <div className="flex tiny" style={{ marginBottom: 4 }}>
                  <span className="grow" style={{ fontWeight: 600 }}>{s.label}</span>
                  <span className="muted">{fmtVal(adj[s.key])}</span>
                </div>
                <input type="range" min={-1} max={1} step={0.01} value={adj[s.key]}
                  onChange={(e) => set(s.key, Number(e.target.value))} style={{ width: "100%" }} />
              </div>
            ))}
            <div className="flex gap8 mt8 wrap">
              <button className="btn subtle sm" onClick={() => { setAdj({ ...resetTo }); onChange({ ...resetTo }); }}>
                <IconRefresh size={14} /> Reset to style
              </button>
              <button className="btn subtle sm" onClick={() => { setAdj({ ...ZERO_ADJUST }); onChange({ ...ZERO_ADJUST }); }}>
                Neutral
              </button>
              <div className="grow" />
              <button className="btn primary sm" onClick={() => onApplyAll(adj)}>Apply to all</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function fmtVal(v: number) {
  const n = Math.round(v * 100);
  return (n > 0 ? "+" : "") + n;
}
