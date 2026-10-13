/** @vitest-environment jsdom */
//
// Three leftovers of the export's polish, from the Leader's and the Tester's reads of the 17:20 build (12 Oct 2026):
//   - a post is the card's primary text and a comment its secondary: the post's text sits on the fourth step of the type
//     scale (1rem, 16 px), a comment's and a reply's one step below;
//   - three unsigned counts were still plain digits on a 1500-record file ("Show the next 500 (1000 records not shown
//     yet)", "Chain positions 0 to 1499 are present, 1500 records.", "✓ 1500 signature verified"), so each takes the
//     formatter like the rest of the page (row 13);
//   - each list of bars says its whole beside the bars: the feed's technique bars are a share of 95 flagged items and
//     the exposure's of the same 95 in the period, so the same count draws the same share only when the whole is stated
//     (row 50).

import { describe, expect, it, beforeEach } from 'vitest';
import {
  buildForensicHtmlExport, EXPOSURE_SCRIPT, FEED_SCRIPT, type ExportMetadata,
} from '../../../src/forensics/html-export';
import { COMPLETENESS_SCRIPT, VERIFIER_SCRIPT_TEMPLATE } from '../../../src/forensics/html-export-scripts';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';
import { I18N } from '../../../src/i18n/export-strings';
import { decisionForLegacy } from '../../../src/content/record/decision';
import type { ForensicRecord } from '../../../src/types/forensic';
import { readSource } from '../../helpers/read-source';

let seq = 0;
function rec(overrides: Partial<ForensicRecord> = {}): ForensicRecord {
  seq++;
  return {
    id: `w-${seq}`, timestamp: new Date(Date.parse('2026-09-15T10:00:00Z') + seq * 60_000).toISOString(), platform: 'twitter',
    originalText: `post ${seq}`, originalHash: `h-${seq}`, originalLength: 6, neutralizedText: '', author: `@a${seq}`, postUrl: '',
    techniques: [], overallScore: 0, userAgeCategory: 'teen', aiSource: 'cloud', feedSource: 'for-you', integrityHash: `i-${seq}`,
    signature: 'sig', publicKeyFingerprint: 'fp', chainPosition: seq - 1, kind: 'post', verdict: 'pass', ...overrides,
  } as ForensicRecord;
}
const flagged = (name: string, platform: ForensicRecord['platform'], severity: number): ForensicRecord => rec({
  platform, verdict: 'flagged', overallScore: severity, techniques: [{ name, severity, confidence: 0.9 }],
  decision: decisionForLegacy({ mode: 'teen', detectionMode: 'ai-judge', techniques: [name], severity, applied: 'mark', mask: false }),
  reader: 'default',
});
// 1500 records: 80 flagged High (fear-appeal, X), 15 flagged Medium (anger-trigger, YouTube), the rest passed.
function file(): ForensicRecord[] {
  const out: ForensicRecord[] = [];
  for (let i = 0; i < 1405; i++) out.push(rec());
  for (let i = 0; i < 80; i++) out.push(flagged('fear-appeal', 'twitter', 7));
  for (let i = 0; i < 15; i++) out.push(flagged('anger-trigger', 'youtube', 4));
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

beforeEach(() => { document.body.innerHTML = ''; seq = 0; });

describe('a post is the primary text of its card (16 px), a comment the secondary', () => {
  const css = readSource('src/forensics/html-export-styles.ts');
  const rule = (sel: string) => css.split('\n').find((l) => l.startsWith(`${sel}{`)) ?? '';
  it('the post text is on the fourth step, a comment and a reply on the third', () => {
    expect(css).toContain('--t3:.9rem;--t4:1rem;');
    expect(rule('.fw-item-text')).toContain('font-size:var(--t4)');
    expect(rule('.fw-item-comment .fw-item-text,.fw-item-reply .fw-item-text')).toContain('font-size:var(--t3)');
  });
});

describe('three plain counts take the formatter (row 13)', () => {
  it('the completeness sentence writes the positions and the count with the separator', () => {
    const root = mount(file(), COMPLETENESS_SCRIPT, 'fw-completeness');
    expect(root.textContent).toContain('Chain positions 0 to 1,499 are present, 1,500 records.');
    expect(root.textContent).not.toMatch(/\b1500\b/);
  });

  it('the checker script writes the paging line, the note and the tally through one formatter', () => {
    // The checker verifies signatures with WebCrypto, so it is read here as the page's text: every place that writes a
    // count into a sentence or a tally goes through fmtCount, and none writes the bare number.
    const script = VERIFIER_SCRIPT_TEMPLATE;
    expect(script).toContain("function fmtCount(n){return nfCount&&typeof n==='number'&&isFinite(n)?nfCount.format(n):''+n;}");
    expect(script).toContain("replace('{n}',fmtCount(Math.min(RESULTS_PAGE,left)))");
    expect(script).toContain("replace('{n}',fmtCount(left))");
    expect(script).toContain("replace('{n}',fmtCount(undrawnBad))");
    expect(script).toContain('tally[l].icon+fmtCount(tally[l].n)+');
    // The page's own part of the checker (after the shared core, whose chain notes are a separate file) writes no bare count.
    const own = script.slice(script.indexOf('var PN='));
    expect(own).not.toMatch(/replace\('\{[a-z]\}',(''\+|String\()/);
    expect(COMPLETENESS_SCRIPT.slice(COMPLETENESS_SCRIPT.indexOf("var host=document.getElementById('fw-completeness')"))).not.toContain('String(');
  });
});

describe('each list of bars says its whole (row 50)', () => {
  it('the feed: the severity bars are a share of the 95 that carry a level, the technique bars of the 95 flagged', () => {
    const feed = mount(file(), FEED_SCRIPT, 'fw-feed');
    expect(texts(feed, '.fw-bar-whole')).toEqual(['of 95 flagged items that carry a level', 'of 95 flagged items']);
    for (const note of feed.querySelectorAll('.fw-bar-whole')) expect(note.previousElementSibling?.classList.contains('fw-barlist')).toBe(true);
  });

  it('the exposure: severity, techniques and platforms each state theirs, in the period', () => {
    const exp = mount(file(), EXPOSURE_SCRIPT, 'fw-exposure');
    expect(texts(exp, '.fw-bar-whole')).toEqual([
      'of 95 flagged in this period that carry a level', 'of 95 flagged in this period', 'of 1,500 recorded in this period',
    ]);
    for (const note of exp.querySelectorAll('.fw-bar-whole')) expect(note.previousElementSibling?.classList.contains('fw-exp-barlist')).toBe(true);
  });

  it('a list whose whole is nothing says no whole: the demo file has no flagged item, so no "of 0 flagged" under an empty list', () => {
    for (const script of [FEED_SCRIPT, EXPOSURE_SCRIPT]) {
      expect(script).toContain("function wholeNote(tpl,n){if(!(n>0))return document.createDocumentFragment();");
    }
    const exp = mount(Array.from({ length: 5 }, () => rec()), EXPOSURE_SCRIPT, 'fw-exposure');
    expect(texts(exp, '.fw-bar-whole')).toEqual(['of 5 recorded in this period']);
  });

  it('every language has the five lines, each with its {n}', () => {
    for (const locale of ['en', 'ro', 'es', 'pt-BR'] as const) {
      const s = I18N[locale] as unknown as Record<string, string>;
      for (const key of ['barWholeFlagged', 'barWholeLevelled', 'barWholeFlaggedPeriod', 'barWholeLevelledPeriod', 'barWholeRecordedPeriod']) {
        expect(s[key], `${locale} ${key}`).toContain('{n}');
      }
    }
  });
});
