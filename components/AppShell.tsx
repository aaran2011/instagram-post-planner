"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ClientState } from "./store";
import { api } from "./store";
import { AppProvider, useApp, View } from "./ui";
import {
  IconUpload, IconGrid, IconCalendar, IconRocket, IconBolt, IconSettings,
  IconInstagram, IconLogout, IconMenu, IconCheck, IconAlert, IconLink,
} from "./icons";
import UploadView from "./views/UploadView";
import PlanView from "./views/PlanView";
import CalendarView from "./views/CalendarView";
import ReviewView from "./views/ReviewView";
import AutomationView from "./views/AutomationView";
import SettingsView from "./views/SettingsView";
import PostModal from "./PostModal";
import ConnectModal from "./ConnectModal";

interface Toast { id: number; msg: string; type: "ok" | "err" | "info"; }

export default function AppShell({ initial, email }: { initial: ClientState; email: string }) {
  const router = useRouter();
  const [state, setState] = useState<ClientState>(initial);
  const [view, setView] = useState<View>(initial.posts.length ? "plan" : "upload");
  const [openPostId, setOpenPostId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);

  const toast = useCallback((msg: string, type: "ok" | "err" | "info" = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const s = await api.get("/api/state");
      setState(s);
    } catch (e: any) {
      if (e.status === 401) router.replace("/login");
    }
  }, [router]);

  // Surface OAuth callback results from the URL (?connected / ?error).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("connected")) {
      toast("Instagram connected", "ok");
      refresh();
      window.history.replaceState({}, "", "/");
    } else if (p.get("error")) {
      toast(decodeURIComponent(p.get("error")!), "err");
      window.history.replaceState({}, "", "/");
    }
  }, [toast, refresh]);

  // Lightweight scheduler heartbeat so due posts publish while the app is open.
  useEffect(() => {
    const tick = () => {
      api.post("/api/scheduler/tick").then((r) => {
        if (r?.processed > 0) refresh();
      }).catch(() => {});
    };
    const iv = setInterval(tick, 60000);
    return () => clearInterval(iv);
  }, [refresh]);

  const go = useCallback((v: View) => { setView(v); setSidebarOpen(false); }, []);
  const openPost = useCallback((id: string | null) => setOpenPostId(id), []);

  const ctx = useMemo(
    () => ({ state, setState, toast, refresh, openPost, openPostId, go, view }),
    [state, toast, refresh, openPost, openPostId, go, view],
  );

  async function logout() {
    await api.post("/api/auth/logout").catch(() => {});
    router.replace("/login");
  }

  const ig = state.instagram;
  const counts = {
    media: state.media.length,
    posts: state.posts.length,
    scheduled: state.posts.filter((p) => p.status === "scheduled").length,
  };

  const navItems: { key: View; label: string; icon: React.ReactNode; badge?: number }[] = [
    { key: "upload", label: "Upload", icon: <IconUpload size={19} />, badge: counts.media || undefined },
    { key: "plan", label: "Your Plan", icon: <IconGrid size={19} />, badge: counts.posts || undefined },
    { key: "calendar", label: "Calendar", icon: <IconCalendar size={19} /> },
    { key: "review", label: "Review", icon: <IconRocket size={19} /> },
    { key: "automation", label: "Automation", icon: <IconBolt size={19} />, badge: counts.scheduled || undefined },
    { key: "settings", label: "Settings", icon: <IconSettings size={19} /> },
  ];

  return (
    <AppProvider value={ctx}>
      <div className="app">
        {sidebarOpen && <div className="scrim" onClick={() => setSidebarOpen(false)} />}
        <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
          <div className="brand">
            <div className="logo">◐</div>
            <div className="name">Instagram Planner</div>
          </div>
          {navItems.map((n) => (
            <button key={n.key} className={`nav-item ${view === n.key ? "active" : ""}`} onClick={() => go(n.key)}>
              {n.icon}
              <span>{n.label}</span>
              {n.badge ? <span className="badge">{n.badge}</span> : null}
            </button>
          ))}
          <div className="nav-spacer" />

          <button
            className="nav-item"
            onClick={() => (ig.connected ? go("settings") : setConnectOpen(true))}
          >
            <IconInstagram size={19} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {ig.connected ? `@${ig.username}` : "Connect Instagram"}
            </span>
            {ig.connected && <span className="badge" style={{ background: "var(--success)", color: "#fff", borderColor: "transparent" }}>●</span>}
          </button>
          <button className="nav-item" onClick={logout}>
            <IconLogout size={19} />
            <span>Log out</span>
          </button>
        </aside>

        <div className="main">
          <div className="topbar">
            <button className="btn ghost sm menu-btn" onClick={() => setSidebarOpen(true)} aria-label="Menu">
              <IconMenu size={20} />
            </button>
            <div className="title">{navItems.find((n) => n.key === view)?.label}</div>
            <div className="spacer" />
            {state.settings.demoMode && (
              <span className="pill accent" title="Nothing will be published to Instagram in demo mode.">
                <span className="dot" style={{ background: "var(--accent)" }} /> Demo mode
              </span>
            )}
            {ig.connected ? (
              <span className="pill ok"><span className="dot" /> {ig.demo ? "Demo" : ""} @{ig.username}</span>
            ) : (
              <button className="btn sm subtle" onClick={() => setConnectOpen(true)}>
                <IconLink size={15} /> Connect Instagram
              </button>
            )}
          </div>

          <div className="content">
            {view === "upload" && <UploadView onConnect={() => setConnectOpen(true)} />}
            {view === "plan" && <PlanView />}
            {view === "calendar" && <CalendarView />}
            {view === "review" && <ReviewView onConnect={() => setConnectOpen(true)} />}
            {view === "automation" && <AutomationView />}
            {view === "settings" && <SettingsView onConnect={() => setConnectOpen(true)} />}
          </div>
        </div>
      </div>

      {openPostId && <PostModal postId={openPostId} onClose={() => setOpenPostId(null)} />}
      {connectOpen && <ConnectModal onClose={() => setConnectOpen(false)} />}

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type === "ok" ? "ok" : t.type === "err" ? "err" : ""}`}>
            {t.type === "ok" ? <IconCheck size={18} /> : t.type === "err" ? <IconAlert size={18} /> : null}
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </AppProvider>
  );
}

// Re-export for view files.
export { useApp };
