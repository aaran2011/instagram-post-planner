import type { ClientState } from "./store";

export interface PlanSection {
  title: string;
  items: string[];
}

// Builds a tailored, best-practice growth plan from the user's actual content
// mix and settings. This is STRATEGY, not a guarantee — presented as such.
export function buildGrowthPlan(state: ClientState): PlanSection[] {
  const media = state.media;
  const photos = media.filter((m) => m.type === "photo").length;
  const videos = media.filter((m) => m.type === "video").length;
  const total = media.length || 1;

  // Tally content categories from analysis.
  const cats: Record<string, number> = {};
  for (const m of media) {
    const c = m.analysis?.category || "General";
    cats[c] = (cats[c] || 0) + 1;
  }
  const topCats = Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const reelShare = Math.round((videos / total) * 100);
  const times = state.settings.defaultTimes.join(" and ");
  const cadence = state.settings.postingCadenceDays;

  const sections: PlanSection[] = [];

  sections.push({
    title: "1. Post consistently (the #1 factor)",
    items: [
      `Keep a steady rhythm — your schedule posts every ${cadence} day(s) at ${times}. Consistency signals the algorithm and builds audience habit.`,
      "Aim for 3–5 feed posts a week plus a few Stories daily. Showing up beats sporadic bursts.",
      "Batch-create so you're never scrambling — this planner already lets you queue weeks ahead.",
    ],
  });

  sections.push({
    title: "2. Lean into Reels for reach",
    items: [
      reelShare >= 40
        ? `You're at ~${reelShare}% video — great. Reels are the main discovery engine right now; keep them coming.`
        : `You're at ~${reelShare}% video. Reels get the most reach — try to raise this toward ~40–50% by turning strong photo ideas into short clips.`,
      "Hook in the first 1–2 seconds, keep it 7–15s, add on-screen text, and end with a reason to follow.",
      "Reuse top-performing Reels as templates — repeat what works.",
    ],
  });

  sections.push({
    title: "3. Play to your strengths",
    items: [
      topCats.length
        ? `Your content skews toward: ${topCats.slice(0, 3).join(", ")}. Double down on your best‑performing theme and make it recognisably "you."`
        : "Pick one clear theme so new visitors instantly get what you're about.",
      "Keep a consistent visual style (colour, framing, tone) so your grid looks intentional.",
      "Mix formats within your niche: how‑tos, before/after, behind‑the‑scenes, and personal moments.",
    ],
  });

  sections.push({
    title: "4. Captions & hashtags that invite engagement",
    items: [
      "Open with a hook line, add value or a story, and end with a clear CTA (ask a question, 'save this', 'follow for more').",
      "Use 5–12 relevant hashtags — a mix of niche and mid‑size tags beats giant generic ones.",
      "Reply to every comment in the first hour — early engagement boosts distribution.",
    ],
  });

  sections.push({
    title: "5. Engage beyond your own posts",
    items: [
      "Spend 10–15 min/day genuinely commenting on accounts in your niche — this is how new people find you.",
      "Use Stories daily (polls, questions, behind‑the‑scenes) to keep existing followers warm.",
      "Collaborate: shoutouts, collabs, or joint Reels expose you to new audiences fast.",
    ],
  });

  sections.push({
    title: "6. Learn from your numbers",
    items: [
      "Check Instagram Insights weekly. Note your top 3 posts and make more like them.",
      "Post when your audience is online (Insights shows this) and adjust your schedule here to match.",
      "Give it time — meaningful growth is usually months of consistency, not days.",
    ],
  });

  return sections;
}
