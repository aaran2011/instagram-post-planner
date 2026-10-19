"use client";
import React, { useState } from "react";
import { useApp, Modal, CloseButton, Spinner } from "./ui";
import { api } from "./store";
import { IconInstagram, IconAlert, IconCheck, IconLink, IconLinkedIn, IconYouTube } from "./icons";

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

        {/* Other platforms for auto-reposting */}
        <div className="tiny muted" style={{ margin: "20px 0 10px", fontWeight: 700 }}>Also connect — to auto-repost your posts</div>

        <ProviderCard
          kind="linkedin" label="LinkedIn" icon={<IconLinkedIn size={16} />}
          configured={Boolean(state.config.linkedinOAuth)}
          envHint="LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET"
          note="Posts your reels (video) and photos/carousels (images)."
        />
        <ProviderCard
          kind="youtube" label="YouTube" icon={<IconYouTube size={16} />}
          configured={Boolean(state.config.youtubeOAuth)}
          envHint="GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET"
          note="Posts your reels as YouTube Shorts (videos only — no photos)."
        />
      </div>
    </Modal>
  );
}

function ProviderCard({ kind, label, icon, configured, envHint, note }: {
  kind: "linkedin" | "youtube"; label: string; icon: React.ReactNode;
  configured: boolean; envHint: string; note: string;
}) {
  const { state, setState, toast } = useApp();
  const acct = kind === "linkedin" ? state.linkedin : state.youtube;
  const name = kind === "linkedin" ? state.linkedin.name : state.youtube.channelTitle;
  const [busy, setBusy] = useState(false);

  async function demo() {
    setBusy(true);
    try {
      const res = await api.post("/api/connect/demo", { provider: kind });
      setState(res);
      toast(`${label} demo connected`, "ok");
    } catch (e: any) { toast(e.message, "err"); }
    finally { setBusy(false); }
  }

  return (
    <div className="card mt12" style={{ padding: 16 }}>
      <div className="flex gap8 mb8">{icon}<b>{label}</b>
        {acct.connected ? <span className="pill ok right"><span className="dot" />{acct.demo ? "Demo" : "Connected"}</span>
          : configured ? <span className="pill right"><span className="dot" />Ready</span>
          : <span className="pill warn right"><span className="dot" />Not configured</span>}
      </div>
      <p className="tiny muted mb8">{note}</p>
      {acct.connected ? (
        <div className="tiny muted">{name || "Connected"}{acct.demo ? " · simulated (no real posting)" : ""}</div>
      ) : (
        <div className="stack gap8">
          {configured ? (
            <button className="btn primary block" onClick={() => (window.location.href = `/api/connect/${kind}/auth`)}>
              {icon} Connect {label}
            </button>
          ) : (
            <div className="banner tiny" style={{ background: "var(--surface-2)" }}>
              <IconAlert size={15} className="bicon" />
              <div>Set <code>{envHint}</code> for real posting.</div>
            </div>
          )}
          <button className="btn subtle block" onClick={demo} disabled={busy}>
            {busy ? <Spinner dark /> : null} Try demo (simulated)
          </button>
        </div>
      )}
    </div>
  );
}
