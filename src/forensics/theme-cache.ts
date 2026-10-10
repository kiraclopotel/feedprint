// FeelingWise — theme sidecar cache (sequence analysis slice 4,
// docs/research/SEQUENCE_ANALYSIS_DESIGN.md §Data model).
//
// Caches the computed Theme[] so repeat Patterns-tab opens are instant.
// Lives in its OWN IndexedDB database (`feelingwise-derived`) — never the
// evidence DB: bumping the forensic store's version for a disposable cache
// risks the one database that must never have a migration accident, and
// deleting this DB loses nothing evidentiary (a verifier recomputes from
// the chain — every step is deterministic).
//
// Invalidation: an entry is valid only when BOTH the algorithm version and
// the chain fingerprint (count + last record id + last timestamp) match.
// Any new record, reset, restore, or algorithm change → full recompute
// (the only path — no incremental merge logic to get subtly wrong).

import type { ForensicRecord } from '../types/forensic';
import type { Theme } from './topics';
import { TOPICS_ALGO_VERSION } from './topics';
import { openSimpleStore } from './idb-open';

const DB_NAME = 'feelingwise-derived';
const DB_VERSION = 1;
const STORE = 'cache';
const ENTRY_KEY = 'themes-v1';

interface ThemeCacheEntry {
  key: typeof ENTRY_KEY;
  builtAt: string;
  algoVersion: number;
  chainFingerprint: string;
  themes: Theme[];
  /** Flat assignment pairs (Map doesn't survive structured clone reliably across versions). */
  assignmentPairs: [string, string][];
  fingerprintCount: number;
}

/** Cheap chain identity — changes whenever the record set changes. Pure. */
export function chainFingerprint(records: ForensicRecord[]): string {
  if (records.length === 0) return '0::';
  let last = records[0];
  for (const r of records) {
    if (r.timestamp > last.timestamp || (r.timestamp === last.timestamp && r.id > last.id)) {
      last = r;
    }
  }
  return `${records.length}:${last.id}:${last.timestamp}`;
}

let _dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise;
  _dbPromise = openSimpleStore(DB_NAME, DB_VERSION, STORE, { keyPath: 'key' });
  return _dbPromise;
}

/**
 * Read the cached themes when still valid for the given record set.
 * Returns null on miss/stale/error — callers recompute. Never throws.
 */
/**
 * Empty the whole sidecar. Called by the chain reset: a theme label is built
 * out of the words of the posts it covers, so leaving it behind would leave
 * derived text from a chain the reader was told had been cleared.
 *
 * Best-effort by design, like every other read and write in this file. The
 * cache is disposable: a failure here costs a stale entry that the algorithm
 * version or the chain fingerprint will invalidate anyway, and it must never
 * be the thing that strands a reset half-done.
 */
export async function clearThemeCache(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('theme cache clear aborted'));
    });
  } catch (err) {
    console.warn('[FeelingWise] clearThemeCache failed', err);
  }
}

export async function readThemeCache(
  records: ForensicRecord[],
  timeoutMs: number = THEME_CACHE_READ_TIMEOUT_MS,
): Promise<{ themes: Theme[]; assignment: Map<string, string>; fingerprintCount: number } | null> {
  // An IndexedDB open that is blocked (another tab holding an older version)
  // never answers, and the Patterns tab waited on it with "computing" for as
  // long as the page stayed open (wiring audit 13 Sep, D2-25). Past the
  // timeout the read counts as a miss and the themes are computed; the next
  // read tries the database again.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => { _dbPromise = null; resolve(null); }, timeoutMs);
  });
  try {
    return await Promise.race([readThemeCacheNow(records), timedOut]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** How long a cache read may take before it counts as a miss. */
const THEME_CACHE_READ_TIMEOUT_MS = 3000;

async function readThemeCacheNow(
  records: ForensicRecord[],
): Promise<{ themes: Theme[]; assignment: Map<string, string>; fingerprintCount: number } | null> {
  try {
    const db = await openDb();
    const entry = await new Promise<ThemeCacheEntry | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(ENTRY_KEY);
      req.onsuccess = () => resolve(req.result as ThemeCacheEntry | undefined);
      req.onerror = () => reject(req.error);
    });
    if (!entry) return null;
    if (entry.algoVersion !== TOPICS_ALGO_VERSION) return null;
    if (entry.chainFingerprint !== chainFingerprint(records)) return null;
    return {
      themes: entry.themes,
      assignment: new Map(entry.assignmentPairs),
      fingerprintCount: entry.fingerprintCount,
    };
  } catch {
    return null;
  }
}

/** Persist freshly computed themes. Fire-and-forget safe; never throws. */
export async function writeThemeCache(
  records: ForensicRecord[],
  themes: Theme[],
  assignment: Map<string, string>,
  fingerprintCount: number,
): Promise<void> {
  try {
    const db = await openDb();
    const entry: ThemeCacheEntry = {
      key: ENTRY_KEY,
      builtAt: new Date().toISOString(),
      algoVersion: TOPICS_ALGO_VERSION,
      chainFingerprint: chainFingerprint(records),
      themes,
      assignmentPairs: Array.from(assignment.entries()),
      fingerprintCount,
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Disposable cache — a failed write only costs a recompute next open.
  }
}
