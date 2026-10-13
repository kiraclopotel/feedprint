/** @vitest-environment jsdom */
//
// The export's numbers and bars say one thing each way (12 Oct 2026, export polish U7, rows 13, 30, 31, 32, 41, 45, 50). Read on a built
// demo export and on a 1700-record export in a browser:
//   - a count was written two ways on one page: '1,500' on the first screen and '1500' on a tile, a bar, a note and the file section;
//   - the bars had 360 px of empty between their words and their track (the label took 44 and 40 percent of the row);
//   - the five tiles of the feed were 183, 188, 167, 205 and 257 px wide, the two exposure tiles 375 and 520;
//   - the same figure was 1.6rem in a feed tile and 1.25rem in an exposure tile;
//   - the mini charts of 'Popularity when recorded' drew +63% and +476% as the same 22 px rise, in a colour of their own;
//   - a bar for a count of 1 in 1700 was drawn as if it were 0, and there was no zero line to read a bar from;
//   - a bar was full for its largest member (19 techniques of 84 flagged items drew as 100 percent, 1000 platform items as 100).

import { describe, expect, it, beforeEach } from 'vitest';
import {
  buildForensicHtmlExport, EXPOSURE_SCRIPT, FEED_SCRIPT, type ExportMetadata,
} from '../../../src/forensics/html-export';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';
import { decisionForLegacy } from '../../../src/content/record/decision';
import type { ForensicRecord } from '../../../src/types/forensic';

let seq = 0;
function rec(overrides: Partial<ForensicRecord> = {}): ForensicRecord {
  seq++;
  return {
    id: `n-${seq}`, timestamp: new Date(Date.parse('2026-09-15T10:00:00Z') + seq * 60_000).toISOString(), platform: 'twitter',
    originalText: `post ${seq}`, originalHash: `h-${seq}`, originalLength: 6, neutralizedText: '', author: `@a${seq}`, postUrl: '',
    techniques: [], overallScore: 0, userAgeCategory: 'teen', aiSource: 'cloud', feedSource: 'for-you', integrityHash: `i-${seq}`,
    signature: 'sig', publicKeyFingerprint: 'fp', chainPosition: seq, kind: 'post', verdict: 'pass', ...overrides,
  } as ForensicRecord;
}
const flagged = (name: string, platform: ForensicRecord['platform'], severity: number): ForensicRecord => rec({
  platform, verdict: 'flagged', overallScore: severity, techniques: [{ name, severity, confidence: 0.9 }],
  decision: decisionForLegacy({ mode: 'teen', detectionMode: 'ai-judge', techniques: [name], severity, applied: 'mark', mask: false }),
  reader: 'default',
});

// 1700 records: 1599 + 80 on X (80 flagged High, fear-appeal), 20 on YouTube (15 flagged Medium, anger-trigger), 1 on TikTok.
function bigFile(): ForensicRecord[] {
  const out: ForensicRecord[] = [];
  for (let i = 0; i < 1599; i++) out.push(rec());
  for (let i = 0; i < 80; i++) out.push(flagged('fear-appeal', 'twitter', 7));
  for (let i = 0; i < 15; i++) out.push(flagged('anger-trigger', 'youtube', 4));
  for (let i = 0; i < 5; i++) out.push(rec({ platform: 'youtube' }));
  out.push(rec({ platform: 'tiktok' }));
  return out;
}

const metaOf = (locale: ExportMetadata['locale'] = 'en'): ExportMetadata => ({
  fwVersion: 'V1.0.0-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' }, publicKeyFingerprint: 'fp16', locale,
});

