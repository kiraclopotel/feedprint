// FeelingWise — v2 perf tracing
//
// ─────────────────────────────────────────────────────────────────────────────
// PURPOSE
// ─────────────────────────────────────────────────────────────────────────────
// Measurement surface for the pipeline so optimization targets the real
// bottleneck. Output = per-stage ms samples in indexedDB; a later
// session can compute p50/p95/p99 from those samples.
//
// Percentile + aggregation conventions remain inline below.
//
// ─────────────────────────────────────────────────────────────────────────────
// CRITICAL SAFETY
// ─────────────────────────────────────────────────────────────────────────────
// This module runs on every processed post on every user's browser if wired
// at pipeline entry. It MUST:
//   • Be a no-op when `ff_captureV2Metrics` is false (default). Achieved via
//     `NOOP_TRACER` fast-path — zero allocations, no async work.
//   • Never throw upward. IndexedDB write failures are swallowed + console
//     warned; they do NOT degrade pipeline behavior for the user.
//   • Never mutate the PipelineResult. All effects are write-only on a
//     side-channel store.
//   • Bound storage — capped at MAX_RECORDS (1000) via ring-buffer eviction.
//     Perf tracing is diagnostic, not forensic; losing old samples is fine.
// ─────────────────────────────────────────────────────────────────────────────

import { isFeatureEnabled } from '../storage/feature-flags';
import { safeSendMessage } from '../storage/context-guard';
import { openSimpleStore } from '../forensics/idb-open';
import { utcDayKey } from '../storage/utc-day';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Named stages of the v2 pipeline we instrument. Kept as a string union so
 * aggregation consumers can iterate without runtime type info.
 *
 * Stage semantics:
 *   • `pipeline_total`  — full `process()` entry → return. Dominates user-felt latency.
 *   • `cache_lookup`    — sha256 + processingCache.get + early return path.
 *   • `detect`          — v2 classifier fan-out (runs when enabled; currently gated off for teen).
 *   • `combined_call`   — the Groq/DeepSeek round-trip inside `combinedDetectAndNeutralize`.
 *                         Most likely latency offender on slow user-network paths.
 *   • `neutralize`      — post-AI processing (frame cleanup, text substitution).
 *   • `inject`          — NOT captured here (content script side). Tracked separately if needed.

 */
export type V2Stage =
  | 'pipeline_total'
  | 'cache_lookup'
  | 'detect'
  | 'combined_call'
  | 'neutralize'
  | 'first_protection'
  | 'protection_terminal';

export const V2_STAGES: readonly V2Stage[] = [
  'pipeline_total',
  'cache_lookup',
  'detect',
  'combined_call',
  'neutralize',
  'first_protection',
  'protection_terminal',
] as const;

/**
 * One sample. Wire-format for the idb store — version-stamped so a
 * future shape change can be detected + migrated (schema drift guard).
 */
export interface PerfRecord {
  version: 1;
  timestamp: number; // Date.now() at stage end
  stage: V2Stage;
  ms: number; // elapsed wall-clock
  platform: string; // 'twitter' | 'facebook' | 'tiktok' | ... — free-form; caller sets
  // Narrowed from `'adult' | 'teen' | 'child'` to family modes. Legacy
  // IDB perf records carrying 'adult' remain readable; the type at
  // WRITE time disallows new 'adult' records.
  mode: 'child' | 'teen' | 'adult';
  provider?: 'groq' | 'deepinfra' | 'deepseek' | 'other'; // only populated for network-bound stages
  cached?: boolean; // cache hit for pipeline_total / cache_lookup
  success: boolean;
  /** Truncated sha256 of post.id — dedup across sessions without keeping PII. */
  postIdHash?: string;
  /** Short reason on failure. NOT stack traces. */
  error?: string;
}

/**
 * Context captured once per pipeline entry; reused across all stage timings
 * within that pipeline invocation. Avoids re-computing platform + mode on
 * every stage.
 */
export interface PerfContext {
  platform: string;
  // Narrowed to family modes.
  mode: 'child' | 'teen' | 'adult';
  provider?: PerfRecord['provider'];
  postIdHash?: string;
}

