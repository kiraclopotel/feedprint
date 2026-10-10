// FeelingWise — Behavioral capture hook.
//
// Companion to `capture-prompt-io.ts`. Where prompt-io captures
// (sliceProse, system, user, raw) tuples for prompt-side hand-labeling,
// THIS module captures (eventKind, postId, timestamp, ageMs,
// queue-state-at-event) tuples for the behavioral side: was the verdict
// dispatched? did it complete? did it get cancelled and why? what was
// the latency at each transition?
//
// Hand-labeled prompt-IO + behavior-event timeline together produce a
// Failure A vs Failure B disentangle:
//   - Failure A (precision gap): model output for input X was wrong on
//     its own merits.
//   - Failure B (sync gap): model output for input X was right but
//     rendered onto wrong content because of tree-state churn between
//     dispatch and render.
//
// Dev-flag-gated. When `captureBehavior` flag is OFF, this module is
// never called from queue.ts (gate at the call site). Same
// fire-and-forget + errors-swallowed contract as
// `capture-prompt-io.ts`.

import { openSimpleStore } from './idb-open';
import type { CapturedBehavior } from '../types/captured-behavior';

const DB_NAME = 'feelingwise-behavior-capture';
const STORE_NAME = 'events';
// Bumped to v2 because earlier diagnostic attempts called
// `indexedDB.open(name, 1)` without an `onupgradeneeded` handler,
// creating empty v1 databases on some installs. Bumping forces
// `onupgradeneeded` to fire and create the missing store on those
// installs. Additive; safe.
const DB_VERSION = 2;

// TTL + record-cap pattern. Behavior events are smaller per-row but
// generated more frequently (multiple events per post), so the record
// cap is raised.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_RECORDS = 200_000;


let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = openSimpleStore(DB_NAME, DB_VERSION, STORE_NAME, { keyPath: 'id', autoIncrement: true });
  return dbPromise;
}

/**
 * Append one behavior event. Fire-and-forget — must NOT throw, must NOT block.
 * Capture failures swallowed; dev instrumentation must never break the
 * production cascade per Decision 7 reversibility commitment.
 */
export async function captureBehaviorEvent(event: Omit<CapturedBehavior, 'id'>): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add(event);
    await new Promise<void>(resolve => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
    // Opportunistic eviction. ~0.5% sample rate (lower than prompt-io
    // because behavior events fire more frequently per post).
    if (Math.random() < 0.005) void evictOldEvents(db);
  } catch {
    // Swallow.
  }
}

async function evictOldEvents(db: IDBDatabase): Promise<void> {
  try {
    const cutoffTs = Date.now() - MAX_AGE_MS;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const all = await new Promise<CapturedBehavior[]>((resolve) => {
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as CapturedBehavior[]) ?? []);
      req.onerror = () => resolve([]);
    });
    const sorted = [...all].sort((a, b) => a.ts - b.ts);
    const toDrop = new Set<number>();
    for (const r of sorted) {
      if (r.id == null) continue;
      if (r.ts < cutoffTs) toDrop.add(r.id);
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
  } catch { /* swallow */ }
}

/** Read all captured events ordered by IDB insertion (id asc). */
export async function readAllCapturedBehavior(): Promise<CapturedBehavior[]> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readonly');
    return await new Promise<CapturedBehavior[]>((resolve, reject) => {
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve((req.result as CapturedBehavior[]) ?? []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

/** Clear the behavior-capture store. Manual session-reset utility. */
export async function clearCapturedBehavior(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    await new Promise<void>(resolve => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch { /* swallow */ }
}

/** Test-only hook to reset module-level cache. Not used by production code. */
export function __resetCaptureBehaviorForTests(): void {
  dbPromise = null;
}

// The shape lives in src/types/captured-behavior.ts so the types layer imports nothing (PLAN-2026-09-16 item 8.6);
// every importer of this module keeps working through this re-export.
export type { CapturedBehavior } from '../types/captured-behavior';
