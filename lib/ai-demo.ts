import type { MediaItem, MediaAnalysis, Settings } from "./types";

// A deterministic, offline content engine. It runs with zero API keys so the
// entire workflow is fully testable in demo mode. When ANTHROPIC_API_KEY is
// set, ai.ts layers real vision analysis + captions on top (with this as a
// guaranteed fallback).

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function pick<T>(arr: T[], seed: number): T {
  // Signed right-shifts on a 32-bit int can go negative, so normalize the index.
  const i = ((Math.trunc(seed) % arr.length) + arr.length) % arr.length;
  return arr[i];
}

interface Theme {
  key: string;
  keywords: string[];
  category: string;
  subjects: string[];
  visualTheme: string;
  moods: string[];
  audience: string;
  colors: string[][];
  captions: string[];
  ctas: string[];
  hashtags: string[];
  music: { name: string; artist: string }[];
}

const THEMES: Theme[] = [
  {
    key: "travel",
    keywords: ["travel", "trip", "beach", "mountain", "city", "sunset", "sky", "ocean", "hike", "road", "vacation", "sea", "island", "view"],
    category: "Travel",
    subjects: ["a sweeping landscape", "a coastal view", "a city skyline", "a mountain trail", "a golden-hour horizon"],
    visualTheme: "wide, airy, natural light",
    moods: ["serene", "adventurous", "expansive", "calm"],
    audience: "travel & lifestyle followers",
    colors: [["#3E6C8E", "#DCC7A1", "#E9EEF2"], ["#F4A259", "#5B8E7D", "#BC4B51"]],
    captions: [
      "Some views ask you to stop talking and just look.",
      "Collecting horizons, one morning at a time.",
      "Wherever this road goes, I'm in.",
      "The kind of quiet you can only find far from everything.",
    ],
    ctas: ["Save this for your next trip.", "Where should I go next? 👇", "Tag someone you'd bring here."],
    hashtags: ["#travel", "#wanderlust", "#travelgram", "#exploremore", "#naturelovers", "#goldenhour", "#travelphotography", "#outdoors"],
    music: [
      { name: "Holocene", artist: "Bon Iver" },
      { name: "Sunset Lover", artist: "Petit Biscuit" },
      { name: "Riptide", artist: "Vance Joy" },
    ],
  },
  {
    key: "food",
    keywords: ["food", "coffee", "cafe", "lunch", "dinner", "brunch", "cake", "meal", "recipe", "kitchen", "plate", "drink", "cook"],
    category: "Food",
    subjects: ["a plated dish", "a coffee moment", "a table spread", "a fresh bake", "a close-up of texture"],
    visualTheme: "warm, close-up, appetizing",
    moods: ["cozy", "indulgent", "fresh", "inviting"],
    audience: "food lovers & home cooks",
    colors: [["#8C5A3C", "#E4C590", "#2E2A26"], ["#C1440E", "#F2E9DC", "#6B8F71"]],
    captions: [
      "Made with more butter than I'll admit.",
      "Small plate, big feelings.",
      "This is your sign to treat yourself today.",
      "Recipe in the works — worth every minute.",
    ],
    ctas: ["Want the recipe? Comment 🍴", "Save this for the weekend.", "Who would you share this with?"],
    hashtags: ["#foodie", "#foodphotography", "#homecooking", "#eeeeeats", "#foodstagram", "#instafood", "#tasty", "#foodlover"],
    music: [
      { name: "Put Your Records On", artist: "Corinne Bailey Rae" },
      { name: "Coffee", artist: "beabadoobee" },
      { name: "Banana Pancakes", artist: "Jack Johnson" },
    ],
  },
  {
    key: "portrait",
    keywords: ["portrait", "me", "selfie", "face", "people", "friend", "family", "smile", "outfit", "ootd", "fashion", "style", "look"],
    category: "Lifestyle",
    subjects: ["a portrait", "a candid moment", "a styled outfit", "a close, honest frame"],
    visualTheme: "personal, character-forward",
    moods: ["confident", "warm", "playful", "reflective"],
    audience: "your community & close followers",
    colors: [["#B56576", "#EAAC8B", "#355070"], ["#2B2D42", "#EDF2F4", "#EF233C"]],
    captions: [
      "Showing up as myself, still figuring it out.",
      "A little more me lately.",
      "Good light, good day.",
      "Note to self: keep going.",
    ],
    ctas: ["How's your week going? 👇", "Drop a 🖤 if this resonates.", "Tell me one good thing today."],
    hashtags: ["#ootd", "#portrait", "#lifestyle", "#dailylook", "#mood", "#selflove", "#style", "#realtalk"],
    music: [
      { name: "Sunflower", artist: "Post Malone" },
      { name: "Golden", artist: "Harry Styles" },
      { name: "About You", artist: "The 1975" },
    ],
  },
  {
    key: "product",
    keywords: ["product", "launch", "work", "project", "design", "brand", "studio", "shop", "new", "art", "print", "craft", "make"],
    category: "Work",
    subjects: ["a product shot", "a work-in-progress", "a studio detail", "a finished piece"],
    visualTheme: "clean, intentional, editorial",
    moods: ["focused", "proud", "minimal", "crafted"],
    audience: "customers & fellow makers",
    colors: [["#1F2937", "#F9FAFB", "#6366F1"], ["#0F766E", "#F5F5F4", "#F59E0B"]],
    captions: [
      "Months of small decisions, finally in one place.",
      "Behind every simple thing is a lot of quiet work.",
      "New drop. Made slowly, on purpose.",
      "The details you don't notice are the ones I obsessed over.",
    ],
    ctas: ["Link in bio to see more.", "What should I make next?", "Save this if it's your kind of thing."],
    hashtags: ["#behindthescenes", "#design", "#madewithlove", "#smallbusiness", "#craft", "#studio", "#process", "#newdrop"],
    music: [
      { name: "Weird Fishes", artist: "Radiohead" },
      { name: "Midnight City", artist: "M83" },
      { name: "Instant Crush", artist: "Daft Punk" },
    ],
  },
  {
    key: "wildlife",
    keywords: ["bird", "wildlife", "nature", "forest", "owl", "eagle", "heron", "deer", "tiger", "leopard", "safari", "wild", "macro", "kingfisher", "hornbill", "pana", "dsc", "wing", "feather", "jungle"],
    category: "Wildlife",
    subjects: ["a bird in its habitat", "a candid wildlife moment", "a portrait of a wild creature", "a fleeting moment in the wild", "a bird mid-flight"],
    visualTheme: "natural light, patient, in-the-wild",
    moods: ["still", "wild", "patient", "awe-struck"],
    audience: "wildlife & nature lovers",
    colors: [["#4b6b3c", "#c8b68a", "#2b2b28"], ["#3E6C8E", "#9CB4B8", "#E9EEF2"]],
    captions: [
      "Patience, and the wild rewards you.",
      "A quiet moment before the flight.",
      "Some encounters last only seconds — worth every hour of waiting.",
      "Eye to eye with the wild.",
      "Nature doesn't pose; you just have to be ready.",
      "Found this beauty deep in the green.",
      "The stillness right before the wings unfold.",
      "Every bird carries a whole story in its eyes.",
      "Out here, silence says the most.",
      "Wild, free, and utterly unbothered by us.",
    ],
    ctas: ["Can you name this one? 👇", "Save this if nature calms you.", "Follow along for more from the wild.", "Tag a fellow bird lover."],
    hashtags: ["#wildlife", "#birdphotography", "#naturephotography", "#birdsofinstagram", "#wildlifephotography", "#birding", "#natgeoyourshot", "#birdwatching", "#nature", "#your_best_birds", "#planetbirds", "#bird"],
    music: [
      { name: "Experience", artist: "Ludovico Einaudi" },
      { name: "Bloom", artist: "The Paper Kites" },
      { name: "Holocene", artist: "Bon Iver" },
    ],
  },
  {
    key: "everyday",
    keywords: [],
    category: "Everyday",
    subjects: ["a slice of everyday life", "a small moment", "an ordinary detail worth keeping"],
    visualTheme: "honest, unposed",
    moods: ["easy", "grateful", "present", "light"],
    audience: "your followers",
    colors: [["#4C5B61", "#E8E2DB", "#A47551"], ["#264653", "#E9C46A", "#E76F51"]],
    captions: [
      "The little things, mostly.",
      "Nothing special, and that's the point.",
      "Saving this one for later-me.",
      "Ordinary day, quietly good.",
    ],
    ctas: ["What's making your day today? 👇", "Double tap if you needed this.", "Tag someone who'd get it."],
    hashtags: ["#everyday", "#momentsofmine", "#slowliving", "#simplethings", "#dailylife", "#capturethemoment", "#nofilter", "#lifelately"],
    music: [
      { name: "Ivy", artist: "Frank Ocean" },
      { name: "Waves", artist: "Dean Lewis" },
      { name: "Bloom", artist: "The Paper Kites" },
    ],
  },
];

