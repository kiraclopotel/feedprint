// Pure perf-trace summarizer — src/diagnostics/perf-summary.ts.

import { describe, it, expect } from 'vitest';
import { summarizePerfRecords, percentile, perfEmptyStateReason } from '../../../src/diagnostics/perf-summary';
import type { PerfRecord, V2Stage } from '../../../src/diagnostics/perf-trace';

function rec(partial: Partial<PerfRecord> & { stage: V2Stage; ms: number }): PerfRecord {
  return {
    version: 1,
    timestamp: 1_000,
    platform: 'twitter',
    mode: 'teen',
    success: true,
    ...partial,
  };
}

describe('percentile (nearest-rank)', () => {
  it('returns 0 for an empty array', () => {
    expect(percentile([], 50)).toBe(0);
  });

  it('returns the single element regardless of p', () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 99)).toBe(42);
  });

  it('computes p50/p95/p99 on 1..100 by nearest-rank', () => {
    const arr = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100, ascending
    expect(percentile(arr, 50)).toBe(50);
    expect(percentile(arr, 95)).toBe(95);
    expect(percentile(arr, 99)).toBe(99);
    expect(percentile(arr, 100)).toBe(100);
  });
});

describe('summarizePerfRecords', () => {
  it('returns an empty summary for no records', () => {
    const s = summarizePerfRecords([]);
    expect(s.totalRecords).toBe(0);
    expect(s.stages).toEqual([]);
    expect(s.platforms).toEqual([]);
    expect(s.firstTimestamp).toBeNull();
    expect(s.lastTimestamp).toBeNull();
  });

  it('computes per-stage percentiles from a known distribution', () => {
    const records = Array.from({ length: 100 }, (_, i) =>
      rec({ stage: 'combined_call', ms: i + 1 }),
    );
    const s = summarizePerfRecords(records);
    expect(s.totalRecords).toBe(100);
    expect(s.stages).toHaveLength(1);
    const cc = s.stages[0];
    expect(cc.stage).toBe('combined_call');
    expect(cc.count).toBe(100);
    expect(cc.p50).toBe(50);
    expect(cc.p95).toBe(95);
    expect(cc.p99).toBe(99);
    expect(cc.maxMs).toBe(100);
    expect(cc.meanMs).toBe(50.5);
  });

  it('orders stages by canonical V2_STAGES, omitting empty stages', () => {
    const records = [
      rec({ stage: 'neutralize', ms: 5 }),
      rec({ stage: 'pipeline_total', ms: 100 }),
      rec({ stage: 'cache_lookup', ms: 1 }),
    ];
    const s = summarizePerfRecords(records);
    // pipeline_total → cache_lookup → (detect omitted) → (combined omitted) → neutralize
    expect(s.stages.map((x) => x.stage)).toEqual(['pipeline_total', 'cache_lookup', 'neutralize']);
  });

  it('computes successRate per stage', () => {
    const records = [
      rec({ stage: 'combined_call', ms: 10, success: true }),
      rec({ stage: 'combined_call', ms: 20, success: true }),
      rec({ stage: 'combined_call', ms: 30, success: false }),
      rec({ stage: 'combined_call', ms: 40, success: false }),
    ];
    const s = summarizePerfRecords(records);
    expect(s.stages[0].successRate).toBe(0.5);
  });

  it('cacheHitRate is null when no sample sets the cached flag', () => {
    const records = [rec({ stage: 'detect', ms: 10 }), rec({ stage: 'detect', ms: 20 })];
    expect(summarizePerfRecords(records).stages[0].cacheHitRate).toBeNull();
  });

  it('cacheHitRate counts only samples where cached is set', () => {
    const records = [
      rec({ stage: 'pipeline_total', ms: 10, cached: true }),
      rec({ stage: 'pipeline_total', ms: 20, cached: false }),
      rec({ stage: 'pipeline_total', ms: 30, cached: true }),
      rec({ stage: 'pipeline_total', ms: 40 }), // cached undefined — excluded from the denominator
    ];
    const s = summarizePerfRecords(records);
    // 2 hits out of 3 flagged samples
    expect(s.stages[0].cacheHitRate).toBeCloseTo(2 / 3, 5);
  });

  it('collects distinct platforms sorted and the timestamp span', () => {
    const records = [
      rec({ stage: 'combined_call', ms: 10, platform: 'tiktok', timestamp: 500 }),
      rec({ stage: 'combined_call', ms: 20, platform: 'facebook', timestamp: 900 }),
      rec({ stage: 'combined_call', ms: 30, platform: 'facebook', timestamp: 300 }),
    ];
    const s = summarizePerfRecords(records);
    expect(s.platforms).toEqual(['facebook', 'tiktok']);
    expect(s.firstTimestamp).toBe(300);
    expect(s.lastTimestamp).toBe(900);
  });

  it('rounds latency stats to 0.1ms', () => {
    const records = [
      rec({ stage: 'cache_lookup', ms: 0.123 }),
      rec({ stage: 'cache_lookup', ms: 0.456 }),
      rec({ stage: 'cache_lookup', ms: 0.789 }),
    ];
    const s = summarizePerfRecords(records);
    const cl = s.stages[0];
    // every reported number has at most one decimal place
    for (const v of [cl.p50, cl.p95, cl.p99, cl.meanMs, cl.maxMs]) {
      expect(Math.round(v * 10) / 10).toBe(v);
    }
  });
});

describe('perfEmptyStateReason — 2026-08-24 01:07 dashboard capture', () => {
  // The panel rendered: "No timing samples yet. Pipeline-performance capture
  // is a debug feature that's off by default... Turn on the captureV2Metrics
  // feature flag..." — unconditionally, regardless of the flag's actual
  // state. commit 69904db proved the flag WAS on (content/index.ts
  // auto-enables ff_captureV2Metrics for dev-tier licenses on init) and every
  // persist was failing with a RealmGuardError, fixed in that same commit by
  // routing the persist through the service worker. The panel told the owner
  // "turn it on" when the truth was "it's on and every write is failing".

  it('says the flag is off only when it actually is', () => {
    expect(perfEmptyStateReason({ flagEnabled: false, writeFailures: 0 })).toBe('flag-off');
  });

  it('does NOT say the flag is off when it is on, even with zero samples', () => {
    const reason = perfEmptyStateReason({ flagEnabled: true, writeFailures: 0 });
    expect(reason).not.toBe('flag-off');
    expect(reason).toBe('flag-on-no-data');
  });

  it('reports writes are failing, not "turn on the flag", when the flag is on and persists are failing', () => {
    // The owner's exact 2026-08-24 state: flag on, 0 records, persists failing.
    const reason = perfEmptyStateReason({ flagEnabled: true, writeFailures: 3 });
    expect(reason).toBe('flag-on-writes-failing');
    expect(reason).not.toBe('flag-off');
  });
});
