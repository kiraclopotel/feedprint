// Pure-aggregation contract for the Operational Events surface.
//
// VISION §1.2 ("no silent degradation") — this aggregator walks chain records
// and groups cap-exhausted / cancelled-batch-llm-failure / cancelled-batch-
// truncated / scan-purged events by hour. Tests pin: bucketing across hours,
// failureKind grouping, pre-N+1 back-compat (records lacking failureKind
// default to 'network'), cap subtype routing, and out-of-window record
// exclusion.

import { describe, it, expect } from 'vitest';
import { bucketizeOperationalEvents } from '../../../src/forensics/chain-debug-stats';
import type { ForensicRecord } from '../../../src/types/forensic';

const HOUR_MS = 60 * 60 * 1000;

function rec(overrides: Partial<ForensicRecord>): ForensicRecord {
  return {
    id: 'fr-stub',
    timestamp: '2026-05-09T00:00:00.000Z',
    platform: 'twitter',
    originalText: 'stub',
    originalHash: 'stub-hash',
    originalLength: 4,
    neutralizedText: '',
    author: '@stub',
    postUrl: 'https://x.com/.../status/0',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'unknown',
    integrityHash: 'stub-integrity',
    ...overrides,
  };
}

describe('bucketizeOperationalEvents', () => {
  it('buckets cap-exhausted records by hour with cap subtype routing', () => {
    const windowEnd = Date.parse('2026-05-09T03:00:00.000Z');
    const records: ForensicRecord[] = [
      rec({
        id: 'a',
        timestamp: '2026-05-09T00:30:00.000Z',
        verdict: 'skipped',
        skipReason: 'cap-exhausted',
        cap: 'daily',
      }),
      rec({
        id: 'b',
        timestamp: '2026-05-09T01:30:00.000Z',
        verdict: 'skipped',
        skipReason: 'cap-exhausted',
        cap: 'daily',
      }),
      rec({
        id: 'c',
        timestamp: '2026-05-09T02:15:00.000Z',
        verdict: 'skipped',
        skipReason: 'cap-exhausted',
        cap: 'monthly',
      }),
    ];

    const buckets = bucketizeOperationalEvents(records, HOUR_MS, windowEnd, 3 * HOUR_MS);

    expect(buckets).toHaveLength(3);
    expect(buckets[0].capExhausted.daily).toBe(1);
    expect(buckets[1].capExhausted.daily).toBe(1);
    expect(buckets[2].capExhausted.monthly).toBe(1);
    expect(buckets[0].total).toBe(1);
    expect(buckets[1].total).toBe(1);
    expect(buckets[2].total).toBe(1);
  });

  it('groups cancelled-batch-llm-failure records by failureKind', () => {
    const windowEnd = Date.parse('2026-05-09T01:00:00.000Z');
    const records: ForensicRecord[] = [
      rec({ id: 'a', timestamp: '2026-05-09T00:10:00.000Z', verdict: 'cancelled-batch-llm-failure', failureKind: 'rate-limit' }),
      rec({ id: 'b', timestamp: '2026-05-09T00:15:00.000Z', verdict: 'cancelled-batch-llm-failure', failureKind: 'rate-limit' }),
      rec({ id: 'c', timestamp: '2026-05-09T00:20:00.000Z', verdict: 'cancelled-batch-llm-failure', failureKind: 'rate-limit' }),
      rec({ id: 'd', timestamp: '2026-05-09T00:25:00.000Z', verdict: 'cancelled-batch-llm-failure', failureKind: 'transient-http' }),
      rec({ id: 'e', timestamp: '2026-05-09T00:30:00.000Z', verdict: 'cancelled-batch-llm-failure', failureKind: 'transient-http' }),
    ];

    const buckets = bucketizeOperationalEvents(records, HOUR_MS, windowEnd, HOUR_MS);

    expect(buckets).toHaveLength(1);
    expect(buckets[0].llmFailure['rate-limit']).toBe(3);
    expect(buckets[0].llmFailure['transient-http']).toBe(2);
    expect(buckets[0].total).toBe(5);
  });

  it('routes cancelled-batch-llm-failure with failureKind=cap-exhausted to capExhausted bucket', () => {
    // Production-shape: cap-exhausted surfaces as a cancelled-batch-llm-failure
    // (callAI returned Err({ kind: 'cap-exhausted', cap }) and scoreBatch
    // emitted CANCEL_LOG with the typed kind). VISION §1.2 distinction
    // (parent's account vs system-side) requires this to land in the
    // capExhausted bucket, NOT in llmFailure.
    const windowEnd = Date.parse('2026-05-09T01:00:00.000Z');
    const records: ForensicRecord[] = [
      rec({ id: 'a', timestamp: '2026-05-09T00:05:00.000Z', verdict: 'cancelled-batch-llm-failure', failureKind: 'cap-exhausted', cap: 'daily' }),
      rec({ id: 'b', timestamp: '2026-05-09T00:10:00.000Z', verdict: 'cancelled-batch-llm-failure', failureKind: 'cap-exhausted', cap: 'daily' }),
      rec({ id: 'c', timestamp: '2026-05-09T00:15:00.000Z', verdict: 'cancelled-batch-llm-failure', failureKind: 'cap-exhausted', cap: 'monthly' }),
      rec({ id: 'd', timestamp: '2026-05-09T00:20:00.000Z', verdict: 'cancelled-batch-llm-failure', failureKind: 'cap-exhausted', cap: 'tier-free' }),
      // Non-cap llm-failure stays in llmFailure
      rec({ id: 'e', timestamp: '2026-05-09T00:25:00.000Z', verdict: 'cancelled-batch-llm-failure', failureKind: 'rate-limit' }),
    ];

    const buckets = bucketizeOperationalEvents(records, HOUR_MS, windowEnd, HOUR_MS);

    expect(buckets[0].capExhausted.daily).toBe(2);
    expect(buckets[0].capExhausted.monthly).toBe(1);
    expect(buckets[0].capExhausted.tierFree).toBe(1);
    expect(buckets[0].llmFailure['rate-limit']).toBe(1);
    expect(buckets[0].llmFailure['cap-exhausted']).toBeUndefined();
    expect(buckets[0].total).toBe(5);
  });

  it('defaults missing failureKind to network for pre-N+1 records', () => {
    const windowEnd = Date.parse('2026-05-09T01:00:00.000Z');
    const records: ForensicRecord[] = [
      rec({ id: 'a', timestamp: '2026-05-09T00:30:00.000Z', verdict: 'cancelled-batch-llm-failure' }),
    ];

    const buckets = bucketizeOperationalEvents(records, HOUR_MS, windowEnd, HOUR_MS);

    expect(buckets[0].llmFailure['network']).toBe(1);
    expect(buckets[0].total).toBe(1);
  });

  it('counts cancelled-batch-truncated records into batchTruncated', () => {
    const windowEnd = Date.parse('2026-05-09T01:00:00.000Z');
    const records: ForensicRecord[] = [
      rec({ id: 'a', timestamp: '2026-05-09T00:10:00.000Z', verdict: 'cancelled-batch-truncated' }),
      rec({ id: 'b', timestamp: '2026-05-09T00:30:00.000Z', verdict: 'cancelled-batch-truncated' }),
    ];

    const buckets = bucketizeOperationalEvents(records, HOUR_MS, windowEnd, HOUR_MS);

    expect(buckets[0].batchTruncated).toBe(2);
    expect(buckets[0].total).toBe(2);
  });

  it('excludes records outside the time window', () => {
    const windowEnd = Date.parse('2026-05-09T03:00:00.000Z');
    const records: ForensicRecord[] = [
      // Before window (window starts 00:00:00)
      rec({ id: 'old', timestamp: '2026-05-08T22:00:00.000Z', verdict: 'cancelled-batch-truncated' }),
      // In window
      rec({ id: 'in', timestamp: '2026-05-09T01:30:00.000Z', verdict: 'cancelled-batch-truncated' }),
      // At/after window end (excluded — half-open interval)
      rec({ id: 'after', timestamp: '2026-05-09T03:00:00.000Z', verdict: 'cancelled-batch-truncated' }),
    ];

    const buckets = bucketizeOperationalEvents(records, HOUR_MS, windowEnd, 3 * HOUR_MS);

    const truncatedTotal = buckets.reduce((s, b) => s + b.batchTruncated, 0);
    expect(truncatedTotal).toBe(1);
  });

  it('returns empty buckets for hours with no events (gap rendering)', () => {
    const windowEnd = Date.parse('2026-05-09T03:00:00.000Z');
    const records: ForensicRecord[] = [
      rec({ id: 'a', timestamp: '2026-05-09T00:30:00.000Z', verdict: 'cancelled-batch-truncated' }),
    ];

    const buckets = bucketizeOperationalEvents(records, HOUR_MS, windowEnd, 3 * HOUR_MS);

    expect(buckets).toHaveLength(3);
    expect(buckets[0].batchTruncated).toBe(1);
    expect(buckets[1].batchTruncated).toBe(0);
    expect(buckets[2].batchTruncated).toBe(0);
    expect(buckets[1].total).toBe(0);
    expect(buckets[2].total).toBe(0);
  });

  it('skips records with non-operational verdicts', () => {
    const windowEnd = Date.parse('2026-05-09T01:00:00.000Z');
    const records: ForensicRecord[] = [
      rec({ id: 'a', timestamp: '2026-05-09T00:10:00.000Z', verdict: 'flagged' }),
      rec({ id: 'b', timestamp: '2026-05-09T00:20:00.000Z', verdict: 'pass' }),
      rec({ id: 'c', timestamp: '2026-05-09T00:30:00.000Z', verdict: 'skipped', skipReason: 'too-short' }),
      rec({ id: 'd', timestamp: '2026-05-09T00:40:00.000Z', verdict: 'cancelled-stale' }),
    ];

    const buckets = bucketizeOperationalEvents(records, HOUR_MS, windowEnd, HOUR_MS);

    expect(buckets[0].total).toBe(0);
  });

  it('counts scan-purged forward-compat skipReason', () => {
    const windowEnd = Date.parse('2026-05-09T01:00:00.000Z');
    const records: ForensicRecord[] = [
      rec({ id: 'a', timestamp: '2026-05-09T00:30:00.000Z', verdict: 'skipped', skipReason: 'scan-purged' }),
      rec({ id: 'b', timestamp: '2026-05-09T00:45:00.000Z', verdict: 'skipped', skipReason: 'scan-purged' }),
    ];

    const buckets = bucketizeOperationalEvents(records, HOUR_MS, windowEnd, HOUR_MS);

    expect(buckets[0].scanPurged).toBe(2);
    expect(buckets[0].total).toBe(2);
  });

  it('handles records with malformed timestamps without throwing', () => {
    const windowEnd = Date.parse('2026-05-09T01:00:00.000Z');
    const records: ForensicRecord[] = [
      rec({ id: 'a', timestamp: 'not-a-date', verdict: 'cancelled-batch-truncated' }),
      rec({ id: 'b', timestamp: '', verdict: 'cancelled-batch-truncated' }),
    ];

    const buckets = bucketizeOperationalEvents(records, HOUR_MS, windowEnd, HOUR_MS);

    expect(buckets[0].batchTruncated).toBe(0);
    expect(buckets[0].total).toBe(0);
  });
});
