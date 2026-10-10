// Read-only served-sequence STRUCTURE analytics — pure-aggregation contract.
//
// Covers computeExposureSkew / computePeriodicity / computeRuns against
// synthetic chains: normal mix, empty, single record, sparse/legacy (no
// techniques, unparseable timestamps), a SYNTHETIC known-period series (ACF
// must find the period), and a clear run. These functions are READ-ONLY:
// every assertion derives only from signed fields, so it doubles as a
// recompute contract a verifier could mirror.

import { describe, it, expect } from 'vitest';
import {
  computeNarrativePressureSignals,
  computeExposureSkew,
  computePeriodicity,
  computeRuns,
  dominantTechnique,
} from '../../../src/forensics/sequence';
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
    postUrl: 'https://x.com/stub/status/0',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'for-you',
    integrityHash: 'stub-integrity',
    ...overrides,
  };
}

/** One record per UTC day starting at `startDay`, with the given severity. */
function dayRec(startDay: number, severity: number, id: string): ForensicRecord {
  const ts = new Date(Date.UTC(2026, 0, startDay, 12, 0, 0)).toISOString();
  return rec({
    id,
    timestamp: ts,
    techniques: severity > 0 ? [{ name: 'shame-attack', severity, confidence: 0.9 }] : [],
  });
}

describe('dominantTechnique', () => {
  it('picks the highest-severity technique', () => {
    const r = rec({
      techniques: [
        { name: 'fear-appeal', severity: 2, confidence: 0.8 },
        { name: 'shame-attack', severity: 5, confidence: 0.9 },
      ],
    });
    expect(dominantTechnique(r)).toBe('shame-attack');
  });

  it('returns null for no/empty techniques (legacy)', () => {
    expect(dominantTechnique(rec({ techniques: [] }))).toBeNull();
    expect(dominantTechnique(rec({ techniques: undefined }))).toBeNull();
  });
});

describe('computeExposureSkew', () => {
  it('measures share + KL-from-uniform over technique and feedSource', () => {
    // 3 shame-attack + 1 fear-appeal → lopsided technique axis.
    const records: ForensicRecord[] = [
      rec({ id: 'a', feedSource: 'for-you', techniques: [{ name: 'shame-attack', severity: 4, confidence: 0.9 }] }),
      rec({ id: 'b', feedSource: 'for-you', techniques: [{ name: 'shame-attack', severity: 4, confidence: 0.9 }] }),
      rec({ id: 'c', feedSource: 'for-you', techniques: [{ name: 'shame-attack', severity: 4, confidence: 0.9 }] }),
      rec({ id: 'd', feedSource: 'following', techniques: [{ name: 'fear-appeal', severity: 4, confidence: 0.9 }] }),
    ];
    const s = computeExposureSkew(records);
    expect(s.total).toBe(4);
    expect(s.byTechnique.counts).toEqual({ 'shame-attack': 3, 'fear-appeal': 1 });
    expect(s.byTechnique.shares['shame-attack']).toBeCloseTo(0.75, 6);
    expect(s.byTechnique.categories).toBe(2);
    expect(s.byTechnique.divergenceFromUniform).toBeGreaterThan(0);
    // feedSource: 3 for-you / 1 following, same lopsided shape.
    expect(s.byFeedSource.counts).toEqual({ 'for-you': 3, following: 1 });
  });

  it('reports zero divergence for a perfectly even split', () => {
    const records: ForensicRecord[] = [
      rec({ id: 'a', techniques: [{ name: 'shame-attack', severity: 4, confidence: 0.9 }] }),
      rec({ id: 'b', techniques: [{ name: 'fear-appeal', severity: 4, confidence: 0.9 }] }),
    ];
    const s = computeExposureSkew(records);
    expect(s.byTechnique.divergenceFromUniform).toBeCloseTo(0, 9);
  });

  it('returns zero divergence for a single category', () => {
    const s = computeExposureSkew([rec({ techniques: [{ name: 'x', severity: 2, confidence: 0.9 }] })]);
    expect(s.byTechnique.categories).toBe(1);
    expect(s.byTechnique.divergenceFromUniform).toBe(0);
  });

  it('tolerates empty input', () => {
    const s = computeExposureSkew([]);
    expect(s.total).toBe(0);
    expect(s.byTechnique.shares).toEqual({});
    expect(s.byTechnique.divergenceFromUniform).toBe(0);
  });

  it('excludes non-exposure records and counts legacy (no technique) on the feed axis only', () => {
    const records: ForensicRecord[] = [
      rec({ id: 'flag', techniques: [{ name: 'shame-attack', severity: 4, confidence: 0.9 }] }),
      rec({ id: 'legacy', techniques: [] }), // exposure (undefined verdict), no dominant technique
      rec({ id: 'skip', verdict: 'skipped' }),
    ];
    const s = computeExposureSkew(records);
    expect(s.total).toBe(2); // flag + legacy, skip excluded
    expect(s.byTechnique.counts).toEqual({ 'shame-attack': 1 }); // legacy has no technique
    expect(s.byFeedSource.counts).toEqual({ 'for-you': 2 }); // both on for-you
  });
});

