// Evidence-gap register item 10 (2026-09-06): the record reconciled against
// the platform's own export.
//
// A two-sided corpus, on the darking lesson: a filter written by hand once
// shipped inverted and every test agreed with it, because every case was a
// case it was supposed to accept. So each join rule here has both sides - a
// pair that MUST join, and the near miss that MUST NOT: the same author a day
// later, a different author in the same minute, the same address on another
// platform, the empty author, the literal string 'unknown'.
//
// The fixtures are synthetic and built from the documented archive shapes. His
// own archives arrive in days and are what will validate the parsers; until
// then this proves the join, not the format.

import { describe, it, expect } from 'vitest';
import {
  parseArchiveFiles,
  reconcile,
  urlKey,
  authorKey,
  DEFAULT_WINDOW_MINUTES,
  type ArchiveFile,
} from '../../../src/forensics/reconcile';
import { SYSTEM_MARKER_KINDS } from '../../../src/forensics/system-records';
import type { ForensicRecord } from '../../../src/types/forensic';

function record(over: Partial<ForensicRecord> & { id: string; timestamp: string }): ForensicRecord {
  return {
    platform: 'facebook', originalText: 't', originalHash: 'h', originalLength: 1,
    neutralizedText: '', author: '@someone', postUrl: '', techniques: [], overallScore: 0,
    userAgeCategory: 'teen', aiSource: 'cloud', feedSource: 'for-you',
    integrityHash: 'ih', signature: 'sig', publicKeyFingerprint: 'fp', chainPosition: 0,
    kind: 'post', verdict: 'pass',
    ...over,
  } as ForensicRecord;
}

const unix = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

function metaFile(name: string, entries: Array<{ author: string; at: string; url?: string }>): ArchiveFile {
  return {
    name,
    text: JSON.stringify({
      impressions_history_posts_seen: entries.map(e => ({
        string_map_data: {
          Author: { value: e.author },
          ...(e.url ? { Link: { value: e.url } } : {}),
          Time: { timestamp: unix(e.at) },
        },
      })),
    }),
  };
}

/**
 * Meta's HTML export, the shape the owner's own request came back in on
 * 2026-09-06: one section per entry, a table of label and value cells, the
 * URL in an anchor inside a cell spanning both columns, the time as a wall
 * clock string. Values here are invented; the tags and classes are Meta's.
 */
function metaHtmlFile(name: string, entries: Array<{ event: string; time: string; url?: string }>): ArchiveFile {
  const section = (e: { event: string; time: string; url?: string }) =>
    `<section class="_3-95 _a6-g"><div class="_2pi8 _2pic _a6-p"><table style="table-layout: fixed;">`
    + `<tr><td class="_a6_q">Event</td><td class="_2piu _a6_r">${e.event}</td></tr>`
    + (e.url ? `<tr><td colspan="2" class="_a6_q">URL<div><a target="_blank" href="${e.url}">${e.url}</a></div></td></tr>` : '')
    + `<tr><td class="_a6_q">Time</td><td class="_2piu _a6_r">${e.time}</td></tr>`
    + `</table></div></section>`;
  return {
    name,
    text: `<!DOCTYPE html><html><head><title>x</title></head><body class="_5vb_ _2yq _a7o5"><div><section class="_3-95 _a6-g"><div class="_2pi8 _2pic _a6-p"><table style="table-layout: fixed;"><tr><td colspan="2" class="_a6_q">Content that has been shown to you in your feed</td></tr></table>`
      + entries.map(section).join('') + `</div></section></div></body></html>`,
  };
}

function tiktokFile(name: string, entries: Array<{ date: string; link: string }>): ArchiveFile {
  return {
    name,
    text: JSON.stringify({
      Activity: { 'Video Browsing History': { VideoList: entries.map(e => ({ Date: e.date, Link: e.link })) } },
    }),
  };
}

