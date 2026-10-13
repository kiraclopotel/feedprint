/** @vitest-environment jsdom */
//
// One colour for one meaning in the export (12 Oct 2026, export polish U4). Read on a built demo export:
//   - no card could show its level: the page's own sentence says the coloured edge is the Safety Signal Level, and a stylesheet rule
//     that forced every border to the line colour beat the colour the script sets on the card;
//   - a card's edge used other thresholds than the legend and the bars (a score of 6 or 7 counts as High and was drawn amber; 3 or
//     4 counts as Medium and was drawn in the Low colour), and an unflagged card had a pale grey edge that would show on a dark page;
//   - the same platform was three colours (X near-black on the tab, blue on the card, teal in the chart), and TikTok and the
//     Medium amber were washed out on the light sheet;
//   - eight technique hues, several of them the level colours (a red next to High, an amber next to Medium);
//   - a verification row that failed looked like the other four hundred and ninety-nine.

import { describe, expect, it, beforeEach } from 'vitest';
import {
  buildForensicHtmlExport, EXPOSURE_SCRIPT, FEED_SCRIPT, READING_SCRIPT, type ExportMetadata,
} from '../../../src/forensics/html-export';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';
import type { ForensicRecord } from '../../../src/types/forensic';

const META: ExportMetadata = {
  fwVersion: 'V1.0.0-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' }, publicKeyFingerprint: 'fp16', locale: 'en',
};

function rec(n: number, sev: number, flagged: boolean, platform = 'twitter'): ForensicRecord {
  return {
    id: `r-${n}`, timestamp: new Date(Date.UTC(2026, 6, 1, 10, 0, n)).toISOString(), platform, originalText: `post ${n} sev${sev}`,
    originalHash: 'h', originalLength: 6, neutralizedText: '', author: '@user', postUrl: '',
    techniques: sev > 0 ? [{ name: 'fear-appeal', severity: sev, confidence: 0.9 }] : [], overallScore: sev, userAgeCategory: 'teen',
    aiSource: 'cloud', feedSource: 'for-you', integrityHash: 'deadbeef', signature: 'sig', publicKeyFingerprint: 'fp', chainPosition: n,
    kind: 'post', verdict: flagged ? 'flagged' : 'pass',
  } as unknown as ForensicRecord;
}

