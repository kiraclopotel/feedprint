// FeelingWise finder ledger (11 Oct 2026).
//
// The selector-health counters say which selector of a chain answered. They cannot say what a finder REFUSED to hide
// or UNDID, and those are the two signals that a page has changed in a way the finder did not expect: a climb that
// now lands on a landmark, a bar that now holds a text box. This is a second, smaller ledger for those events, in the
// same shape and with the same care: numbers only, no text and no address, one key per day in chrome.storage.local,
// flushed every thirty seconds and when the page goes away. Off writes it too (it has the storage permission and no
// network); the popup reads it.
//
// Keys are `<event>.<feature>.<reason>`, for example `refused.hide-action-buttons.text-input`. The set of keys is
// fixed by the code that records them, so the ledger can never hold anything a page said.

import { utcDayKey } from '../storage/utc-day';

const STORAGE_KEY = 'fw_finder_ledger';
const FLUSH_INTERVAL_MS = 30_000;
/** A day's ledger never holds more keys than this, whatever calls it; the keys come from code, so it is a backstop. */
const MAX_KEYS = 200;

export interface FinderLedgerSnapshot {
  date: string;
  counters: Record<string, number>;
}

const pending: Map<string, number> = new Map();
let flushScheduled = false;
let pageDeathBound = false;

const onPageDeath = (): void => { void flushFinderLedger(); };

function bindPageDeath(): void {
  if (pageDeathBound) return;
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  pageDeathBound = true;
  window.addEventListener('pagehide', onPageDeath);
}

function scheduleFlush(): void {
  bindPageDeath();
  if (flushScheduled) return;
  flushScheduled = true;
  setTimeout(() => {
    flushScheduled = false;
    void flushFinderLedger();
  }, FLUSH_INTERVAL_MS);
}

/** Count one event under `key`. Cheap: a map increment; the write happens later. */
export function recordFinderEvent(key: string): void {
  pending.set(key, (pending.get(key) ?? 0) + 1);
  scheduleFlush();
}

/** Merge what is pending into today's stored ledger. Best effort: a failed write keeps the counts for the next flush. */
export async function flushFinderLedger(): Promise<void> {
  if (pending.size === 0) return;
  if (typeof chrome === 'undefined' || !chrome?.storage?.local) return;
  try {
    const stored = await chrome.storage.local.get([STORAGE_KEY]);
    const raw = stored[STORAGE_KEY] as FinderLedgerSnapshot | undefined;
    const today = utcDayKey();
    const snapshot: FinderLedgerSnapshot = raw && raw.date === today ? raw : { date: today, counters: {} };
    for (const [key, n] of pending) {
      if (!(key in snapshot.counters) && Object.keys(snapshot.counters).length >= MAX_KEYS) continue;
      snapshot.counters[key] = (snapshot.counters[key] ?? 0) + n;
    }
    pending.clear();
    await chrome.storage.local.set({ [STORAGE_KEY]: snapshot });
  } catch {
    // Silent: the counts stay pending and the next flush retries.
  }
}

/** Today's ledger, or an empty one. Never throws. */
export async function readFinderLedger(): Promise<FinderLedgerSnapshot> {
  const empty: FinderLedgerSnapshot = { date: utcDayKey(), counters: {} };
  if (typeof chrome === 'undefined' || !chrome?.storage?.local) return empty;
  try {
    const stored = await chrome.storage.local.get([STORAGE_KEY]);
    const raw = stored[STORAGE_KEY] as FinderLedgerSnapshot | undefined;
    return raw && raw.date === utcDayKey() ? raw : empty;
  } catch {
    return empty;
  }
}

/** Test hook: forget everything pending and stop the timer's effect. */
export function __resetFinderLedgerForTest(): void {
  pending.clear();
  flushScheduled = false;
  if (pageDeathBound && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
    window.removeEventListener('pagehide', onPageDeath);
  }
  pageDeathBound = false;
}

/** Test hook: what is waiting to be written. */
export function __pendingFinderEventsForTest(): Record<string, number> {
  return Object.fromEntries(pending);
}
