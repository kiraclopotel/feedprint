// The hourly chart said an ad was blocked. The total beside it said it was not.
//
// usageBand reads a paid placement as blocked, because the Block Ads rule hides
// ads and a rule-hidden thing belongs in the blocked band. That is a standing
// decision from 14 September and it is right, for an ad that was hidden.
//
// Block Ads can be off. pipeline.ts says in its own comment what happens then:
// an adult-mode ad enters the record "as a pass under the sponsored row with a
// note when Block Ads is OFF". usageBand checked isPaidPlacement before it
// looked at the verdict, so that record banded as blocked anyway.
//
// One record, one pass over the data, two answers. addRecordsToSummary calls
// usageBand for the hourly chart and then, eleven lines further down in the
// same loop, counts the month's blocked total with
// `isPaidPlacement(r) && r.verdict !== 'pass'`, which excludes exactly this
// record. A parent reading the hourly chart to answer "is Block Ads doing
// anything" was shown a yes, on the evidence of an ad their own setting had let
// through.
//
// The existing suite could not see it: its fixture never sets detectionMode or
// the rails, so isPaidPlacement is false for every record in it and this branch
// is never reached. That is the coverage-artifact shape the protection rule
// names, on a different surface.

import { describe, expect, it } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';
import { usageBand } from '../../../src/forensics/usage-band';
import { addRecordsToSummary, emptyMonthSummary, hourKeyOf } from '../../../src/forensics/archive-summary';

let seq = 0;
function ad(verdict: ForensicRecord['verdict'], over: Partial<ForensicRecord> = {}): ForensicRecord {
  seq += 1;
  return {
    id: `ad-${seq}`,
    timestamp: '2026-07-01T10:00:00.000Z',
    platform: 'instagram',
    originalText: 'a sponsored post',
    originalHash: 'h',
    originalLength: 16,
    neutralizedText: '',
    author: '@brand',
    postUrl: '',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'adult',
    aiSource: 'rules',
    feedSource: 'for-you',
    integrityHash: 'deadbeef',
    signature: 'sig',
    publicKeyFingerprint: 'fp',
    chainPosition: seq,
    kind: 'post',
    detectionMode: 'sponsored-ad:adult',
    verdict,
    ...over,
  } as unknown as ForensicRecord;
}

describe('an ad that was shown is not a blocked ad (2026-09-19)', () => {
  it('bands a shown ad with the things that reached the person', () => {
    // Block Ads off: the ad was served, seen, and recorded as a pass.
    expect(usageBand(ad('pass'))).toBe('pass');
  });

  it('still bands a hidden ad as blocked, which is the standing decision', () => {
    expect(usageBand(ad('flagged-hidden'))).toBe('blocked');
    expect(usageBand(ad('blocked'))).toBe('blocked');
    expect(usageBand(ad(undefined))).toBe('blocked');
  });

  it('agrees with the total counted beside it in the same loop', () => {
    const shown = ad('pass');
    const hidden = ad('flagged-hidden');
    const summary = emptyMonthSummary('2026-07');
    addRecordsToSummary(summary, [shown, hidden]);

    const hour = hourKeyOf(shown.timestamp);
    const bucket = summary.usageByHour[hour!]!;

    // This is the assertion the defect broke: the chart and the total are two
    // readings of the same records and must not disagree about how many ads
    // were stopped.
    expect(bucket.blocked, 'the hourly chart').toBe(1);
    expect(summary.blocked, 'the month total').toBe(1);
    expect(bucket.pass, 'and the shown one is counted as seen').toBe(1);
  });

  it('a record with no ad markers is untouched by any of this', () => {
    const plain = { ...ad('pass'), detectionMode: undefined } as ForensicRecord;
    expect(usageBand(plain)).toBe('pass');
  });
});
