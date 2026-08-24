/**
 * Digital wardrobe — the seam, not the feature.
 *
 * Nothing here talks to storage or a model yet. It exists so that the day the
 * wardrobe is built, the recommendation engine does not have to change shape:
 * fixes already accept an optional list of items the person actually owns, and
 * `suggestSwap` is the one function that would gain a body.
 *
 * Until a provider is registered, `getWardrobe()` returns an empty wardrobe and
 * every screen behaves exactly as it does today — no placeholder UI, no
 * half-feature.
 */

import type { CheckContext } from '../engine/types';

export type GarmentKind =
  | 'shirt'
  | 'tshirt'
  | 'top'
  | 'trousers'
  | 'jeans'
  | 'skirt'
  | 'dress'
  | 'blazer'
  | 'jacket'
  | 'sweater'
  | 'shoes'
  | 'accessory'
  | 'traditional';

export interface Garment {
  id: string;
  kind: GarmentKind;
  /** Human label the owner gave it: "navy oxford shirt". */
  label: string;
  /** Dominant colours as hex, from the photo. */
  colors: string[];
  /** 0 (loungewear) to 4 (black tie). */
  formality: number;
  /** Object URL or blob key — never leaves the device in the current design. */
  photo?: string;
  lastWornAt?: string;
}

export interface Wardrobe {
  items: Garment[];
  /** False until the user has actually photographed anything. */
  enabled: boolean;
}

export interface WardrobeProvider {
  list(): Promise<Garment[]>;
  add(photo: Blob): Promise<Garment>;
  remove(id: string): Promise<void>;
}

let provider: WardrobeProvider | null = null;

export function registerWardrobeProvider(p: WardrobeProvider) {
  provider = p;
}

export function wardrobeEnabled(): boolean {
  return provider !== null;
}

export async function getWardrobe(): Promise<Wardrobe> {
  if (!provider) return { items: [], enabled: false };
  return { items: await provider.list(), enabled: true };
}

export interface Swap {
  /** What the check flagged. */
  problem: string;
  /** The owned item that would solve it. */
  item: Garment;
  reason: string;
}

/**
 * "Wear the brown shoes you already own."
 *
 * With no wardrobe this returns nothing, and the recommendation stays generic
 * ("switch to darker shoes"). With one, the same fix gains a specific item.
 */
export async function suggestSwap(_ctx: CheckContext, _problemCategory: string): Promise<Swap | null> {
  if (!provider) return null;
  throw new Error('Wardrobe provider registered without a swap implementation.');
}
