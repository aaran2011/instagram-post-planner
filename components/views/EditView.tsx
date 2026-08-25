"use client";
import React, { useCallback, useRef, useState } from "react";
import { useApp, Spinner } from "../ui";
import { api } from "../store";
import type { EditAdjustments } from "../store";
import {
  loadImage, analyzeStats, deriveAdjustments, averageAdjustments, describeStyle,
} from "../edit-engine";
import {
  analyzePro, computeEnhance, renderPro, suggestCrop, cropCanvas, dHash, groupDuplicates,
  canvasToBlob, PRO_SLIDERS, NEUTRAL_PRO, type ProParams,
} from "../pro-edit";
import { uploadFile } from "../uploader";
import { isAccepted } from "../media-utils";
import {
  IconWand, IconUpload, IconCheck, IconTrash, IconRefresh, IconSparkle, IconClose,
  IconChevronL, IconChevronR, IconCalendar, IconEye, IconGrid,
} from "../icons";

const PREVIEW_MAX = 1500; // px for on-screen previews; full-res used on save
const PAIR_COUNT = 3;

export default function EditView() {
  const { state } = useApp();
  const [mode, setMode] = useState<"edit" | "train">(state.editStyle ? "edit" : "train");

  return (
    <div className="stack gap24" style={{ maxWidth: 1120 }}>
      <div className="sectionhead" style={{ marginBottom: 0 }}>
        <div className="htext">
          <h1>Edit Images</h1>
          <p className="muted tiny">
            Upload your photos, then let the AI edit each one professionally — analyzed per image,
            using your trained style where it fits. Real photographic adjustments only, never generated detail.
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

      {mode === "train" ? <TrainPanel onDone={() => setMode("edit")} /> : <EditFlow />}
    </div>
  );
}

function StyleBadge() {
  const { state } = useApp();
  const s = state.editStyle;
  if (!s) return <span className="pill warn"><span className="dot" /> No style yet</span>;
  return <span className="pill ok" title={s.notes}><span className="dot" /> Style trained · {s.pairs} pairs</span>;
}

// ============================ TRAIN ============================

