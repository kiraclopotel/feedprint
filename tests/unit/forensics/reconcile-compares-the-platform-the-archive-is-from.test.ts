// A platform's own data download says nothing about another platform's feed.
//
// reconcile() compares the record with a platform's export and counts, among other things,
// the records "not mentioned in it". It counted every record in the compared period, of any
// platform. Found 2026-09-20 on a chain built by the product's own code: compared with an
// export naming one platform, the signed marker and the section under it said "3 records
// supported, 11 not mentioned in it". Eight of the eleven were YouTube records. A YouTube
// record is not mentioned in another platform's export in the way a Tuesday is not
// mentioned in it: true, and no finding about either.

import { describe, it, expect } from 'vitest';
import { parseArchiveFiles, reconcile, type ArchiveFile } from '../../../src/forensics/reconcile';
import type { ForensicRecord } from '../../../src/types/forensic';

function record(over: Partial<ForensicRecord> & { id: string; timestamp: string }): ForensicRecord {
  return {
    platform: 'facebook', originalText: 't', originalHash: 'h', originalLength: 1, neutralizedText: '', author: '@someone',
    postUrl: '', techniques: [], overallScore: 0, userAgeCategory: 'teen', aiSource: 'cloud', feedSource: 'for-you',
    integrityHash: 'ih', signature: 'sig', publicKeyFingerprint: 'fp', chainPosition: 0, kind: 'post', verdict: 'pass', ...over,
  } as ForensicRecord;
}
const unix = (iso: string): number => Math.floor(Date.parse(iso) / 1000);
function metaFile(entries: Array<{ author: string; at: string; url?: string }>): ArchiveFile {
  return {
    name: 'posts_seen.json',
    text: JSON.stringify({
      impressions_history_posts_seen: entries.map((e) => ({
        string_map_data: { Author: { value: e.author }, ...(e.url ? { Link: { value: e.url } } : {}), Time: { timestamp: unix(e.at) } },
      })),
    }),
  };
}

const URL_1 = 'https://facebook.com/groups/g1/permalink/111';
const archive = parseArchiveFiles([metaFile([
  { author: 'Loud Page', at: '2026-08-01T10:00:00.000Z', url: URL_1 },
  { author: 'Other Page', at: '2026-08-01T10:20:00.000Z' },
])]);

const facebook = [
  record({ id: 'f1', timestamp: '2026-08-01T10:00:20.000Z', postUrl: URL_1 }),
  record({ id: 'f2', timestamp: '2026-08-01T10:05:00.000Z', author: '@nobody-in-the-export' }),
  record({ id: 'f3', timestamp: '2026-08-01T10:10:00.000Z', author: '@nor-this-one' }),
];
const youtube = Array.from({ length: 8 }, (_, i) =>
  record({ id: `y${i}`, platform: 'youtube', timestamp: `2026-08-01T10:0${i}:30.000Z`, author: `@channel${i}` }));

describe('reconcile compares the platform the archive is from', () => {
  it('the archive fixture is one platform', () => {
    expect([...new Set(archive.items.map((i) => i.platform))]).toEqual(['facebook']);
  });

  it('records of another platform are not counted as not mentioned, and are counted on their own', () => {
    const out = reconcile([...facebook, ...youtube], archive);
    expect(out.counts.corroboratedByUrl).toBe(1);
    expect(out.counts.unmatchedRecords).toBe(2);
    expect(out.counts.recordsOnOtherPlatforms).toBe(8);
    // Still visible per platform, where a platform that reconciles nothing is not a failure.
    expect(out.byPlatform.youtube).toEqual({ records: 8, archiveItems: 0, corroborated: 0 });
    expect(out.byPlatform.facebook.records).toBe(3);
  });

  it('every record is still in exactly one count', () => {
    const all = [...facebook, ...youtube];
    const c = reconcile(all, archive).counts;
    expect(c.corroboratedByUrl + c.corroboratedByAuthorAndTime + c.unmatchedRecords + c.recordsOutsideWindow
      + c.recordsOnOtherPlatforms + c.systemMarkersExcluded).toBe(all.length);
  });

  it('a recognised file that lists nothing still speaks for its platform', () => {
    // An X archive with an empty tweet list was asked about X and said nothing: an X record
    // beside it IS "not mentioned in it", and must stay in the finding number. Found the
    // same day by reading the first draft, which took platforms from items alone, against the
    // per-platform case in reconcile.test.ts.
    const withEmptyX = parseArchiveFiles([
      metaFile([{ author: 'Loud Page', at: '2026-08-01T10:00:00.000Z', url: URL_1 }]),
      { name: 'tweets.js', text: 'window.YTD.tweet.part0 = []' },
    ]);
    expect(withEmptyX.coveredPlatforms).toEqual(['facebook', 'twitter']);
    const out = reconcile([
      ...facebook,
      record({ id: 'x1', platform: 'twitter', timestamp: '2026-08-01T10:03:00.000Z', author: '@someone-on-x' }),
      ...youtube,
    ], withEmptyX);
    expect(out.counts.unmatchedRecords).toBe(3);
    expect(out.counts.recordsOnOtherPlatforms).toBe(8);
  });

  it('with no other platform in the record nothing changes', () => {
    const c = reconcile(facebook, archive).counts;
    expect(c.unmatchedRecords).toBe(2);
    expect(c.recordsOnOtherPlatforms).toBe(0);
  });
});
