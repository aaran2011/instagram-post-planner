"use client";
import React, { useState } from "react";
import { useApp } from "../ui";
import { api, mediaById } from "../store";
import type { Post } from "../store";
import { formatLocal } from "@/lib/schedule";
import GenerateOverlay from "../GenerateOverlay";
import { IconVideo, IconReel, IconSparkle, IconGrid, IconCheck, IconClock, IconAlert } from "../icons";

function StatusDot({ status }: { status: Post["status"] }) {
  if (status === "published") return <span className="pill ok stat"><IconCheck size={11} /></span>;
  if (status === "demo_published") return <span className="pill accent stat">DEMO</span>;
  if (status === "failed") return <span className="pill err stat"><IconAlert size={11} /></span>;
  if (status === "scheduled") return <span className="pill stat" style={{ background: "rgba(0,0,0,0.5)", color: "#fff", border: "none" }}><IconClock size={11} /></span>;
  return null;
}

export default function PlanView() {
  const { state, setState, toast, openPost, go } = useApp();
  const posts = state.posts;
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [regen, setRegen] = useState(false);

  async function reorder(fromId: string, toId: string) {
    if (fromId === toId) return;
    const ids = posts.map((p) => p.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    // Optimistic reorder (each post keeps its own date/time).
    const map = new Map(posts.map((p) => [p.id, p]));
    const next = ids.map((id, i) => ({ ...map.get(id)!, order: i }));
    setState((prev) => ({ ...prev, posts: next }));
    try {
      const res = await api.post("/api/posts/reorder", { orderedIds: ids });
      setState(res);
      toast("Order updated", "ok");
    } catch (e: any) {
      toast(e.message, "err");
    }
  }

  async function regeneratePlan() {
    if (!state.media.length) return;
    if (!confirm("Regenerate the whole plan from your library? This replaces the current captions, order and schedule.")) return;
    setRegen(true);
    try {
      const res = await api.post("/api/plan/generate", {});
      setState(res);
      toast("Plan regenerated", "ok");
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setRegen(false);
    }
  }

  if (!posts.length) {
    return (
      <div className="empty">
        <div className="eicon"><IconGrid /></div>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>No plan yet</h1>
        <p className="muted mb16">Upload content and generate a plan to see your Instagram grid here.</p>
        <button className="btn primary" onClick={() => go("upload")}><IconSparkle size={16} /> Go to Upload</button>
      </div>
    );
  }

  return (
    <div>
      {regen && <GenerateOverlay count={state.media.length} />}
      <div className="sectionhead">
        <div className="htext">
          <h1>Your Instagram Plan</h1>
          <p className="muted tiny">Drag any post to reorder your feed. Click a post to preview &amp; edit. Each post keeps its own date &amp; time.</p>
        </div>
        <div className="spacer" />
        <div className="toolbar">
          <span className="pill">{posts.length} posts</span>
          <button className="btn sm subtle" onClick={regeneratePlan}><IconSparkle size={15} /> Regenerate plan</button>
          <button className="btn primary sm" onClick={() => go("review")}>Review &amp; Schedule</button>
        </div>
      </div>

      <div className="iggrid" style={{ maxWidth: 720 }}>
        {posts.map((p) => {
          const m = mediaById(state, p.mediaId);
          const when = formatLocal(p.scheduledAt, p.timezone);
          return (
            <div
              key={p.id}
              className={`igcell ${dragId === p.id ? "dragging" : ""} ${overId === p.id && dragId !== p.id ? "over" : ""}`}
              draggable
              onDragStart={() => setDragId(p.id)}
              onDragEnd={() => { setDragId(null); setOverId(null); }}
              onDragOver={(e) => { e.preventDefault(); setOverId(p.id); }}
              onDrop={(e) => { e.preventDefault(); if (dragId) reorder(dragId, p.id); setDragId(null); setOverId(null); }}
              onClick={() => openPost(p.id)}
              title={m?.originalName}
            >
              {m ? <img src={m.thumbUrl} alt="" loading="lazy" /> : <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--text-3)" }}><IconAlert /></div>}
              <span className="ord">{p.order + 1}</span>
              {m?.type === "video" && <span className="type">{p.format === "reel" ? <IconReel size={16} /> : <IconVideo size={16} />}</span>}
              <StatusDot status={p.status} />
              <div className="when">{when.date} · {when.time}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