function TrainPanel({ onDone }: { onDone: () => void }) {
  const { setState, toast } = useApp();
  const [before, setBefore] = useState<File[]>([]);
  const [after, setAfter] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ adj: EditAdjustments; notes: string } | null>(null);
  const ready = before.length === PAIR_COUNT && after.length === PAIR_COUNT;

  async function learn() {
    if (!ready) { toast(`Add exactly ${PAIR_COUNT} before and ${PAIR_COUNT} matching edited photos`, "err"); return; }
    setBusy(true);
    try {
      const perPair: EditAdjustments[] = [];
      for (let i = 0; i < PAIR_COUNT; i++) {
        const [bImg, aImg] = await Promise.all([loadImage(before[i]), loadImage(after[i])]);
        perPair.push(deriveAdjustments(analyzeStats(bImg), analyzeStats(aImg)));
      }
      const adj = averageAdjustments(perPair);
      const notes = describeStyle(adj);
      const res = await api.post("/api/edit-style", { adjustments: adj, pairs: PAIR_COUNT, notes });
      setState((prev) => ({ ...prev, editStyle: res.editStyle }));
      setResult({ adj, notes });
      toast("Style learned and saved", "ok");
    } catch (e: any) {
      toast(e.message || "Could not analyze the pairs", "err");
    } finally { setBusy(false); }
  }

  return (
    <div className="stack gap16">
      <div className="card" style={{ padding: 20 }}>
        <b>Teach the app your look</b>
        <p className="tiny muted mt8">
          Add <b>{PAIR_COUNT} unedited</b> photos and the <b>{PAIR_COUNT} matching edited</b> versions in the same order —
          drag &amp; drop or click. The app learns your taste and layers it on top of its per-image professional edit.
        </p>
        <div className="mt16" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <PairColumn title="Before (unedited)" files={before} setFiles={setBefore} accent="var(--text-2)" />
          <PairColumn title="After (your edit)" files={after} setFiles={setAfter} accent="var(--accent)" />
        </div>
        <div className="flex mt16">
          <div className="grow tiny muted">{before.length}/{PAIR_COUNT} before · {after.length}/{PAIR_COUNT} after</div>
          <button className="btn primary" onClick={learn} disabled={!ready || busy}>
            {busy ? <Spinner /> : <IconSparkle size={16} />} Learn my style
          </button>
        </div>
      </div>
      {result && (
        <div className="card" style={{ padding: 20 }}>
          <div className="flex gap8"><IconCheck size={18} /><b>Learned style</b></div>
          <p className="tiny muted mt8">{result.notes}</p>
          <div className="flex mt16"><div className="grow" />
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
  const [dragging, setDragging] = useState(false);
  function add(list: FileList | File[] | null) {
    if (!list) return;
    const imgs = Array.from(list).filter((f) => isAccepted(f) && f.type.startsWith("image/"));
    setFiles([...files, ...imgs].slice(0, PAIR_COUNT));
  }
  return (
    <div>
      <div className="tiny" style={{ fontWeight: 700, color: accent, marginBottom: 8 }}>{title}</div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); add(e.dataTransfer.files); }}
        onClick={() => { if (files.length < PAIR_COUNT) inputRef.current?.click(); }}
        style={{
          display: "grid", gridTemplateColumns: `repeat(${PAIR_COUNT},1fr)`, gap: 6, padding: 6, borderRadius: 10,
          cursor: files.length < PAIR_COUNT ? "pointer" : "default",
          border: dragging ? "2px dashed var(--accent)" : "2px dashed transparent",
          background: dragging ? "var(--surface-2)" : "transparent", transition: "border-color .15s, background .15s",
        }}
      >
        {Array.from({ length: PAIR_COUNT }).map((_, i) => {
          const f = files[i];
          return (
            <div key={i} style={{ aspectRatio: "1", borderRadius: 8, overflow: "hidden", background: "var(--surface-2)", border: "1px dashed var(--border)", position: "relative", display: "grid", placeItems: "center" }}>
              {f ? (
                <>
                  <img src={URL.createObjectURL(f)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  <button onClick={(e) => { e.stopPropagation(); setFiles(files.filter((_, j) => j !== i)); }}
                    style={{ position: "absolute", top: 2, right: 2, background: "rgba(0,0,0,.6)", color: "#fff", border: "none", borderRadius: 6, width: 20, height: 20, cursor: "pointer", display: "grid", placeItems: "center" }}>
                    <IconClose size={12} />
                  </button>
                </>
              ) : <span className="tiny muted">{i + 1}</span>}
            </div>
          );
        })}
      </div>
      <button className="btn subtle sm mt8" onClick={() => inputRef.current?.click()} disabled={files.length >= PAIR_COUNT}>
        <IconUpload size={14} /> Add or drop
      </button>
      <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(e) => { add(e.target.files); e.currentTarget.value = ""; }} />
    </div>
  );
}

// ============================ EDIT FLOW ============================

interface EditItem {
  id: string; file: File; img: HTMLImageElement; origUrl: string;
  hash: string; isDup: boolean;
  auto: ProParams; params: ProParams;
  crop: { x: number; y: number; w: number; h: number } | null; useCrop: boolean;
  editedUrl: string; saved: boolean;
}

const uid = () => Math.random().toString(36).slice(2, 10);

