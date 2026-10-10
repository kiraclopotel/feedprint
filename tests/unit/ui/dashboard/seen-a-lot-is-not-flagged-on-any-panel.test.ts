// The Head's HOLD on 15d99ef2 (10 Oct 2026): the Flagged tile left "seen a lot" out, but the per-platform bars, the
// techniques-observed tile, an archived month's summary and the Activity filters still counted it, so the page
// disagreed with itself. On a fixture with one seen-a-lot item, every one of them agrees with the Flagged tile.

import { describe, expect, it } from 'vitest';
import type { ForensicRecord } from '../../../../src/types/forensic';
import { computeStats } from '../../../../src/forensics/store';
import { summarizeMonth, MONTH_SUMMARY_VERSION } from '../../../../src/forensics/archive-summary';
import { countRecordSets, isFlaggedVerdict } from '../../../../src/ui/dashboard/record-sets';
import { matchesTypeFilter } from '../../../../src/ui/dashboard/components/feed-filters';

let n = 0;
function rec(over: Partial<ForensicRecord>): ForensicRecord {
  n++;
  return {
    id: `r${n}`, chainPosition: n, timestamp: `2026-10-0${1 + (n % 8)}T10:00:00.000Z`, kind: 'post',
    platform: 'facebook', originalText: 'text', verdict: 'pass', techniques: [], ...over,
  } as unknown as ForensicRecord;
}

// By hand: two flags read from the content (fear appeal on Facebook, shame attack on X), one item seen a lot (a
// repeat-exposure mark alone, on Instagram), two passes. Flagged = 2, seen a lot = 1.
const records = [
  rec({ verdict: 'flagged', techniques: [{ name: 'fear-appeal', severity: 7, confidence: 0.9 }] as never }),
  rec({ verdict: 'flagged', platform: 'twitter', techniques: [{ name: 'shame-attack', severity: 5, confidence: 0.8 }] as never }),
  rec({ verdict: 'flagged', platform: 'instagram', techniques: [{ name: 'repeat-exposure', severity: 6, confidence: 1 }] as never }),
  rec({}), rec({ platform: 'instagram' }),
];

describe('"seen a lot" is not flagged on any panel', () => {
  it('the Flagged tile: 2 flagged, 1 seen a lot', () => {
    const sets = countRecordSets(records);
    expect(sets.flagged).toBe(2);
    expect(sets.seenALot).toBe(1);
  });

  it('the per-platform bars and the techniques-observed tile agree with it', () => {
    const stats = computeStats(records);
    expect(stats.total).toBe(2);
    expect(stats.byPlatform).toEqual({ facebook: 1, twitter: 1 });
    expect(Object.keys(stats.byTechnique).sort()).toEqual(['fear-appeal', 'shame-attack']);
  });

  it('an archived month agrees with it, and is counted again under the new version', () => {
    const month = summarizeMonth('2026-10', records);
    expect(month.flagged).toBe(2);
    expect(month.byPlatform.instagram ?? 0).toBe(0);
    expect(month.byTechnique['repeat-exposure'] ?? 0).toBe(0);
    expect(Object.values(month.flaggedByHour).reduce((a, b) => a + b, 0)).toBe(2);
    expect(MONTH_SUMMARY_VERSION).toBeGreaterThanOrEqual(4);
  });

  it('the shared flag check and the Activity feed\'s AI filter leave it out', () => {
    expect(records.filter(isFlaggedVerdict).length).toBe(2);
    const cloud = records.map(r => ({ ...r, aiSource: 'cloud' }) as ForensicRecord);
    expect(cloud.filter(r => matchesTypeFilter(r, 'ai')).length).toBe(2);
  });
});
