"use client";
import React, { useEffect, useState } from "react";
import { IconCheck, IconSparkle } from "./icons";

const STEPS = [
  "Understanding your photos & videos",
  "Creating content categories",
  "Writing captions & hashtags",
  "Finding the best posting order",
  "Building your schedule",
  "Assembling your Instagram grid",
];

// Purely visual progress. Steps advance on a timer; the last one holds until
// the real work finishes and the parent unmounts this overlay.
export default function GenerateOverlay({ count }: { count: number }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => {
      setStep((s) => (s < STEPS.length - 1 ? s + 1 : s));
    }, 850);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="overlay">
      <div className="modal narrow" style={{ padding: 34, textAlign: "center" }}>
        <div className="genring" />
        <h2 style={{ fontSize: 21 }}>
          <IconSparkle size={18} style={{ verticalAlign: -3, marginRight: 6, color: "var(--accent)" }} />
          Analyzing your content…
        </h2>
        <p className="muted mt8">Planning {count} {count === 1 ? "post" : "posts"}. This won’t take long.</p>
        <div className="gensteps">
          {STEPS.map((label, i) => (
            <div key={i} className={`genstep ${i < step ? "done" : i === step ? "active" : ""}`}>
              <span className="gs">{i < step ? <IconCheck size={12} /> : i === step ? <span className="spin dark" style={{ width: 12, height: 12 }} /> : null}</span>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