function EditFlow() {
  const { state, setState, toast, go } = useApp();
  const [items, setItems] = useState<EditItem[]>([]);
  const [stage, setStage] = useState<"collect" | "edited">("collect");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [viewIdx, setViewIdx] = useState(0);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ---- add / dedupe ----
  const recomputeDupes = (list: EditItem[]): EditItem[] => {
    const groups = groupDuplicates(list.map((i) => i.hash));
    const seen: Record<number, boolean> = {};
    return list.map((it, idx) => {
      const g = groups[idx];
      const isDup = g !== -1 && seen[g] === true;
      if (g !== -1) seen[g] = true;
      return { ...it, isDup };
    });
  };

  const addFiles = useCallback(async (list: FileList | File[] | null) => {
    if (!list) return;
    const files = Array.from(list).filter((f) => isAccepted(f) && f.type.startsWith("image/"));
    if (!files.length) return;
    setBusy(true);
    try {
      const next: EditItem[] = [];
      for (const file of files) {
        const img = await loadImage(file);
        next.push({
          id: uid(), file, img, origUrl: URL.createObjectURL(file), hash: dHash(img), isDup: false,
          auto: NEUTRAL_PRO, params: NEUTRAL_PRO, crop: null, useCrop: false, editedUrl: "", saved: false,
        });
      }
      setItems((prev) => recomputeDupes([...prev, ...next]));
    } catch (e: any) { toast(e.message || "Could not load images", "err"); }
    finally { setBusy(false); }
  }, [toast]);

  function removeItem(id: string) {
    setItems((prev) => recomputeDupes(prev.filter((i) => i.id !== id)));
  }

  function renderItemCanvas(it: EditItem, maxDim: number): HTMLCanvasElement {
    const canvas = renderPro(it.img, it.params, maxDim);
    if (it.useCrop && it.crop) {
      const sc = canvas.width / it.img.naturalWidth;
      return cropCanvas(canvas, { x: it.crop.x * sc, y: it.crop.y * sc, w: it.crop.w * sc, h: it.crop.h * sc });
    }
    return canvas;
  }

  async function renderPreviewUrl(it: EditItem): Promise<string> {
    const blob = await canvasToBlob(renderItemCanvas(it, PREVIEW_MAX), 0.9);
    return blob ? URL.createObjectURL(blob) : "";
  }

  // ---- process all ("Edit Images") ----
  async function editAll() {
    if (!items.length) return;
    setBusy(true);
    try {
      const out: EditItem[] = [];
      for (let i = 0; i < items.length; i++) {
        setProgress(`Editing ${i + 1}/${items.length}…`);
        const it = items[i];
        const s = analyzePro(it.img);
        const auto = computeEnhance(s, state.editStyle);
        const crop = suggestCrop(it.img);
        const withParams: EditItem = { ...it, auto, params: auto, crop, useCrop: Boolean(crop) };
        withParams.editedUrl = await renderPreviewUrl(withParams);
        out.push(withParams);
        // yield to the UI so the progress label updates
        await new Promise((r) => setTimeout(r, 0));
      }
      setItems(out);
      setStage("edited");
      setViewIdx(0);
      toast("Photos edited", "ok");
    } catch (e: any) { toast(e.message || "Editing failed", "err"); }
    finally { setBusy(false); setProgress(""); }
  }

  async function reRender(id: string, patch: Partial<EditItem>) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch, saved: false } : i)));
    const base = items.find((i) => i.id === id);
    if (!base) return;
    const merged = { ...base, ...patch } as EditItem;
    const url = await renderPreviewUrl(merged);
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch, editedUrl: url, saved: false } : i)));
  }

  // ---- add to calendar ----
  async function addToCalendar() {
    const keep = items.filter((i) => !i.isDup);
    const skipped = items.length - keep.length;
    if (!keep.length) { toast("No non-duplicate photos to add", "err"); return; }
    setBusy(true);
    try {
      const mediaIds: string[] = [];
      for (let i = 0; i < keep.length; i++) {
        setProgress(`Saving ${i + 1}/${keep.length}…`);
        const it = keep[i];
        const blob = await canvasToBlob(renderItemCanvas(it, Infinity), 0.95);
        if (!blob) continue;
        const name = it.file.name.replace(/\.(\w+)$/, "") + "-edited.jpg";
        const media = await uploadFile(new File([blob], name, { type: "image/jpeg" }), Boolean(state.config.blobDirect));
        mediaIds.push(media.id);
        setState((prev) => ({ ...prev, media: [media, ...prev.media] }));
      }
      setProgress("Building your plan…");
      const res = await api.post("/api/plan/generate", { mediaIds });
      setState(res);
      toast(`Added ${mediaIds.length} edited photo${mediaIds.length === 1 ? "" : "s"} to the calendar` + (skipped ? ` · skipped ${skipped} duplicate${skipped === 1 ? "" : "s"}` : ""), "ok");
      go("calendar");
    } catch (e: any) { toast(e.message || "Could not add to calendar", "err"); }
    finally { setBusy(false); setProgress(""); }
  }

  const dupCount = items.filter((i) => i.isDup).length;

  // -------- COLLECT STAGE (upload + grid) --------
  if (stage === "collect") {
    return (
      <div className="stack gap16">
        {!state.editStyle && (
          <div className="banner warn"><div>No editing style trained yet — the AI will still edit each photo professionally; training just adds your personal taste on top.</div></div>
        )}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
          onClick={() => inputRef.current?.click()}
          style={{ cursor: "pointer", padding: 30, textAlign: "center", border: "2px dashed var(--border)", borderRadius: 14, background: "var(--surface)" }}
        >
          <IconUpload size={28} />
          <div style={{ fontWeight: 650, marginTop: 8 }}>Upload all your photos</div>
          <div className="tiny muted">Drag &amp; drop or click · batch upload · nothing is edited until you press “Edit Images”.</div>
          <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.currentTarget.value = ""; }} />
        </div>

        {busy && <div className="flex gap8 tiny muted"><Spinner /> {progress || "Loading…"}</div>}

        {items.length > 0 && (
          <>
            <div className="flex">
              <div className="grow tiny muted">
                {items.length} photo{items.length === 1 ? "" : "s"}
                {dupCount > 0 && <> · <span style={{ color: "var(--warn)" }}>{dupCount} duplicate{dupCount === 1 ? "" : "s"} flagged</span></>}
              </div>
              <button className="btn subtle sm" onClick={() => setItems([])} style={{ marginRight: 8 }}><IconTrash size={14} /> Clear</button>
              <button className="btn primary" onClick={editAll} disabled={busy}><IconWand size={16} /> Edit Images</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 12 }}>
              {items.map((it) => (
                <div key={it.id} className="card" style={{ padding: 6, position: "relative" }}>
                  <div style={{ aspectRatio: "1", borderRadius: 8, overflow: "hidden", background: "var(--surface-2)" }}>
                    <img src={it.origUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: it.isDup ? 0.55 : 1 }} />
                  </div>
                  {it.isDup && (
                    <span style={{ position: "absolute", top: 10, left: 10, background: "var(--warn)", color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6 }}>DUPLICATE</span>
                  )}
                  <button onClick={() => removeItem(it.id)} title="Remove"
                    style={{ position: "absolute", top: 10, right: 10, background: "rgba(0,0,0,.6)", color: "#fff", border: "none", borderRadius: 6, width: 22, height: 22, cursor: "pointer", display: "grid", placeItems: "center" }}>
                    <IconClose size={13} />
                  </button>
                </div>
              ))}
            </div>
            {dupCount > 0 && <p className="tiny muted">Duplicates are flagged and will be skipped when adding to the calendar.</p>}
          </>
        )}
      </div>
    );
  }

  // -------- EDITED STAGE (full-screen preview) --------
  const cur = items[viewIdx];
  return (
    <div className="stack gap12">
      <div className="flex">
        <button className="btn subtle sm" onClick={() => setStage("collect")}><IconGrid size={14} /> Back to photos</button>
        <div className="grow" />
        <div className="tiny muted" style={{ alignSelf: "center", marginRight: 10 }}>{viewIdx + 1} / {items.length}</div>
        <button className="btn primary" onClick={addToCalendar} disabled={busy}>
          {busy ? <Spinner /> : <IconCalendar size={16} />} Add to Calendar
        </button>
      </div>
      {busy && progress && <div className="flex gap8 tiny muted"><Spinner /> {progress}</div>}

      {cur && <BigPreview
        item={cur}
        onPrev={() => setViewIdx((i) => Math.max(0, i - 1))}
        onNext={() => setViewIdx((i) => Math.min(items.length - 1, i + 1))}
        canPrev={viewIdx > 0} canNext={viewIdx < items.length - 1}
        onToggleCrop={() => reRender(cur.id, { useCrop: !cur.useCrop })}
        onAdjust={() => setAdjustOpen(true)}
      />}

      {/* thumbnail strip */}
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
        {items.map((it, i) => (
          <button key={it.id} onClick={() => setViewIdx(i)}
            style={{ flex: "none", width: 60, height: 60, borderRadius: 8, overflow: "hidden", padding: 0, cursor: "pointer", position: "relative", border: i === viewIdx ? "2px solid var(--accent)" : "2px solid transparent", background: "var(--surface-2)" }}>
            <img src={it.editedUrl || it.origUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            {it.isDup && <span style={{ position: "absolute", inset: 0, background: "rgba(217,130,11,.35)" }} />}
          </button>
        ))}
      </div>

      {adjustOpen && cur && (
        <AdjustModal item={cur} onClose={() => setAdjustOpen(false)}
          onChange={(params) => reRender(cur.id, { params })}
          onResetAuto={() => reRender(cur.id, { params: cur.auto })}
          onApplyAll={(params) => { items.forEach((it) => reRender(it.id, { params: { ...params } })); }}
        />
      )}
    </div>
  );
}

