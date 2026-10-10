// What counts as a flagged item is written twice, and the two copies must
// answer the same.
//
// src/forensics/flag-provenance.ts is what page one uses at build time. The
// exported page cannot import it: the reading view runs from inline scripts in
// the recipient's browser, so the same two predicates are restated as ES5
// inside src/forensics/export-numbers-inline.ts. The duplication is required
// and stays; what must not stay is the two copies drifting.
//
// They had drifted. Until 2026-09-17 the reading view used a looser rule of its
// own (not a block, and flagged-or-severity-five-and-up) over every record that
// was not a marker, which counted image records; page one dropped images and
// paid placements. The public demo printed "129 Flagged items" in the reading
// view and "108 of 1,325 content records" on page one of the same file, and
// the paragraph directly above the 129 told the reader that images are
// unmeasured. Three numbers for one question, in the file the letters ask
// researchers to open.

import { describe, expect, it } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';
import { isDecidedContentRecord, isFlaggedRecord } from '../../../src/forensics/flag-provenance';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';

interface Inline {
  isDecidedContentRecord: (r: ForensicRecord) => boolean;
  isFlaggedRecord: (r: ForensicRecord) => boolean;
}
const inline = new Function(`${EXPORT_NUMBERS_INLINE_SOURCE}; return FWN;`)() as Inline;

let n = 0;
function rec(over: Partial<ForensicRecord> = {}): ForensicRecord {
  n++;
  return {
    id: `fr-${n}`,
    timestamp: '2026-09-10T10:00:00.000Z',
    platform: 'twitter',
    originalText: 'text',
    originalHash: `hash-${n}`,
    originalLength: 4,
    neutralizedText: '',
    author: '@person',
    postUrl: '',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'adult',
    aiSource: 'cloud',
    feedSource: 'for-you',
    integrityHash: `ih-${n}`,
    chainPosition: n,
    kind: 'post',
    verdict: 'pass',
    ...over,
  } as ForensicRecord;
}

/** Every shape the two predicates are asked about, including the ones that split them. */
const CASES: ReadonlyArray<{ what: string; record: ForensicRecord }> = [
  { what: 'an ordinary passed post', record: rec() },
  { what: 'a flagged post', record: rec({ verdict: 'flagged' }) },
  { what: 'a flagged and hidden post', record: rec({ verdict: 'flagged-hidden' }) },
  { what: 'a masked post', record: rec({ verdict: 'masked' }) },
  { what: 'a blocked post', record: rec({ verdict: 'blocked' }) },
  { what: 'a record written before verdicts existed', record: rec({ verdict: undefined }) },
  { what: 'a cancelled record', record: rec({ verdict: 'cancelled-stale' as ForensicRecord['verdict'] }) },
  { what: 'a comment', record: rec({ kind: 'comment', verdict: 'flagged' }) },
  { what: 'a reply', record: rec({ kind: 'reply', verdict: 'flagged' }) },
  { what: 'a video', record: rec({ kind: 'video', verdict: 'flagged' }) },
  // The pair that printed two totals on one page.
  { what: 'a flagged image record', record: rec({ kind: 'image', verdict: 'flagged' }) },
  { what: 'a passed image record', record: rec({ kind: 'image', verdict: 'pass' }) },
  { what: 'an environment record', record: rec({ kind: 'environment', verdict: 'pass' }) },
  { what: 'a gap marker', record: rec({ kind: 'gap-marker', verdict: 'pass' }) },
  { what: 'a reset marker', record: rec({ kind: 'reset-marker', verdict: 'pass' }) },
  { what: 'a heartbeat marker', record: rec({ kind: 'heartbeat-marker', verdict: 'pass' }) },
  // Advertising: in the population, never on the flagged side.
  { what: 'a sponsored post the ad rule hid', record: rec({ verdict: 'blocked', detectionMode: 'block:ads:platform-ad-marker' }) },
  { what: 'a flagged advertiser post', record: rec({ verdict: 'flagged', accountType: 'advertiser' }) },
  { what: 'a sponsored-ad detection', record: rec({ verdict: 'flagged', detectionMode: 'sponsored-ad:adult' }) },
  // Severity without a flagged verdict: the old reading-view rule counted these.
  { what: 'a passed post carrying a severity five technique', record: rec({ techniques: [{ name: 'anger-trigger', severity: 5, confidence: 1 }] }) },
];

describe('the flagged-share rule, written twice', () => {
  it.each(CASES)('$what: both copies agree on whether it is a content record', ({ record }) => {
    expect(inline.isDecidedContentRecord(record)).toBe(isDecidedContentRecord(record));
  });

  it.each(CASES)('$what: both copies agree on whether it is flagged', ({ record }) => {
    expect(inline.isFlaggedRecord(record)).toBe(isFlaggedRecord(record));
  });

  it('counts a mixed file the same on both sides, which is the number the demo disagreed about', () => {
    const file = CASES.map(c => c.record);
    const count = (
      decided: (r: ForensicRecord) => boolean,
      flagged: (r: ForensicRecord) => boolean,
    ): { decided: number; flagged: number } => {
      let d = 0; let f = 0;
      for (const r of file) {
        if (!decided(r)) continue;
        d++;
        if (flagged(r)) f++;
      }
      return { decided: d, flagged: f };
    };
    expect(count(inline.isDecidedContentRecord, inline.isFlaggedRecord))
      .toEqual(count(isDecidedContentRecord, isFlaggedRecord));
  });

  it('keeps image records out of both sides, and advertising off the flagged side', () => {
    // Stated here as well as compared, so the contract is readable without
    // running the module: a test that only says "the same" cannot say "what".
    const image = rec({ kind: 'image', verdict: 'flagged' });
    expect(inline.isDecidedContentRecord(image)).toBe(false);
    expect(isDecidedContentRecord(image)).toBe(false);

    const ad = rec({ verdict: 'flagged', accountType: 'advertiser' });
    expect(inline.isDecidedContentRecord(ad)).toBe(true);
    expect(inline.isFlaggedRecord(ad)).toBe(false);
    expect(isFlaggedRecord(ad)).toBe(false);
  });
});
