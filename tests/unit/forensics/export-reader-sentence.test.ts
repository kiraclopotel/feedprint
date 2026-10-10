// The export reader opens on the answer (14 Sep 2026, the stranger test of
// futurestate 3b item 2): the first thing on the page after the title is "What
// the feed showed", and under that heading one generated sentence says, for the
// current selection, how many impressions of how many posts, how many paid, and
// between which days. The verifier's own paragraph moved under its status line.
// The sentence is computed in the recipient's browser by READING_SCRIPT from the
// same embedded records the checker verifies; nothing here is an asserted number.

import { describe, expect, it } from 'vitest';
import { I18N, READING_SCRIPT, buildForensicHtmlExport } from '../../../src/forensics/html-export';

describe('export reader: the one-sentence answer', () => {
  it('every locale carries the sentence, its all-platforms name and its empty form', () => {
    for (const [locale, s] of Object.entries(I18N)) {
      for (const k of ['rdSentence', 'rdSentenceAll', 'rdSentenceNone'] as const) {
        expect(typeof s[k], `${locale}.${k}`).toBe('string');
        expect(s[k].length, `${locale}.${k}`).toBeGreaterThan(4);
      }
      for (const slot of ['{platform}', '{surface}', '{impressions}', '{unique}', '{paid}', '{from}', '{to}']) {
        expect(s.rdSentence, `${locale}.rdSentence ${slot}`).toContain(slot);
      }
      expect(s.rdSentenceNone).toContain('{platform}');
      expect(s.rdSentenceNone).toContain('{surface}');
      // No em dashes in anything a recipient reads (house rule).
      expect(s.rdSentence).not.toContain('—');
      expect(s.subtitle).not.toContain('—');
      expect(s.whatThisDoes).not.toContain('—');
    }
  });

  it('the reading script fills the sentence and falls back to the empty form', () => {
    expect(READING_SCRIPT).toContain("getElementById('fw-reading-sentence')");
    expect(READING_SCRIPT).toContain('i18n.rdSentence');
    expect(READING_SCRIPT).toContain('i18n.rdSentenceAll');
    expect(READING_SCRIPT).toContain('i18n.rdSentenceNone');
  });

  it('the page opens on the reading, with the sentence slot above the marks and the checker paragraph under the verify button', () => {
    const html = buildForensicHtmlExport([], {
      fwVersion: 'FeelingWise Vtest',
      publicKeyJwk: {},
      publicKeyFingerprint: 'abcd',
      locale: 'en',
    } as Parameters<typeof buildForensicHtmlExport>[1]);
    const reading = html.indexOf('<section id="fw-reading"');
    const sentence = html.indexOf('<p id="fw-reading-sentence"');
    const marks = html.indexOf('<div id="fw-reading-marks"');
    const verifyBtn = html.indexOf('<button id="fw-verify-btn">');
    const whatThisDoes = html.indexOf('class="fw-meta fw-what-this-does"');
    const summary = html.indexOf(I18N.en.pageOneHeader);
    expect(reading).toBeGreaterThan(0);
    expect(sentence).toBeGreaterThan(reading);
    expect(marks).toBeGreaterThan(sentence);
    expect(verifyBtn).toBeGreaterThan(marks);
    expect(whatThisDoes).toBeGreaterThan(verifyBtn);
    expect(summary).toBeGreaterThan(whatThisDoes);
    // The old jargon opener is gone from page one.
    expect(html).not.toContain('Version 1.0: checks exported records');
  });
});
