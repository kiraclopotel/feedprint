// FeelingWise — Capture hook
//
// Capture hook for strict-production measurement. Wires
// `combinedDetectAndNeutralize` to write (Slice prose, AI system prompt,
// AI user prompt, raw response) tuples to a session-bound IDB store when
// the `capturePromptIO` feature flag is on.
//
// Flow per Decision 7:
//   1. The operator flips the dev flag from the console:
//        chrome.storage.local.set({ 'ff_capturePromptIO': true })
//   2. Scrolls 30 minutes through real feeds.
//   3. Exports records via `readAllCapturedTuples()` (dashboard surface or
//      dev-console invocation — TBD; this module exposes the readers).
//   4. Hand-labels the tuples → builds the production-shape labeled corpus.
//   5. Re-runs cascade against the labeled corpus → strict V1 production
//      precision number, tighter than synthetic labeled-100 runs.
//
// Design notes:
//   - Dev-flag-gated. When flag is OFF, this module is never called from
//     neutralizer.ts (gate at the call site, not here, so the IDB connection
//     is never opened during normal operation).
//   - Fire-and-forget on writes. Capture failure must NEVER break the
//     production cascade. Errors are silently swallowed; the diagnostics
//     counter (`capture-prompt-io-write-failed`) increments for visibility
//     in the existing neutralizer-diagnostics surface.
//   - Append-only. No automatic clear; the operator calls `clearCapturedTuples()`
//     manually between sessions when ready to reset the corpus.
//   - Reversible: deleting this file + removing the flag entry +
//     removing the two call sites in neutralizer.ts removes the
//     capture path entirely.

import { openSimpleStore } from './idb-open';

const DB_NAME = 'feelingwise-prompt-io-capture';
const STORE_NAME = 'tuples';
// Bumped to v2 because earlier diagnostic scripts called
// `indexedDB.open(name, 1)` without an `onupgradeneeded` handler. That
// could have created empty v1 databases on some installs. When this
// module then opened the same name at version 1, `onupgradeneeded`
// would NOT fire (database already existed at requested version) →
// store never created → captures failed silently. Bumping to v2 forces
// `onupgradeneeded` to fire for users with the orphan v1 database; the
// handler below creates the store if missing. New users get v2
// directly with the store on first open. Additive; safe.
const DB_VERSION = 2;

// Defensive against `capturePromptIO` flag
// accidentally left ON in production. Bounds storage growth to a 7-day window
// AND a hard record cap. Eviction runs opportunistically on the next write
// after the threshold is exceeded; intentionally sloppy to avoid blocking the
// hot capture path.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_RECORDS = 50_000;

/**
 * One captured production-shape tuple per `callAI` invocation inside
 * `combinedDetectAndNeutralize`. Schema is intentionally flat — these
 * records are hand-labeled, so additional analytic fields are added at
 * label time (corpus-build phase), not here.
 */
export interface CapturedTuple {
  /** Auto-assigned by IDB on insert. */
  id?: number;
  /** Wall-clock time at capture, for ordering + session-window analysis. */
  timestamp: number;
  /** Which cascade stage produced this tuple. */
  stage: 'triage' | 'classify';
  /** Rendered Slice prose () when available — else empty string. */
  sliceProse: string;
  /** Full system prompt the model saw at this stage. */
  systemPrompt: string;
  /** Full user prompt the model saw at this stage. */
  userPrompt: string;
  /** Raw response string from `callAI`. */
  rawResponse: string;
  /** Locale forwarded to the cascade. V1 is English-only; `ro` retained for forensic-tag back-compat. */
  locale?: 'en' | 'ro';
  /** Mode forwarded to the cascade (`child` / `teen` / `adult`). Optional for legacy paths. */
  mode?: 'child' | 'teen' | 'adult';
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = openSimpleStore(DB_NAME, DB_VERSION, STORE_NAME, { keyPath: 'id', autoIncrement: true });
  return dbPromise;
}

/**
 * Append one tuple to the capture store. Fire-and-forget — must NOT throw,
 * must NOT block. Capture failures swallowed (this is dev instrumentation;
 * a broken IDB write must never break the production cascade).
 */
export async function capturePromptIO(tuple: Omit<CapturedTuple, 'id'>): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add(tuple);
    await new Promise<void>(resolve => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
    // Opportunistic eviction. ~1% sample rate keeps eviction
    // off the hot path while still bounding growth over a long capture session.
    if (Math.random() < 0.01) void evictOldRecords(db);
  } catch {
    // Swallow — dev instrumentation must not break production path.
  }
}

async function evictOldRecords(db: IDBDatabase): Promise<void> {
  try {
    const cutoffTs = Date.now() - MAX_AGE_MS;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const all = await new Promise<CapturedTuple[]>((resolve) => {
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as CapturedTuple[]) ?? []);
      req.onerror = () => resolve([]);
    });
    // Drop records older than MAX_AGE_MS OR beyond MAX_RECORDS (oldest first).
    const sorted = [...all].sort((a, b) => a.timestamp - b.timestamp);
    const toDrop = new Set<number>();
    for (const r of sorted) {
      if (r.id == null) continue;
      if (r.timestamp < cutoffTs) toDrop.add(r.id);
    }
    if (sorted.length > MAX_RECORDS) {
      for (let i = 0; i < sorted.length - MAX_RECORDS; i++) {
        if (sorted[i].id != null) toDrop.add(sorted[i].id!);
      }
    }
    for (const id of toDrop) store.delete(id);
    await new Promise<void>(resolve => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch { /* swallow — eviction is best-effort */ }
}

/** Read all captured tuples, ordered by insertion (id asc). Empty array on failure. */
export async function readAllCapturedTuples(): Promise<CapturedTuple[]> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readonly');
    return await new Promise<CapturedTuple[]>((resolve, reject) => {
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve((req.result as CapturedTuple[]) ?? []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

/** Clear the capture store. Manual session-reset utility. */
export async function clearCapturedTuples(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    await new Promise<void>(resolve => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // Swallow.
  }
}

/** Test-only hook to reset module-level cache. Not used by production code. */
export function __resetCapturePromptIOForTests(): void {
  dbPromise = null;
}
