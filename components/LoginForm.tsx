"use client";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { IconAlert } from "./icons";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [usingDefaults, setUsingDefaults] = useState(false);
  const [defaultEmail, setDefaultEmail] = useState<string>("");

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((d) => {
        if (d.authenticated) router.replace("/");
        if (d.config?.defaultCredentials) {
          setUsingDefaults(true);
          setDefaultEmail(d.email || "");
        }
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
        setLoading(false);
        return;
      }
      router.replace("/");
    } catch (err: any) {
      setError("Network error. Is the server running?");
      setLoading(false);
    }
  }

  return (
    <div className="loginwrap">
      <div className="card logincard">
        <div className="loginlogo">◐</div>
        <h1 style={{ fontSize: 26 }}>Instagram Planner</h1>
        <p className="muted mt8 mb24">Your private content command center.</p>

        {usingDefaults && (
          <div className="banner warn mb16">
            <IconAlert size={18} className="bicon" />
            <div>
              <b>Using default credentials.</b> Set <code>APP_EMAIL</code> and{" "}
              <code>APP_PASSWORD</code> in <code>.env.local</code>. Default is{" "}
              <b>{defaultEmail}</b> / <b>changeme</b>.
            </div>
          </div>
        )}

        <form onSubmit={submit} className="stack gap16">
          <label className="field">
            <span>Email or username</span>
            <input
              className="input"
              type="text"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoFocus
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </label>

          {error && (
            <div className="banner" style={{ color: "var(--danger)", background: "var(--danger-soft)", border: "none" }}>
              <IconAlert size={18} className="bicon" />
              <div>{error}</div>
            </div>
          )}

          <button className="btn primary lg block" disabled={loading} type="submit">
            {loading ? <span className="spin" /> : "Log In"}
          </button>
        </form>
      </div>
    </div>
  );
}
