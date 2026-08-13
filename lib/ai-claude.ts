import fs from "fs/promises";
import { config, aiConfigured } from "./config";
import { thumbPath } from "./paths";
import type { MediaItem, Settings } from "./types";

// Optional real AI via the Anthropic Messages API (called with fetch so there
// is no SDK dependency). Every function here is best-effort: callers must fall
// back to the deterministic demo engine on any failure.

export function claudeAvailable() {
  return aiConfigured();
}

async function readThumbBase64(item: MediaItem) {
  if (!item.thumb) return null;
  try {
    const buf = await fs.readFile(thumbPath(item.thumb));
    return { media_type: "image/jpeg", data: buf.toString("base64") };
  } catch {
    return null;
  }
}

async function callClaude(system: string, content: any[], maxTokens = 700) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": config.anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.anthropicModel,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = (data.content || [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");
  return text as string;
}

function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("No JSON in model output");
  return JSON.parse(raw.slice(start, end + 1));
}

export interface ClaudeResult {
  subject?: string;
  category?: string;
  mood?: string;
  visualTheme?: string;
  audience?: string;
  format?: "post" | "reel";
  colors?: string[];
  caption?: string;
  cta?: string;
  hashtags?: string[];
  music?: { name: string; artist: string } | null;
}

// Analyze one item and produce caption/hashtags/music in a single call.
export async function claudeGenerateForItem(
  item: MediaItem,
  settings: Settings,
): Promise<ClaudeResult> {
  const img = item.type === "photo" ? await readThumbBase64(item) : null;
  const system = [
    "You are an expert Instagram content strategist helping a single creator plan posts.",
    `The creator's niche is: ${settings.niche || "general lifestyle"}. Write on-topic for that niche.`,
    "Analyze the media and produce a concise, non-generic caption grounded in what is ACTUALLY shown.",
    "If the image has an identifiable subject (e.g. a specific bird species, animal, or place), name/describe it naturally in the caption and use a couple of subject-specific hashtags.",
    `Caption tone: ${settings.aiTone}. Emojis: ${settings.aiEmojis ? "sparingly allowed" : "none"}.`,
    "Hashtags must be relevant and modest (8-12), no spammy blocks.",
    item.type === "video"
      ? "This is a VIDEO. Never suggest music or audio changes — its original audio must be kept. Set music to null."
      : "This is a PHOTO. You may suggest ONE fitting song (name + artist) the creator could add manually in Instagram.",
    "Respond ONLY with minified JSON matching: {subject, category, mood, visualTheme, audience, format:'post'|'reel', colors:[hex,hex,hex], caption, cta, hashtags:[...], music:{name,artist}|null}.",
  ].join(" ");

  const content: any[] = [];
  if (img) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: img.media_type, data: img.data },
    });
  }
  content.push({
    type: "text",
    text:
      `Filename: ${item.originalName}\nType: ${item.type}` +
      (item.duration ? `\nDuration: ${Math.round(item.duration)}s` : "") +
      (img ? "\nThe image above is a thumbnail of the media." : "\n(No preview available; infer from filename/type.)"),
  });

  const text = await callClaude(system, content, 700);
  const j = extractJson(text);
  return {
    subject: j.subject,
    category: j.category,
    mood: j.mood,
    visualTheme: j.visualTheme,
    audience: j.audience,
    format: j.format === "reel" ? "reel" : "post",
    colors: Array.isArray(j.colors) ? j.colors.slice(0, 3) : undefined,
    caption: typeof j.caption === "string" ? j.caption : undefined,
    cta: typeof j.cta === "string" ? j.cta : undefined,
    hashtags: Array.isArray(j.hashtags) ? j.hashtags.map(String) : undefined,
    music: item.type === "video" ? null : j.music ?? null,
  };
}

// Focused regenerators reuse the same call but bias the ask.
export async function claudeRegenerateCaption(item: MediaItem, settings: Settings) {
  const r = await claudeGenerateForItem(item, settings);
  return { caption: r.caption, cta: r.cta };
}
