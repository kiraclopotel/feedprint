/** @vitest-environment jsdom */
//
// M344, 2026-09-20: a recount of the public demo export's tables found the
// blocked tile counting a population none of the row's other tiles count.
// `if(isBlock(r))nBlock++` sat above the line that drops records
// FWN.isDecidedContentRecord refuses (image records among them), while Posts,
// Comments and Flagged are counted below that line or never count images at
// all. The demo printed "73 Blocked before analysis" beside 1056 posts, 269
// comments, 99 flagged, and beside page one's "62 paid placements": the 11
// between are kind 'image' records about ads already counted as posts.
//
// This fixture is the smallest shape that tells the two orderings apart: two
// paid-placement records of kind 'post' (isBlock true, isDecidedContentRecord
// true, counted either way the line sits) and one paid-placement record of
// kind 'image' (isBlock true, isDecidedContentRecord false: counted only if
// nBlock++ runs before the image filter returns). The tile must read 2, the
// population every other tile in the row counts, never 3.

import { describe, it, expect, beforeEach } from 'vitest';
import { buildForensicHtmlExport, FEED_SCRIPT, I18N, type ExportMetadata } from '../../../src/forensics/html-export';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';
import type { ForensicRecord } from '../../../src/types/forensic';

let seq = 0;
function rec(overrides: Partial<ForensicRecord> = {}): ForensicRecord {
  seq++;
  return {
    id: `r-${seq}`,
    timestamp: new Date(Date.parse('2026-07-01T10:00:00Z') + seq * 60_000).toISOString(),
    platform: 'twitter',
    originalText: 'sample',
    originalHash: `h-${seq}`,
    originalLength: 6,
    neutralizedText: '',
    author: '@someone',
    postUrl: '',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'adult',
    aiSource: 'cloud',
    feedSource: 'for-you',
    integrityHash: 'deadbeef',
    signature: 'sig',
    publicKeyFingerprint: 'fp',
    chainPosition: seq,
    kind: 'post',
    verdict: 'pass',
    ...overrides,
  } as ForensicRecord;
}

/** Marked a paid placement the way FWN.isPaidPlacement reads it (export-numbers-inline.ts): accountType alone is enough. */
function ad(overrides: Partial<ForensicRecord> = {}): ForensicRecord {
  return rec({ author: '@advertiser', accountType: 'advertiser', ...overrides });
}

const META: ExportMetadata = {
  fwVersion: 'V1.0.0-test',
  publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' },
  publicKeyFingerprint: 'fp16',
  locale: 'en',
};

function feed(records: ForensicRecord[]): string {
  const html = buildForensicHtmlExport(records, META);
  const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
  (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(m![1]);
  document.body.innerHTML = '<div id="fw-feed"></div>';
  // Both scripts, in the order the page loads them, the same as
  // export-glance-bands.test.ts: run alone, FEED_SCRIPT takes its own
  // fallback branch, which is not what a recipient's browser runs.
  new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${FEED_SCRIPT}`)();
  return (document.getElementById('fw-feed') as HTMLElement).innerHTML;
}

/** The number in the blocked tile. */
function blockedTile(html: string): number {
  const m = html.match(new RegExp(`<b>(\\d+)</b><span>${I18N.en.feedBlockedCount}</span>`));
  return Number(m?.[1]);
}

beforeEach(() => {
  document.body.innerHTML = '';
  delete (window as unknown as { __FW_EXPORT__?: unknown }).__FW_EXPORT__;
  seq = 0;
});

describe('the blocked tile counts the population every other tile in the row counts', () => {
  it('leaves an ad record of kind image out, the way the tile leaves every image record out', () => {
    const html = feed([
      ad({ kind: 'post' }),
      ad({ kind: 'post' }),
      ad({ kind: 'image' }),
    ]);
    expect(blockedTile(html)).toBe(2);
  });
});
