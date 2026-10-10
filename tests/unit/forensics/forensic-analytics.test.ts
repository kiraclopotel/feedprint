// Read-only forensic analytics — pure-aggregation contract.
//
// Covers computeExposureTimeline / computeAmplificationTrend /
// computeAuthorEscalation against synthetic chains:
// normal mix, empty input, legacy records missing metrics/environment,
// single-bucket, and the escalation rule both true and false. These functions
// are READ-ONLY: they derive only from fields already on the signed record, so
// the assertions double as a recompute contract a verifier could mirror.
// (computeEvidenceSummary deleted 2026-07-14 — superseded by the HTML
// export's client-side EXPOSURE_SCRIPT rollup; see analytics.ts tail note.)

import { describe, it, expect } from 'vitest';
import {
  computeExposureTimeline,
  computeAmplificationTrend,
  computeAuthorEscalation,
} from '../../../src/forensics/analytics';
import type { ForensicRecord } from '../../../src/types/forensic';
import type { AuthorProfile } from '../../../src/forensics/author-store';

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

describe('computeExposureTimeline', () => {
  it('buckets a normal mix by day with severity + breakdowns', () => {
    const records: ForensicRecord[] = [
      rec({
        id: 'a',
        timestamp: '2026-05-09T01:00:00.000Z',
        platform: 'twitter',
        feedSource: 'for-you',
        techniques: [{ name: 'shame-attack', severity: 4, confidence: 0.9 }],
      }),
      rec({
        id: 'b',
        timestamp: '2026-05-09T20:00:00.000Z',
        platform: 'tiktok',
        feedSource: 'following',
        techniques: [
          { name: 'shame-attack', severity: 3, confidence: 0.8 },
          { name: 'fear-appeal', severity: 2, confidence: 0.7 },
        ],
      }),
      rec({
        id: 'c',
        timestamp: '2026-05-10T05:00:00.000Z',
        platform: 'twitter',
        techniques: [{ name: 'fear-appeal', severity: 5, confidence: 0.9 }],
      }),
      // Non-exposure verdicts must NOT be counted.
      rec({ id: 'skip', timestamp: '2026-05-09T02:00:00.000Z', verdict: 'skipped', skipReason: 'too-short' }),
      rec({ id: 'pass', timestamp: '2026-05-09T03:00:00.000Z', verdict: 'pass' }),
    ];

    const t = computeExposureTimeline(records, { bucket: 'day' });
    expect(t.bucketSize).toBe('day');
    expect(t.total).toBe(3);
    expect(t.buckets.map(b => b.bucket)).toEqual(['2026-05-09', '2026-05-10']);

    const d09 = t.buckets[0];
    expect(d09.count).toBe(2);
    expect(d09.severitySum).toBe(4 + 3 + 2); // 9
    expect(d09.byTechnique).toEqual({ 'shame-attack': 2, 'fear-appeal': 1 });
    expect(d09.byPlatform).toEqual({ twitter: 1, tiktok: 1 });
    expect(d09.byFeedSource).toEqual({ 'for-you': 1, following: 1 });

    const d10 = t.buckets[1];
    expect(d10.count).toBe(1);
    expect(d10.severitySum).toBe(5);
  });

  it('treats undefined verdict as flagged (legacy back-compat)', () => {
    const t = computeExposureTimeline([rec({ verdict: undefined })]);
    expect(t.total).toBe(1);
  });

  it('returns an empty timeline on empty input', () => {
    const t = computeExposureTimeline([]);
    expect(t.total).toBe(0);
    expect(t.buckets).toEqual([]);
    expect(t.undatedCount).toBe(0);
  });

  it('collapses a single-bucket day and counts undated records separately', () => {
    const records: ForensicRecord[] = [
      rec({ id: 'a', timestamp: '2026-05-09T01:00:00.000Z' }),
      rec({ id: 'b', timestamp: '2026-05-09T23:00:00.000Z' }),
      rec({ id: 'bad', timestamp: 'not-a-date' }),
    ];
    const t = computeExposureTimeline(records, { bucket: 'day' });
    expect(t.buckets).toHaveLength(1);
    expect(t.buckets[0].count).toBe(2);
    expect(t.undatedCount).toBe(1);
  });

  it('buckets by ISO week (Monday start, UTC)', () => {
    // 2026-05-09 is a Saturday; 2026-05-11 is the following Monday.
    const records: ForensicRecord[] = [
      rec({ id: 'sat', timestamp: '2026-05-09T12:00:00.000Z' }),
      rec({ id: 'sun', timestamp: '2026-05-10T12:00:00.000Z' }),
      rec({ id: 'mon', timestamp: '2026-05-11T12:00:00.000Z' }),
    ];
    const t = computeExposureTimeline(records, { bucket: 'week' });
    // Sat+Sun belong to the week starting Mon 2026-05-04; Mon starts 2026-05-11.
    expect(t.buckets.map(b => b.bucket)).toEqual(['2026-05-04', '2026-05-11']);
    expect(t.buckets[0].count).toBe(2);
    expect(t.buckets[1].count).toBe(1);
  });

  it('handles legacy records with no techniques without throwing', () => {
    const t = computeExposureTimeline([rec({ techniques: [] })]);
    expect(t.buckets[0].severitySum).toBe(0);
    expect(t.buckets[0].byTechnique).toEqual({});
  });
});