describe('reading a platform archive', () => {
  it('reads Meta impressions by shape, not by file name', () => {
    const index = parseArchiveFiles([metaFile('some-file-the-parent-renamed.json', [
      { author: 'Loud Page', at: '2026-08-01T10:00:00.000Z' },
      { author: 'Other Page', at: '2026-08-01T11:00:00.000Z' },
    ])]);
    expect(index.recognised).toEqual([{ name: 'some-file-the-parent-renamed.json', shape: 'meta-impressions', items: 2 }]);
    expect(index.items.map(i => i.author)).toEqual(['Loud Page', 'Other Page']);
    expect(index.items[0].platform).toBe('facebook');
    expect(index.fromISO).toBe('2026-08-01T10:00:00.000Z');
    expect(index.toISO).toBe('2026-08-01T11:00:00.000Z');
  });

  it('an Instagram export is told apart by its own file name, which is the only signal Meta gives', () => {
    const index = parseArchiveFiles([metaFile('instagram/posts_viewed.json', [{ author: 'A', at: '2026-08-01T10:00:00.000Z' }])]);
    expect(index.items[0].platform).toBe('instagram');
  });

  it('reads TikTok browsing history and reads its zoneless date as UTC', () => {
    const index = parseArchiveFiles([tiktokFile('user_data.json', [
      { date: '2026-08-01 10:00:00', link: 'https://www.tiktokv.com/share/video/7300000000000000001/' },
    ])]);
    expect(index.recognised[0].shape).toBe('tiktok-browsing-history');
    expect(index.items[0].atISO).toBe('2026-08-01T10:00:00.000Z');
    expect(index.items[0].author).toBe('');
  });

  it("recognises X's archive and says it reconciles nothing, rather than reading as no match", () => {
    const index = parseArchiveFiles([{ name: 'tweets.js', text: 'window.YTD.tweet.part0 = [ { "tweet": {} } ]' }]);
    expect(index.recognised[0].shape).toBe('x-archive');
    expect(index.recognised[0].items).toBe(0);
    expect(index.recognised[0].note).toContain('not what its timeline served');
    expect(index.items).toHaveLength(0);
  });

  it("reads Meta's HTML export: one entry per table, the possessive tail off the author, the anchor as the address, the wall clock as local time", () => {
    const file = metaHtmlFile('content_that_has_been_shown_to_you_in_your_feed.html', [
      { event: 'Some Page&#039;s post', time: 'Aug 31, 2026 10:03:20 pm', url: 'https://www.facebook.com/groups/g1/permalink/111/' },
      { event: 'Another One’s video', time: 'Sep 2, 2026 9:15:00 am' },
      { event: 'No time here', time: 'not a time' },
    ]);
    const index = parseArchiveFiles([file]);
    expect(index.recognised).toHaveLength(1);
    expect(index.recognised[0].shape).toBe('meta-html');
    expect(index.recognised[0].items).toBe(2);
    expect(index.recognised[0].note).toContain('wall clock');
    expect(index.items.map(i => i.author)).toEqual(['Some Page', 'Another One']);
    expect(index.items[0].url).toBe('https://www.facebook.com/groups/g1/permalink/111/');
    expect(index.items[1].url).toBeUndefined();
    expect(index.items[0].platform).toBe('facebook');
    // Local time: the instant is 22:03:20 on 31 August in this computer's zone.
    const expected = new Date(2026, 7, 31, 22, 3, 20).toISOString();
    expect(index.items[0].atISO).toBe(expected);
    expect(index.fromISO).toBe(expected);
  });

  it('an Instagram HTML export is told apart by its file name, and an HTML page without timed rows reads as nothing', () => {
    const ig = metaHtmlFile('instagram_posts_viewed.html', [{ event: 'creator&#039;s post', time: 'Sep 1, 2026 1:00:00 pm' }]);
    expect(parseArchiveFiles([ig]).items[0].platform).toBe('instagram');
    const settings: ArchiveFile = { name: 'controls.html', text: '<!DOCTYPE html><html><body><table><tr><td class="_a6_q">Setting</td><td class="_2piu _a6_r">On</td></tr></table></body></html>' };
    const index = parseArchiveFiles([settings]);
    expect(index.recognised).toEqual([]);
    expect(index.unrecognised).toEqual(['controls.html']);
  });

  it('a record at the same address as an HTML entry is corroborated by address', () => {
    const file = metaHtmlFile('feed.html', [{ event: 'Page&#039;s post', time: 'Sep 2, 2026 9:15:00 am', url: 'https://www.facebook.com/groups/g1/permalink/222/?ref=x' }]);
    const index = parseArchiveFiles([file]);
    const at = new Date(2026, 8, 2, 9, 15, 0).toISOString();
    const r = reconcile([record({ id: 'r1', timestamp: at, postUrl: 'https://facebook.com/groups/g1/permalink/222' })], index);
    expect(r.counts.corroboratedByUrl).toBe(1);
    expect(r.counts.unmatchedRecords).toBe(0);
  });

  it('names what it could not read instead of ignoring it', () => {
    const index = parseArchiveFiles([
      { name: 'not-json.txt', text: 'hello' },
      { name: 'json-but-not-an-archive.json', text: '{"something":"else"}' },
      { name: 'empty-list.json', text: '{"impressions_history_posts_seen":[]}' },
    ]);
    expect(index.unrecognised).toEqual(['not-json.txt', 'json-but-not-an-archive.json', 'empty-list.json']);
    expect(index.recognised).toHaveLength(0);
  });
});

