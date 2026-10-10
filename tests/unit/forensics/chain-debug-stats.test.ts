// `buildChainDebugStatsResponse` — pure transformation contract.
//
// The SW handler at `src/background/service-worker.ts` GET_CHAIN_DEBUG_STATS
// branch is a thin dispatcher: getRecords() → buildChainDebugStatsResponse →
// sendResponse. This test pins the transformation: verdict counts by class,
// last-10 newest-first ordering, originalText truncation at 50 chars, and
// missing-field handling. The SW dispatch logic is framework-level (chrome
// API + sendResponse) and not where bugs hide; the transformation is.

import { describe, it, expect } from 'vitest';
import { buildChainDebugStatsResponse } from '../../../src/forensics/chain-debug-stats';
import type { ForensicRecord } from '../../../src/types/forensic';

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

describe('buildChainDebugStatsResponse', () => {
  it('counts each verdict class into its own bucket', () => {
    const records: ForensicRecord[] = [
      rec({ id: 'a', verdict: 'flagged' }),
      rec({ id: 'b', verdict: 'flagged' }),
      rec({ id: 'c', verdict: 'flagged-hidden' }),
      rec({ id: 'd', verdict: 'blocked' }),
      rec({ id: 'e', verdict: 'pass' }),
      rec({ id: 'f', verdict: 'pass' }),
      rec({ id: 'g', verdict: 'pass' }),
      // verdict undefined (legacy pre-Phase-1.6.2 record)
      rec({ id: 'h' }),
      // unknown verdict value (forward-compat bucket)
      rec({ id: 'i', verdict: 'cancelled-stale' as ForensicRecord['verdict'] }),
    ];

    const response = buildChainDebugStatsResponse(records);

    expect(response.ok).toBe(true);
    expect(response.totalRecords).toBe(9);
    expect(response.verdictCounts).toEqual({
      flagged: 2,
      'flagged-hidden': 1,
      blocked: 1,
      pass: 3,
      'flagged-undefined': 1,
      other: 1,
    });
  });

  it('returns last 10 records newest-first by timestamp', () => {
    const records: ForensicRecord[] = Array.from({ length: 15 }, (_, i) =>
      rec({
        id: `fr-${i}`,
        timestamp: `2026-05-09T00:00:${String(i).padStart(2, '0')}.000Z`,
        verdict: 'flagged',
      }),
    );

    const response = buildChainDebugStatsResponse(records);

    expect(response.last10Records).toHaveLength(10);
    expect(response.last10Records[0].timestamp).toBe('2026-05-09T00:00:14.000Z');
    expect(response.last10Records[9].timestamp).toBe('2026-05-09T00:00:05.000Z');
  });

  it('truncates originalText to 50 chars', () => {
    const longText = 'a'.repeat(200);
    const records: ForensicRecord[] = [
      rec({ originalText: longText, verdict: 'flagged' }),
    ];

    const response = buildChainDebugStatsResponse(records);

    expect(response.last10Records[0].originalText).toBe('a'.repeat(50));
    expect(response.last10Records[0].originalText.length).toBe(50);
  });

  it('maps undefined verdict to "undefined" string in last10Records', () => {
    const records: ForensicRecord[] = [
      rec({ id: 'legacy', timestamp: '2026-05-09T00:00:00.000Z' }),
    ];

    const response = buildChainDebugStatsResponse(records);

    expect(response.last10Records[0].verdict).toBe('undefined');
  });

  it('extracts technique name from techniques[0]', () => {
    const records: ForensicRecord[] = [
      rec({
        verdict: 'flagged',
        techniques: [
          { name: 'shame-attack', severity: 8, confidence: 0.9 },
          { name: 'fear-appeal', severity: 6, confidence: 0.7 },
        ],
      }),
    ];

    const response = buildChainDebugStatsResponse(records);

    expect(response.last10Records[0].technique).toBe('shame-attack');
  });

  it('handles empty records array without throwing', () => {
    const response = buildChainDebugStatsResponse([]);

    expect(response.ok).toBe(true);
    expect(response.totalRecords).toBe(0);
    expect(response.last10Records).toEqual([]);
    expect(response.verdictCounts).toEqual({
      flagged: 0,
      'flagged-hidden': 0,
      blocked: 0,
      pass: 0,
      'flagged-undefined': 0,
      other: 0,
    });
  });

  it('handles missing originalText / techniques without throwing', () => {
    const records: ForensicRecord[] = [
      rec({
        verdict: 'flagged',
        // simulating partial legacy record where required fields are absent
        originalText: undefined as unknown as string,
        techniques: undefined as unknown as ForensicRecord['techniques'],
      }),
    ];

    const response = buildChainDebugStatsResponse(records);

    expect(response.last10Records[0].originalText).toBe('');
    expect(response.last10Records[0].technique).toBeUndefined();
  });
});
