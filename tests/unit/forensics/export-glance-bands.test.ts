/** @vitest-environment jsdom */
//
// One meaning of "high" per file, and one population under the flagged tile.
//
// The reading view's three bars cut severity at 8 and 5 and labelled the bands
// with a bare word. The level filter on page one of the same file cuts at 6 and
// 3, and puts the numbers in its own labels: "High (6-10)". Measured on the
// public demo on 2026-09-17, the bars said 8 high and filtering High showed 39.
// Nothing on the page said they were different questions, because they are not:
// they are one question asked twice with two answers.
//
// The per-account rows under them had the same shape of fault. They kept the
// old loose rule (not a block, and flagged or severity five and up) over every
// non-marker record, so they counted the 21 flagged image records that the
// paragraph two inches above says are left out. Ten rows that add up past the
// total printed above them is the thing a hostile reader finds first.
//
// The bands now come from FWN.severityLevel, the engine the filter reads. A
// rule match has no level in that engine (it matched a word list and read no
// meaning), so it is named under the bars instead of being folded into the
// lowest one, which is where the old cut silently put it.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildForensicHtmlExport,
  FEED_SCRIPT,
  I18N,
  type ExportMetadata,
} from '../../../src/forensics/html-export';
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
    originalHash: 'h',
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

/** A post a judge read and named a technique on, at the severity given. */
function judged(severity: number, over: Partial<ForensicRecord> = {}): ForensicRecord {
  return rec({
    verdict: 'flagged',
    overallScore: severity,
    techniques: [{ name: 'fear-appeal', severity, confidence: 0.9 }],
    ...over,
  });
}

/** What the word filter writes: no model read it, and aiSource says so. */
function ruleMatch(over: Partial<ForensicRecord> = {}): ForensicRecord {
  return rec({
    verdict: 'flagged',
    aiSource: 'rules',
    detectionMode: 'profanity-mask',
    overallScore: 6,
    techniques: [{ name: 'swearing', severity: 6, confidence: 1 }],
    ...over,
  });
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
  // Both scripts, in the order the page loads them. Run alone, FEED_SCRIPT
  // takes its own fallback branch for every counting question, which is not
  // what any recipient runs: the export always ships the numbers engine above
  // it.
  new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${FEED_SCRIPT}`)();
  return (document.getElementById('fw-feed') as HTMLElement).innerHTML;
}

/** The three bar numbers, in order: high, medium, low. */
function bars(html: string): number[] {
  const upTo = html.indexOf('fw-people') >= 0 ? html.slice(0, html.indexOf('fw-people')) : html;
  const head = upTo.slice(0, upTo.indexOf(I18N.en.feedTechniquesHeader) >= 0 ? upTo.indexOf(I18N.en.feedTechniquesHeader) : upTo.length);
  return [...head.matchAll(/<span class="fw-barnum">(\d+)<\/span>/g)].slice(0, 3).map((m) => Number(m[1]));
}

/** The per-account rows only, without the item cards that follow them. */
function peopleBlock(html: string): string {
  const from = html.indexOf('fw-people');
  const to = html.indexOf('<article', from);
  return html.slice(from, to === -1 ? undefined : to);
}

/** The number in the flagged tile. */
function flaggedTile(html: string): number {
  const m = html.match(new RegExp(`<b>(\\d+)</b><span>${I18N.en.feedFlagged}</span>`));
  return Number(m?.[1]);
}

beforeEach(() => {
  document.body.innerHTML = '';
  delete (window as unknown as { __FW_EXPORT__?: unknown }).__FW_EXPORT__;
  seq = 0;
});

describe('the bars are the bands the filter names', () => {
  it('puts a severity 6 in high, where the filter label says it belongs', () => {
    // The old cut called 6 medium while the filter offered "High (6-10)".
    expect(bars(feed([judged(6)]))).toEqual([1, 0, 0]);
  });

  it('puts a severity 3 in medium, not low', () => {
    expect(bars(feed([judged(3)]))).toEqual([0, 1, 0]);
  });

  it('puts a severity 2 in low', () => {
    expect(bars(feed([judged(2)]))).toEqual([0, 0, 1]);
  });

  it('labels the bands with the numbers that define them, the filter’s own labels', () => {
    const html = feed([judged(7)]);
    expect(html).toContain(I18N.en.exposureSevHigh);
    expect(html).toContain(I18N.en.exposureSevMid);
    expect(html).toContain(I18N.en.exposureSevLow);
  });
});

describe('a flag no model made is counted, and put in no band', () => {
  it('keeps a rule match in the tile and out of all three bars', () => {
    const html = feed([judged(7), ruleMatch()]);
    expect(flaggedTile(html)).toBe(2);
    expect(bars(html)).toEqual([1, 0, 0]);
  });

  it('names how many carry no level, rather than leaving the arithmetic broken', () => {
    const html = feed([judged(7), ruleMatch(), ruleMatch()]);
    expect(html).toContain(I18N.en.feedNoLevelNote.replace('{n}', '2'));
  });

  it('says nothing of the kind when every flag has a level', () => {
    const html = feed([judged(7), judged(4)]);
    expect(html).not.toContain('carry no level');
  });

  it('the bars and the note account for the tile exactly', () => {
    const html = feed([judged(9), judged(6), judged(4), judged(1), ruleMatch()]);
    const [hi, mid, lo] = bars(html);
    expect(hi + mid + lo + 1).toBe(flaggedTile(html));
  });
});

describe('the per-account rows are a breakdown of the tile above them', () => {
  it('leaves a flagged image record out, exactly as the tile does', () => {
    const html = feed([
      judged(7, { author: '@one' }),
      rec({ kind: 'image', verdict: 'flagged', author: '@one', techniques: [{ name: 'fear-appeal', severity: 7, confidence: 0.9 }] }),
    ]);
    expect(flaggedTile(html)).toBe(1);
    const block = peopleBlock(html);
    expect(block).toContain(`1 ${I18N.en.feedPeopleItems}`);
    expect(block).not.toContain(`2 ${I18N.en.feedPeopleItems}`);
  });

  it('leaves a paid placement out of the rows too', () => {
    const html = feed([
      judged(7, { author: '@one' }),
      rec({ author: '@advertiser', accountType: 'advertiser', verdict: 'flagged', techniques: [{ name: 'fear-appeal', severity: 9, confidence: 1 }] }),
    ]);
    const block = peopleBlock(html);
    expect(block).toContain('@one');
    expect(block).not.toContain('@advertiser');
  });

  it('counts a rule match, which is a flag the file acted on', () => {
    const html = feed([ruleMatch({ author: '@two' })]);
    const block = peopleBlock(html);
    expect(block).toContain('@two');
    expect(flaggedTile(html)).toBe(1);
  });
});
