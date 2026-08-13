"use client";
import React, { useMemo } from "react";
import { useApp, Modal, CloseButton } from "./ui";
import { buildGrowthPlan } from "./growth";
import { IconSparkle, IconCheck, IconAlert } from "./icons";

export default function GrowthModal({ onClose }: { onClose: () => void }) {
  const { state } = useApp();
  const sections = useMemo(() => buildGrowthPlan(state), [state]);

  return (
    <Modal onClose={onClose} className="narrow" >
      <div className="editpane" style={{ maxWidth: 460 }}>
        <div className="ehead">
          <span className="pill accent"><IconSparkle size={13} /> Grow your followers</span>
          <div className="right" />
          <CloseButton onClose={onClose} />
        </div>
        <div className="escroll">
          <div className="banner warn mb16">
            <IconAlert size={16} className="bicon" />
            <div>This is a <b>strategy plan based on proven best practices</b>, tailored to your content — <b>not a guarantee of followers</b>. Results depend on your content, niche, and consistency.</div>
          </div>

          <div className="stack gap16">
            {sections.map((s) => (
              <div key={s.title}>
                <div style={{ fontWeight: 650, marginBottom: 8 }}>{s.title}</div>
                <div className="stack gap8">
                  {s.items.map((it, i) => (
                    <div key={i} className="flex gap8" style={{ alignItems: "flex-start" }}>
                      <IconCheck size={15} style={{ color: "var(--accent)", flex: "none", marginTop: 3 }} />
                      <span className="tiny" style={{ color: "var(--text-2)", lineHeight: 1.5 }}>{it}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="efoot">
          <span className="tiny muted">Tailored to your {state.media.length} uploaded item(s).</span>
          <div className="right" />
          <button className="btn primary" onClick={onClose}>Got it</button>
        </div>
      </div>
    </Modal>
  );
}
