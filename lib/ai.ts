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

// Analyze all media, choose a varied order, and build scheduled draft posts.
export async function generatePlan(media: MediaItem[], settings: Settings): Promise<Post[]> {
  const plans = await mapLimit(media, claudeAvailable() ? 4 : 16, (m) => planForItem(m, settings));

  // Persist analysis onto the media objects (mutates the passed items).
  for (const p of plans) p.item.analysis = p.analysis;

  const order = optimizeOrder(plans.map((p) => ({ item: p.item, a: p.analysis })));
  const byId = new Map(plans.map((p) => [p.item.id, p]));

  const slots = buildSlots(order.length, {
    times: settings.defaultTimes,
    cadenceDays: settings.postingCadenceDays,
    tz: settings.timezone,
  });

  const now = new Date().toISOString();
  return order.map((mediaId, i) => {
    const p = byId.get(mediaId)!;
    return {
      id: newId("post"),
      mediaId,
      order: i,
      caption: p.caption,
      hashtags: p.hashtags,
      cta: p.cta,
      category: p.analysis.category,
      mood: p.analysis.mood,
      subject: p.analysis.subject,
      format: p.analysis.format,
      music: p.music,
      scheduledAt: (slots[i] ?? new Date()).toISOString(),
      timezone: settings.timezone,
      status: "draft",
      igMediaId: null,
      error: null,
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
    } satisfies Post;
  });
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