describe('computeAmplificationTrend', () => {
  // The amplification LABEL lives on the environment record and nowhere else.
  // This test used to hang it on flagged records — a shape no writer produces,
  // because logger.ts writes an environment record with kind 'environment' and
  // verdict 'pass'. The production code read the label off exposure records,
  // which never carry one, so every label resolved to 'unknown' and the
  // dashboard card was permanently "no data"; the fixture hid that by inventing
  // a record the product cannot make. Labels come from environment records now
  // and the ratio still comes from the exposure records' own metrics.
  it('distributes amplification labels and computes mean views/like', () => {
    const room = (id: string, timestamp: string, amp: 'high' | 'normal' | 'low' | 'unknown'): ForensicRecord =>
      rec({
        id, timestamp, kind: 'environment', verdict: 'pass',
        environment: {
          label: 'unknown', summary: '', dominantTechnique: null,
          negativePct: 0, positivePct: 0, neutralPct: 0, sampled: 0,
          algorithmicAmplification: amp,
        },
      });
    const records: ForensicRecord[] = [
      room('env-a', '2026-05-09T01:00:00.000Z', 'high'),
      room('env-b', '2026-05-09T02:00:00.000Z', 'normal'),
      room('env-c', '2026-05-09T03:00:00.000Z', 'unknown'),
      rec({ id: 'a', timestamp: '2026-05-09T01:00:00.000Z', metrics: { views: 14000, primary_likes: 100 } }), // ratio 140
      rec({ id: 'b', timestamp: '2026-05-09T02:00:00.000Z', metrics: { views: 6000, primary_likes: 100 } }),  // ratio 60
      // Legacy: no metrics → no ratio.
      rec({ id: 'c', timestamp: '2026-05-09T03:00:00.000Z' }),
    ];
    const t = computeAmplificationTrend(records);
    expect(t.buckets).toHaveLength(1);
    const b = t.buckets[0];
    expect(b.amplificationLabels).toEqual({ high: 1, normal: 1, low: 0, unknown: 1 });
    expect(b.ratioSampleSize).toBe(2);
    expect(b.meanViewsPerLike).toBeCloseTo((140 + 60) / 2, 6); // 100
  });

  it('detects repeated posts and ranks by max views/like (140x organic view)', () => {
    const url = 'https://x.com/acct/status/777';
    const records: ForensicRecord[] = [
      rec({ id: 'a', postUrl: url, timestamp: '2026-05-09T01:00:00.000Z', metrics: { views: 14000, primary_likes: 100 } }),
      rec({ id: 'b', postUrl: url, timestamp: '2026-05-10T01:00:00.000Z', metrics: { views: 28000, primary_likes: 100 } }),
      rec({ id: 'c', postUrl: 'https://x.com/acct/status/1', timestamp: '2026-05-09T01:00:00.000Z' }),
    ];
    const t = computeAmplificationTrend(records);
    expect(t.repeatedPosts).toHaveLength(1);
    expect(t.repeatedPosts[0].postUrl).toBe(url);
    expect(t.repeatedPosts[0].sightings).toBe(2);
    expect(t.repeatedPosts[0].maxViewsPerLike).toBe(280); // max(140, 280)
  });

  it('uses comment likes when primary_likes absent and skips zero-like ratios', () => {
    const records: ForensicRecord[] = [
      rec({ id: 'a', timestamp: '2026-05-09T01:00:00.000Z', metrics: { views: 500, likes: 10 } }), // ratio 50
      rec({ id: 'b', timestamp: '2026-05-09T02:00:00.000Z', metrics: { views: 500, likes: 0 } }), // skipped (div0)
    ];
    const t = computeAmplificationTrend(records);
    expect(t.buckets[0].ratioSampleSize).toBe(1);
    expect(t.buckets[0].meanViewsPerLike).toBe(50);
  });

  it('returns empty on empty input', () => {
    const t = computeAmplificationTrend([]);
    expect(t.buckets).toEqual([]);
    expect(t.repeatedPosts).toEqual([]);
  });
});

