/** @vitest-environment jsdom */
//
// What the Tester's reads of the committed export left open (12 Oct 2026, export polish U9). Read on a built demo export, in a browser and
// on paper:
//   - the five verbatim AI instruction boxes kept their screen height on paper and cut the text mid-line (276 px shown of 2,669 for the
//     comment judge); on paper none of the five reached its last line, and all five do now;
//   - paragraphs held a line of 647 px, 87 to 94 letters, not the 72 the row wanted (in this face 60 zero widths hold 67 letters, 65 hold 75 to 77, 62 hold 71 to 73);
//   - the beta pill went from cream to grey when the boxes moved to the well; it is warm again, from the page's warn token;
//   - the reconciliation badge named a literal grey (#6b7686) that a later rule overrides: it reads the muted token now;
//   - the dot of 'your rule: ...' was a purple (#7b1fa2) beside the technique violet and dim on the dark page: it is a diamond in the ink.

import { describe, expect, it, beforeEach } from 'vitest';
import { buildForensicHtmlExport, FEED_SCRIPT, type ExportMetadata } from '../../../src/forensics/html-export';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';
import type { ForensicRecord } from '../../../src/types/forensic';

const META: ExportMetadata = {
  fwVersion: 'V1.0.0-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' }, publicKeyFingerprint: 'fp16', locale: 'en',
};
let seq = 0;
function rec(overrides: Partial<ForensicRecord> = {}): ForensicRecord {
  seq++;
  return {
    id: `l-${seq}`, timestamp: new Date(Date.parse('2026-09-15T10:00:00Z') + seq * 60_000).toISOString(), platform: 'twitter',
    originalText: `post ${seq}`, originalHash: `h-${seq}`, originalLength: 6, neutralizedText: '', author: `@a${seq}`, postUrl: '',
    techniques: [], overallScore: 0, userAgeCategory: 'teen', aiSource: 'cloud', feedSource: 'for-you', integrityHash: `i-${seq}`,
    signature: 'sig', publicKeyFingerprint: 'fp', chainPosition: seq, kind: 'post', verdict: 'pass', ...overrides,
  } as ForensicRecord;
}

const html = buildForensicHtmlExport([rec()], META);
const style = html.match(/<style>([\s\S]*?)<\/style>/)![1].replace(/\/\*[\s\S]*?\*\//g, '');

function blocks(selector: string, sheet: string = style): string[] {
  const out: string[] = [];
  for (const m of sheet.matchAll(/(^|[}\n])\s*([^{}@/][^{}]*)\{([^{}]*)\}/g)) {
    if (m[2].split(',').map((x) => x.trim()).includes(selector)) out.push(m[3].replace(/\s+/g, ' '));
  }
  return out;
}
function media(head: string): string {
  const at = style.lastIndexOf(head);
  expect(at, `a ${head} block`).toBeGreaterThan(-1);
  const open = style.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < style.length; i++) {
    if (style[i] === '{') depth++;
    if (style[i] === '}' && --depth === 0) return style.slice(open + 1, i);
  }
  throw new Error('unbalanced');
}

beforeEach(() => { document.body.innerHTML = ''; seq = 0; });

describe('the verbatim AI instructions print whole (the Tester\'s fault on paper)', () => {
  const print = media('@media print');

  it('keeps the screen height of the box on the screen and lifts it on paper', () => {
    expect(blocks('.fw-mth-prompt pre')[0]).toContain('max-height:24em');
    expect(blocks('.fw-mth-prompt pre')[0]).toContain('overflow:auto');
    const onPaper = blocks('.fw-mth-prompt pre', print);
    expect(onPaper.length).toBeGreaterThan(0);
    expect(onPaper[onPaper.length - 1]).toContain('max-height:none');
    expect(onPaper[onPaper.length - 1]).toContain('overflow:visible');
  });

  it('leaves the time stamp tokens at their screen height on paper (8 to 9 thousand characters each, checked from the file)', () => {
    expect(blocks('.fw-anchor-tst', print)).toEqual([]);
    expect(blocks('.fw-anchor-tst')[0]).toContain('max-height:5.5em');
  });
});

describe('the small things (rows of the Tester\'s reads)', () => {
  it('holds a paragraph to about 72 letters: 62 zero widths, not 75', () => {
    const p = blocks('p').find((b) => b.includes('max-width'))!;
    expect(p).toContain('max-width:62ch');
    expect(style).not.toContain('max-width:75ch');
  });

  it('draws the beta pill warm from the warn token, in both schemes, not in the grey of the well', () => {
    const pill = blocks('.fw-beta')[0];
    expect(pill).toContain('background:color-mix(in oklab,var(--warn) 10%,var(--lift))');
    expect(pill).toContain('border:1px solid color-mix(in oklab,var(--warn) 35%,var(--line))');
    expect(pill).toContain('color:var(--amber)');
    expect(pill).not.toContain('var(--well)');
  });

  it('gives the reconciliation badge the muted token and leaves no literal grey of the old light page', () => {
    expect(blocks('.fw-recon-badge')[0]).toContain('color:var(--mut)');
    expect(style).not.toContain('#6b7686');
  });
});

describe('the dot of "your rule" is a shape, not a purple (the Tester\'s note on the technique violet)', () => {
  it('draws the dot of a user rule as a diamond in the ink, with no colour of its own on the element', () => {
    const records = [rec({
      verdict: 'blocked', aiSource: 'rules', detectionMode: 'block:ai-label:en', feedSource: 'video',
      techniques: [{ name: 'ai-content-block', severity: 10, confidence: 1 }], overallScore: 10,
    } as Partial<ForensicRecord>), rec()];
    const out = buildForensicHtmlExport(records, META);
    (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(out.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/)![1]);
    document.body.innerHTML = '<div id="fw-feed"></div>';
    new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${FEED_SCRIPT}`)();
    const tag = document.querySelector('#fw-feed .fw-tag-rule');
    expect(tag, 'a your-rule tag').not.toBeNull();
    const dot = tag!.querySelector('.fw-dot') as HTMLElement;
    expect(dot.classList.contains('fw-dot-rule')).toBe(true);
    expect(dot.getAttribute('style')).toBeNull();
    const rule = blocks('.fw-dot-rule')[0];
    expect(rule).toContain('background:var(--ink)');
    expect(rule).toContain('border-radius:0');
    expect(rule).toContain('transform:rotate(45deg)');
    expect(FEED_SCRIPT).not.toContain('#7b1fa2');
  });
});
