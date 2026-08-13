import type { MediaItem, MediaAnalysis, Post, Settings } from "./types";
import {
  analyzeItemDemo,
  captionDemo,
  ctaDemo,
  hashtagsDemo,
  musicDemo,
} from "./ai-demo";
import { claudeAvailable, claudeGenerateForItem, claudeRegenerateCaption } from "./ai-claude";
import { optimizeOrder } from "./ordering";
import { buildSlots } from "./schedule";
import { newId } from "./api";

// Run async tasks with a small concurrency cap (protects the AI API + memory).
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  const workers = new Array(Math.min(limit, items.length || 1)).fill(0).map(async () => {
    while (idx < items.length) {
      const cur = idx++;
      results[cur] = await fn(items[cur], cur);
    }
  });
  await Promise.all(workers);
  return results;
}

interface ItemPlan {
  item: MediaItem;
  analysis: MediaAnalysis;
  caption: string;
  cta: string;
  hashtags: string[];
  music: Post["music"];
}

async function planForItem(item: MediaItem, settings: Settings): Promise<ItemPlan> {
  // Demo baseline (always valid).
  const demoAnalysis = analyzeItemDemo(item, settings.niche);
  let analysis = demoAnalysis;
  let caption = captionDemo(item, demoAnalysis, settings);
  let cta = ctaDemo(item, 0, demoAnalysis);
  let hashtags = hashtagsDemo(item, demoAnalysis);
  let music = musicDemo(item, 0, demoAnalysis);

  if (claudeAvailable()) {
    try {
      const r = await claudeGenerateForItem(item, settings);
      analysis = {
        subject: r.subject || demoAnalysis.subject,
        contentType: item.type,
        visualTheme: r.visualTheme || demoAnalysis.visualTheme,
        mood: r.mood || demoAnalysis.mood,
        context: demoAnalysis.context,
        audience: r.audience || demoAnalysis.audience,
        category: r.category || demoAnalysis.category,
        format: r.format || demoAnalysis.format,
        colors: r.colors && r.colors.length ? r.colors : demoAnalysis.colors,
        similarityGroup: (r.category || demoAnalysis.category).toLowerCase(),
      };
      if (r.caption) caption = r.caption;
      if (r.cta) cta = r.cta;
      if (r.hashtags && r.hashtags.length) hashtags = r.hashtags;
      music =
        item.type === "video"
          ? null
          : r.music
            ? { name: r.music.name, artist: r.music.artist, supportedByApi: false }
            : music;
    } catch (e) {
      // Silent fallback to demo output for this item.
    }
  }

  return { item, analysis, caption, cta, hashtags, music };
}

export interface GenerateOpts {
  // Each group is a set of mediaIds that become ONE post (carousel if >1).
  // If omitted, every media item becomes its own single-image post.
  groups?: string[][];
  startOrder?: number; // append after existing posts
  startAfter?: Date; // schedule after the last existing post
}

// Analyze media, choose an order, and build scheduled draft posts. Supports
// carousel groups and appending after an existing plan.
export async function generatePlan(
  media: MediaItem[],
  settings: Settings,
  opts: GenerateOpts = {},
): Promise<Post[]> {
  const { groups, startOrder = 0, startAfter } = opts;
  const mediaById = new Map(media.map((m) => [m.id, m]));

  // A "unit" is one post: its cover (for analysis) + all its mediaIds.
  let units: { coverId: string; mediaIds: string[] }[];
  if (groups && groups.length) {
    units = groups
      .map((g) => g.filter((id) => mediaById.has(id)))
      .filter((g) => g.length > 0)
      .map((g) => ({ coverId: g[0], mediaIds: g }));
  } else {
    units = media.map((m) => ({ coverId: m.id, mediaIds: [m.id] }));
  }

  const plans = await mapLimit(units, claudeAvailable() ? 4 : 16, async (u) => {
    const cover = mediaById.get(u.coverId)!;
    const p = await planForItem(cover, settings);
    p.item.analysis = p.analysis; // persist analysis onto the cover media
    return { unit: u, ...p };
  });

  // Keep the user's composed order for groups; optimize for auto single posts.
  let ordered = plans;
  if (!(groups && groups.length)) {
    const order = optimizeOrder(plans.map((p) => ({ item: p.item, a: p.analysis })));
    const byCover = new Map(plans.map((p) => [p.unit.coverId, p]));
    ordered = order.map((id) => byCover.get(id)!).filter(Boolean) as typeof plans;
  }

  const slots = buildSlots(ordered.length, {
    times: settings.defaultTimes,
    cadenceDays: settings.postingCadenceDays,
    tz: settings.timezone,
    from: startAfter,
  });

  const now = new Date().toISOString();
  return ordered.map((p, i) => ({
    id: newId("post"),
    mediaId: p.unit.coverId,
    mediaIds: p.unit.mediaIds,
    order: startOrder + i,
    caption: p.caption,
    hashtags: p.hashtags,
    cta: p.cta,
    category: p.analysis.category,
    mood: p.analysis.mood,
    subject: p.analysis.subject,
    format: p.unit.mediaIds.length > 1 ? "post" : p.analysis.format,
    music: p.music,
    scheduledAt: (slots[i] ?? new Date()).toISOString(),
    timezone: settings.timezone,
    status: "draft",
    igMediaId: null,
    error: null,
    publishedAt: null,
    createdAt: now,
    updatedAt: now,
  } satisfies Post));
}

// Also persist analysis back onto media so the library can show it.
export async function analyzeMediaOnly(media: MediaItem[]): Promise<Map<string, MediaAnalysis>> {
  const out = new Map<string, MediaAnalysis>();
  for (const m of media) out.set(m.id, m.analysis ?? analyzeItemDemo(m));
  return out;
}

// ---- Single-field regenerators (never touch other fields) ----

export async function regenerateCaption(item: MediaItem, settings: Settings, variant: number): Promise<{ caption: string; cta: string }> {
  if (claudeAvailable()) {
    try {
      const r = await claudeRegenerateCaption(item, settings);
      if (r.caption) return { caption: r.caption, cta: r.cta || ctaDemo(item, variant) };
    } catch {}
  }
  const analysis = item.analysis ?? analyzeItemDemo(item, settings.niche);
  return { caption: captionDemo(item, analysis, settings, variant), cta: ctaDemo(item, variant, analysis) };
}

export async function regenerateHashtags(item: MediaItem, variant: number): Promise<string[]> {
  const analysis = item.analysis ?? analyzeItemDemo(item);
  if (claudeAvailable()) {
    try {
      const r = await claudeGenerateForItem(item, { aiTone: "", aiEmojis: true } as Settings);
      if (r.hashtags && r.hashtags.length) return r.hashtags;
    } catch {}
  }
  return hashtagsDemo(item, analysis, variant);
}

export function regenerateMusic(item: MediaItem, variant: number) {
  return musicDemo(item, variant, item.analysis);
}

export function regenerateRecommendation(item: MediaItem): { subject: string; category: string; mood: string; format: "post" | "reel" } {
  const a = item.analysis ?? analyzeItemDemo(item);
  return { subject: a.subject, category: a.category, mood: a.mood, format: a.format };
}