describe('the comparable forms', () => {
  it('an address survives tracking parameters, www and a trailing slash', () => {
    const key = urlKey('https://www.facebook.com/permalink.php?story_fbid=123&id=456');
    expect(key).toBe('facebook.com/permalink.php');
    expect(urlKey('https://facebook.com/some/post/')).toBe(urlKey('https://www.facebook.com/some/post?utm_source=x'));
  });

  it('a bare host, a relative path and a non-address are not addresses', () => {
    expect(urlKey('https://facebook.com/')).toBeUndefined();
    expect(urlKey('/some/post')).toBeUndefined();
    expect(urlKey('')).toBeUndefined();
    expect(urlKey(undefined)).toBeUndefined();
  });

  it("an author survives @ and case, and 'unknown' is never a name", () => {
    expect(authorKey('@Someone')).toBe('someone');
    expect(authorKey('  Loud   Page ')).toBe('loud page');
    expect(authorKey('unknown')).toBeUndefined();
    expect(authorKey('UNKNOWN')).toBeUndefined();
    expect(authorKey('')).toBeUndefined();
  });
});

describe('the join: what must match', () => {
  it('an address on both sides is corroborated, and once only', () => {
    const archive = parseArchiveFiles([metaFile('m.json', [
      { author: 'Loud Page', at: '2026-08-01T10:00:00.000Z', url: 'https://www.facebook.com/loud/posts/1?utm=1' },
    ])]);
    const out = reconcile([
      record({ id: 'a', timestamp: '2026-08-01T10:00:20.000Z', author: 'Loud Page', postUrl: 'https://facebook.com/loud/posts/1' }),
      record({ id: 'b', timestamp: '2026-08-01T10:00:25.000Z', author: 'Loud Page', postUrl: 'https://facebook.com/loud/posts/1' }),
    ], archive);
    expect(out.counts.corroboratedByUrl).toBe(1);
    expect(out.counts.unmatchedRecords).toBe(1);
    expect(out.corroboratedIds).toEqual(['a']);
  });

  it('the same author inside the window is corroborated without an address', () => {
    const archive = parseArchiveFiles([metaFile('m.json', [{ author: 'Loud Page', at: '2026-08-01T10:00:00.000Z' }])]);
    const out = reconcile([record({ id: 'a', timestamp: '2026-08-01T10:10:00.000Z', author: '@loud page' })], archive);
    expect(out.counts.corroboratedByAuthorAndTime).toBe(1);
    expect(out.counts.unmatchedRecords).toBe(0);
  });

  it('two sightings of one author pair off one each, closest first', () => {
    const archive = parseArchiveFiles([metaFile('m.json', [
      { author: 'Loud Page', at: '2026-08-01T10:00:00.000Z' },
      { author: 'Loud Page', at: '2026-08-01T10:20:00.000Z' },
    ])]);
    const out = reconcile([
      record({ id: 'a', timestamp: '2026-08-01T10:01:00.000Z', author: 'Loud Page' }),
      record({ id: 'b', timestamp: '2026-08-01T10:21:00.000Z', author: 'Loud Page' }),
    ], archive);
    expect(out.counts.corroboratedByAuthorAndTime).toBe(2);
    expect(out.counts.unmatchedArchiveItems).toBe(0);
  });
});