function BigPreview({ item, onPrev, onNext, canPrev, canNext, onToggleCrop, onAdjust }: {
  item: EditItem; onPrev: () => void; onNext: () => void; canPrev: boolean; canNext: boolean;
  onToggleCrop: () => void; onAdjust: () => void;
}) {
  const [comparing, setComparing] = useState(false);
  const showOriginal = comparing;
  const src = showOriginal ? item.origUrl : (item.editedUrl || item.origUrl);
  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ position: "relative", background: "#000", borderRadius: 12, overflow: "hidden", display: "grid", placeItems: "center", minHeight: 320 }}>
        <img src={src} alt="" style={{ maxWidth: "100%", maxHeight: "68vh", objectFit: "contain", display: "block" }} />
        {item.isDup && <span style={{ position: "absolute", top: 10, left: 10, background: "var(--warn)", color: "#fff", fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 6 }}>DUPLICATE — will be skipped</span>}
        <span style={{ position: "absolute", top: 10, right: 10, background: "rgba(0,0,0,.6)", color: "#fff", fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 6 }}>
          {showOriginal ? "ORIGINAL" : "EDITED"}
        </span>
        {canPrev && <NavBtn side="left" onClick={onPrev} />}
        {canNext && <NavBtn side="right" onClick={onNext} />}
      </div>
      <div className="flex gap8 mt12 wrap" style={{ alignItems: "center" }}>
        <button
          className="btn subtle sm"
          onPointerDown={(e) => { e.preventDefault(); setComparing(true); }}
          onPointerUp={() => setComparing(false)}
          onPointerLeave={() => setComparing(false)}
          onPointerCancel={() => setComparing(false)}
          onContextMenu={(e) => e.preventDefault()}
          style={{ touchAction: "none", userSelect: "none" }}
        >
          <IconEye size={15} /> Hold to compare
        </button>
        {item.crop && (
          <button className={`btn sm ${item.useCrop ? "primary" : "subtle"}`} onClick={onToggleCrop}>
            <IconGrid size={14} /> {item.useCrop ? "Auto-crop on" : "Auto-crop off"}
          </button>
        )}
        <button className="btn subtle sm" onClick={onAdjust}><IconWand size={14} /> Adjust</button>
        <div className="grow" />
        <span className="tiny muted">{item.file.name}</span>
      </div>
    </div>
  );
}