function themeByKey(key: string): Theme | undefined {
  return THEMES.find((t) => t.key === key);
}

// Map the creator's stated niche to a content theme (so a wildlife
// photographer gets wildlife captions/hashtags across their whole feed).
function themeByNiche(niche?: string): Theme | undefined {
  if (!niche) return undefined;
  const n = niche.toLowerCase();
  if (/wild|bird|nature|animal|forest|ocean|macro|safari|jungle/.test(n)) return themeByKey("wildlife");
  if (/food|recipe|cook|cafe|restaurant|bak/.test(n)) return themeByKey("food");
  if (/travel|trip|adventure|explor|wander/.test(n)) return themeByKey("travel");
  if (/portrait|fashion|style|ootd|model|people/.test(n)) return themeByKey("portrait");
  if (/product|brand|shop|business|design|studio|maker/.test(n)) return themeByKey("product");
  return undefined;
}

function themeFor(item: MediaItem, niche?: string): Theme {
  const byNiche = themeByNiche(niche);
  if (byNiche) return byNiche;
  const name = item.originalName.toLowerCase();
  for (const t of THEMES) {
    if (t.keywords.some((k) => name.includes(k))) return t;
  }
  // Deterministic spread across themes so a batch of generic names still varies.
  const seed = hashSeed(item.id + item.originalName);
  return THEMES[seed % (THEMES.length - 1)]; // exclude "everyday" from random spread
}

