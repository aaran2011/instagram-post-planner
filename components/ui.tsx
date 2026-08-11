"use client";
import React, { createContext, useContext } from "react";
import type { ClientState } from "./store";
import { IconClose } from "./icons";

export type View = "upload" | "plan" | "calendar" | "review" | "automation" | "settings";

export interface AppCtx {
  state: ClientState;
  setState: (s: ClientState | ((prev: ClientState) => ClientState)) => void;
  toast: (msg: string, type?: "ok" | "err" | "info") => void;
  refresh: () => Promise<void>;
  openPost: (postId: string | null) => void;
  openPostId: string | null;
  go: (v: View) => void;
  view: View;
}

const Ctx = createContext<AppCtx | null>(null);
export const AppProvider = Ctx.Provider;
export function useApp() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp must be used within AppProvider");
  return c;
}

export function Modal({
  onClose,
  children,
  className = "",
  labelledBy,
}: {
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
      >
        {children}
      </div>
    </div>
  );
}

export function Spinner({ dark = false }: { dark?: boolean }) {
  return <span className={`spin ${dark ? "dark" : ""}`} />;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        borderRadius: 999,
        padding: 3,
        gap: 2,
      }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className="btn sm"
          style={{
            border: "none",
            background: value === o.value ? "var(--surface)" : "transparent",
            boxShadow: value === o.value ? "var(--shadow-sm)" : "none",
            color: value === o.value ? "var(--text)" : "var(--text-2)",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button className="btn ghost sm" onClick={onClose} aria-label="Close" style={{ padding: 7 }}>
      <IconClose size={18} />
    </button>
  );
}
