/** @vitest-environment jsdom */
// An export may not say the model did something it was never asked to do.
//
// The adult reader answers a family, an effect and an intent from fixed lists. It is never
// asked for a technique: a table maps the family to the technique name the record carries,
// and the methods block of every export says so ("a technique name the model was never
// asked for"). It states no reason either: src/core/neutralizer.ts assembles the line
// "judge-v1: commercial, recruit, wants the reader to buy" from the three answers.
// Found 2026-09-20 on an export of adult-mode records: page one said "Flagged by a judge: 17
// of 56 ... A model read the item and named a technique", 15 of the 17 being adult-reader
// records, and each of their cards said "Model's stated reason: judge-v1: commercial, ...".

import { describe, it, expect, beforeEach } from 'vitest';
import { buildForensicHtmlExport, FEED_SCRIPT, I18N, type ExportMetadata } from '../../../src/forensics/html-export';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';
import { UI_LANGUAGES } from '../../../src/i18n';
import type { ForensicRecord } from '../../../src/types/forensic';

function rec(id: string, why: string): ForensicRecord {
  return {
    id, timestamp: '2026-09-15T10:00:00.000Z', platform: 'twitter', originalText: `post ${id}`, originalHash: `h-${id}`,
    originalLength: 6, neutralizedText: '', author: '@a', postUrl: '', overallScore: 6, userAgeCategory: 'adult',
    techniques: [{ name: 'consumer-rapid-frame', severity: 6, confidence: 0.9, why }],
    aiSource: 'cloud', feedSource: 'for-you', integrityHash: `i-${id}`, signature: 'sig', publicKeyFingerprint: 'fp',
    chainPosition: 1, kind: 'post', verdict: 'flagged',
  } as ForensicRecord;
}

function feedText(records: ForensicRecord[], locale: ExportMetadata['locale']): string {
  const meta: ExportMetadata = { fwVersion: 'V1.0.0-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' }, publicKeyFingerprint: 'fp16', locale };
  const html = buildForensicHtmlExport(records, meta);
  const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
  (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(m![1]);
  document.body.innerHTML = '<div id="fw-feed"></div>';
  new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${FEED_SCRIPT}`)();
  return (document.getElementById('fw-feed') as HTMLElement).textContent ?? '';
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('an export says what the model was asked for', () => {
  it('a line the code assembled from the reader answers is not called the model stated reason', () => {
    for (const lang of UI_LANGUAGES) {
      const text = feedText([rec('adult', 'judge-v1: commercial, recruit, wants the reader to buy')], lang);
      expect(text, lang).toContain('judge-v1: commercial');
      expect(text, lang).toContain(I18N[lang].feedWhyPrefixReader);
      expect(text, lang).not.toContain(I18N[lang].feedWhyPrefix);
    }
  });

  it('a reason a model really wrote keeps its label', () => {
    const text = feedText([rec('teen', 'Uses a countdown to rush the reader into buying.')], 'en');
    expect(text).toContain(I18N.en.feedWhyPrefix);
    expect(text).not.toContain(I18N.en.feedWhyPrefixReader);
  });

  it('no language says on page one, or in the numbers table, that the model named the technique', () => {
    const NAMED = /named a technique|a numit o tehnică|nombró una técnica|nomeou uma técnica/i;
    for (const lang of UI_LANGUAGES) {
      expect(I18N[lang].summaryFlaggedJudgedValue, lang).not.toMatch(NAMED);
      expect(I18N[lang].rdColModelNamed, lang).not.toMatch(NAMED);
      expect(I18N[lang].summaryFlaggedJudgedValue, lang).toContain('{k}');
    }
  });
});