describe('computePeriodicity', () => {
  it('returns insufficient when too few days observed', () => {
    const records = [dayRec(1, 4, 'a'), dayRec(2, 4, 'b'), dayRec(3, 4, 'c')];
    const p = computePeriodicity(records, { maxLagDays: 7 }); // needs ≥14 days
    expect(p.insufficient).toBe(true);
    expect(p.daysObserved).toBe(3);
    expect(p.acf).toEqual([]);
  });

  it('finds a synthetic 7-day period via ACF peak', () => {
    // 6 weeks of data: a strong spike every 7th day, quiet otherwise.
    const records: ForensicRecord[] = [];
    for (let d = 1; d <= 42; d++) {
      const severity = d % 7 === 1 ? 10 : 1; // spike on days 1, 8, 15, ...
      records.push(dayRec(d, severity, `d${d}`));
    }
    const p = computePeriodicity(records, { maxLagDays: 14 });
    expect(p.insufficient).toBe(false);
    expect(p.daysObserved).toBe(42);
    // ACF at lag 7 should be a clear peak; lag-7 index is 6.
    expect(p.acf[6]).toBeGreaterThan(0.3);
    expect(p.peakLags).toContain(7);
  });

  it('returns no peaks for a flat (zero-variance) series', () => {
    // Every day identical severity → variance 0 → ACF undefined → empty.
    const records: ForensicRecord[] = [];
    for (let d = 1; d <= 30; d++) records.push(dayRec(d, 4, `d${d}`));
    const p = computePeriodicity(records, { maxLagDays: 7 });
    expect(p.insufficient).toBe(false);
    expect(p.acf).toEqual([]);
    expect(p.peakLags).toEqual([]);
  });

  it('tolerates empty input', () => {
    const p = computePeriodicity([]);
    expect(p.insufficient).toBe(true);
    expect(p.daysObserved).toBe(0);
  });
});

describe('computeRuns', () => {
  it('detects a clear technique run and a high-severity run', () => {
    // 3 consecutive shame-attack (severity 6 ⇒ also high-severity), then a break.
    const records: ForensicRecord[] = [
      rec({ id: '1', timestamp: '2026-05-09T01:00:00.000Z', techniques: [{ name: 'shame-attack', severity: 6, confidence: 0.9 }] }),
      rec({ id: '2', timestamp: '2026-05-09T02:00:00.000Z', techniques: [{ name: 'shame-attack', severity: 6, confidence: 0.9 }] }),
      rec({ id: '3', timestamp: '2026-05-09T03:00:00.000Z', techniques: [{ name: 'shame-attack', severity: 7, confidence: 0.9 }] }),
      rec({ id: '4', timestamp: '2026-05-09T04:00:00.000Z', techniques: [{ name: 'fear-appeal', severity: 2, confidence: 0.9 }] }),
    ];
    const runs = computeRuns(records);
    const tech = runs.find(r => r.kind === 'shame-attack');
    expect(tech).toBeDefined();
    expect(tech!.length).toBe(3);
    expect(tech!.startTs).toBe('2026-05-09T01:00:00.000Z');
    expect(tech!.endTs).toBe('2026-05-09T03:00:00.000Z');
    const high = runs.find(r => r.kind === 'high-severity');
    expect(high).toBeDefined();
    expect(high!.length).toBe(3);
  });

  it('ignores runs shorter than 2 and orders by length desc', () => {
    const records: ForensicRecord[] = [
      rec({ id: '1', timestamp: '2026-05-09T01:00:00.000Z', techniques: [{ name: 'a', severity: 2, confidence: 0.9 }] }),
      rec({ id: '2', timestamp: '2026-05-09T02:00:00.000Z', techniques: [{ name: 'b', severity: 2, confidence: 0.9 }] }),
      rec({ id: '3', timestamp: '2026-05-09T03:00:00.000Z', techniques: [{ name: 'b', severity: 2, confidence: 0.9 }] }),
    ];
    const runs = computeRuns(records);
    // Only the b-run (length 2) qualifies; the lone 'a' does not.
    expect(runs.map(r => r.kind)).toEqual(['b']);
    expect(runs[0].length).toBe(2);
  });

  it('walks records in timestamp order regardless of input order', () => {
    const records: ForensicRecord[] = [
      rec({ id: '2', timestamp: '2026-05-09T02:00:00.000Z', techniques: [{ name: 'x', severity: 2, confidence: 0.9 }] }),
      rec({ id: '1', timestamp: '2026-05-09T01:00:00.000Z', techniques: [{ name: 'x', severity: 2, confidence: 0.9 }] }),
    ];
    const runs = computeRuns(records);
    expect(runs).toHaveLength(1);
    expect(runs[0].startTs).toBe('2026-05-09T01:00:00.000Z');
  });

  it('tolerates empty and single-record input', () => {
    expect(computeRuns([])).toEqual([]);
    expect(computeRuns([rec({ techniques: [{ name: 'x', severity: 2, confidence: 0.9 }] })])).toEqual([]);
  });
});

