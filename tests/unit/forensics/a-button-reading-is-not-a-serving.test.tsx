// @vitest-environment jsdom
// A reading the person asked for is not something the feed served.
//
// The "read this" button sends one item to the reader and writes what it answered as a pass
// record whose detectionMode holds "read-this" (src/content/markers/read-this.ts). Its own
// docblock, and isReadingRecord beside the author-week count, say what such a record is:
// never a sighting, never a flag. Only that one module asked. Found 2026-09-20 on an export
// of adult-mode records built with the product's own writers: a reading of a post already
// recorded as an automatic pass gave "56 impressions of 55 posts", "seen before: 1", and,
// in the section about what the app brings back, a row for the author reading "Days served
// 2, Servings 2" under "Bringing a thread back is the app's choice, not the reader's". The
// second serving was the reader pressing a button. The reading also counted as a content
// record "the product decided on", and its card said nothing about where it came from.

import { describe, it, expect, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { buildForensicHtmlExport, FEED_SCRIPT, I18N, type ExportMetadata } from '../../../src/forensics/html-export';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';
import { isDecidedContentRecord } from '../../../src/forensics/flag-provenance';
import { isImpression, seenBeforeIds } from '../../../src/forensics/export-numbers';
import { isReadingRecord } from '../../../src/forensics/author-week';
import { ReadingAskedNote } from '../../../src/ui/dashboard/components/FeedCard';
import { I18nProvider } from '../../../src/i18n/react';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';
import { UI_LANGUAGES } from '../../../src/i18n';
import type { ForensicRecord } from '../../../src/types/forensic';

let seq = 0;
function rec(overrides: Partial<ForensicRecord>): ForensicRecord {
  seq++;
  return {
    id: `b-${seq}`, timestamp: `2026-09-1${seq}T10:00:00.000Z`, platform: 'twitter',
    originalText: 'the same post', originalHash: 'same-hash', originalLength: 13, neutralizedText: '',
    author: '@violet', postUrl: 'https://x.com/violet/status/1', techniques: [], overallScore: 0,
    userAgeCategory: 'adult', aiSource: 'cloud', feedSource: 'for-you', integrityHash: `i-${seq}`, signature: 'sig',
    publicKeyFingerprint: 'fp', chainPosition: seq, kind: 'post', verdict: 'pass', detectionMode: 'pass:judge-v1:not-charged',
    ...overrides,
  } as ForensicRecord;
}
const served = (): ForensicRecord => rec({});
const reading = (): ForensicRecord => rec({
  detectionMode: 'pass:read-this:charged:angry:recruit',
  techniques: [{ name: 'anger-trigger', severity: 6, confidence: 0.9 }], overallScore: 6,
});

function meta(locale: ExportMetadata['locale'] = 'en'): ExportMetadata {
  return { fwVersion: 'V1.0.0-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' }, publicKeyFingerprint: 'fp16', locale };
}
type Fwn = { isDecidedContentRecord(r: unknown): boolean; isImpression(r: unknown): boolean; seenBeforeIds(rs: unknown[]): Record<string, true> };
function inlineEngine(): Fwn {
  return new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};return FWN;`)() as Fwn;
}

beforeEach(() => { document.body.innerHTML = ''; seq = 0; });

describe('a button reading is not a serving', () => {
  it('the fixture is a reading by the rule the product already has', () => {
    expect(isReadingRecord(reading())).toBe(true);
    expect(isReadingRecord(served())).toBe(false);
  });

  it('it is not a content record and not an impression, in the module and in the page engine alike', () => {
    const r = reading();
    const fwn = inlineEngine();
    expect(isDecidedContentRecord(r)).toBe(false);
    expect(isImpression(r)).toBe(false);
    expect(fwn.isDecidedContentRecord(r)).toBe(false);
    expect(fwn.isImpression(r)).toBe(false);
    // The served record beside it is untouched.
    expect(isDecidedContentRecord(served())).toBe(true);
    expect(fwn.isImpression(served())).toBe(true);
  });

  it('a reading of a post already served does not make that post "seen before"', () => {
    const a = served();
    const b = reading();
    expect(Object.keys(seenBeforeIds([a, b]))).toEqual([]);
    expect(Object.keys(inlineEngine().seenBeforeIds([a, b]))).toEqual([]);
    // Two real servings still do.
    const c = served();
    expect(Object.keys(seenBeforeIds([a, c]))).toEqual([c.id]);
  });

  it('page one counts one content record of two, and says readings are not counted', () => {
    const html = buildForensicHtmlExport([served(), reading()], meta());
    const row = html.match(/<dd data-fw-prov="contentRecords">([\s\S]*?)<\/dd>/)?.[1] ?? '';
    expect(row).toMatch(/^1 of 2\./);
    const SAYS_READING: Record<string, RegExp> = { en: /a reading you asked for/, ro: /o citire cerută de dvs\./, es: /una lectura que pediste/, 'pt-BR': /uma leitura que você pediu/ };
    for (const lang of UI_LANGUAGES) {
      expect(I18N[lang].summaryContentRecordsValue, lang).toMatch(SAYS_READING[lang]);
    }
  });

  it('the card says where the reading came from, in the export and in the panel', () => {
    for (const lang of UI_LANGUAGES) {
      const html = buildForensicHtmlExport([served(), reading()], meta(lang));
      const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
      (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(m![1]);
      document.body.innerHTML = '<div id="fw-feed"></div>';
      new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${FEED_SCRIPT}`)();
      const notes = document.querySelectorAll('#fw-feed .fw-reading-asked');
      expect(notes.length, `${lang}: one reading, one note`).toBe(1);
      expect(notes[0].textContent).toBe(I18N[lang].feedReadingAsked);

      const panel = (r: ForensicRecord): string =>
        renderToString(createElement(I18nProvider, { lang, children: createElement(ReadingAskedNote, { record: r }) }));
      expect(panel(reading())).toContain(DASHBOARD_STRINGS[lang].feedReadingAsked.split("'")[0]);
      expect(panel(served())).toBe('');
    }
  });
});