function NavBtn({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label={side}
      style={{ position: "absolute", top: "50%", transform: "translateY(-50%)", [side]: 10, width: 40, height: 40, borderRadius: "50%", border: "none", background: "rgba(0,0,0,.5)", color: "#fff", display: "grid", placeItems: "center", cursor: "pointer" } as React.CSSProperties}>
      {side === "left" ? <IconChevronL size={20} /> : <IconChevronR size={20} />}
    </button>
  );
}

function AdjustModal({ item, onClose, onChange, onResetAuto, onApplyAll }: {
  item: EditItem; onClose: () => void; onChange: (p: ProParams) => void;
  onResetAuto: () => void; onApplyAll: (p: ProParams) => void;
}) {
  const [p, setP] = useState<ProParams>(item.params);
  const set = (k: keyof ProParams, v: number) => { const next = { ...p, [k]: v }; setP(next); onChange(next); };
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 900, width: "95%" }}>
        <div className="flex" style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <b className="grow">Fine-tune this photo</b>
          <button className="btn ghost sm" onClick={onClose}><IconClose size={18} /></button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 0 }}>
          <div style={{ padding: 16, background: "var(--surface-2)", display: "grid", placeItems: "center" }}>
            <img src={item.editedUrl || item.origUrl} alt="" style={{ maxWidth: "100%", maxHeight: "62vh", objectFit: "contain", borderRadius: 8 }} />
          </div>
          <div style={{ padding: 16, maxHeight: "70vh", overflowY: "auto" }}>
            {PRO_SLIDERS.map((s) => (
              <div key={s.key} style={{ marginBottom: 11 }}>
                <div className="flex tiny" style={{ marginBottom: 3 }}>
                  <span className="grow" style={{ fontWeight: 600 }}>{s.label}</span>
                  <span className="muted">{Math.round((p[s.key] as number) * 100)}</span>
                </div>
                <input type="range" min={-1} max={1} step={0.01} value={p[s.key] as number}
                  onChange={(e) => set(s.key, Number(e.target.value))} style={{ width: "100%" }} />
              </div>
            ))}
            <div className="flex gap8 mt8 wrap">
              <button className="btn subtle sm" onClick={() => { setP(item.auto); onResetAuto(); }}><IconRefresh size={14} /> Reset to AI edit</button>
              <div className="grow" />
              <button className="btn primary sm" onClick={() => onApplyAll(p)}>Apply to all</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