function renderFeed(records: ForensicRecord[]): HTMLElement {
  const html = buildForensicHtmlExport(records, META);
  const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
  (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(m![1]);
  document.body.innerHTML = '<div id="fw-feed"></div>';
  new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${FEED_SCRIPT}`)();
  return document.getElementById('fw-feed') as HTMLElement;
}

// One record in a feed of its own: the card's inline edge colour, as written.
const edgeOf = (sev: number, flagged: boolean): string => {
  const feed = renderFeed([rec(1, sev, flagged)]);
  const card = feed.querySelector<HTMLElement>(':scope > .fw-item');
  expect(card, `a card for severity ${sev}`).not.toBeNull();
  return (card!.getAttribute('style') ?? '').replace(/\s+/g, '');
};

beforeEach(() => {
  document.body.innerHTML = '';
  delete (window as unknown as { __FW_EXPORT__?: unknown }).__FW_EXPORT__;
});

describe('a card edge follows the legend: High 6 to 10, Medium 3 to 5, Low under 3', () => {
  it('draws 6 and 7 as High, 3, 4 and 5 as Medium, 1 and 2 as Low, and an unflagged card in the page line colour', () => {
    for (const sev of [10, 7, 6]) expect(edgeOf(sev, true), `severity ${sev}`).toContain('border-left-color:#e53935');
    for (const sev of [5, 4, 3]) expect(edgeOf(sev, true), `severity ${sev}`).toContain('border-left-color:#c97a12');
    for (const sev of [2, 1]) expect(edgeOf(sev, true), `severity ${sev}`).toContain('border-left-color:#4fb3a9');
    expect(edgeOf(0, false)).toContain('border-left-color:var(--line)');
  });

  it('names the level colours once, so a bar, a swatch and a card edge cannot drift apart', () => {
    for (const script of [FEED_SCRIPT, EXPOSURE_SCRIPT]) {
      expect(script).toContain("'#e53935'");
      expect(script).toContain("'#c97a12'");
      expect(script).toContain("'#4fb3a9'");
      expect(script).not.toContain('#e0a458');
    }
    expect(FEED_SCRIPT).not.toContain('#cfcfcf');
  });
});

describe('the stylesheet lets the script colour a card edge, and shows a verification row that did not pass', () => {
  const style = buildForensicHtmlExport([rec(1, 0, false)], META).match(/<style>([\s\S]*?)<\/style>/)![1];

  it('forces the top, right and bottom edge of a card to the line colour and leaves its left edge to the script', () => {
    const rules = [...style.matchAll(/(?:^|[}\n])\s*\.fw-item\s*\{([^}]*)\}/g)].map((m) => m[1]);
    const house = rules.find((r) => r.includes('border-top-color:var(--line) !important'))!;
    expect(house, 'the house rule for a card').toBeDefined();
    expect(house).toContain('border-right-color:var(--line) !important');
    expect(house).toContain('border-bottom-color:var(--line) !important');
    expect(house).not.toMatch(/border-left-color/);
    // The shared list that forced every edge no longer names the card.
    expect(style).not.toMatch(/\.fw-item,\.fw-anchor,\.fw-mth-prompt/);
  });

  it('gives a warning row and a failed row their own edge and weight, a failed one its colour, and leaves a passed one neutral', () => {
    expect(style).toMatch(/\.fw-record\.fw-warn\{border-left-color:var\(--warn\) !important;\}/);
    expect(style).toMatch(/\.fw-record\.fw-fail\{border-left-color:var\(--danger\) !important;\}/);
    expect(style).toMatch(/\.fw-record\.fw-warn>summary,\.fw-record\.fw-fail>summary\{font-weight:600;\}/);
    expect(style).toMatch(/\.fw-record\.fw-fail>summary\{color:var\(--danger\) !important;\}/);
    expect(style).not.toMatch(/\.fw-record\.fw-pass\{[^}]*!important/);
  });
});

describe('a platform is one colour wherever it is drawn', () => {
  const mapOf = (script: string, name: string): string => {
    const m = script.match(new RegExp(`var ${name}=(\\{[^}]*\\});`));
    expect(m, `${name} in the script`).not.toBeNull();
    return m![1];
  };

  it('uses the same map for the card chip, the platform tab and the platform bars, and no platform is near-black or teal-washed', () => {
    const chip = mapOf(FEED_SCRIPT, 'PLAT');
    expect(mapOf(READING_SCRIPT, 'COLORS')).toBe(chip);
    expect(mapOf(EXPOSURE_SCRIPT, 'EXP_COLORS')).toBe(chip);
    expect(chip).toContain("twitter:'#1da1f2'");
    expect(chip).toContain("tiktok:'#0f8f98'");
    expect(chip).not.toContain('#1a1a1a');
    expect(chip).not.toContain('#69c9d0');
  });

  it('colours the platform bars by platform, not one teal for all five', () => {
    expect(EXPOSURE_SCRIPT).toContain("EXP_COLORS[p.name]||'#888'");
    expect(EXPOSURE_SCRIPT).not.toContain("'#0288a3',p.n,maxP");
  });

  it('draws the platform dot on a card in the platform colour', () => {
    const feed = renderFeed([rec(1, 0, false, 'tiktok')]);
    const dots = Array.from(feed.querySelectorAll<HTMLElement>('.fw-item .fw-dot')).map((d) => (d.getAttribute('style') ?? '').replace(/\s+/g, ''));
    expect(dots).toContain('background:#0f8f98');
  });
});

describe('a technique is one colour, the record colour, and borrows no level colour', () => {
  it('draws the dot of a technique on a card and its bar in the feed and in the exposure view in the record colour', () => {
    const feed = renderFeed([rec(1, 7, true)]);
    const tag = Array.from(feed.querySelectorAll<HTMLElement>('.fw-tag')).find((t) => (t.textContent ?? '').includes('fear'))
      ?? feed.querySelector<HTMLElement>('.fw-item .fw-tags .fw-tag')!;
    expect(tag, 'a technique tag on the card').not.toBeNull();
    expect((tag.querySelector('.fw-dot')!.getAttribute('style') ?? '').replace(/\s+/g, '')).toBe('background:var(--record)');
    expect(FEED_SCRIPT).toContain('TECH_COLOR,t.n,nFlag');
    expect(EXPOSURE_SCRIPT).toContain("'var(--record)',t.n,nFlagged,null");
    expect(FEED_SCRIPT).not.toContain("'fear-appeal':'#ef5350'");
    expect(FEED_SCRIPT).not.toContain('#d32f2f');
  });
});
