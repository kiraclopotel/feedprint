// Page one may not say "no gaps" over a file that holds the recorder's own signed gaps.
//
// Found 2026-09-20 by exporting a chain in which the product's own code had written one of
// every marker kind. Page one's signed row read "None. This file begins at the start of the
// chain and has no gaps in it." The file held ten gap markers: six recorder-down stretches
// adding up to 140 hours, a chain-lost marker at position 0 saying entries the install had
// were gone, and three counted losses. The row was computed from chain positions alone, and
// "gaps" is also the product's own word for those markers, so the sentence denied what the
// list under it said under the same signature. A reset that opened a later run was reported
// nowhere on page one either: only the first run's opener was read.

import { describe, it, expect } from 'vitest';
import { buildForensicHtmlExport, computeChainCoverage, I18N, type ExportMetadata } from '../../../src/forensics/html-export';
import { UI_LANGUAGES } from '../../../src/i18n';
import type { ForensicRecord } from '../../../src/types/forensic';

let seq = 0;
function rec(chainPosition: number, overrides: Partial<ForensicRecord> = {}): ForensicRecord {
  seq++;
  return {
    id: `g-${seq}`, timestamp: `2026-09-${String(10 + (seq % 15)).padStart(2, '0')}T10:00:00Z`, platform: 'twitter',
    originalText: 'a post', originalHash: 'h', originalLength: 6, neutralizedText: '',
    author: '@someone', postUrl: `https://x.com/someone/status/${seq}`, techniques: [],
    overallScore: 0, userAgeCategory: 'adult', aiSource: 'none', feedSource: 'for-you',
    integrityHash: `hash-${seq}`, signature: 'sig', publicKeyFingerprint: 'fp',
    chainPosition, kind: 'post', verdict: 'pass', ...overrides,
  } as ForensicRecord;
}
const gap = (pos: number): ForensicRecord => rec(pos, {
  kind: 'gap-marker', detectionMode: 'gap-marker', author: '', postUrl: '',
  originalText: 'gap-marker reason=recorder-down from=2026-09-11T00:00:00.000Z to=2026-09-12T00:00:00.000Z count=0',
  resetReason: 'gap: no heartbeat between 2026-09-11T00:00:00.000Z and 2026-09-12T00:00:00.000Z',
});
const reset = (timestamp: string): ForensicRecord => rec(0, { kind: 'reset-marker', detectionMode: 'reset-marker', author: '', postUrl: '', timestamp });

function meta(locale: ExportMetadata['locale'] = 'en'): ExportMetadata {
  return { fwVersion: 'V1.0.0-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' }, publicKeyFingerprint: 'fp16', locale };
}
function prov(html: string, name: string): string | null {
  const m = html.match(new RegExp(`<dd data-fw-prov="${name}">([\\s\\S]*?)</dd>`));
  return m ? m[1] : null;
}

describe('page one and the gaps the recorder signed', () => {
  it('counts the gap markers and the resets that open a later run', () => {
    const records = [rec(0), rec(1), gap(2), rec(3), reset('2026-09-20T08:00:00.000Z'), rec(1), gap(2)];
    const c = computeChainCoverage(records);
    expect(c.signedGaps).toBe(2);
    expect(c.resetsInside).toEqual(['2026-09-20T08:00:00.000Z']);
    expect(c.missingBefore).toBe(0);
    expect(c.gapsInside).toBe(0);
  });

  it('a whole chain with a signed gap names it on page one', () => {
    const html = buildForensicHtmlExport([rec(0), rec(1), gap(2), rec(3)], meta());
    const row = prov(html, 'signedGaps');
    expect(row, 'page one has no row for the signed gaps').not.toBeNull();
    expect(row!).toMatch(/^1\b/);
  });

  it('a whole chain with no marker keeps the all-clear and prints no gap row', () => {
    const html = buildForensicHtmlExport([rec(0), rec(1), rec(2)], meta());
    expect(prov(html, 'missingBefore')).toBe(I18N.en.summaryCoverageComplete);
    expect(prov(html, 'signedGaps')).toBeNull();
  });

  it('a reset that opens a later run is on page one, and the all-clear is not', () => {
    const html = buildForensicHtmlExport([rec(0), rec(1), reset('2026-09-20T08:00:00.000Z'), rec(1)], meta());
    const row = prov(html, 'resetsInside');
    expect(row, 'page one has no row for a reset inside the file').not.toBeNull();
    expect(row!).toContain('2026-09-20T08:00:00.000Z');
    // The sentence itself travels in the file's string table, so the row is what is read.
    expect(prov(html, 'missingBefore')).toBeNull();
  });

  it('a reset that opens the file is still the first-run row and is not repeated as one inside', () => {
    const html = buildForensicHtmlExport([reset('2026-09-20T08:00:00.000Z'), rec(1)], meta());
    expect(prov(html, 'chainReset')).toContain('2026-09-20T08:00:00.000Z');
    expect(prov(html, 'resetsInside')).toBeNull();
  });

  it('the all-clear is a sentence about positions in every language, and the gap row has its words', () => {
    // "gap" is the product's word for a signed marker, so the sentence about positions
    // may not use it: en gaps, ro goluri, es huecos, pt falhas or lacunas.
    const GAP_WORD = /\bgaps?\b|golu|hueco|falhas|lacuna/i;
    for (const lang of UI_LANGUAGES) {
      const t = I18N[lang];
      expect(t.summaryCoverageComplete, lang).not.toMatch(GAP_WORD);
      expect(t.summarySignedGaps, lang).toBeTruthy();
      expect(t.summarySignedGapsValue, lang).toContain('{n}');
      expect(t.summaryResetsInside, lang).toBeTruthy();
      expect(t.summaryResetsInsideValue, lang).toContain('{at}');
      const html = buildForensicHtmlExport([rec(0), gap(1)], meta(lang));
      expect(prov(html, 'signedGaps'), lang).toMatch(/^1\b/);
    }
  });
});