describe('the join: what must NOT match', () => {
  const archive = parseArchiveFiles([metaFile('m.json', [
    { author: 'Loud Page', at: '2026-08-01T10:00:00.000Z', url: 'https://www.facebook.com/loud/posts/1' },
  ])]);

  it('the same author a day later is not the same sighting', () => {
    const out = reconcile([record({ id: 'a', timestamp: '2026-08-02T10:00:00.000Z', author: 'Loud Page' })], archive);
    expect(out.counts.corroboratedByAuthorAndTime).toBe(0);
    expect(out.counts.recordsOutsideWindow).toBe(1);
  });

  it('a record inside the archive period but too far from any item is unmatched, not corroborated', () => {
    // Two items an hour apart, so the record below sits well inside the period
    // the archive covers and more than the window from either sighting.
    const spread = parseArchiveFiles([metaFile('m.json', [
      { author: 'Loud Page', at: '2026-08-01T10:00:00.000Z' },
      { author: 'Loud Page', at: '2026-08-01T11:00:00.000Z' },
    ])]);
    const out = reconcile([record({ id: 'a', timestamp: '2026-08-01T10:30:00.000Z', author: 'Loud Page' })], spread);
    expect(out.counts.corroboratedByAuthorAndTime).toBe(0);
    expect(out.counts.unmatchedRecords).toBe(1);
    expect(out.counts.recordsOutsideWindow).toBe(0);
    expect(out.windowMinutes).toBe(DEFAULT_WINDOW_MINUTES);
  });

  it('a record past the end of what the archive covers is outside the window, not a miss', () => {
    const out = reconcile([record({ id: 'a', timestamp: '2026-08-01T10:16:00.000Z', author: 'Loud Page' })], archive);
    expect(out.counts.corroboratedByAuthorAndTime).toBe(0);
    expect(out.counts.recordsOutsideWindow).toBe(1);
    expect(out.counts.unmatchedRecords).toBe(0);
  });

  it('a different author in the same minute is not corroborated', () => {
    const out = reconcile([record({ id: 'a', timestamp: '2026-08-01T10:00:30.000Z', author: 'Quiet Page' })], archive);
    expect(out.counts.corroboratedByAuthorAndTime).toBe(0);
    expect(out.counts.unmatchedRecords).toBe(1);
  });

  it('the same address on another platform is not corroborated', () => {
    const out = reconcile([record({
      id: 'a', timestamp: '2026-08-01T10:00:30.000Z', platform: 'instagram',
      author: 'Quiet Page', postUrl: 'https://www.facebook.com/loud/posts/1',
    })], archive);
    // The address matches on both sides, and it is the same address, so it
    // corroborates: an address is the platform's own name for one post. What
    // must not happen is an author match across platforms.
    expect(out.counts.corroboratedByUrl).toBe(1);
    const authorCross = reconcile([record({
      id: 'b', timestamp: '2026-08-01T10:00:30.000Z', platform: 'instagram', author: 'Loud Page',
    })], archive);
    expect(authorCross.counts.corroboratedByAuthorAndTime).toBe(0);
  });

  it("an empty author and the literal 'unknown' never corroborate", () => {
    const anonymous = parseArchiveFiles([metaFile('m.json', [{ author: '', at: '2026-08-01T10:00:00.000Z' }])]);
    const out = reconcile([
      record({ id: 'a', timestamp: '2026-08-01T10:00:10.000Z', author: '' }),
      record({ id: 'b', timestamp: '2026-08-01T10:00:10.000Z', author: 'unknown' }),
    ], anonymous);
    expect(out.counts.corroboratedByAuthorAndTime).toBe(0);
    expect(out.counts.unmatchedRecords).toBe(2);
  });

  it('an empty archive corroborates nothing and puts every record outside the window', () => {
    const empty = parseArchiveFiles([]);
    const out = reconcile([record({ id: 'a', timestamp: '2026-08-01T10:00:00.000Z' })], empty);
    expect(out.counts.corroboratedByUrl + out.counts.corroboratedByAuthorAndTime).toBe(0);
    expect(out.counts.recordsOutsideWindow).toBe(1);
    expect(out.counts.unmatchedRecords).toBe(0);
  });
});

/**
 * Found 2026-09-18 by reading the export's own section against the join: the
 * window filter ran over every record the chain held, housekeeping markers
 * included. A heartbeat, a gap, a prune, a rotation, a reset, an import, a
 * repair, a redaction and an earlier reconciliation carry no author and no
 * address, so not one of them can ever match an archive entry, and every one
 * of them landed in unmatchedRecords, which the export prints as records the
 * platform does not corroborate. Both sides here: a marker must be dropped,
 * and a real capture that looks just as bare must still be counted.
 */
