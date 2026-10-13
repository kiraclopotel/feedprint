//
// The export's controls behave like controls (12 Oct 2026, export polish U5, rows 16, 18, 33, 34, 40, 43, 53). Read on a built demo
// export in a browser:
//   - the link 'open original post' dropped 121 px below its line when the code panel opened (the row centred its children);
//   - the button that shows the next 500 records had a 1.7:1 edge (the house rule forced the line colour onto it), the same fill as
//     the rows above it, regular weight and no hover;
//   - the four filter selects had a 6 x 3 px chevron, an arrow pointer and no hover, and read as underlined text;
//   - the 'blur authors' box was the browser's 13 px box, off the column edge, with an arrow pointer on its label;
//   - the 'scan code to open' and 'show original' summaries had no hover and a target about 18 px tall;
//   - no pressable had a focus ring of its own (the browsers' rings differ per control);
//   - nothing guarded a reader who asked for no motion.

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
const compact = style.replace(/\s+/g, ' ');

// Every declaration block whose selector list contains exactly `selector` as one of its comma-separated selectors.
function blocks(selector: string): string[] {
  const out: string[] = [];
  for (const m of style.matchAll(/(^|[}\n])\s*([^{}@/][^{}]*)\{([^{}]*)\}/g)) {
    const sels = m[2].split(',').map((x) => x.trim());
    if (sels.includes(selector)) out.push(m[3].replace(/\s+/g, ' '));
  }
  return out;
}
const last = (selector: string): string => {
  const b = blocks(selector);
  expect(b.length, `a rule for ${selector}`).toBeGreaterThan(0);
  return b[b.length - 1];
};

describe('the link and the code panel start on one line (row 16)', () => {
  it('lines the source row up by baseline, so the link and the summary read on one line and the link keeps it when the panel opens', () => {
    const row = last('.fw-source');
    expect(row).toContain('align-items:baseline');
    expect(row).not.toContain('align-items:center');
  });
});

describe('the "show the next 500" button is a control (row 18)', () => {
  it('has the control edge, a heavier weight and a roomier target, after the house rule that forces the line colour on boxes', () => {
    const rule = last('.fw-feed-more');
    expect(rule).toContain('border:2px solid var(--edge) !important');
    expect(rule).toContain('font-weight:600');
    expect(rule).toContain('padding:.7rem 1.2rem');
    // The house rule that sets the line colour is earlier in the sheet: the button's own rule comes after it and wins.
    const house = compact.indexOf('.fwb-chip.adv,.fw-feed-more{background:var(--lift) !important');
    const own = compact.indexOf('.fw-feed-more{border:2px solid var(--edge) !important');
    expect(house).toBeGreaterThan(-1);
    expect(own).toBeGreaterThan(house);
  });

  it('inverts on hover, in the page ink and ground, so it answers a pointer in both schemes', () => {
    const hover = last('.fw-feed-more:hover');
    expect(hover).toContain('background:var(--ink) !important');
    expect(hover).toContain('color:var(--ground) !important');
  });
});

describe('the filter selects read as menus (row 33)', () => {
  it('draws a 6 px chevron with room for it, a hand pointer and a hover edge in the ink', () => {
    const sel = last('.fw-filters select');
    expect(sel).toContain('background-size:6px 6px,6px 6px');
    expect(sel).toContain('background-position:right 9px top 52%,right 3px top 52%');
    expect(sel).toContain('padding:4px 24px 4px 2px');
    expect(sel).toContain('cursor:pointer');
    expect(sel).not.toContain('background-size:4px 4px');
    expect(last('.fw-filters select:hover')).toContain('border-bottom-color:var(--ink) !important');
  });
});

describe('the blur-authors box is a drawn control (row 34)', () => {
  it('is 16 px in the page ink, on the column edge, level with its label, and both box and label take a hand pointer', () => {
    const box = last('#fw-blur-authors');
    expect(box).toContain('accent-color:var(--ink)');
    expect(box).toContain('width:16px');
    expect(box).toContain('height:16px');
    expect(box).toContain('margin:0 8px 0 0');
    expect(box).toContain('vertical-align:-3px');
    expect(box).toContain('cursor:pointer');
    expect(blocks('.fw-blur-toggle').join(' ')).toContain('cursor:pointer');
  });
});

describe('the two disclosure summaries have a hover and a target (row 40)', () => {
  it('pads both summaries and underlines them in the ink on hover', () => {
    expect(last('.fw-qr summary')).toContain('padding:3px 0');
    expect(last('.fw-orig-details summary')).toContain('padding:3px 0');
    const hover = last('.fw-qr summary:hover');
    expect(hover).toContain('color:var(--ink)');
    expect(hover).toContain('text-decoration:underline');
    expect(hover).toContain('text-underline-offset:3px');
    expect(blocks('.fw-orig-details summary:hover')).toEqual(blocks('.fw-qr summary:hover'));
  });
});

describe('one focus ring for every pressable (row 43)', () => {
  it('draws a 2 px ring in the record colour, offset 2 px, for keyboard focus only, on every kind of pressable', () => {
    const m = compact.match(/:is\(([^)]*)\):focus-visible\{([^}]*)\}/);
    expect(m, 'a :focus-visible rule').not.toBeNull();
    const kinds = m![1].split(',').map((x) => x.trim());
    for (const k of ['button', 'select', 'input', 'summary', 'a', '[role="button"]']) expect(kinds, k).toContain(k);
    expect(m![2]).toContain('outline:2px solid var(--record)');
    expect(m![2]).toContain('outline-offset:2px');
    // The older dotted focus rule on a bar link stays, and the ring is declared after it, so a keyboard reader sees the ring.
    expect(compact.indexOf(':focus-visible{')).toBeGreaterThan(compact.indexOf('.fw-exp-barrow-link:hover,.fw-exp-barrow-link:focus'));
  });

  it('never removes the browser ring without giving another', () => {
    expect(style).not.toMatch(/outline\s*:\s*(none|0)\b/);
  });
});

describe('a reader who asked for no motion gets none (row 53)', () => {
  it('shortens every transition and animation and turns smooth scrolling off under prefers-reduced-motion', () => {
    const m = compact.match(/@media \(prefers-reduced-motion:reduce\)\{([^@]*?)\}\}/) ?? compact.match(/@media \(prefers-reduced-motion:reduce\)\{(.*?)\}/);
    expect(m, 'a reduced-motion block').not.toBeNull();
    expect(m![1]).toContain('*,*::before,*::after');
    expect(m![1]).toContain('transition-duration:.01ms !important');
    expect(m![1]).toContain('animation-duration:.01ms !important');
    expect(m![1]).toContain('scroll-behavior:auto !important');
  });
});
