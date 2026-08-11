"use client";
import React, { useMemo, useState } from "react";
import { useApp, Modal, CloseButton, Spinner } from "../ui";
import { api, mediaById } from "../store";
import { formatLocal } from "@/lib/schedule";
import { IconRocket, IconVideo, IconReel, IconCheck, IconAlert, IconInstagram, IconGrid } from "../icons";

export default function ReviewView({ onConnect }: { onConnect: () => void }) {
  const { state, setState, toast, openPost, go } = useApp();
  const posts = state.posts;
  const [confirming, setConfirming] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const stats = useMemo(() => {
    let photos = 0, videos = 0;
    for (const p of posts) {
      const m = mediaById(state, p.mediaId);
      if (m?.type === "video") videos++; else photos++;
    }
    const sorted = [...posts].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    return {
      total: posts.length,
      photos, videos,
      first: sorted[0], last: sorted[sorted.length - 1],
    };
  }, [posts, state]);

  const ig = state.instagram;

  async function confirmSchedule() {
    setPublishing(true);
    try {
      const res = await api.post("/api/publish", {});
      setState(res);
      const s = res.summary;
      if (s.demoMode) {
        toast(`Demo scheduled — ${s.scheduled} upcoming, ${s.demoPublished} marked published (nothing sent to Instagram)`, "ok");
      } else {
        toast(`${s.scheduled} scheduled · ${s.published} published${s.failed ? ` · ${s.failed} failed` : ""}`, s.failed ? "err" : "ok");
      }
      setConfirming(false);
      go("automation");
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setPublishing(false);
    }
  }

  if (!posts.length) {
    return (
      <div className="empty">
        <div className="eicon"><IconGrid /></div>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>Nothing to review yet</h1>
        <p className="muted mb16">Generate a plan first, then come back to review and schedule.</p>
        <button className="btn primary" onClick={() => go("upload")}>Go to Upload</button>
      </div>
    );
  }

  const firstWhen = stats.first && formatLocal(stats.first.scheduledAt, stats.first.timezone);
  const lastWhen = stats.last && formatLocal(stats.last.scheduledAt, stats.last.timezone);

  return (
    <div>
      <div className="sectionhead">
        <div className="htext"><h1>Ready to Schedule</h1><p className="muted tiny">Inspect every post, then publish &amp; schedule your plan.</p></div>
      </div>

      <div className="stats mb24">
        <div className="card stat"><div className="k">Total Posts</div><div className="v">{stats.total}</div></div>
        <div className="card stat"><div className="k">Photos</div><div className="v">{stats.photos}</div></div>
        <div className="card stat"><div className="k">Videos</div><div className="v">{stats.videos}</div></div>
        <div className="card stat"><div className="k">First Post</div><div className="v" style={{ fontSize: 15 }}>{firstWhen ? `${firstWhen.date}` : "—"}</div><div className="tiny muted">{firstWhen?.time}</div></div>
        <div className="card stat"><div className="k">Last Post</div><div className="v" style={{ fontSize: 15 }}>{lastWhen ? `${lastWhen.date}` : "—"}</div><div className="tiny muted">{lastWhen?.time}</div></div>
        <div className="card stat">
          <div className="k">Instagram</div>
          {ig.connected ? (
            <><div className="v" style={{ fontSize: 15 }}>@{ig.username}</div><div className="tiny muted">{ig.demo ? "Demo connection" : ig.accountType}</div></>
          ) : (
            <button className="btn subtle sm mt8" onClick={onConnect}><IconInstagram size={15} /> Connect</button>
          )}
        </div>
      </div>

      {state.settings.demoMode && (
        <div className="banner info mb16">
          <IconAlert size={16} className="bicon" />
          <div><b>Demo mode is on.</b> Scheduling &amp; publishing are simulated — nothing is sent to Instagram. Posts will be labeled <b>DEMO — NOT PUBLISHED</b>. Turn this off in Settings when you’re ready to go live.</div>
        </div>
      )}

      <div className="flex mb16">
        <b>Final grid</b>
        <div className="right" />
        <button className="btn primary lg" onClick={() => setConfirming(true)}>
          <IconRocket size={18} /> Publish &amp; Schedule
        </button>
      </div>

      <div className="iggrid" style={{ maxWidth: 720 }}>
        {posts.map((p) => {
          const m = mediaById(state, p.mediaId);
          const when = formatLocal(p.scheduledAt, p.timezone);
          return (
            <div key={p.id} className="igcell" onClick={() => openPost(p.id)}>
              {m && <img src={m.thumbUrl} alt="" loading="lazy" />}
              <span className="ord">{p.order + 1}</span>
              {m?.type === "video" && <span className="type">{p.format === "reel" ? <IconReel size={16} /> : <IconVideo size={16} />}</span>}
              <div className="when">{when.date} · {when.time}</div>
            </div>
          );
        })}
      </div>

      {confirming && (
        <Modal onClose={() => !publishing && setConfirming(false)} className="narrow">
          <div style={{ padding: 26 }}>
            <div className="flex mb16"><h2 style={{ fontSize: 20 }}>Confirm &amp; Schedule</h2><div className="right" /><CloseButton onClose={() => setConfirming(false)} /></div>
            <p className="mb16">
              You’re about to schedule <b>{stats.total} {stats.total === 1 ? "post" : "posts"}</b>{" "}
              to <b>@{ig.username || "your account"}</b>.
            </p>
            <div className="rows mb16">
              <div className="row"><div className="rowmain"><div className="rowtitle">First scheduled post</div><div className="rowsub">{firstWhen?.date} · {firstWhen?.time}</div></div></div>
              <div className="row"><div className="rowmain"><div className="rowtitle">Last scheduled post</div><div className="rowsub">{lastWhen?.date} · {lastWhen?.time}</div></div></div>
              <div className="row"><div className="rowmain"><div className="rowtitle">Photos / Videos</div><div className="rowsub">{stats.photos} photos · {stats.videos} videos</div></div></div>
            </div>

            {!ig.connected && !state.settings.demoMode && (
              <div className="banner warn mb16"><IconAlert size={16} className="bicon" /><div>Instagram isn’t connected. Connect an account or enable demo mode first.</div></div>
            )}
            {state.settings.demoMode ? (
              <div className="banner info mb16"><IconAlert size={16} className="bicon" /><div>Demo mode: nothing will be sent to Instagram.</div></div>
            ) : (
              <div className="banner mb16"><IconAlert size={16} className="bicon" /><div className="tiny">Real publishing requires <code>PUBLIC_BASE_URL</code> so Instagram can fetch your media. Due posts publish now; future posts publish at their time while the app/scheduler runs.</div></div>
            )}

            <button className="btn primary block lg" onClick={confirmSchedule} disabled={publishing || (!ig.connected && !state.settings.demoMode)}>
              {publishing ? <Spinner /> : <IconCheck size={18} />} Confirm &amp; Schedule
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
