"use client";
import React, { useState } from "react";
import { useApp, Spinner } from "../ui";
import { api } from "../store";
import { tzListWith } from "../tz";
import { IconInstagram, IconCheck, IconAlert, IconPlus, IconClose, IconSparkle } from "../icons";

export default function SettingsView({ onConnect }: { onConnect: () => void }) {
  const { state, setState, toast } = useApp();
  const s = state.settings;
  const [timezone, setTimezone] = useState(s.timezone);
  const [times, setTimes] = useState<string[]>(s.defaultTimes);
  const [cadence, setCadence] = useState(s.postingCadenceDays);
  const [tone, setTone] = useState(s.aiTone);
  const [emojis, setEmojis] = useState(s.aiEmojis);
  const [newTime, setNewTime] = useState("");
  const [saving, setSaving] = useState(false);
  const ig = state.instagram;

  async function save() {
    setSaving(true);
    try {
      const res = await api.patch("/api/settings", {
        timezone, defaultTimes: times, postingCadenceDays: cadence, aiTone: tone, aiEmojis: emojis,
      });
      setState((prev) => ({ ...prev, settings: res.settings }));
      toast("Settings saved", "ok");
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setSaving(false);
    }
  }

  async function toggleDemo(next: boolean) {
    try {
      const res = await api.patch("/api/settings", { demoMode: next });
      setState((prev) => ({ ...prev, settings: res.settings }));
      toast(next ? "Demo mode ON — publishing is simulated" : "Demo mode OFF — live publishing enabled", "ok");
    } catch (e: any) {
      toast(e.message, "err");
    }
  }

  async function disconnect() {
    if (!confirm("Disconnect Instagram?")) return;
    try {
      await api.post("/api/instagram/disconnect");
      setState((prev) => ({ ...prev, instagram: { connected: false, username: null, igUserId: null, accountType: null, connectedAt: null, demo: false } }));
      toast("Disconnected", "ok");
    } catch (e: any) {
      toast(e.message, "err");
    }
  }

  function addTime() {
    if (!/^\d{1,2}:\d{2}$/.test(newTime)) { toast("Use HH:MM format", "err"); return; }
    if (!times.includes(newTime)) setTimes((t) => [...t, newTime].sort());
    setNewTime("");
  }

  return (
    <div style={{ maxWidth: 720 }} className="stack gap24">
      <div className="sectionhead" style={{ marginBottom: 0 }}>
        <div className="htext"><h1>Settings</h1><p className="muted tiny">Your account, time zone and content preferences.</p></div>
      </div>

      {/* Instagram */}
      <div className="card" style={{ padding: 22 }}>
        <div className="flex gap12 mb16"><IconInstagram size={20} /><b>Instagram account</b></div>
        {ig.connected ? (
          <div className="flex gap12 wrap">
            <div className="avatar" style={{ width: 44, height: 44 }}>
              <div style={{ width: "100%", height: "100%", borderRadius: "50%", background: "var(--accent-grad)", display: "grid", placeItems: "center", color: "#fff", fontWeight: 700 }}>
                {(ig.username || "?").slice(0, 1).toUpperCase()}
              </div>
            </div>
            <div className="grow">
              <div style={{ fontWeight: 650 }}>@{ig.username}</div>
              <div className="tiny muted">{ig.demo ? "Demo connection (simulated)" : `${ig.accountType || "Business"} account`}{ig.connectedAt ? ` · connected ${new Date(ig.connectedAt).toLocaleDateString()}` : ""}</div>
            </div>
            <span className="pill ok"><span className="dot" /> Connected</span>
            <button className="btn danger sm" onClick={disconnect}>Disconnect</button>
          </div>
        ) : (
          <div className="flex gap12 wrap">
            <div className="grow muted tiny">No account connected. Connect your Instagram Business account to publish.</div>
            <button className="btn primary sm" onClick={onConnect}><IconInstagram size={15} /> Connect Instagram</button>
          </div>
        )}
      </div>

      {/* Demo mode */}
      <div className="card" style={{ padding: 22 }}>
        <div className="flex gap12">
          <div className="grow">
            <b>Demo mode</b>
            <p className="tiny muted mt8">When on, scheduling &amp; publishing are simulated. Nothing is sent to Instagram and posts are labeled <b>DEMO — NOT PUBLISHED</b>. Recommended until you’ve configured real API access.</p>
          </div>
          <Toggle on={s.demoMode} onChange={toggleDemo} />
        </div>
      </div>

      {/* Posting preferences */}
      <div className="card" style={{ padding: 22 }}>
        <b>Default posting preferences</b>
        <div className="mt16 stack gap16">
          <label className="field">
            <span>Time zone</span>
            <select className="select" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {tzListWith(timezone).map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </label>

          <div>
            <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-2)", marginBottom: 6 }}>Preferred posting times</span>
            <div className="taglist mb8">
              {times.map((t) => (
                <span key={t} className="tag">{t}<button onClick={() => setTimes((x) => x.filter((y) => y !== t))}><IconClose size={13} /></button></span>
              ))}
              {times.length === 0 && <span className="tiny muted">No times — add at least one.</span>}
            </div>
            <div className="flex gap8" style={{ maxWidth: 260 }}>
              <input className="input" type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
              <button className="btn subtle sm" onClick={addTime}><IconPlus size={15} /></button>
            </div>
          </div>

          <label className="field" style={{ maxWidth: 260 }}>
            <span>Days between posts</span>
            <input className="input" type="number" min={1} max={30} value={cadence} onChange={(e) => setCadence(Math.max(1, parseInt(e.target.value) || 1))} />
          </label>
        </div>
      </div>

      {/* AI preferences */}
      <div className="card" style={{ padding: 22 }}>
        <div className="flex gap8 mb16"><IconSparkle size={18} /><b>AI preferences</b></div>
        {!state.config.ai && (
          <div className="banner warn mb16"><IconAlert size={16} className="bicon" /><div>No <code>ANTHROPIC_API_KEY</code> configured — the app uses the built-in demo content engine. Add a key to enable real vision analysis &amp; captions.</div></div>
        )}
        <label className="field mb16">
          <span>Caption tone</span>
          <input className="input" value={tone} onChange={(e) => setTone(e.target.value)} placeholder="e.g. warm, authentic, concise" />
        </label>
        <div className="flex gap12">
          <div className="grow tiny muted">Allow emojis in captions</div>
          <Toggle on={emojis} onChange={setEmojis} />
        </div>
      </div>

      <div className="flex">
        <div className="right" />
        <button className="btn primary" onClick={save} disabled={saving}>{saving ? <Spinner /> : <IconCheck size={16} />} Save preferences</button>
      </div>

      {/* Config diagnostics */}
      <div className="card" style={{ padding: 22 }}>
        <b>Configuration</b>
        <div className="rows mt16">
          <ConfigRow ok={state.config.ai} label="AI (ANTHROPIC_API_KEY)" okText="Configured" noText="Using demo content engine" />
          <ConfigRow ok={state.config.instagram} label="Instagram API" okText={state.config.instagramOAuth ? "OAuth configured" : "Manual token configured"} noText="Not configured — connect via demo" />
          <ConfigRow ok={!state.config.defaultSessionSecret} label="SESSION_SECRET" okText="Set" noText="Using insecure default — set for production" warn />
        </div>
      </div>
    </div>
  );
}

function ConfigRow({ ok, label, okText, noText, warn }: { ok: boolean; label: string; okText: string; noText: string; warn?: boolean }) {
  return (
    <div className="row">
      <div className="rowmain"><div className="rowtitle">{label}</div><div className="rowsub">{ok ? okText : noText}</div></div>
      {ok ? <span className="pill ok"><span className="dot" /> OK</span> : <span className={`pill ${warn ? "warn" : ""}`}><span className="dot" /> {warn ? "Warning" : "Demo"}</span>}
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      aria-pressed={on}
      style={{
        width: 46, height: 27, borderRadius: 999, border: "none", padding: 3, cursor: "pointer",
        background: on ? "var(--accent)" : "var(--border-strong)", transition: "background 0.2s", flex: "none",
      }}
    >
      <span style={{ display: "block", width: 21, height: 21, borderRadius: "50%", background: "#fff", transform: on ? "translateX(19px)" : "none", transition: "transform 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
    </button>
  );
}
