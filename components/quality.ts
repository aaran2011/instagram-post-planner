import type { ClientMedia, Post } from "./store";

// Non-destructive quality heuristics. These are SUGGESTIONS only — the app never
// removes anything automatically. They flag likely problems (things Instagram
// will crop/reject, or that tend to underperform) so you can decide.

export function postWarnings(
  media: ClientMedia | undefined,
  post: Post,
  posts: Post[],
  mediaById: (id: string) => ClientMedia | undefined,
): string[] {
  const w: string[] = [];
  if (!media) return w;

  // Aspect ratio — Instagram feed accepts 4:5 (0.8) to 1.91:1.
  if (media.type === "photo" && media.width && media.height) {
    const r = media.width / media.height;
    if (r < 0.8) {
      w.push("Taller than Instagram's feed allows (max 4:5) — it'll be cropped or rejected. A less-tall crop works better.");
    } else if (r > 1.91) {
      w.push("Wider than Instagram's feed allows (max 1.91:1) — it'll be cropped. A tighter crop works better.");
    }
  }

  // Low resolution.
  const minSide = Math.min(media.width || 9999, media.height || 9999);
  if (minSide > 0 && minSide < 640) {
    w.push("Low resolution — may look soft. Instagram prefers 1080px on the short side.");
  }

  // Video length.
  if (media.type === "video" && media.duration) {
    if (media.duration < 3) w.push("Very short clip (under 3s) — may not hold attention as a Reel.");
    else if (media.duration > 90) w.push("Long video (over 90s) — a tighter cut usually performs better as a Reel.");
  }

  // Similar to a neighbouring post (same visual group next to each other).
  const idx = posts.findIndex((p) => p.id === post.id);
  const group = media.analysis?.similarityGroup;
  if (group) {
    const neighbours = [posts[idx - 1], posts[idx + 1]].filter(Boolean) as Post[];
    if (neighbours.some((n) => mediaById(n.mediaId)?.analysis?.similarityGroup === group)) {
      w.push("Looks similar to a post right next to it — spacing out similar content keeps the feed varied.");
    }
  }

  return w;
}
