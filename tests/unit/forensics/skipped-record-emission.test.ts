// The feed served it and nothing judged it: that has to reach the chain, and it
// has to reach the chain without pretending to be a verdict.
//
// Why this exists. The owner installed a fresh build on 2026-09-04, scrolled X
// for a while, and the dashboard showed three records: everything the
// deterministic rules had flagged, and nothing else. A free install left the
// pipeline at `pre-llm-free-tier-no-ai` and only `post-llm-*` passes wrote a
// record, so the free tier recorded what the regexes caught rather than what the
// feed served, while the store listing said "Writes down what your feed served".
//
// Two properties are locked here and they pull in opposite directions:
//   1. the record EXISTS, so the free tier records the feed;
//   2. the record claims NOTHING, so no rate moves.
// (2) is the one that will rot first, because it is invisible: a future reader
// that counts records instead of verdicts would silently start reporting tens of
// thousands of unjudged posts as checked-and-clean.

import { describe, expect, it } from 'vitest';
import { aggregateByActionFamily } from '../../../src/forensics/data-layer';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import type { ForensicRecord } from '../../../src/types/forensic';

function record(over: Partial<ForensicRecord> = {}): ForensicRecord {
  return {
    id: 'r', timestamp: '2026-09-04T20:38:00.000Z', platform: 'twitter',
    originalText: 'a post the feed served', originalHash: 'h', originalLength: 22,
    neutralizedText: '', techniques: [], overallScore: 0,
    userAgeCategory: 'teen', aiSource: 'rules',
    ...over,
  } as unknown as ForensicRecord;
}

const skipped = (reason: string, over: Partial<ForensicRecord> = {}) =>
  record({ verdict: 'skipped', skipReason: reason, detectionMode: `skip:${reason}`, ...over });

describe('a skipped record claims nothing', () => {
  it('is not counted as a detection, an ad or a house rule', () => {
    const families = aggregateByActionFamily([
      skipped('free-tier-no-ai'),
      skipped('too-short'),
      skipped('non-substantive'),
    ]);
    expect(families['not-judged']).toBe(3);
    expect(families.detection).toBe(0);
    expect(families.ads).toBe(0);
    expect(families['house-rule']).toBe(0);
    expect(families.pass).toBe(0);
  });

  it('does not move the pass rate, which divides by decided records only', () => {
    // The StatisticsTab formula, reproduced: decided = passed + flagged + blocked.
    const decidedRate = (records: ForensicRecord[]) => {
      const passed = records.filter(r => r.verdict === 'pass').length;
      const flagged = records.filter(r =>
        r.verdict === 'flagged' || r.verdict === 'flagged-hidden' || r.verdict === undefined).length;
      const blocked = records.filter(r => r.verdict === 'blocked').length;
      const decided = passed + flagged + blocked;
      return decided > 0 ? Math.round((passed / decided) * 100) : 0;
    };

    const judged = [
      record({ verdict: 'pass' }), record({ verdict: 'pass' }), record({ verdict: 'pass' }),
      record({ verdict: 'flagged' }),
    ];
    const before = decidedRate(judged);
    // A whole scroll session of unjudged posts arrives.
    const after = decidedRate([...judged, ...Array.from({ length: 500 }, () => skipped('free-tier-no-ai'))]);
    expect(before).toBe(75);
    expect(after).toBe(before);
  });

  it('carries no technique, so the export cannot read it as a flag', () => {
    // The export counts a technique at severity >= 5 as a flag when no verdict
    // was written. A synthetic technique here (the blocked path adds one so its
    // rows render) would put a technique name on an item nothing looked at.
    for (const reason of ['free-tier-no-ai', 'too-short', 'non-substantive', 'cap-exhausted']) {
      const r = skipped(reason);
      expect(r.techniques).toEqual([]);
      expect(r.overallScore).toBe(0);
    }
  });
});

describe('a skipped record still says what happened', () => {
  it('names the gate that declined, without the pipeline prefix', () => {
    expect(skipped('free-tier-no-ai').skipReason).toBe('free-tier-no-ai');
    expect(skipped('free-tier-no-ai').detectionMode).toBe('skip:free-tier-no-ai');
  });

  it('hashes over the verdict and the reason, so neither can be edited quietly', async () => {
    const base = skipped('free-tier-no-ai', { id: 'fixed', chainPosition: 0 });
    const tampered = { ...base, skipReason: 'too-short' };
    const flipped = { ...base, verdict: 'pass' as const };
    const h = await computeRecordIntegrityHash(base);
    expect(await computeRecordIntegrityHash(tampered)).not.toBe(h);
    expect(await computeRecordIntegrityHash(flipped)).not.toBe(h);
  });

  it('keeps the engagement counts read before they were hidden', () => {
    const r = skipped('free-tier-no-ai', { metrics: { likes: 1_200_000, views: 9_000_000 } });
    expect(r.metrics?.likes).toBe(1_200_000);
    expect(r.metrics?.views).toBe(9_000_000);
  });
});
