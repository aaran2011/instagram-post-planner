"use client";
import React, { useState } from "react";
import { useApp, Modal, CloseButton, Spinner } from "./ui";
import { api } from "./store";
import { IconInstagram, IconAlert, IconCheck, IconLink } from "./icons";

export default function ConnectModal({ onClose }: { onClose: () => void }) {
  const { state, setState, toast, refresh } = useApp();
  const cfg = state.config;
  const [demoUser, setDemoUser] = useState(state.instagram.username || "your_handle");
  const [busy, setBusy] = useState<string | null>(null);

  async function connect(mode: "oauth" | "manual" | "demo") {
    setBusy(mode);
    try {
      const res = await api.post("/api/instagram/connect", { mode, username: demoUser });
      if (mode === "oauth" && res.redirect) {
        window.location.href = res.redirect;
        return;
      }
      await refresh();
      toast(mode === "demo" ? "Demo account connected" : "Instagram connected", "ok");
      onClose();
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal onClose={onClose} className="narrow">
      <div style={{ padding: 26 }}>
        <div className="flex mb16">
          <div className="flex gap10"><IconInstagram size={22} /><h2 style={{ fontSize: 20 }}>Connect Instagram</h2></div>
          <div className="right" /><CloseButton onClose={onClose} />
        </div>

        <p className="muted mb24 tiny">
          Publishes to your <b>Instagram Business/Creator</b> account using the official
          <b> Instagram Login</b> API — <b>no Facebook Page required</b>. You log in with your
          Instagram credentials; access tokens are stored server-side only.
        </p>

        {/* Real OAuth */}
        <div className="card" style={{ padding: 16 }} >
          <div className="flex gap8 mb8"><IconLink size={16} /><b>Log in with Instagram</b>{cfg.instagramOAuth ? <span className="pill ok right"><span className="dot" />Ready</span> : <span className="pill warn right"><span className="dot" />Not configured</span>}</div>
          {cfg.instagramOAuth ? (
            <button className="btn primary block" onClick={() => connect("oauth")} disabled={busy === "oauth"}>
              {busy === "oauth" ? <Spinner /> : <IconInstagram size={16} />} Continue with Instagram
            </button>
          ) : (
            <div className="banner tiny" style={{ background: "var(--surface-2)" }}>
              <IconAlert size={15} className="bicon" />
              <div>Set <code>INSTAGRAM_APP_ID</code>, <code>INSTAGRAM_APP_SECRET</code> and <code>INSTAGRAM_REDIRECT_URI</code> in <code>.env.local</code> to enable this.</div>
            </div>
          )}
        </div>

        {/* Manual token */}
        {cfg.instagramManualToken && (
          <div className="card mt12" style={{ padding: 16 }}>
            <div className="flex gap8 mb8"><b>Use configured token</b><span className="pill ok right"><span className="dot" />Ready</span></div>
            <button className="btn subtle block" onClick={() => connect("manual")} disabled={busy === "manual"}>
              {busy === "manual" ? <Spinner dark /> : <IconCheck size={16} />} Connect with IG_ACCESS_TOKEN
            </button>
          </div>
        )}

        {/* Demo */}
        <div className="card mt12" style={{ padding: 16 }}>
          <div className="flex gap8 mb8"><b>Demo connection</b><span className="pill accent right">No API needed</span></div>
          <p className="tiny muted mb8">Simulate a connected account so you can test the entire workflow. Nothing is published.</p>
          <div className="flex gap8">
            <input className="input" value={demoUser} onChange={(e) => setDemoUser(e.target.value.replace(/^@/, ""))} placeholder="your_handle" />
            <button className="btn subtle" onClick={() => connect("demo")} disabled={busy === "demo"}>
              {busy === "demo" ? <Spinner dark /> : "Connect demo"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
