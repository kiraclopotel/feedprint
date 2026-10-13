// What the export prints (12 Oct 2026, the export sweep's first finding). The print rule hid every button, and the numbers in "What the
// feed showed" are buttons, so a printed export kept its row and column names and lost every number; the bars of its charts are
// backgrounds, which a print dialog leaves off by default; a card, a table row and a box were cut by page edges; and a dark device
// printed the accent colours meant for a dark ground. The page's own CSS is the thing under test (a browser's print engine is not
// in this suite); the export sweep's PDF reads are the check on a real page, and the payload is checked byte for byte beside it.

import { describe, expect, it } from 'vitest';
import { buildForensicHtmlExport, type ExportMetadata } from '../../../src/forensics/html-export';
import type { ForensicRecord } from '../../../src/types/forensic';

const META: ExportMetadata = {
  fwVersion: 'V1.0.0-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' }, publicKeyFingerprint: 'fp16', locale: 'en',
};

function records(): ForensicRecord[] {
  return [1, 2, 3].map((n) => ({
    id: `fr-${n}`, timestamp: `2026-09-10T10:0${n}:00.000Z`, platform: 'twitter', originalText: `text ${n}`, originalHash: `hash-${n}`,
    originalLength: 6, neutralizedText: '', author: '@person', postUrl: '', techniques: [], overallScore: 0, userAgeCategory: 'teen',
    aiSource: 'cloud', feedSource: 'for-you', integrityHash: `ih-${n}`, signature: 'sig', publicKeyFingerprint: 'fp16', chainPosition: n,
    verdict: 'pass', kind: 'post',
  }) as unknown as ForensicRecord);
}

const html = buildForensicHtmlExport(records(), META);
const style = html.match(/<style>([\s\S]*?)<\/style>/)![1];

/** The text between the braces of the last @media print block. */
function printBlock(css: string): string {
  const start = css.lastIndexOf('@media print');
  expect(start, 'the page has a print rule').toBeGreaterThan(-1);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(css.indexOf('{', start) + 1, i);
  }
  throw new Error('the print rule never closes');
}
const print = printBlock(style);
const rules = print.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((r) => r.trim()).filter(Boolean).map((r) => r + '}');
const ruleFor = (needle: string): string => {
  const r = rules.find((x) => x.includes(needle));
  expect(r, `a print rule for ${needle}`).toBeDefined();
  return r!;
};

describe('what acts on a page does not print, and a figure that is a button does', () => {
  it('hides the buttons that act, by name, and no longer every button', () => {
    const hide = ruleFor('display:none');
    expect(hide).toContain('button:not(.fw-num)');
    for (const acts of ['.fw-filters', '.fw-blur-toggle', '.fw-marks']) expect(hide).toContain(acts);
    expect(rules.some((r) => /^button\s*[,{]/.test(r) && r.includes('display:none')), 'no rule hides every button').toBe(false);
  });

  it('prints the numbers table figures plain and in place, pressed or not, against the ID rule that styles them on screen', () => {
    const figure = ruleFor('#fw-reading-numbers .fw-num,');
    expect(figure).toContain('text-decoration:none');
    expect(figure).toContain('background:none');
    expect(figure).toContain('padding:0');
    // The on-screen rule that outranks a class selector is the one the print rule has to meet.
    expect(style).toMatch(/#fw-reading-numbers button\{[^}]*underline dotted/);
  });

  it('leaves the screen look of a figure as it was', () => {
    expect(style).toMatch(/\.fw-num\{font:inherit;background:none;border:0;padding:\.1rem \.3rem;[^}]*text-decoration:underline dotted;\}/);
  });
});

describe('what a page of paper does to the rest', () => {
  it('prints backgrounds as drawn, so the bars of a chart and the coloured edges are not lost to a default dialog', () => {
    expect(ruleFor('print-color-adjust')).toMatch(/html\{[^}]*-webkit-print-color-adjust:exact;print-color-adjust:exact/);
  });

  it('does not cut a card, a table row or a box with a page edge, and does not leave a heading alone at a page foot', () => {
    const keep = ruleFor('break-inside:avoid');
    for (const part of ['.fw-item', '.fw-numbers tr', '.fw-opinion', '.fwb-card', '.fw-barrow']) expect(keep).toContain(part);
    expect(ruleFor('break-after:avoid')).toContain('h2');
  });

  it('puts the accent colours back to their light values and the scheme to light, so a dark device prints dark ink on white', () => {
    const tokens = ruleFor('--ground:#fff');
    for (const t of ['--ink:#000', '--record:#4531c9', '--ok:#246b2b', '--warn:#8a4b00', '--danger:#b3261e', 'color-scheme:light']) expect(tokens).toContain(t);
  });
});

describe('a page of paper has its own margin and no box loses its edge to it (export print unit, 12 Oct 2026)', () => {
  const noComments = style.replace(/\/\*[\s\S]*?\*\//g, '');

  it('sets the page margin to 16 mm, so the dialog default no longer puts a box edge on the edge of the printable area', () => {
    expect(noComments).toMatch(/@page\{margin:16mm;\}/);
  });

  it('keeps two pixels at each side of the body in print, whatever the paper, and lets the body be as wide as the page', () => {
    expect(ruleFor('box-shadow:none')).toMatch(/body\{[^}]*margin:0 auto;padding:0 2px;max-width:none;box-shadow:none;/);
  });

  it('underlines the link to the original post, whose address prints beside it in the code panel', () => {
    expect(ruleFor('a.fw-source-link')).toContain('text-decoration:underline');
  });

  it('leaves out the line that tells a reader to click a number', () => {
    expect(ruleFor('.fw-numbers-hint')).toContain('display:none !important');
  });

  it('shows the "not shown yet" line on paper only, in muted ink', () => {
    // On screen the button says it; the line is hidden there and shown in print.
    expect(noComments).toMatch(/\n\.fw-print-note\{display:none;\}/);
    expect(ruleFor('.fw-print-note{display:block')).toContain('color:var(--mut)');
    // An empty line (the verification list with nothing undrawn that failed) takes no room.
    expect(ruleFor('.fw-print-note:empty')).toContain('display:none');
  });
});

describe('the print rule changes the style block only', () => {
  it('holds the signed payload as one script of data, outside the style block', () => {
    const payload = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
    expect(payload).not.toBeNull();
    expect(payload![1]).toContain('"signature":"sig"');
    expect(style).not.toContain('fw-export-data');
  });
});

describe('the rest of what paper needs (export unit E1)', () => {
  it('leaves a passed verification row out unless the reader opened it, and always prints a row that did not pass', () => {
    const hide = ruleFor('#fw-results details');
    expect(hide).toContain('details.fw-record.fw-pass:not([open])');
    expect(hide).toContain('display:none');
    expect(hide).not.toMatch(/fw-fail|fw-warn/);
  });

  it('wraps a long label inside a third of the width instead of giving it half the page', () => {
    const labels = ruleFor('fit-content(32%)');
    for (const dl of ['.fw-summary dl', '.fw-methodology dl', '.fw-anchor dl']) expect(labels).toContain(dl);
    expect(labels).toContain('grid-template-columns:fit-content(32%) 1fr');
  });

  it('puts the code beside its link, small, and drops the arrow that opens it', () => {
    expect(ruleFor('.fw-qr>summary')).toContain('display:none');
    expect(ruleFor('.fw-qr-holder svg')).toContain('width:72px');
    expect(ruleFor('.fw-qr-holder{')).toContain('display:flex');
  });
});