function mount(records: ForensicRecord[], script: string, rootId: string, locale: ExportMetadata['locale'] = 'en'): HTMLElement {
  const html = buildForensicHtmlExport(records, metaOf(locale));
  const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
  (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(m![1]);
  document.body.innerHTML = `<div id="${rootId}"></div>`;
  new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${script}`)();
  return document.getElementById(rootId) as HTMLElement;
}

const texts = (root: ParentNode, sel: string): string[] => [...root.querySelectorAll(sel)].map((n) => (n.textContent ?? '').trim());
const widthOf = (row: Element, sel: string): string => ((row.querySelector(sel) as HTMLElement).style.width);
const rowFor = (root: ParentNode, rowSel: string, label: string): Element => {
  const row = [...root.querySelectorAll(rowSel)].find((r) => (r.textContent ?? '').toLowerCase().includes(label.toLowerCase()));
  expect(row, `a bar row for ${label}`).toBeDefined();
  return row!;
};

beforeEach(() => { document.body.innerHTML = ''; seq = 0; });

describe('a count has its thousands separator wherever it is written (row 13)', () => {
  it('writes the feed tiles, a bar number and the paging note with the separator, in English', () => {
    const feed = mount(bigFile(), FEED_SCRIPT, 'fw-feed');
    const tiles = texts(feed, '.fw-stat b');
    expect(tiles[0], 'posts').toBe('1,700');
    expect(tiles).toContain('95');
    // The first page is 250 cards, so 1450 of the 1700 are not shown yet.
    expect(feed.textContent).toContain('1,450 records not shown yet');
  });

  it('writes the exposure tile and the platform bar numbers with the separator', () => {
    const exp = mount(bigFile(), EXPOSURE_SCRIPT, 'fw-exposure');
    expect(texts(exp, '.fw-exp-stat b')[0]).toBe('1,700');
    expect(rowFor(exp, '.fw-exp-barrow', 'X').querySelector('.fw-exp-barnum')!.textContent).toBe('1,679');
  });

  it('writes in the file\'s own language: Romanian groups with a point', () => {
    const feed = mount(bigFile(), FEED_SCRIPT, 'fw-feed', 'ro');
    expect(texts(feed, '.fw-stat b')[0]).toBe('1.700');
  });

  it('writes the file section\'s record count with the separator, and leaves the signed summary row in plain digits', () => {
    const html = buildForensicHtmlExport(bigFile(), metaOf('en'));
    // The row in the file section is not under the provenance digest.
    expect(html).toMatch(/<dt>[^<]*:<\/dt><dd>1,700<\/dd>/);
    // A row marked data-fw-prov is signed as written, and the checkers read the count that leads it.
    expect(html).toMatch(/data-fw-prov="recordCount">1700<\/dd>/);
    expect(buildForensicHtmlExport(bigFile(), metaOf('ro'))).toMatch(/<dt>[^<]*:<\/dt><dd>1\.700<\/dd>/);
  });
});

describe('a bar is a share of its whole, and a small share is still drawn (rows 45, 50)', () => {
  it('draws the technique bars of the feed as the share of the flagged items that carry the technique', () => {
    const feed = mount(bigFile(), FEED_SCRIPT, 'fw-feed');
    const lists = [...feed.querySelectorAll('.fw-barlist')];
    const techniques = lists[lists.length - 1];
    // 80 of 95 flagged items carry fear-appeal and 15 of 95 carry anger-trigger; neither bar is full, and the larger one is not 100.
    expect(widthOf(rowFor(techniques, '.fw-barrow', 'fear'), '.fw-barfill')).toBe('84%');
    expect(widthOf(rowFor(techniques, '.fw-barrow', 'anger'), '.fw-barfill')).toBe('16%');
  });

  it('draws the technique and platform bars of the exposure summary against their whole', () => {
    const exp = mount(bigFile(), EXPOSURE_SCRIPT, 'fw-exposure');
    expect(widthOf(rowFor(exp, '.fw-exp-barrow', 'fear'), '.fw-exp-barfill')).toBe('84%');
    // 1679 of 1700 content events are on X, so its bar is not the whole track by virtue of being the largest.
    expect(widthOf(rowFor(exp, '.fw-exp-barrow', 'X'), '.fw-exp-barfill')).toBe('99%');
    expect(widthOf(rowFor(exp, '.fw-exp-barrow', 'YouTube'), '.fw-exp-barfill')).toBe('1%');
  });

  it('draws a count of one in 1700 as one percent of the track, not as an empty one', () => {
    const exp = mount(bigFile(), EXPOSURE_SCRIPT, 'fw-exposure');
    expect(widthOf(rowFor(exp, '.fw-exp-barrow', 'TikTok'), '.fw-exp-barfill')).toBe('1%');
  });

  it('keeps a bar for a count of zero empty', () => {
    const feed = mount(bigFile(), FEED_SCRIPT, 'fw-feed');
    const low = rowFor(feed, '.fw-barrow', 'Low');
    expect(widthOf(low, '.fw-barfill')).toBe('0%');
  });
});

describe('the mini chart of "Popularity when recorded" is drawn from zero (row 41)', () => {
  const series = (url: string, from: number, to: number): ForensicRecord[] => [
    rec({ postUrl: url, metrics: { likes: from } } as Partial<ForensicRecord>),
    rec({ postUrl: url, metrics: { likes: to } } as Partial<ForensicRecord>),
  ];
  const rise = (svg: Element): number => {
    const pts = (svg.querySelector('polyline')!.getAttribute('points') ?? '').split(' ').map((p) => Number(p.split(',')[1]));
    return pts[0] - pts[pts.length - 1];
  };

  it('does not draw +63 percent and +476 percent as the same rise', () => {
    const feed = mount([...series('https://x.com/a/status/1', 100, 163), ...series('https://x.com/b/status/2', 100, 576)], FEED_SCRIPT, 'fw-feed');
    // Each of the four cards (two records for each address) carries the chart of its address; there are two different charts.
    const sparks = [...feed.querySelectorAll('.fw-spark')];
    expect(sparks.length).toBe(4);
    const rises = [...new Set(sparks.map((s) => Math.round(rise(s) * 100) / 100))].sort((x, y) => x - y);
    expect(rises.length).toBe(2);
    const [a, b] = rises;
    // The chart is 28 px high with 3 px of padding: from zero a rise to the maximum is at most 22 px, and a larger relative rise is a taller one.
    expect(a).toBeLessThan(12);
    expect(b).toBeGreaterThan(a * 1.5);
  });

  it('draws the line and its points in the record colour', () => {
    const feed = mount(series('https://x.com/a/status/1', 100, 163), FEED_SCRIPT, 'fw-feed');
    const spark = feed.querySelector('.fw-spark')!;
    expect(spark.querySelector('polyline')!.getAttribute('stroke')).toBe('var(--record)');
    expect([...spark.querySelectorAll('circle')].map((c) => c.getAttribute('fill'))).toEqual(['var(--record)', 'var(--record)']);
    expect(FEED_SCRIPT).not.toContain('#0288a3');
  });
});

describe('the stylesheet for tiles and bars (rows 30, 31, 32, 50)', () => {
  const style = buildForensicHtmlExport([rec()], metaOf()).match(/<style>([\s\S]*?)<\/style>/)![1].replace(/\/\*[\s\S]*?\*\//g, '');
  const ruleOf = (selector: string): string => {
    const hits: string[] = [];
    for (const m of style.matchAll(/(^|[}\n])\s*([^{}@/][^{}]*)\{([^{}]*)\}/g)) {
      if (m[2].split(',').map((x) => x.trim()).includes(selector)) hits.push(m[3].replace(/\s+/g, ' '));
    }
    expect(hits.length, `a rule for ${selector}`).toBeGreaterThan(0);
    return hits[0];
  };

  it('gives a bar label the width of a label, so a bar starts near its words (row 30)', () => {
    expect(ruleOf('.fw-barrow .fw-barlabel')).toContain('flex:0 0 min(11rem,44%)');
    expect(ruleOf('.fw-exp-barlabel')).toContain('flex:0 0 min(11rem,40%)');
  });

  it('makes the tiles of a row as wide as each other with 12 px between them (row 31)', () => {
    expect(ruleOf('.fw-stat')).toContain('flex:1 1 0');
    expect(ruleOf('.fw-exp-stat')).toContain('flex:1 1 0');
    // Two exposure tiles with a date range in the large figure only sit side by side when each has room for it.
    expect(ruleOf('.fw-exp-stat')).toContain('min-width:180px');
    expect(ruleOf('.fw-glance')).toContain('gap:12px');
    expect(ruleOf('.fw-exp-glance')).toContain('gap:12px');
  });

  it('sets the figure of an exposure tile like the figure of a feed tile (row 32)', () => {
    const feedFigure = ruleOf('.fw-stat b');
    const expFigure = ruleOf('.fw-exp-stat b');
    for (const part of ['font-size:1.6rem', 'line-height:1.1', 'letter-spacing:-.02em']) {
      expect(feedFigure, 'feed tile').toContain(part);
      expect(expFigure, 'exposure tile').toContain(part);
    }
  });

  it('gives every bar track a zero line and a straight left edge to start from (row 50)', () => {
    for (const sel of ['.fw-exp-bartrack', '.fw-barrow .fw-bartrack']) {
      expect(ruleOf(sel), sel).toContain('border-left:1px solid var(--ink)');
      expect(ruleOf(sel), sel).toContain('border-radius:0 4px 4px 0');
    }
    expect(ruleOf('.fw-exp-barfill')).toContain('border-radius:0 4px 4px 0');
    expect(ruleOf('.fw-barrow .fw-barfill')).toContain('border-radius:0 4px 4px 0');
  });
});