describe('computeAuthorEscalation', () => {
  function profile(overrides: Partial<AuthorProfile>): AuthorProfile {
    return {
      profileKey: 'twitter|@a',
      handle: '@a',
      platform: 'twitter',
      totalSeen: 0,
      totalFlagged: 0,
      techniques: {},
      firstSeen: '2026-05-01T00:00:00.000Z',
      lastSeen: '2026-05-09T00:00:00.000Z',
      ...overrides,
    };
  }

  it('flags an escalating repeat offender (rule TRUE)', () => {
    const handle = '@bully';
    // 6 records, severity rising over time: earlier half low, later half high.
    const records: ForensicRecord[] = [
      rec({ id: '1', author: handle, timestamp: '2026-05-01T00:00:00.000Z', techniques: [{ name: 'shame-attack', severity: 1, confidence: 0.9 }] }),
      rec({ id: '2', author: handle, timestamp: '2026-05-02T00:00:00.000Z', techniques: [{ name: 'shame-attack', severity: 1, confidence: 0.9 }] }),
      rec({ id: '3', author: handle, timestamp: '2026-05-03T00:00:00.000Z', techniques: [{ name: 'shame-attack', severity: 2, confidence: 0.9 }] }),
      rec({ id: '4', author: handle, timestamp: '2026-05-07T00:00:00.000Z', techniques: [{ name: 'shame-attack', severity: 5, confidence: 0.9 }] }),
      rec({ id: '5', author: handle, timestamp: '2026-05-08T00:00:00.000Z', techniques: [{ name: 'shame-attack', severity: 5, confidence: 0.9 }] }),
      rec({ id: '6', author: handle, timestamp: '2026-05-09T00:00:00.000Z', techniques: [{ name: 'shame-attack', severity: 6, confidence: 0.9 }] }),
    ];
    const profiles = [profile({ handle, totalSeen: 10, totalFlagged: 8, techniques: { 'shame-attack': 6, 'fear-appeal': 2 } })];
    const out = computeAuthorEscalation(records, profiles);
    expect(out).toHaveLength(1);
    const e = out[0];
    expect(e.flagRate).toBeCloseTo(0.8, 6);
    expect(e.dominantTechniques[0]).toEqual({ name: 'shame-attack', count: 6 });
    expect(e.severityTrend).toBe('rising');
    expect(e.escalating).toBe(true);
  });

  it('does not flag a flat or low-flag-rate author (rule FALSE)', () => {
    const handle = '@calm';
    // Flat severity across 4 records.
    const records: ForensicRecord[] = [
      rec({ id: '1', author: handle, timestamp: '2026-05-01T00:00:00.000Z', techniques: [{ name: 'fear-appeal', severity: 2, confidence: 0.9 }] }),
      rec({ id: '2', author: handle, timestamp: '2026-05-02T00:00:00.000Z', techniques: [{ name: 'fear-appeal', severity: 2, confidence: 0.9 }] }),
      rec({ id: '3', author: handle, timestamp: '2026-05-03T00:00:00.000Z', techniques: [{ name: 'fear-appeal', severity: 2, confidence: 0.9 }] }),
      rec({ id: '4', author: handle, timestamp: '2026-05-04T00:00:00.000Z', techniques: [{ name: 'fear-appeal', severity: 2, confidence: 0.9 }] }),
    ];
    // High flag rate + enough sightings, but severity is flat → not escalating.
    const flat = profile({ handle, totalSeen: 10, totalFlagged: 9 });
    // Low flag rate even though severity could rise → not escalating.
    const lowRate = profile({ handle: '@occasional', totalSeen: 10, totalFlagged: 2 });
    const out = computeAuthorEscalation(records, [flat, lowRate]);
    const calm = out.find(e => e.handle === handle)!;
    expect(calm.severityTrend).toBe('flat');
    expect(calm.escalating).toBe(false);
    const occ = out.find(e => e.handle === '@occasional')!;
    expect(occ.escalating).toBe(false);
  });

  it('marks insufficient-data when an author has fewer than 4 chain records', () => {
    const profiles = [profile({ handle: '@new', totalSeen: 6, totalFlagged: 5 })];
    const out = computeAuthorEscalation([], profiles);
    expect(out[0].severityTrend).toBe('insufficient-data');
    expect(out[0].severityDelta).toBeNull();
    expect(out[0].escalating).toBe(false);
  });

  it('returns empty on empty profiles', () => {
    expect(computeAuthorEscalation([rec({})], [])).toEqual([]);
  });

  it('scopes record matching by platform (M18 composite key) — same handle on two platforms never merges', () => {
    const handle = '@news';
    // Twitter '@news': rising severity. Facebook '@news': a different real
    // account with only 2 records (insufficient for a trend). A raw-handle
    // match would hand BOTH profiles the merged 6-record list and invent a
    // trend for the Facebook account out of the Twitter account's records.
    const records: ForensicRecord[] = [
      rec({ id: 't1', author: handle, platform: 'twitter', timestamp: '2026-05-01T00:00:00.000Z', techniques: [{ name: 'fear-appeal', severity: 1, confidence: 0.9 }] }),
      rec({ id: 't2', author: handle, platform: 'twitter', timestamp: '2026-05-02T00:00:00.000Z', techniques: [{ name: 'fear-appeal', severity: 1, confidence: 0.9 }] }),
      rec({ id: 't3', author: handle, platform: 'twitter', timestamp: '2026-05-03T00:00:00.000Z', techniques: [{ name: 'fear-appeal', severity: 5, confidence: 0.9 }] }),
      rec({ id: 't4', author: handle, platform: 'twitter', timestamp: '2026-05-04T00:00:00.000Z', techniques: [{ name: 'fear-appeal', severity: 5, confidence: 0.9 }] }),
      rec({ id: 'f1', author: handle, platform: 'facebook', timestamp: '2026-05-01T00:00:00.000Z', techniques: [{ name: 'fear-appeal', severity: 1, confidence: 0.9 }] }),
      rec({ id: 'f2', author: handle, platform: 'facebook', timestamp: '2026-05-02T00:00:00.000Z', techniques: [{ name: 'fear-appeal', severity: 1, confidence: 0.9 }] }),
    ];
    const out = computeAuthorEscalation(records, [
      profile({ handle, platform: 'twitter', totalSeen: 8, totalFlagged: 6 }),
      profile({ handle, platform: 'facebook', totalSeen: 4, totalFlagged: 2 }),
    ]);
    const tw = out.find(e => e.platform === 'twitter')!;
    const fb = out.find(e => e.platform === 'facebook')!;
    expect(tw.severityTrend).toBe('rising');
    // 2 facebook records < 4 minimum: must be insufficient-data, NOT a trend
    // borrowed from the twitter account's records.
    expect(fb.severityTrend).toBe('insufficient-data');
    expect(fb.severityDelta).toBeNull();
  });
});

