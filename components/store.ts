import type { Post, Settings, InstagramAccount, MediaAnalysis } from "@/lib/types";

export type { Post, Settings, InstagramAccount, MediaAnalysis };

export interface ClientMedia {
  id: string;
  type: "photo" | "video";
  originalName: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  createdAt: string;
  url: string;
  thumbUrl: string;
  analysis: MediaAnalysis | null;
}

export interface ConfigStatus {
  ai: boolean;
  instagram: boolean;
  instagramOAuth: boolean;
  instagramManualToken: boolean;
  defaultCredentials: boolean;
  defaultSessionSecret: boolean;
}

export interface ClientState {
  media: ClientMedia[];
  posts: Post[];
  settings: Settings;
  instagram: InstagramAccount;
  config: ConfigStatus;
  limitations: Record<string, string>;
}

async function handle(res: Response) {
  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    (err as any).data = data;
    (err as any).status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (url: string) => fetch(url, { cache: "no-store" }).then(handle),
  post: (url: string, body?: any) =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }).then(handle),
  patch: (url: string, body?: any) =>
    fetch(url, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }).then(handle),
};

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function fmtDuration(sec: number | null) {
  if (!sec || sec <= 0) return "";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function mediaById(state: ClientState, id: string) {
  return state.media.find((m) => m.id === id);
}
