// "Repeat offender" was two populations on one screen.
//
// account-ledger.ts builds the rows the Frequent flaggers panel shows, and its
// header states the contract: "'flagged' is overview-data's isFlaggedVerdict;
// the panel, the Overview and Statistics must never disagree on what a flag
// is." isFlaggedVerdict counts verdict 'flagged', 'flagged-hidden', and
// undefined, which is what a legacy record carries.
//
// computeRecidivistSet, which decides who gets badged in the feed and who the
// "Repeat accounts" filter opens, counted only the two spelled-out verdicts. So
// on any install with history an author could reach the panel's threshold on
// legacy records, be listed as a frequent flagger, and then never be badged and
// open zero rows under the filter named after them.
//
// Both sides moved together on 2026-09-19. activity-filters.ts's
// repeat-offenders predicate mirrors the set by design, and its own comment
// says so, so widening one alone would have traded this defect for a different
// one: a recidivist author's passed and blocked records leaking into a feed
// labelled "Repeat accounts".

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT as ROOT } from '../../../../helpers/repo-root';
import type { ForensicRecord } from '../../../../../src/types/forensic';
import { computeRecidivistSet } from '../../../../../src/ui/dashboard/components/RecidivistAuthorsPanel';
import { computeAccountLedger } from '../../../../../src/ui/dashboard/components/account-ledger';
import { authorProfileKey } from '../../../../../src/forensics/author-store';

let seq = 0;
function rec(over: Partial<ForensicRecord> = {}): ForensicRecord {
  seq += 1;
  return {
    id: `r-${seq}`,
    timestamp: new Date(Date.parse('2026-07-01T10:00:00Z') + seq * 600_000).toISOString(),
    platform: 'twitter',
    originalText: `item ${seq}`,
    originalHash: 'h',
    originalLength: 6,
    neutralizedText: '',
    author: '@repeat_account',
    postUrl: '',
    techniques: [{ name: 'shame-attack', severity: 6, confidence: 1 }],
    overallScore: 6,
    userAgeCategory: 'adult',
    aiSource: 'cloud',
    feedSource: 'for-you',
    integrityHash: 'deadbeef',
    signature: 'sig',
    publicKeyFingerprint: 'fp',
    chainPosition: seq,
    kind: 'post',
    ...over,
  } as unknown as ForensicRecord;
}

const KEY = authorProfileKey('@repeat_account', 'twitter');

describe('one definition of a repeat account (2026-09-19)', () => {
  it('an author flagged twice on legacy records is both listed and badged', () => {
    // The case that used to split: two records with no verdict field at all.
    const records = [rec({ verdict: undefined }), rec({ verdict: undefined })];

    const ledger = computeAccountLedger(records, { minFlagged: 2 });
    const listed = ledger.some((row) => row.flagged >= 2);
    const badged = computeRecidivistSet(records, 2).has(KEY);

    expect(listed, 'the panel counts them').toBe(true);
    expect(badged, 'and so does everything the panel points at').toBe(true);
  });

  it('the modern verdicts behave exactly as before', () => {
    const records = [rec({ verdict: 'flagged' }), rec({ verdict: 'flagged-hidden' })];
    expect(computeRecidivistSet(records, 2).has(KEY)).toBe(true);
  });

  it('a mix of legacy and modern reaches the threshold together', () => {
    const records = [rec({ verdict: undefined }), rec({ verdict: 'flagged' })];
    expect(computeRecidivistSet(records, 2).has(KEY)).toBe(true);
  });

  it('one flag is still not a repeat', () => {
    expect(computeRecidivistSet([rec({ verdict: 'flagged' })], 2).has(KEY)).toBe(false);
  });

  it('an advertiser who bought four placements is still not a repeat offender', () => {
    // Standing decision 1, 2026-09-14. isFlaggedVerdict excludes paid
    // placements itself, so widening the verdict test must not have opened
    // this door.
    const ads = [
      rec({ verdict: 'flagged', detectionMode: 'sponsored-ad' } as Partial<ForensicRecord>),
      rec({ verdict: 'flagged', detectionMode: 'sponsored-ad' } as Partial<ForensicRecord>),
      rec({ verdict: undefined, detectionMode: 'sponsored-ad' } as Partial<ForensicRecord>),
      rec({ verdict: undefined, detectionMode: 'sponsored-ad' } as Partial<ForensicRecord>),
    ];
    expect(computeRecidivistSet(ads, 2).has(KEY)).toBe(false);
  });

  it('an unknown author is never a repeat account', () => {
    const anon = [rec({ author: 'unknown', verdict: undefined }), rec({ author: 'unknown', verdict: undefined })];
    expect(computeRecidivistSet(anon, 2).has(authorProfileKey('unknown', 'twitter'))).toBe(false);
  });

  it('the rail predicate was widened with the set, not after it', () => {
    // The two are a pair by construction: the filter intersects the set, and
    // its own comment says it must. A check that only watched one of them would
    // pass while the feed over-counted.
    const filters = readFileSync(join(ROOT, 'src/ui/dashboard/components/activity-filters.ts'), 'utf8');
    expect(filters).toContain('return isFlaggedItem(r)');
    expect(filters, 'the old pair is gone from the repeat-offenders case')
      .not.toContain("return (r.verdict === 'flagged' || r.verdict === 'flagged-hidden')");
  });
});
