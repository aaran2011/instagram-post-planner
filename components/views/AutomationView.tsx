"use client";
import React, { useState } from "react";
import { useApp, Spinner } from "../ui";
import { api, mediaById } from "../store";
import type { Post } from "../store";
import { formatLocal } from "@/lib/schedule";
import { IconClock, IconCheck, IconAlert, IconRefresh, IconEdit, IconVideo, IconBolt } from "../icons";

function Row({ post, right }: { post: Post; right?: React.ReactNode }) {
  const { state, openPost } = useApp();
  const m = mediaById(state, post.mediaId);
  const when = formatLocal(post.scheduledAt, post.timezone);
  return (
    <div className="row">
      {m ? <img src={m.thumbUrl} alt="" /> : <div className="rowthumb" />}
      <div className="rowmain">
        <div className="rowtitle">
          {when.date} · {when.time}{" "}
          <span className="tiny muted">· {m?.type === "video" ? "Video" : "Photo"} · {post.category}</span>
        </div>
        <div className="rowsub">{post.error ? <span style={{ color: "var(--danger)" }}>{post.error}</span> : post.caption.slice(0, 80)}</div>
      </div>
      {right}
      <button className="btn ghost sm" onClick={() => openPost(post.id)}><IconEdit size={15} /> Edit</button>
    </div>
  );
}

export default function AutomationView() {
  const { state, setState, toast, go } = useApp();
  const [retrying, setRetrying] = useState<string | null>(null);
  const posts = state.posts;

  const upcoming = posts.filter((p) => p.status === "scheduled" || p.status === "publishing").sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const drafts = posts.filter((p) => p.status === "draft");
  const published = posts.filter((p) => p.status === "published" || p.status === "demo_published").sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));
  const failed = posts.filter((p) => p.status === "failed");

  async function retry(id: string) {
    setRetrying(id);
    try {
      const res = await api.post("/api/publish", { postId: id });
      setState(res);
      const st = res.outcome?.status;
      toast(st === "failed" ? `Still failing: ${res.outcome.error}` : "Published", st === "failed" ? "err" : "ok");
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setRetrying(null);
    }
  }

  if (!posts.length) {
    return (
      <div className="empty">
        <div className="eicon"><IconBolt /></div>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>No automation yet</h1>
        <p className="muted mb16">Once you schedule a plan, its status shows up here.</p>
        <button className="btn primary" onClick={() => go("upload")}>Go to Upload</button>
      </div>
    );
  }

  return (
    <div className="stack gap24">
      <div className="sectionhead" style={{ marginBottom: 0 }}>
        <div className="htext"><h1>Automation</h1><p className="muted tiny">What’s upcoming, published, and anything that needs attention.</p></div>
        <div className="spacer" />
        {state.settings.demoMode && <span className="pill accent"><span className="dot" style={{ background: "var(--accent)" }} /> Demo mode</span>}
      </div>

      {drafts.length > 0 && (
        <div className="banner info">
          <IconAlert size={16} className="bicon" />
          <div>{drafts.length} post{drafts.length > 1 ? "s are" : " is"} still a draft. Go to <b onClick={() => go("review")} style={{ cursor: "pointer", textDecoration: "underline" }}>Review</b> to schedule {drafts.length > 1 ? "them" : "it"}.</div>
        </div>
      )}

      <section>
        <div className="flex gap8 mb16"><IconClock size={18} /><b>Upcoming</b><span className="pill">{upcoming.length}</span></div>
        {upcoming.length === 0 ? <p className="muted tiny">Nothing scheduled.</p> : (
          <div className="rows">
            {upcoming.map((p) => (
              <Row key={p.id} post={p} right={<span className="pill">{p.status === "publishing" ? "Publishing…" : "Scheduled"}</span>} />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex gap8 mb16"><IconCheck size={18} /><b>Published</b><span className="pill">{published.length}</span></div>
        {published.length === 0 ? <p className="muted tiny">Nothing published yet.</p> : (
          <div className="rows">
            {published.map((p) => (
              <Row key={p.id} post={p} right={p.status === "demo_published" ? <span className="pill accent">DEMO — NOT PUBLISHED</span> : <span className="pill ok"><span className="dot" /> Published</span>} />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex gap8 mb16"><IconAlert size={18} /><b>Failed</b><span className="pill">{failed.length}</span></div>
        {failed.length === 0 ? <p className="muted tiny">No failures. 🎉</p> : (
          <div className="rows">
            {failed.map((p) => (
              <Row key={p.id} post={p} right={
                <button className="btn subtle sm" onClick={() => retry(p.id)} disabled={retrying === p.id}>
                  {retrying === p.id ? <Spinner dark /> : <IconRefresh size={15} />} Retry
                </button>
              } />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
