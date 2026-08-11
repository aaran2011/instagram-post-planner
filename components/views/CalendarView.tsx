"use client";
import React, { useMemo, useState } from "react";
import { useApp, Segmented } from "../ui";
import { api, mediaById } from "../store";
import type { Post } from "../store";
import { localParts, zonedTimeToUtc, formatLocal } from "@/lib/schedule";
import { IconChevronL, IconChevronR, IconCalendar } from "../icons";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function dayKeyOf(iso: string, tz: string) {
  const p = localParts(new Date(iso), tz);
  return `${p.year}-${p.month}-${p.day}`;
}
function keyOf(y: number, m: number, d: number) { return `${y}-${m}-${d}`; }

export default function CalendarView() {
  const { state, openPost, setState, toast } = useApp();
  const [mode, setMode] = useState<"month" | "week" | "day">("month");
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() }); // month 0-11
  const [weekStart, setWeekStart] = useState(() => startOfWeek(now));
  const [dayDate, setDayDate] = useState(() => new Date());
  const [dragId, setDragId] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const postsByDay = useMemo(() => {
    const map = new Map<string, Post[]>();
    for (const p of state.posts) {
      const k = dayKeyOf(p.scheduledAt, p.timezone);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(p);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    return map;
  }, [state.posts]);

  const todayKey = keyOf(now.getFullYear(), now.getMonth() + 1, now.getDate());

  async function moveToDate(postId: string, y: number, m: number, d: number) {
    const post = state.posts.find((p) => p.id === postId);
    if (!post) return;
    const lp = localParts(new Date(post.scheduledAt), post.timezone);
    const iso = zonedTimeToUtc(y, m, d, lp.hour, lp.minute, post.timezone).toISOString();
    if (iso === post.scheduledAt) return;
    try {
      let res = await api.post(`/api/posts/${postId}/schedule`, { scheduledAt: iso });
      if (res.conflict) {
        if (!confirm("Another post is within 30 minutes of that time. Move it anyway?")) return;
        res = await api.post(`/api/posts/${postId}/schedule`, { scheduledAt: iso, force: true });
      }
      setState((prev) => ({ ...prev, posts: prev.posts.map((p) => (p.id === postId ? res.post : p)) }));
      toast("Rescheduled", "ok");
    } catch (e: any) {
      toast(e.message, "err");
    }
  }

  function Cell({ y, m, d, dim }: { y: number; m: number; d: number; dim?: boolean }) {
    const k = keyOf(y, m, d);
    const posts = postsByDay.get(k) || [];
    return (
      <div
        className={`calcell ${dim ? "dim" : ""} ${k === todayKey ? "today" : ""} ${overKey === k ? "drop" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setOverKey(k); }}
        onDragLeave={() => setOverKey((o) => (o === k ? null : o))}
        onDrop={(e) => { e.preventDefault(); if (dragId) moveToDate(dragId, y, m, d); setDragId(null); setOverKey(null); }}
      >
        <div className="dnum">{d}</div>
        {posts.map((p) => {
          const media = mediaById(state, p.mediaId);
          const when = formatLocal(p.scheduledAt, p.timezone);
          return (
            <div
              key={p.id}
              className="calpost"
              draggable
              onDragStart={() => setDragId(p.id)}
              onDragEnd={() => { setDragId(null); setOverKey(null); }}
              onClick={() => openPost(p.id)}
              title={`${when.time} · ${media?.originalName || ""}`}
            >
              {media && <img src={media.thumbUrl} alt="" />}
              <span className="cptext">{when.time}</span>
            </div>
          );
        })}
      </div>
    );
  }

  function MonthGrid() {
    const first = new Date(cursor.y, cursor.m, 1);
    const startDow = first.getDay();
    const cells: React.ReactNode[] = [];
    // Leading days from previous month
    for (let i = 0; i < startDow; i++) {
      const d = new Date(cursor.y, cursor.m, 1 - (startDow - i));
      cells.push(<Cell key={`p${i}`} y={d.getFullYear()} m={d.getMonth() + 1} d={d.getDate()} dim />);
    }
    const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) cells.push(<Cell key={d} y={cursor.y} m={cursor.m + 1} d={d} />);
    while (cells.length % 7 !== 0) {
      const idx = cells.length;
      const d = new Date(cursor.y, cursor.m + 1, cells.length - (startDow + daysInMonth) + 1);
      cells.push(<Cell key={`n${idx}`} y={d.getFullYear()} m={d.getMonth() + 1} d={d.getDate()} dim />);
    }
    return <div className="calgrid">{cells}</div>;
  }

  function WeekGrid() {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      return d;
    });
    return (
      <div className="calgrid">
        {days.map((d, i) => (
          <div key={i} style={{ gridColumn: "auto" }}>
            <Cell y={d.getFullYear()} m={d.getMonth() + 1} d={d.getDate()} />
          </div>
        ))}
      </div>
    );
  }

  function DayList() {
    const k = keyOf(dayDate.getFullYear(), dayDate.getMonth() + 1, dayDate.getDate());
    const posts = postsByDay.get(k) || [];
    return (
      <div style={{ padding: 16 }}>
        {posts.length === 0 && <p className="muted">No posts scheduled this day.</p>}
        <div className="rows">
          {posts.map((p) => {
            const media = mediaById(state, p.mediaId);
            const when = formatLocal(p.scheduledAt, p.timezone);
            return (
              <div key={p.id} className="row" onClick={() => openPost(p.id)} style={{ cursor: "pointer" }}>
                {media && <img src={media.thumbUrl} alt="" />}
                <div className="rowmain">
                  <div className="rowtitle">{when.time} · {p.category}</div>
                  <div className="rowsub">{p.caption.slice(0, 70)}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function shift(dir: number) {
    if (mode === "month") {
      const m = cursor.m + dir;
      const y = cursor.y + Math.floor(m / 12);
      setCursor({ y, m: ((m % 12) + 12) % 12 });
    } else if (mode === "week") {
      const d = new Date(weekStart); d.setDate(d.getDate() + dir * 7); setWeekStart(d);
    } else {
      const d = new Date(dayDate); d.setDate(d.getDate() + dir); setDayDate(d);
    }
  }

  const label =
    mode === "month" ? `${MONTHS[cursor.m]} ${cursor.y}`
    : mode === "week" ? `Week of ${MONTHS[weekStart.getMonth()]} ${weekStart.getDate()}`
    : `${MONTHS[dayDate.getMonth()]} ${dayDate.getDate()}, ${dayDate.getFullYear()}`;

  return (
    <div>
      <div className="sectionhead">
        <div className="htext"><h1>Calendar</h1><p className="muted tiny">Drag a post to another day to reschedule. Click to preview.</p></div>
        <div className="spacer" />
        <Segmented value={mode} onChange={setMode as any}
          options={[{ value: "month", label: "Month" }, { value: "week", label: "Week" }, { value: "day", label: "Day" }]} />
      </div>

      <div className="flex gap12 mb16">
        <button className="btn subtle sm" onClick={() => shift(-1)}><IconChevronL size={16} /></button>
        <b style={{ minWidth: 180, textAlign: "center" }}>{label}</b>
        <button className="btn subtle sm" onClick={() => shift(1)}><IconChevronR size={16} /></button>
        <button className="btn ghost sm" onClick={() => { const n = new Date(); setCursor({ y: n.getFullYear(), m: n.getMonth() }); setWeekStart(startOfWeek(n)); setDayDate(n); }}>Today</button>
        <div className="right" />
        {state.posts.length === 0 && <span className="pill"><IconCalendar size={13} /> Nothing scheduled yet</span>}
      </div>

      <div className="cal">
        {mode !== "day" && <div className="calhead">{DOW.map((d) => <div key={d}>{d}</div>)}</div>}
        {mode === "month" && <MonthGrid />}
        {mode === "week" && <WeekGrid />}
        {mode === "day" && <DayList />}
      </div>
    </div>
  );
}

function startOfWeek(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
}
