"use client";
import React, { useState } from "react";
import { useApp, Modal, CloseButton, Spinner } from "./ui";
import { api } from "./store";
import { IconInstagram, IconAlert, IconCheck, IconLink, IconLinkedIn, IconYouTube } from "./icons";

export default function ConnectModal({ onClose }: { onClose: () => void }) {
  const { state, toast, refresh } = useApp();
  const cfg = state.config;
  const [busy, setBusy] = useState<string | null>(null);

  async function connect(mode: "oauth" | "manual") {
    setBusy(mode);
    try {
      const res = await api.post("/api/instagram/connect", { mode });
      if (mode === "oauth" && res.redirect) { window.location.href = res.redirect; return; }
      await refresh();
      toast("Instagram connected", "ok");
      onClose();
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal onClose={onClose} className="narrow">
      <div style={{ padding: 26, overflowY: "auto", flex: 1, minHeight: 0 }}>
        <div className="flex mb16">
          <div className="flex gap10"><IconLink size={22} /><h2 style={{ fontSize: 20 }}>Connect accounts</h2></div>
          <div className="right" /><CloseButton onClose={onClose} />
        </div>

        <p className="muted mb24 tiny">
          Connect your own accounts — you log in with each platform and authorize this tool. Access tokens
          are stored server-side only; nothing is simulated.
        </p>

        {/* Instagram */}
        <div className="card" style={{ padding: 16 }}>
          <div className="flex gap8 mb8"><IconInstagram size={16} /><b>Instagram</b>
            {state.instagram.connected ? <span className="pill ok right"><span className="dot" />Connected</span>
              : cfg.instagramOAuth ? <span className="pill right"><span className="dot" />Ready</span>
              : <span className="pill warn right"><span className="dot" />Needs setup</span>}
          </div>
          {state.instagram.connected ? (
            <div className="tiny muted">@{state.instagram.username}</div>
          ) : cfg.instagramOAuth ? (
            <button className="btn primary block" onClick={() => connect("oauth")} disabled={busy === "oauth"}>
              {busy === "oauth" ? <Spinner /> : <IconInstagram size={16} />} Connect Instagram
            </button>
          ) : cfg.instagramManualToken ? (
            <button className="btn subtle block" onClick={() => connect("manual")} disabled={busy === "manual"}>
              {busy === "manual" ? <Spinner dark /> : <IconCheck size={16} />} Connect with IG_ACCESS_TOKEN
            </button>
          ) : (
            <div className="banner tiny" style={{ background: "var(--surface-2)" }}>
              <IconAlert size={15} className="bicon" />
              <div>One-time setup: add <code>INSTAGRAM_APP_ID</code> / <code>INSTAGRAM_APP_SECRET</code> / <code>INSTAGRAM_REDIRECT_URI</code>.</div>
            </div>
          )}
        </div>

        <ProviderCard
          kind="linkedin" label="LinkedIn" icon={<IconLinkedIn size={16} />}
          configured={Boolean(state.config.linkedinOAuth)}
          envHint="LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET"
          note="Reposts your reels (video) and photos/carousels (images)."
        />
        <ProviderCard
          kind="youtube" label="YouTube" icon={<IconYouTube size={16} />}
          configured={Boolean(state.config.youtubeOAuth)}
          envHint="GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET"
          note="Reposts your reels as YouTube Shorts (videos only — no photos)."
        />
      </div>
    </Modal>
  );
}

function ProviderCard({ kind, label, icon, configured, envHint, note }: {
  kind: "linkedin" | "youtube"; label: string; icon: React.ReactNode;
  configured: boolean; envHint: string; note: string;
}) {
  const { state } = useApp();
  const acct = kind === "linkedin" ? state.linkedin : state.youtube;
  const name = kind === "linkedin" ? state.linkedin.name : state.youtube.channelTitle;

  return (
    <div className="card mt12" style={{ padding: 16 }}>
      <div className="flex gap8 mb8">{icon}<b>{label}</b>
        {acct.connected ? <span className="pill ok right"><span className="dot" />Connected</span>
          : <span className="pill right"><span className="dot" />{configured ? "Ready" : "Needs setup"}</span>}
      </div>
      <p className="tiny muted mb8">{note}</p>
      {acct.connected ? (
        <div className="tiny muted">{name || "Connected"}</div>
      ) : (
        <>
          <button className="btn primary block" onClick={() => (window.location.href = `/api/connect/${kind}/auth`)}>
            {icon} Connect {label}
          </button>
          {!configured && (
            <div className="banner tiny mt8" style={{ background: "var(--surface-2)" }}>
              <IconAlert size={15} className="bicon" />
              <div>One-time setup needed to log in: add <code>{envHint}</code> and the redirect URL. Ask Claude to help set this up.</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