describe('the population the counts are over', () => {
  const archive = parseArchiveFiles([metaFile('m.json', [{ author: 'Loud Page', at: '2026-08-01T10:00:00.000Z' }])]);
  const at = '2026-08-01T10:00:10.000Z';

  it('no housekeeping marker enters the comparison, and the number left out is reported', () => {
    const markers = [...SYSTEM_MARKER_KINDS].map((kind, i) => record({
      id: `m${i}`, timestamp: at, platform: 'twitter', author: '', postUrl: '',
      kind: kind as ForensicRecord['kind'],
    }));
    const out = reconcile([record({ id: 'a', timestamp: at, author: 'Loud Page' }), ...markers], archive);
    expect(out.counts.corroboratedByAuthorAndTime).toBe(1);
    expect(out.counts.unmatchedRecords).toBe(0);
    expect(out.counts.recordsOutsideWindow).toBe(0);
    expect(out.counts.systemMarkersExcluded).toBe(SYSTEM_MARKER_KINDS.size);
    // The markers' storage platform is twitter; excluding them must take them
    // out of the per-platform table too, or the table and the totals disagree.
    expect(out.byPlatform.twitter).toBeUndefined();
  });

  // CHANGED 2026-09-20, M356: this case asserted unmatchedRecords 1 over a bare
  // twitter capture beside a facebook archive. The archive here carries no
  // twitter item, and the signed reconcile line reads unmatchedRecords out as
  // records "not mentioned in it", which an export of one platform cannot say
  // about another platform's feed. On a chain built by the product against an
  // archive naming one platform the line said "3 records supported, 11 not
  // mentioned in it" and 8 of the 11 were YouTube. The sighting is still
  // counted, which is what this case protects: it is in the population, in the
  // per-platform table below, and now in its own number.
  it('a capture just as bare as a marker is still counted, because it is a sighting', () => {
    const out = reconcile([
      record({ id: 'a', timestamp: at, author: 'Loud Page' }),
      record({ id: 'b', timestamp: at, platform: 'twitter', author: '', postUrl: '', kind: 'post' }),
    ], archive);
    expect(out.counts.systemMarkersExcluded).toBe(0);
    expect(out.counts.recordsOnOtherPlatforms).toBe(1);
    expect(out.counts.unmatchedRecords).toBe(0);
    expect(out.byPlatform.twitter).toEqual({ records: 1, archiveItems: 0, corroborated: 0 });
  });
});

/**
 * Found 2026-09-18: records were held to the archive's window and archive
 * entries were held to nothing, so an install younger than the export counted
 * every impression from before it existed as something the platform lists and
 * the recorder has no record of. recordsOutsideWindow had no partner on the
 * archive side. Both sides here: what predates the recorder must leave the
 * unmatched figure, and what falls inside its coverage must stay in it.
 */
describe('the period both sides can speak for', () => {
  const archive = parseArchiveFiles([metaFile('m.json', [
    { author: 'Loud Page', at: '2026-08-01T10:00:00.000Z' },
    { author: 'Loud Page', at: '2026-08-02T10:00:00.000Z' },
    { author: 'Loud Page', at: '2026-08-03T10:00:00.000Z' },
    { author: 'Loud Page', at: '2026-08-10T10:00:00.000Z' },
  ])]);

  it('an export older than the install does not report its own earlier days as the recorder missing them', () => {
    const out = reconcile([record({ id: 'a', timestamp: '2026-08-10T10:00:30.000Z', author: 'Loud Page' })], archive);
    expect(out.counts.corroboratedByAuthorAndTime).toBe(1);
    expect(out.counts.unmatchedArchiveItems).toBe(0);
    expect(out.counts.archiveItemsOutsideCoverage).toBe(3);
    // The archive's own window is unchanged and is still what the marker
    // carries; the compared period is the narrower overlap.
    expect(out.fromISO).toBe('2026-08-01T10:00:00.000Z');
    expect(out.toISO).toBe('2026-08-10T10:00:00.000Z');
    // The two spans do not quite overlap: the one capture is thirty seconds
    // past the archive's last entry, inside the tolerance that paired them.
    expect(out.comparedFromISO).toBe('2026-08-10T10:00:00.000Z');
    expect(out.comparedToISO).toBe('2026-08-10T10:00:30.000Z');
  });

  it('an entry inside the recorder\'s own coverage that matches nothing stays unmatched', () => {
    const out = reconcile([
      record({ id: 'a', timestamp: '2026-08-01T10:00:30.000Z', author: 'Loud Page' }),
      record({ id: 'b', timestamp: '2026-08-10T10:00:30.000Z', author: 'Loud Page' }),
    ], archive);
    expect(out.counts.corroboratedByAuthorAndTime).toBe(2);
    // The 2nd and the 3rd sit between the two captures, inside the period the
    // recorder was running, and are genuinely unaccounted for.
    expect(out.counts.unmatchedArchiveItems).toBe(2);
    expect(out.counts.archiveItemsOutsideCoverage).toBe(0);
  });

  it('the three archive-side numbers account for every entry the archive carried', () => {
    for (const records of [
      [record({ id: 'a', timestamp: '2026-08-10T10:00:30.000Z', author: 'Loud Page' })],
      [record({ id: 'a', timestamp: '2026-08-02T10:00:30.000Z', author: 'Loud Page' })],
      [],
    ]) {
      const out = reconcile(records, archive);
      const corroborated = out.counts.corroboratedByUrl + out.counts.corroboratedByAuthorAndTime;
      expect(corroborated + out.counts.unmatchedArchiveItems + out.counts.archiveItemsOutsideCoverage)
        .toBe(archive.items.length);
    }
  });

  it('no overlap at all is said by leaving the compared period out, not by inventing one', () => {
    const out = reconcile([record({ id: 'a', timestamp: '2027-01-01T10:00:00.000Z', author: 'Loud Page' })], archive);
    expect(out.comparedFromISO).toBeUndefined();
    expect(out.comparedToISO).toBeUndefined();
    expect(out.counts.recordsOutsideWindow).toBe(1);
    expect(out.counts.unmatchedArchiveItems).toBe(0);
    expect(out.counts.archiveItemsOutsideCoverage).toBe(4);
  });
});

