// FeelingWise — pipeline perf-trace summarizer (pure).
//
// Turns the raw PerfRecord ring (src/diagnostics/perf-trace.ts, IDB
// `feelingwise-pipeline-v2-metrics`) into a per-stage latency summary a
// non-coder can read on the debug tab: how long each pipeline step takes
// (p50 / p95 / p99), how often it succeeds, and the cache-hit rate. This is
// the "understand WHERE the time goes, then choose what to fix" signal — the
// highest-leverage diagnostic per the diagnostics-tab spec.
//
// PURE + Node-testable by contract: no IDB, no chrome, no Date.now(). The
// dashboard reads the records (perf-trace.readRecords) and the empty-state
// guidance; this file only does the math. Percentile convention is documented
// at `percentile()` so the numbers are reproducible.

import type { PerfRecord, V2Stage } from '../diagnostics/perf-trace';
import { V2_STAGES } from '../diagnostics/perf-trace';

export interface StagePerfStats {
  stage: V2Stage;
  /** Number of samples for this stage. */
  count: number;
  /** Latency percentiles in ms (rounded to 0.1ms). */
  p50: number;
  p95: number;
  p99: number;
  meanMs: number;
  maxMs: number;
  /** Fraction 0..1 of samples with success === true. */
  successRate: number;
  /**
   * Fraction 0..1 of samples with cached === true, among samples where the
   * `cached` flag is set at all. null when no sample carries the flag (most
   * stages never set it — only pipeline_total / cache_lookup do).
   */
  cacheHitRate: number | null;
}

export interface PerfSummary {
  totalRecords: number;
  /** Earliest / latest sample timestamp (ms epoch), or null when empty. */
  firstTimestamp: number | null;
  lastTimestamp: number | null;
  /** Per-stage stats, only for stages with ≥1 sample, in V2_STAGES order. */
  stages: StagePerfStats[];
  /** Distinct platforms seen (sorted) — lets the UI offer a per-platform drill-down. */
  platforms: string[];
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

/**
 * Nearest-rank percentile on an ASCENDING-sorted array. `p` is a percentage
 * in [0, 100]. Empty → 0; single element → that element. Nearest-rank avoids
 * interpolation ambiguity and is stable for the small samples (≤1000) the
 * perf ring holds.
 */
export function percentile(sortedAsc: number[], p: number): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  if (n === 1) return sortedAsc[0];
  const rank = Math.ceil((p / 100) * n);
  const idx = Math.min(n - 1, Math.max(0, rank - 1));
  return sortedAsc[idx];
}

/**
 * Summarize a set of perf records into per-stage latency stats. Pure — pass
 * the records straight from `readRecords()`. Stages are reported in canonical
 * V2_STAGES order; a stage with no samples is omitted (the UI shows "no data"
 * for the whole section when `stages` is empty).
 */
export function summarizePerfRecords(records: PerfRecord[]): PerfSummary {
  if (records.length === 0) {
    return { totalRecords: 0, firstTimestamp: null, lastTimestamp: null, stages: [], platforms: [] };
  }

  const byStage = new Map<V2Stage, PerfRecord[]>();
  const platforms = new Set<string>();
  let firstTimestamp = Infinity;
  let lastTimestamp = -Infinity;

  for (const r of records) {
    if (r.platform) platforms.add(r.platform);
    if (r.timestamp < firstTimestamp) firstTimestamp = r.timestamp;
    if (r.timestamp > lastTimestamp) lastTimestamp = r.timestamp;
    const list = byStage.get(r.stage);
    if (list) list.push(r);
    else byStage.set(r.stage, [r]);
  }

  const stages: StagePerfStats[] = [];
  for (const stage of V2_STAGES) {
    const samples = byStage.get(stage);
    if (!samples || samples.length === 0) continue;

    const sortedMs = samples.map((s) => s.ms).sort((a, b) => a - b);
    const sum = sortedMs.reduce((acc, ms) => acc + ms, 0);
    const successes = samples.reduce((acc, s) => acc + (s.success ? 1 : 0), 0);
    const cachedSamples = samples.filter((s) => typeof s.cached === 'boolean');
    const cacheHits = cachedSamples.reduce((acc, s) => acc + (s.cached ? 1 : 0), 0);

    stages.push({
      stage,
      count: samples.length,
      p50: round1(percentile(sortedMs, 50)),
      p95: round1(percentile(sortedMs, 95)),
      p99: round1(percentile(sortedMs, 99)),
      meanMs: round1(sum / samples.length),
      maxMs: round1(sortedMs[sortedMs.length - 1]),
      successRate: successes / samples.length,
      cacheHitRate: cachedSamples.length > 0 ? cacheHits / cachedSamples.length : null,
    });
  }

  return {
    totalRecords: records.length,
    firstTimestamp,
    lastTimestamp,
    stages,
    platforms: Array.from(platforms).sort(),
  };
}

/**
 * Why the perf panel has zero samples, for the empty-state copy. Pure —
 * callers pass the already-read flag state and write-failure count.
 *
 * 2026-08-24 01:07 defect: the panel's empty state unconditionally said
 * "captureV2Metrics is off by default, turn it on" — true when the flag
 * really is off, but wrong on the owner's dev-tier build, where
 * content/index.ts auto-enables the flag on init (commit history around
 * 69904db) and every persist was failing with a RealmGuardError (content
 * realm trying to open the extension-origin IndexedDB store directly; fixed
 * in 69904db by routing the persist through the service worker instead).
 * The panel invented a cause ("it's off") instead of reading the one fact it
 * could actually check (the flag's real value) and the one signal cheap to
 * add (whether persists are failing).
 */
export type PerfEmptyStateReason = 'flag-off' | 'flag-on-no-data' | 'flag-on-writes-failing';

export function perfEmptyStateReason(args: {
  flagEnabled: boolean;
  writeFailures: number;
}): PerfEmptyStateReason {
  if (!args.flagEnabled) return 'flag-off';
  return args.writeFailures > 0 ? 'flag-on-writes-failing' : 'flag-on-no-data';
}
