//
// The export's text keeps an order a reader can see (12 Oct 2026, export polish U6, rows 14, 15, 20, 35, 36, 37, 38). Read on a built
// demo export in a browser:
//   - the summary's labels took 43 percent of the width and the values wrapped at about 390 px; the rows sat 5 px apart and every
//     value kept the browser's 40 px indent;
//   - the note under a cut text was body size in full ink, louder than the comment it footnotes (the class had no rule);
//   - the two small tables of 'How items were identified' had no rule: no cell padding, centred heads over left-aligned data, a
//     caption in three to five lines;
//   - the line above the first record card looked like the paragraph under it (no rule for the class);
//   - the grey notes inside the summary rows were on a 25 px pitch for 14 px text (the inline span took its parent's line box);
//   - the sub-title in each time-stamp card was larger than the text around it and unmarked;
//   - the serial tag was 11 px fixed in a line of 12.8 px text and sat a pixel above the time's baseline.

import { describe, expect, it } from 'vitest';
import { buildForensicHtmlExport, type ExportMetadata } from '../../../src/forensics/html-export';
import type { ForensicRecord } from '../../../src/types/forensic';

const META: ExportMetadata = {
  fwVersion: 'V1.0.0-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' }, publicKeyFingerprint: 'fp16', locale: 'en',
};
const REC = {
  id: 'r-1', timestamp: '2026-07-01T10:00:01.000Z', platform: 'twitter', originalText: 'post', originalHash: 'h', originalLength: 4,
  neutralizedText: '', author: '@user', postUrl: '', techniques: [], overallScore: 0, userAgeCategory: 'teen', aiSource: 'cloud',
  feedSource: 'for-you', integrityHash: 'deadbeef', signature: 'sig', publicKeyFingerprint: 'fp', chainPosition: 1, kind: 'post', verdict: 'pass',
} as unknown as ForensicRecord;

const html = buildForensicHtmlExport([REC], META);
const style = html.match(/<style>([\s\S]*?)<\/style>/)![1].replace(/\/\*[\s\S]*?\*\//g, '');

// The declaration blocks (outside a media query's own braces) whose selector list holds `selector`, in sheet order.
function blocks(selector: string, sheet: string = style): string[] {
  const out: string[] = [];
  for (const m of sheet.matchAll(/(^|[}\n])\s*([^{}@/][^{}]*)\{([^{}]*)\}/g)) {
    if (m[2].split(',').map((x) => x.trim()).includes(selector)) out.push(m[3].replace(/\s+/g, ' '));
  }
  return out;
}
const last = (selector: string, sheet?: string): string => {
  const b = blocks(selector, sheet);
  expect(b.length, `a rule for ${selector}`).toBeGreaterThan(0);
  return b[b.length - 1];
};
// The text between the braces of the first media query that starts with `head`.
function media(head: string): string {
  const at = style.indexOf(head);
  expect(at, `a ${head} block`).toBeGreaterThan(-1);
  const open = style.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < style.length; i++) {
    if (style[i] === '{') depth++;
    if (style[i] === '}' && --depth === 0) return style.slice(open + 1, i);
  }
  throw new Error('unbalanced');
}

describe('the summary lists have a label column that does not take the page (row 14)', () => {
  const lists = ['.fw-summary dl', '.fw-anchor dl', '.fw-methodology dl'];

  it('caps a label at 13rem, gives the value the rest, and puts 12 px between rows and 24 px between columns', () => {
    for (const sel of lists) {
      const rule = blocks(sel)[0];
      expect(rule, sel).toContain('grid-template-columns:minmax(0,13rem) minmax(0,1fr)');
      expect(rule, sel).toContain('gap:12px 24px');
      expect(rule, sel).not.toContain('auto 1fr');
    }
  });

  it('takes the browser indent off every value', () => {
    for (const sel of ['.fw-summary dd', '.fw-anchor dd', '.fw-methodology dd']) expect(blocks(sel)[0], sel).toContain('margin:0;');
  });

  it('stacks a label over its value on a narrow screen, and keeps the label that wraps inside a third of the page on paper', () => {
    const narrow = media('@media (max-width:640px)');
    expect(last('.fw-summary dl', narrow)).toContain('grid-template-columns:minmax(0,1fr)');
    expect(last('.fw-methodology dl', narrow)).toContain('gap:0');
    expect(last('.fw-summary dd', narrow)).toContain('margin:0 0 .7rem');
    expect(last('.fw-summary dl', media('@media print'))).toContain('grid-template-columns:fit-content(32%) 1fr');
  });
});

