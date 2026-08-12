"use client";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { IconAlert, IconCheck } from "./icons";

type Mode = "login" | "reset-request" | "reset-verify" | "reset-done";

export default function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failedCount, setFailedCount] = useState(0);
  const [usingDefaults, setUsingDefaults] = useState(false);
  const [accountEmail, setAccountEmail] = useState<string>("");
  const [emailConfigured, setEmailConfigured] = useState(true);

  // reset flow fields
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((d) => {
        if (d.authenticated) router.replace("/");
        if (d.email) setAccountEmail(d.email);
        if (d.config?.defaultCredentials) setUsingDefaults(true);
        if (d.config && typeof d.config.email === "boolean") setEmailConfigured(d.config.email);
      })
      .catch(() => {});
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Login failed");
        setFailedCount((c) => c + 1);
        setLoading(false);
        return;
      }
      router.replace("/");
    } catch {
      setError("Network error. Is the server running?");
      setLoading(false);
    }
  }

  function startReset() {
    setError(null);
    setInfo(null);
    setEmail((e) => e || accountEmail);
    setMode("reset-request");
  }

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email || accountEmail }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not send the code.");
        setLoading(false);
        return;
      }
      setInfo(`If ${email || accountEmail} is the account email, a 6-digit code is on its way.`);
      setMode("reset-verify");
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  async function doReset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email || accountEmail, code, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not reset the password.");
        setLoading(false);
        return;
      }
      setMode("reset-done");
      setPassword("");
      setFailedCount(0);
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  const errorBox = error && (
    <div className="banner" style={{ color: "var(--danger)", background: "var(--danger-soft)", border: "none" }}>
      <IconAlert size={18} className="bicon" />
      <div>{error}</div>
    </div>
  );
  const infoBox = info && (
    <div className="banner info"><IconCheck size={18} className="bicon" /><div>{info}</div></div>
  );

  return (
    <div className="loginwrap">
      <div className="card logincard">
        <div className="loginlogo">◐</div>
        <h1 style={{ fontSize: 26 }}>Instagram Planner</h1>
        <p className="muted mt8 mb24">Your private content command center.</p>

        {/* ---- LOGIN ---- */}
        {mode === "login" && (
          <>
            {usingDefaults && (
              <div className="banner warn mb16">
                <IconAlert size={18} className="bicon" />
                <div>
                  <b>Using default credentials.</b> Set <code>APP_EMAIL</code> and{" "}
                  <code>APP_PASSWORD</code> in your environment.
                </div>
              </div>
            )}
            <form onSubmit={submit} className="stack gap16">
              <label className="field">
                <span>Email or username</span>
                <input className="input" type="text" autoComplete="username" value={email}
                  onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoFocus />
              </label>
              <label className="field">
                <span>Password</span>
                <input className="input" type="password" autoComplete="current-password" value={password}
                  onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              </label>

              {errorBox}

              <button className="btn primary lg block" disabled={loading} type="submit">
                {loading ? <span className="spin" /> : "Log In"}
              </button>
            </form>

            {failedCount >= 2 && (
              <div className="center mt16">
                <button className="btn ghost sm" onClick={startReset}>Forgot password?</button>
              </div>
            )}
          </>
        )}

        {/* ---- RESET: request code ---- */}
        {mode === "reset-request" && (
          <form onSubmit={sendCode} className="stack gap16">
            <p className="muted tiny">We'll email a 6‑digit reset code to your account email.</p>
            <label className="field">
              <span>Account email</span>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com" autoFocus />
            </label>
            {!emailConfigured && (
              <div className="banner warn"><IconAlert size={16} className="bicon" />
                <div>Email sending isn't set up yet, so a code can't be sent. Ask the admin to add <code>RESEND_API_KEY</code>.</div>
              </div>
            )}
            {errorBox}
            <button className="btn primary lg block" disabled={loading} type="submit">
              {loading ? <span className="spin" /> : "Send code"}
            </button>
            <button type="button" className="btn ghost sm" onClick={() => { setMode("login"); setError(null); }}>Back to login</button>
          </form>
        )}

        {/* ---- RESET: verify code + new password ---- */}
        {mode === "reset-verify" && (
          <form onSubmit={doReset} className="stack gap16">
            {infoBox}
            <label className="field">
              <span>6‑digit code</span>
              <input className="input" inputMode="numeric" maxLength={6} value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" autoFocus />
            </label>
            <label className="field">
              <span>New password</span>
              <input className="input" type="password" value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 6 characters" />
            </label>
            {errorBox}
            <button className="btn primary lg block" disabled={loading} type="submit">
              {loading ? <span className="spin" /> : "Reset password"}
            </button>
            <div className="flex" style={{ justifyContent: "space-between" }}>
              <button type="button" className="btn ghost sm" onClick={() => sendCode()}>Resend code</button>
              <button type="button" className="btn ghost sm" onClick={() => { setMode("login"); setError(null); setInfo(null); }}>Back to login</button>
            </div>
          </form>
        )}

        {/* ---- RESET: done ---- */}
        {mode === "reset-done" && (
          <div className="stack gap16">
            <div className="banner info"><IconCheck size={18} className="bicon" /><div>Password updated. Log in with your new password.</div></div>
            <button className="btn primary lg block" onClick={() => { setMode("login"); setInfo(null); setError(null); }}>Back to login</button>
          </div>
        )}
      </div>
    </div>
  );
}
