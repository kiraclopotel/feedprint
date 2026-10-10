// @vitest-environment jsdom
// A report holds the flagged records only, and three places in it spoke as if it were the feed.
//
// Found 2026-09-20 by building a chain of 71 records with the product's own writers,
// exporting it through the report's real path (applyExportGate then exportHtml) and reading
// the 10-record file against the same chain exported whole.
//
//   1. Page one: "Earlier records NOT in this file: 3 ... were removed from this install
//      before the export was made, so no export can contain them." Positions 0 to 2 were
//      passes, still on the install, and the whole export of the same chain held them.
//   2. Page one: "Held back: 61 operational metadata (verifier samples, comment-section room
//      verdicts, blocked videos), not retained observations." The 61 were 47 passes, 2 ads,
//      1 starred-swearing record and 11 markers: none of the three things named, and the
//      passes ARE retained observations.
//   3. The behaviour section: "The longest run was 10 flagged items in a row", "Baseline
//      flag rate 100%", "2 of 2 welcome-back items were flagged", and a cautious reading
//      that predicted an unbroken charged stretch. The same chain exported whole: longest
//      run 1, baseline 16.7%, welcome-back 0 of 2, no caution met.

import { describe, it, expect, beforeEach } from 'vitest';
import { buildForensicHtmlExport, BEHAVIOR_SCRIPT, I18N, type ExportMetadata } from '../../../src/forensics/html-export';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';
import { applyExportGate } from '../../../src/forensics/exporter';
import { UI_LANGUAGES } from '../../../src/i18n';
import type { ForensicRecord } from '../../../src/types/forensic';

let seq = 0;
function rec(chainPosition: number, verdict: ForensicRecord['verdict'], minute: number): ForensicRecord {
  seq++;
  const flagged = verdict === 'flagged';
  return {
    id: `s-${seq}`, timestamp: new Date(Date.parse('2026-09-18T10:00:00Z') + minute * 60_000).toISOString(),
    platform: 'twitter', originalText: `post ${seq}`, originalHash: `h${seq}`, originalLength: 6, neutralizedText: '',
    author: '@someone', postUrl: `https://x.com/someone/status/${seq}`,
    techniques: flagged ? [{ name: 'anger-trigger', severity: 6, confidence: 0.9 }] : [],
    overallScore: flagged ? 6 : 0, userAgeCategory: 'teen', aiSource: flagged ? 'groq' : 'none', feedSource: 'for-you',
    integrityHash: `hash-${seq}`, signature: 'sig', publicKeyFingerprint: 'fp',
    chainPosition, kind: 'post', verdict,
  } as ForensicRecord;
}

// Twelve records, every third one flagged, the first three passes: a feed whose longest
// flagged run is 1 and whose baseline is a third.
function chain(): ForensicRecord[] {
  return Array.from({ length: 12 }, (_, i) => rec(i, i % 3 === 0 && i > 0 ? 'flagged' : 'pass', i * 2));
}

function report(locale: ExportMetadata['locale'] = 'en'): { html: string; included: ForensicRecord[]; total: number } {
  const all = chain();
  const gate = applyExportGate(all, { minOverallScore: 0 });
  const meta: ExportMetadata = {
    fwVersion: 'V1.0.0-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' }, publicKeyFingerprint: 'fp16', locale,
    selection: {
      totalSource: gate.totalSource, included: gate.included.length, excludedUnreviewed: gate.excludedUnreviewed,
      excludedLowConfidence: gate.excludedLowConfidence, excludedNonDetection: gate.excludedNonDetection,
    },
  };
  return { html: buildForensicHtmlExport(gate.included, meta), included: gate.included, total: all.length };
}
function prov(html: string, name: string): string | null {
  const m = html.match(new RegExp(`<dd data-fw-prov="${name}">([\\s\\S]*?)</dd>`));
  return m ? m[1] : null;
}
function behaviourText(html: string): string {
  const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
  (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(m![1]);
  document.body.innerHTML = '<div id="fw-behavior"></div>';
  new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${BEHAVIOR_SCRIPT}`)();
  return (document.getElementById('fw-behavior') as HTMLElement).textContent ?? '';
}

beforeEach(() => {
  document.body.innerHTML = '';
  delete (window as unknown as { __FW_EXPORT__?: unknown }).__FW_EXPORT__;
});

describe('a report says it is a selection everywhere it counts', () => {
  it('the fixture is what the comment says: 3 flagged of 12, none of them adjacent', () => {
    const r = report();
    expect(r.included.length).toBe(3);
    expect(r.total).toBe(12);
  });

  it('page one does not say the absent records were removed from the install', () => {
    const { html } = report();
    expect(prov(html, 'missingBefore') ?? '').not.toContain(I18N.en.summaryMissingBeforeNote);
    const row = prov(html, 'selectionCoverage');
    expect(row, 'page one has no row saying why positions are absent from a report').not.toBeNull();
    // Flagged at positions 3, 6 and 9: 3 positions before the first and 4 inside the range.
    // The 2 after the last leave no trace in the file; the held-back row counts all 9.
    expect(row!).toMatch(/^7\b/);
  });

  it('a whole export of the same chain keeps the ordinary rows', () => {
    const meta: ExportMetadata = { fwVersion: 'V1.0.0-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' }, publicKeyFingerprint: 'fp16', locale: 'en' };
    const html = buildForensicHtmlExport(chain(), meta);
    expect(prov(html, 'selectionCoverage')).toBeNull();
    expect(prov(html, 'missingBefore')).toBe(I18N.en.summaryCoverageComplete);
  });

  it('the held-back line names what the gate really holds back, in every language', () => {
    for (const lang of UI_LANGUAGES) {
      const s = I18N[lang].summaryHeldBackNonDetection;
      // The three things the old sentence named, none of which the gate's bucket is made of.
      expect(s, lang).not.toMatch(/verifier samples|mostre de verificare|muestras del verificador|amostras do verificador/i);
      expect(s, lang).not.toMatch(/not retained observations|nu observații reținute|no observaciones conservadas|não observações conservadas/i);
    }
    expect(I18N.en.summaryHeldBackNonDetection).toMatch(/did not flag/);
    // The row is HTML-escaped, so its opening words are what is matched.
    expect(prov(report().html, 'heldBack')).toContain('9 records the product did not flag: items it passed');
  });

  it('the behaviour section computes nothing over a selection, and says why', () => {
    for (const lang of UI_LANGUAGES) {
      const text = behaviourText(report(lang).html);
      expect(text, lang).toContain(I18N[lang].bhSelectionNote);
      expect(text, `${lang}: a rate was printed over a flagged-only file`).not.toMatch(/100\s?%/);
      expect(text, lang).not.toContain(I18N[lang].bhIntro);
    }
  });

  it('the behaviour section still reads a whole export', () => {
    const meta: ExportMetadata = { fwVersion: 'V1.0.0-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' }, publicKeyFingerprint: 'fp16', locale: 'en' };
    const text = behaviourText(buildForensicHtmlExport(chain(), meta));
    expect(text).toContain(I18N.en.bhIntro);
    expect(text).not.toContain(I18N.en.bhSelectionNote);
  });
});