describe('a note under a cut text is a footnote (row 15)', () => {
  it('is on the second type step (0.8rem) in the muted ink with a line of its own height, smaller than the text it foots', () => {
    const rule = last('.fw-text-capture');
    expect(rule).toContain('font-size:var(--t2)');
    expect(rule).toContain('color:var(--mut)');
    expect(rule).toContain('line-height:1.45');
    expect(rule).toContain('margin:.2rem 0 .1rem');
  });
});

describe('the two small tables of "How items were identified" are tables (row 20)', () => {
  it('collapses their borders, fits them to the text column, and aligns heads and data to the left with room between columns', () => {
    const table = last('.fw-mth-floors');
    expect(table).toContain('border-collapse:collapse');
    expect(table).toContain('width:100%');
    expect(table).toContain('max-width:34rem');
    expect(last('.fw-mth-floors caption')).toContain('text-align:left');
    expect(last('.fw-mth-floors caption')).toContain('caption-side:top');
    expect(last('.fw-mth-floors td')).toContain('text-align:left');
    expect(last('.fw-mth-floors td')).toContain('padding:.25rem 1.5rem .25rem 0');
    expect(last('.fw-mth-floors td')).toContain('border-bottom:1px solid var(--line)');
    expect(last('.fw-mth-floors th')).toContain('color:var(--mut)');
  });
});

describe('the line above the first record card is a heading (row 35)', () => {
  it('is bold, tightened, with space above it and little below', () => {
    const rule = last('.fw-feed-opinion-head');
    expect(rule).toContain('font-weight:700');
    expect(rule).toContain('letter-spacing:-.01em');
    expect(rule).toContain('margin:1.5rem 0 .25rem');
  });
});

describe('the grey notes inside the summary rows keep a line of their own height (row 36)', () => {
  it('makes each of the three a block with a line of 1.45 and a small gap above', () => {
    for (const sel of ['.fw-coverage-note', '.fw-conditions-note', '.fw-stamp-note']) {
      const rule = last(sel);
      expect(rule, sel).toContain('display:block');
      expect(rule, sel).toContain('line-height:1.45');
      expect(rule, sel).toContain('margin-top:.2rem');
    }
  });
});

describe('the sub-title of a time-stamp card is marked (row 37)', () => {
  it('is on the third type step (0.9rem), larger than the line text, bold and a tone darker than the muted ink', () => {
    const rule = last('.fw-anchor-check .section-label');
    expect(rule).toContain('font-size:var(--t3)');
    expect(rule).toContain('font-weight:600');
    expect(rule).toContain('color:var(--text2)');
  });
});

describe("the serial tag follows the reader's text size (row 38)", () => {
  it("is on the type scale (second step, 0.8rem), not 11 px, with tabular figures and a line height that keeps it on the time's baseline", () => {
    const rule = last('.fw-item-serial');
    expect(rule).toContain('font-size:var(--t2)');
    expect(rule).not.toContain('11px');
    expect(rule).toContain('font-variant-numeric:tabular-nums');
    expect(rule).toContain('line-height:1.3');
  });

  it("lines the platform chip, the time and the serial up on one text baseline instead of centring their boxes", () => {
    const line = last('.fw-item-line2');
    expect(line).toContain('align-items:baseline');
    expect(line).not.toContain('align-items:center');
  });
});