/**
 * The tracer returned by `startTrace`. Callers mark a stage start via
 * `stage(name)`, which returns an end function. Contract:
 *   • Call the end function at most once per stage invocation.
 *   • It's safe to start + end stages out-of-order or omit stages.
 *   • `end(options)` captures success/cached/error metadata without requiring
 *     the caller to maintain parallel state.
 */
interface StageEnd {
  (options?: { success?: boolean; cached?: boolean; error?: string; provider?: PerfRecord['provider'] }): void;
}

/**
 * The caller's verdict on a wrapped step's result. A step can resolve without doing its job: the
 * AI judge resolves to null when it got no reading, and timing that as ok shows the AI step at
 * 100% ok while its calls are being refused.
 */
type StageOutcome<T> = (result: T) => { success: boolean; error?: string };

export interface PerfTracer {
  stage(stage: V2Stage): StageEnd;
  /** Shortcut — wraps a fn with start+end around it. */
  wrap<T>(stage: V2Stage, fn: () => Promise<T>, outcome?: StageOutcome<T>): Promise<T>;
}

// ─────────────────────────────────────────────────────────────────────────────
// NO-OP TRACER — production fast-path when flag is off
// ─────────────────────────────────────────────────────────────────────────────

const NOOP_END: StageEnd = () => {};

const NOOP_TRACER: PerfTracer = {
  stage: () => NOOP_END,
  wrap: async <T>(_: V2Stage, fn: () => Promise<T>) => fn(),
};

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVE TRACER
// ─────────────────────────────────────────────────────────────────────────────

function makeActiveTracer(ctx: PerfContext): PerfTracer {
  return {
    stage(stage: V2Stage): StageEnd {
      const t0 = performance.now();
      let ended = false;
      return (options) => {
        if (ended) return;
        ended = true;
        const ms = performance.now() - t0;
        const record: PerfRecord = {
          version: 1,
          timestamp: Date.now(),
          stage,
          ms,
          platform: ctx.platform,
          mode: ctx.mode,
          provider: options?.provider ?? ctx.provider,
          cached: options?.cached,
          success: options?.success ?? true,
          error: options?.error,
          postIdHash: ctx.postIdHash,
        };
        // Fire-and-forget — never block pipeline. Errors swallowed inside.
        dispatchPersist(record);
      };
    },
    async wrap<T>(stage: V2Stage, fn: () => Promise<T>, outcome?: StageOutcome<T>): Promise<T> {
      const end = this.stage(stage);
      try {
        const result = await fn();
        let verdict: { success: boolean; error?: string } = { success: true };
        if (outcome) {
          try { verdict = outcome(result); } catch { /* a verdict that throws must not cost the step */ }
        }
        end({ success: verdict.success, error: verdict.error?.slice(0, 140) });
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        end({ success: false, error: msg.slice(0, 140) });
        throw err;
      }
    },
  };
}

/**
 * Entry point. Resolves to NOOP_TRACER when the flag is off — callers can
 * `await` this once per pipeline invocation and reuse the result.
 *
 * Deliberately async so the flag-check is evaluated against live storage,
 * not a cached snapshot that might pre-date the user flipping the flag.
 * Worst case: one chrome.storage round-trip per post, already cached 5s inside
 * `getFeatureFlags()`.
 */
export async function startTrace(ctx: PerfContext): Promise<PerfTracer> {
  try {
    const enabled = await isFeatureEnabled('captureV2Metrics');
    if (!enabled) return NOOP_TRACER;
  } catch {
    return NOOP_TRACER;
  }
  return makeActiveTracer(ctx);
}

/**
 * Record an externally-measured span. For durations the caller already holds
 * (the video path measures with its own clocks and the AI clients return
 * latencyMs) rather than bracketing a callsite with `stage()`. Same flag gate
 * and fire-and-forget persistence as the tracer; a no-op when
 * `captureV2Metrics` is off. Never throws.
 */