describe('computeNarrativePressureSignals', () => {
  const motifRec = (
    id: string,
    platform: ForensicRecord['platform'],
    hour: number,
    technique: string,
    severity: number,
  ) => rec({
    id,
    platform,
    timestamp: `2026-05-09T${String(hour).padStart(2, '0')}:00:00.000Z`,
    techniques: [{ name: technique, severity, confidence: 0.9 }],
  });

  it('computes escalation per platform and prefers theme assignment when available', () => {
    const records: ForensicRecord[] = [
      motifRec('tw-1', 'twitter', 1, 'fear-appeal', 2),
      motifRec('yt-1', 'youtube', 1, 'fear-appeal', 8),
      motifRec('tw-2', 'twitter', 2, 'fear-appeal', 5),
      motifRec('yt-2', 'youtube', 2, 'fear-appeal', 8),
      motifRec('tw-3', 'twitter', 3, 'fear-appeal', 8),
      motifRec('yt-3', 'youtube', 3, 'fear-appeal', 8),
    ];
    const themeAssignment = new Map(records.map((r) => [r.id, 'venezuela-thread']));
    const out = computeNarrativePressureSignals(records, {
      themeAssignment,
      themeLabels: new Map([['venezuela-thread', 'Venezuela']]),
    });

    const twitter = out.platforms.find((p) => p.platform === 'twitter')!;
    const youtube = out.platforms.find((p) => p.platform === 'youtube')!;
    expect(twitter.exposureCount).toBe(3);
    expect(youtube.exposureCount).toBe(3);
    expect(twitter.escalatingMotifs).toHaveLength(1);
    expect(twitter.escalatingMotifs[0]).toMatchObject({
      motifKey: 'theme:venezuela-thread',
      motifLabel: 'Venezuela',
      axis: 'theme',
      firstSeverity: 2,
      lastSeverity: 8,
      delta: 6,
    });
    expect(youtube.escalatingMotifs).toEqual([]);
  });

  it('measures rolling entropy collapse as the served mix narrows', () => {
    const records: ForensicRecord[] = [
      motifRec('r1', 'tiktok', 1, 'fear-appeal', 3),
      motifRec('r2', 'tiktok', 2, 'shame-attack', 3),
      motifRec('r3', 'tiktok', 3, 'scapegoating', 3),
      motifRec('r4', 'tiktok', 4, 'fomo', 3),
      motifRec('r5', 'tiktok', 5, 'fear-appeal', 3),
      motifRec('r6', 'tiktok', 6, 'fear-appeal', 3),
      motifRec('r7', 'tiktok', 7, 'fear-appeal', 3),
      motifRec('r8', 'tiktok', 8, 'fear-appeal', 3),
    ];
    const tiktok = computeNarrativePressureSignals(records, { entropyWindow: 4 }).platforms[0];

    expect(tiktok.diversityCollapse.startEntropy).toBeCloseTo(Math.log(4), 6);
    expect(tiktok.diversityCollapse.endEntropy).toBe(0);
    expect(tiktok.diversityCollapse.dropFromStart).toBeCloseTo(Math.log(4), 6);
    expect(tiktok.diversityCollapse.normalizedDropFromStart).toBeCloseTo(1, 6);
  });

  it('tracks the quiet-gap return interval for a recurring motif', () => {
    const records: ForensicRecord[] = [
      motifRec('r1', 'instagram', 0, 'body-comparison-priming', 4),
      motifRec('r2', 'instagram', 1, 'body-comparison-priming', 4),
      motifRec('r3', 'instagram', 3, 'fear-appeal', 5),
      motifRec('r4', 'instagram', 7, 'body-comparison-priming', 7),
    ];
    const instagram = computeNarrativePressureSignals(records, { quietGapHours: 4 }).platforms[0];

    expect(instagram.quietGapReturns).toHaveLength(1);
    expect(instagram.quietGapReturns[0]).toMatchObject({
      motifKey: 'technique:body-comparison-priming',
      gapHours: 6,
      previousSeverity: 4,
      returnSeverity: 7,
      recordIds: ['r2', 'r4'],
    });
  });

  it('reports trigger volatility as rapid motif switching, not severity average', () => {
    const records: ForensicRecord[] = [
      motifRec('r1', 'facebook', 1, 'fear-appeal', 6),
      motifRec('r2', 'facebook', 2, 'shame-attack', 6),
      motifRec('r3', 'facebook', 3, 'scapegoating', 6),
      motifRec('r4', 'facebook', 4, 'fear-appeal', 6),
      motifRec('r5', 'facebook', 5, 'shame-attack', 6),
    ];
    const facebook = computeNarrativePressureSignals(records).platforms[0];

    expect(facebook.triggerVolatility.transitionCount).toBe(4);
    expect(facebook.triggerVolatility.switchCount).toBe(4);
    expect(facebook.triggerVolatility.switchRate).toBe(1);
    expect(facebook.triggerVolatility.distinctStates).toBe(3);
    expect(facebook.triggerVolatility.longestStableRun).toBe(1);
  });
});

