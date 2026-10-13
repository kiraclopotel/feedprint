// What the first screen of the export does (12 Oct 2026, export polish U1). Read on a rendered page, light and dark: the page
// title was the size of a section title, the platform names sat below their numbers, the total row had a two-pixel rule under
// one cell only and no weight, the box under "Verify all records" had a blank band above its title and the page dropped by
// its height when it filled, the verify button did nothing on hover or press, the sheet had the same ground as the page
// around it, and running text went the full width of the sheet. The page's own CSS is the thing under test (a browser's
// layout engine is not in this suite); the sweep's pictures and measures of a built file are the check on a real page, and
// the signed payload is checked byte for byte beside it.

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
const noComments = style.replace(/\/\*[\s\S]*?\*\//g, '');

/** The body of the last rule whose selector list is exactly `selector`. */
function lastRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const all = [...noComments.matchAll(new RegExp(`(?:^|[}\\n])\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g'))];
  expect(all.length, `a rule for ${selector}`).toBeGreaterThan(0);
  return all[all.length - 1][1];
}
const printBlock = noComments.slice(noComments.lastIndexOf('@media print'));

describe('the title, the brand and the sheet lead the page', () => {
  it('sets the page title above the section titles, which stay where they were', () => {
    expect(lastRule('.fw-cert-top h1')).toMatch(/font-size:1\.5rem/);
    expect(lastRule('.fw-cert-top h1')).not.toMatch(/font-size:1\.15rem/);
    expect(noComments).toMatch(/h2\{margin:2\.5rem 0 \.75rem;\}/);
  });

  it('draws the brand dot larger with a ring that a box-shadow reset cannot remove, and gives the row room', () => {
    const dot = lastRule('.fw-brand-dot');
    expect(dot).toContain('width:14px');
    expect(dot).toContain('height:14px');
    expect(dot).toMatch(/outline:3px solid color-mix\(in oklab,var\(--record\) 20%,transparent\)/);
    expect(lastRule('.fw-brandrow')).toMatch(/gap:12px;margin-bottom:14px/);
  });

  it('lifts the sheet off the page with a shadow in both schemes: a dark one on a light page, a heavier dark one on a dark page', () => {
    // The sheet's own rule (the one that sets the face), not the narrow-screen or the print one.
    expect(noComments).toMatch(/body\{font-family:[^}]*box-shadow:var\(--sheet-shadow\)[^}]*\}/);
    const tokens = noComments.match(/--sheet-shadow:([^;]+);/g)!;
    expect(tokens.length, 'one token for each scheme').toBe(2);
    expect(tokens[0]).toContain('color-mix(in oklab,var(--ink) 10%,transparent)');
    expect(tokens[1]).toContain('rgb(0 0 0 /');
    // The descendants keep their reset; only the sheet itself carries the shadow.
    expect(noComments).toMatch(/body \*\{[^}]*box-shadow:none !important/);
  });

  it('does not print the shadow', () => {
    expect(printBlock).toMatch(/body\{[^}]*box-shadow:none/);
  });
});

describe('the numbers table lines up and closes on a real total', () => {
  it('puts a row head on the line of the numbers beside it, at the size of the cells', () => {
    const head = lastRule('#fw-reading-numbers tbody th');
    expect(head).toContain('vertical-align:middle');
    expect(head).toContain('font-size:var(--t3)');
    expect(head).toContain('padding:10px 8px');
    expect(lastRule('#fw-reading-numbers td')).toContain('vertical-align:middle');
    // The rule for the head row (bottom aligned, small) is untouched: the head row's cells are not in tbody.
    expect(lastRule('#fw-reading-numbers th')).toContain('vertical-align:bottom');
  });

  it('closes the table on a two-pixel rule across every cell, and sets the total in bold, its figures too', () => {
    const total = lastRule('#fw-reading-numbers .fw-numbers-total th,#fw-reading-numbers .fw-numbers-total td');
    expect(total).toContain('border-top:2px solid var(--edge)');
    expect(total).toContain('font-weight:700');
    expect(lastRule('#fw-reading-numbers .fw-numbers-total button')).toContain('font-weight:700');
  });
});

describe('the check box does not leave a blank band, jump the page, or answer dead', () => {
  it('starts its title at the box padding', () => {
    expect(lastRule('.fw-chain-summary h2')).toContain('margin-top:0');
  });

  it('keeps the room the filled box takes, so the page below does not drop when it fills; its margins stay inside the room', () => {
    const status = lastRule('#fw-status');
    expect(status).toContain('display:flow-root');
    expect(status).toContain('min-height:11.9rem');
  });

  it('gives the verify button a hover and a press that are not the rest colour, and leaves a disabled one alone', () => {
    const rest = lastRule('button#fw-verify-btn');
    expect(rest).toContain('background:var(--ink)');
    const hover = lastRule('button#fw-verify-btn:hover:not(:disabled)');
    const press = lastRule('button#fw-verify-btn:active:not(:disabled)');
    expect(hover).toContain('color-mix(in oklab,var(--ink) 82%,var(--ground))');
    expect(press).toContain('color-mix(in oklab,var(--ink) 66%,var(--ground))');
    expect(noComments).not.toMatch(/button#fw-verify-btn:hover\{background:var\(--ink\);\}/);
  });
});

describe('running text keeps a readable line', () => {
  it('caps a paragraph near 72 letters (62 zero widths) and avoids a last line of one word, but not a paragraph that is drawn as a box', () => {
    const p = lastRule('p');
    expect(p).toContain('max-width:62ch');
    expect(p).toContain('text-wrap:pretty');
    expect(lastRule('p.fw-disclaimer,p.fw-withheld')).toContain('max-width:none');
  });
});

describe('the first-screen rules change the style block only', () => {
  it('keeps the signed payload as one script of data, outside the style block', () => {
    const payload = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
    expect(payload).not.toBeNull();
    expect(payload![1]).toContain('"signature":"sig"');
    expect(style).not.toContain('fw-export-data');
  });
});