export async function recordSpan(
  ctx: PerfContext,
  stage: V2Stage,
  ms: number,
  options?: { success?: boolean; provider?: PerfRecord['provider']; error?: string },
): Promise<void> {
  try {
    if (!(await isFeatureEnabled('captureV2Metrics'))) return;
  } catch {
    return;
  }
  dispatchPersist({
    version: 1,
    timestamp: Date.now(),
    stage,
    ms,
    platform: ctx.platform,
    mode: ctx.mode,
    provider: options?.provider ?? ctx.provider,
    success: options?.success ?? true,
    error: options?.error,
    postIdHash: ctx.postIdHash,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PERSISTENCE — routed through the service worker
// ─────────────────────────────────────────────────────────────────────────────
//
// stage()/recordSpan() run in the content-script realm (pipeline.ts,
// content/index.ts, video-context/*, protection-terminals.ts share the host
// page's origin — not the extension origin). Opening the
// `feelingwise-pipeline-v2-metrics` IndexedDB store there trips the realm
// guard (assertExtensionRealm, called inside openSimpleStore) and throws
// RealmGuardError — the 2026-08-24 "[FW perf-trace] persist failed" defect.
// `dispatchPersist` sends the record to the service worker instead of
// opening the store here; `persistRecord` (the actual IndexedDB write) runs
// only when invoked from the extension-origin realm — i.e. from
// service-worker.ts's CAPTURE_PERF_RECORD handler. Mirrors the
// CAPTURE_PROMPT_IO / CAPTURE_BEHAVIOR capture-routing pattern already in
// use (core/neutralizer.ts, content/queue.ts).
function dispatchPersist(record: PerfRecord): void {
  // Through the guard (B7u3 site 5): it handles a throw on the spot and a send that fails later, and stops further sends once
  // the extension context is gone. Perf capture is diagnostic-only and must never throw upward.
  void safeSendMessage({ type: 'CAPTURE_PERF_RECORD', payload: record });
}

const DB_NAME = 'feelingwise-pipeline-v2-metrics';
const DB_VERSION = 1;
const STORE = 'records';
const MAX_RECORDS = 1000;

/**
 * The open connection, cached so a burst of records does not open the database
 * once each. Dropped whenever that connection stops being usable.
 *
 * It was cached and never invalidated (found 2026-09-19). Two consequences, and
 * the second is the one that reaches a person. A failed open was remembered as
 * a failure for the life of the realm, so one bad moment turned perf capture
 * off until the worker died. And a connection nobody lets go of BLOCKS a
 * delete: `resetForensicChain` clears this store by name, and a held handle is
 * exactly what makes that hang, which is the shape M289 had one file over, a
 * handle nobody was using standing in the way of the database.
 *
 * `onversionchange` is the one that matters for the reset: another realm asking
 * to delete or upgrade fires it, and closing there is what lets the delete
 * through. `onclose` covers the connection being taken away underneath us.
 */
let _dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise;
  const opening = openSimpleStore(DB_NAME, DB_VERSION, STORE, {
    autoIncrement: true,
    indexes: [['by_timestamp', 'timestamp'], ['by_stage', 'stage']],
  }).then((db) => {
    // Only ever clear the cache if it still holds THIS attempt: a later open
    // may already have replaced it, and dropping that one would leave the
    // realm opening a fresh connection on every record.
    const forget = (): void => { if (_dbPromise === opening) _dbPromise = null; };
    db.onclose = forget;
    db.onversionchange = () => { try { db.close(); } finally { forget(); } };
    return db;
  }).catch((err) => {
    if (_dbPromise === opening) _dbPromise = null;
    throw err;
  });
  _dbPromise = opening;
  return opening;
}

/**
 * Writes one record to the extension-origin IndexedDB store. Called only
 * from the extension realm: service-worker.ts's CAPTURE_PERF_RECORD handler
 * (production) or directly in tests. Content-realm callers must go through
 * `dispatchPersist` above instead — never call this from a content script.
 */
export async function persistRecord(record: PerfRecord): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      store.add(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    // Ring-buffer eviction — runs occasionally, not every insert.
    if (Math.random() < 0.05) {
      void evictExcess(db).catch(() => {});
    }
  } catch (err) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[FW perf-trace] persist failed', err);
    }
    void recordPersistFailure(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WRITE-FAILURE SIGNAL (2026-08-24) — for the empty-state panel
// ─────────────────────────────────────────────────────────────────────────────
//
// Before this, a failed persist only logged to console.warn — invisible to
// the dashboard. The panel's empty state then had no way to tell "the flag
// is off" apart from "the flag is on and writes are silently failing" and
// asserted the wrong one (see perfEmptyStateReason in core/perf-summary.ts).
// Mirrors the selector-health / extraction-canary pattern: a small, dated,
// best-effort chrome.storage.local counter, never thrown, never blocking.

const PERSIST_FAILURE_STORAGE_KEY = 'fw_perf_persist_failures';

export interface PerfPersistFailureLog {
  date: string;
  count: number;
  lastError: string;
  lastAt: string;
}

async function recordPersistFailure(err: unknown): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome?.storage?.local) return;
  try {
    const today = utcDayKey();
    const existing = await chrome.storage.local.get([PERSIST_FAILURE_STORAGE_KEY]);
    const raw = existing[PERSIST_FAILURE_STORAGE_KEY] as PerfPersistFailureLog | undefined;
    const prevCount = raw && raw.date === today ? raw.count : 0;
    const msg = err instanceof Error ? err.message : String(err);
    const log: PerfPersistFailureLog = {
      date: today,
      count: prevCount + 1,
      lastError: msg.slice(0, 140),
      lastAt: new Date().toISOString(),
    };
    await chrome.storage.local.set({ [PERSIST_FAILURE_STORAGE_KEY]: log });
  } catch {
    // Silent — the console.warn already fired; this counter is best-effort.
  }
}

