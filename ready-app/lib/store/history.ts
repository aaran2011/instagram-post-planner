'use client';

/**
 * Local history.
 *
 * Kept in localStorage on purpose: the app has no accounts, and a record of
 * how someone looked on a given day is not something to put on a server
 * without a very good reason. The shape below is the same one a synced
 * backend would use, so moving it later is a storage swap and not a redesign.
 *
 * Frames are never stored — only numbers and text.
 */

import type { AppearanceReport, CheckContext, ReadinessReport } from '../engine/types';

const KEY = 'ready:history:v1';
const LIMIT = 50;

export interface HistoryEntry {
  id: string;
  /** ISO timestamp. */
  at: string;
  eventId: CheckContext['eventId'];
  eventLabel: string;
  depth: CheckContext['depth'];
  appearance: number;
  readiness: number | null;
  state: ReadinessReport['state'] | null;
  buckets: { label: string; score: number }[];
  /** The rescan lineage, so before/after survives a reload. */
  previousId?: string;
}

/*
 * Exposed as a subscribable store so screens can read it with
 * useSyncExternalStore: the value is right on the first client render, the
 * server renders a skeleton instead of a wrong empty state, and a save from one
 * screen updates any other that is listening.
 */
const listeners = new Set<() => void>();
let cache: HistoryEntry[] | null = null;

export function subscribeHistory(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** Null on the server, where there is no localStorage to read. */
export function historyServerSnapshot(): HistoryEntry[] | null {
  return null;
}

export function historySnapshot(): HistoryEntry[] {
  if (cache === null) cache = read();
  return cache;
}

function invalidate() {
  cache = null;
  for (const listener of listeners) listener();
}

function read(): HistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function write(entries: HistoryEntry[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries.slice(0, LIMIT)));
    invalidate();
  } catch {
    // Private browsing and full quotas both land here. History is a nicety;
    // losing it must never break the check that is currently running.
  }
}

export function listHistory(): HistoryEntry[] {
  return read();
}

export function saveEntry(entry: Omit<HistoryEntry, 'id' | 'at'> & { id?: string; at?: string }): HistoryEntry {
  const full: HistoryEntry = {
    id: entry.id ?? `h-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    at: entry.at ?? new Date().toISOString(),
    ...entry,
  } as HistoryEntry;
  const all = read().filter((e) => e.id !== full.id);
  write([full, ...all]);
  return full;
}

export function clearHistory() {
  try {
    window.localStorage.removeItem(KEY);
    invalidate();
  } catch {
    /* nothing to do */
  }
}

export interface Comparison {
  before: number;
  after: number;
  delta: number;
  improved: string[];
  regressed: string[];
}

/** Before/after for a rescan, computed on category scores rather than vibes. */
export function compare(before: AppearanceReport, after: AppearanceReport): Comparison {
  const beforeById = new Map(before.categories.map((c) => [c.id, c]));
  const improved: string[] = [];
  const regressed: string[] = [];

  for (const c of after.categories) {
    const prev = beforeById.get(c.id);
    if (!prev) continue;
    const delta = Math.round((c.score - prev.score) * 10) / 10;
    if (delta >= 0.3) improved.push(`${c.label} ${prev.score} → ${c.score}`);
    else if (delta <= -0.3) regressed.push(`${c.label} ${prev.score} → ${c.score}`);
  }

  const fixedTitles = new Set(after.fixes.map((f) => f.title));
  for (const fix of before.fixes) {
    if (!fixedTitles.has(fix.title)) improved.push(`Sorted: ${fix.title.toLowerCase()}`);
  }

  return {
    before: before.overall,
    after: after.overall,
    delta: Math.round((after.overall - before.overall) * 10) / 10,
    improved: improved.slice(0, 5),
    regressed: regressed.slice(0, 3),
  };
}