describe('what the result says and does not say', () => {
  it('no count can exceed the smaller of the two sets, and none is a rate', () => {
    const archive = parseArchiveFiles([metaFile('m.json', [
      { author: 'A', at: '2026-08-01T10:00:00.000Z' },
      { author: 'B', at: '2026-08-01T10:05:00.000Z' },
    ])]);
    const out = reconcile([
      record({ id: '1', timestamp: '2026-08-01T10:00:10.000Z', author: 'A' }),
      record({ id: '2', timestamp: '2026-08-01T10:00:20.000Z', author: 'A' }),
      record({ id: '3', timestamp: '2026-08-01T10:05:10.000Z', author: 'B' }),
    ], archive);
    const corroborated = out.counts.corroboratedByUrl + out.counts.corroboratedByAuthorAndTime;
    expect(corroborated).toBe(2);
    expect(corroborated).toBeLessThanOrEqual(archive.items.length);
    // Every value is a whole count; nothing the result carries is a rate, a
    // recall or a percentage, because there is no honest denominator for one.
    for (const value of Object.values(out.counts)) expect(Number.isInteger(value)).toBe(true);
    expect(Object.keys(out.counts).join(' ')).not.toMatch(/recall|percent|ratio|share/i);
  });

  it('reports per platform, so a platform that reconciles nothing is visibly not a failure', () => {
    const archive = parseArchiveFiles([
      metaFile('m.json', [{ author: 'A', at: '2026-08-01T10:00:00.000Z' }]),
      { name: 'tweets.js', text: 'window.YTD.tweet.part0 = []' },
    ]);
    const out = reconcile([
      record({ id: '1', timestamp: '2026-08-01T10:00:10.000Z', author: 'A' }),
      record({ id: '2', timestamp: '2026-08-01T10:00:10.000Z', platform: 'twitter', author: 'B' }),
    ], archive);
    expect(out.byPlatform.facebook).toEqual({ records: 1, archiveItems: 1, corroborated: 1 });
    expect(out.byPlatform.twitter).toEqual({ records: 1, archiveItems: 0, corroborated: 0 });
    expect(out.recognised.find(r => r.shape === 'x-archive')?.note).toBeTruthy();
  });

  it('the window is what the caller asked for and is carried in the result', () => {
    const archive = parseArchiveFiles([metaFile('m.json', [{ author: 'A', at: '2026-08-01T10:00:00.000Z' }])]);
    const out = reconcile([record({ id: '1', timestamp: '2026-08-01T10:40:00.000Z', author: 'A' })], archive, { windowMinutes: 60 });
    expect(out.windowMinutes).toBe(60);
    expect(out.counts.corroboratedByAuthorAndTime).toBe(1);
  });
});