// Prefer the theme chosen during analysis (stored as similarityGroup); else derive.
function resolveTheme(item: MediaItem, analysis?: MediaAnalysis | null, niche?: string): Theme {
  if (analysis?.similarityGroup) {
    const t = themeByKey(analysis.similarityGroup);
    if (t) return t;
  }
  return themeFor(item, niche);
}

export function analyzeItemDemo(item: MediaItem, niche?: string): MediaAnalysis {
  const theme = themeFor(item, niche);
  const seed = hashSeed(item.id + item.originalName);
  const isVideo = item.type === "video";
  const longVideo = isVideo && (item.duration ?? 0) > 60;
  return {
    subject: pick(theme.subjects, seed),
    contentType: isVideo ? "video" : "photo",
    visualTheme: theme.visualTheme,
    mood: pick(theme.moods, seed >> 2),
    context: isVideo
      ? "Short-form motion; keep original audio."
      : "Static frame suited to a feed post.",
    audience: theme.audience,
    category: theme.category,
    // Videos lean reel; very long videos definitely reel.
    format: isVideo || longVideo ? "reel" : seed % 5 === 0 ? "reel" : "post",
    colors: pick(theme.colors, seed >> 3),
    // Same theme + similar aspect => same similarity group (used to avoid
    // placing near-duplicates next to each other).
    similarityGroup: `${theme.key}`,
  };
}

export function captionDemo(item: MediaItem, analysis: MediaAnalysis, settings: Settings, variant = 0): string {
  const theme = resolveTheme(item, analysis, settings.niche);
  const seed = hashSeed(item.id + item.originalName) + variant * 7;
  let caption = pick(theme.captions, seed);
  if (!settings.aiEmojis) caption = caption.replace(/[\u{1F300}-\u{1FAFF}☀-➿]/gu, "").trim();
  return caption;
}

export function ctaDemo(item: MediaItem, variant = 0, analysis?: MediaAnalysis | null): string {
  const theme = resolveTheme(item, analysis);
  const seed = hashSeed(item.id + "cta") + variant * 3;
  return pick(theme.ctas, seed);
}

export function hashtagsDemo(item: MediaItem, analysis: MediaAnalysis, variant = 0): string[] {
  const theme = resolveTheme(item, analysis);
  const seed = hashSeed(item.id + "tags") + variant * 5;
  const pool = [...theme.hashtags];
  // Rotate the pool deterministically and take a relevant, modest set (8-12).
  const rotated = pool.slice(seed % pool.length).concat(pool.slice(0, seed % pool.length));
  const count = 8 + (seed % 4); // 8..11
  const base = rotated.slice(0, count);
  // Add one format-aware tag.
  if (analysis.format === "reel" && !base.includes("#reels")) base.push("#reels");
  return Array.from(new Set(base));
}

// Music suggestion for PHOTO posts only. Videos keep their original audio.
export function musicDemo(item: MediaItem, variant = 0, analysis?: MediaAnalysis | null) {
  if (item.type === "video") return null;
  const theme = resolveTheme(item, analysis);
  const seed = hashSeed(item.id + "music") + variant * 11;
  const m = pick(theme.music, seed);
  return { name: m.name, artist: m.artist, supportedByApi: false as const };
}