/** Best-effort read for the Dashboard's perf panel. Returns today's log or an empty shell. */
export async function readPerfPersistFailures(): Promise<PerfPersistFailureLog> {
  const empty: PerfPersistFailureLog = { date: utcDayKey(), count: 0, lastError: '', lastAt: '' };
  if (typeof chrome === 'undefined' || !chrome?.storage?.local) return empty;
  try {
    const existing = await chrome.storage.local.get([PERSIST_FAILURE_STORAGE_KEY]);
    const raw = existing[PERSIST_FAILURE_STORAGE_KEY] as PerfPersistFailureLog | undefined;
    if (raw && raw.date === empty.date) return raw;
    return empty;
  } catch {
    return empty;
  }
}

async function evictExcess(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const countReq = store.count();
    countReq.onsuccess = () => {
      const excess = countReq.result - MAX_RECORDS;
      if (excess <= 0) {
        resolve();
        return;
      }
      const cursorReq = store.index('by_timestamp').openCursor();
      let deleted = 0;
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor || deleted >= excess) {
          resolve();
          return;
        }
        cursor.delete();
        deleted++;
        cursor.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    };
    countReq.onerror = () => reject(countReq.error);
  });
}

export async function readRecords(opts?: {
  stage?: V2Stage;
  sinceMs?: number;
  limit?: number;
}): Promise<PerfRecord[]> {
  try {
    const db = await openDb();
    return await new Promise<PerfRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const out: PerfRecord[] = [];
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve(out);
          return;
        }
        const rec = cursor.value as PerfRecord;
        const matchStage = !opts?.stage || rec.stage === opts.stage;
        const matchSince = !opts?.sinceMs || rec.timestamp >= opts.sinceMs;
        if (matchStage && matchSince) {
          out.push(rec);
        }
        if (opts?.limit && out.length >= opts.limit) {
          resolve(out);
          return;
        }
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST HOOKS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Test-only synchronous active tracer constructor. Production code must use
 * `startTrace` which respects the feature flag.
 */
export function __makeActiveTracerForTests(ctx: PerfContext): PerfTracer {
  return makeActiveTracer(ctx);
}

export const __NOOP_TRACER_FOR_TESTS = NOOP_TRACER;
export const __MAX_RECORDS_FOR_TESTS = MAX_RECORDS;
