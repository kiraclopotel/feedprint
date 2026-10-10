// @vitest-environment jsdom
// The why says what the reading answered, never a family it did not answer.
//
// Found 2026-09-20 by building an export of adult-mode records with the product's own
// writers and reading each card against its record. Rows J1, J2, J7 and J8 of the policy
// table fire on a severity band alone, for any family, and their words named hostility:
// a reading of commercial at severity 8 printed "Why: hostility", body at 1 printed
// "mild hostility", threat (alarm, never aimed at anyone) at 6 printed "hostile content".
// The legacy path reaches the same rows from a severity with no family at all, so a
// fear-appeal at 8 was "hostility" on the page notice of a teenager's feed. The why is
// the one place the product says out loud what it thinks somebody did.
//
// Three surfaces draw the words: the notice on the page, the card in the panel and the
// card in the export. All three are read here, in all four languages, on both sides:
// a family that is not hostile must not be called hostile, and one that is still is.

import { describe, it, expect, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { buildForensicHtmlExport, FEED_SCRIPT, type ExportMetadata } from '../../../src/forensics/html-export';
import { DecisionNote } from '../../../src/ui/dashboard/components/FeedCard';
import { I18nProvider } from '../../../src/i18n/react';
import { MARKER_STRINGS } from '../../../src/i18n/marker-strings';
import { UI_LANGUAGES } from '../../../src/i18n';
import type { ForensicRecord } from '../../../src/types/forensic';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';
import { decisionForJudge, decisionForLegacy } from '../../../src/content/record/decision';
import { whyFor } from '../../../src/core/policy/why';
import { whyFragment } from '../../../src/content/markers/hide-why';

type Lang = (typeof UI_LANGUAGES)[number];
// "hostility", "hostile", "ostilitate", "ostil", "hostilidad", "hostilidade": one stem.
const HOSTILE = /h?ostil/i;
const BAND_ROWS = ['J1', 'J2', 'J7', 'J8'] as const;

let seq = 0;
function rec(overrides: Partial<ForensicRecord>): ForensicRecord {
  seq++;
  return {
    id: `w-${seq}`, timestamp: '2026-09-20T10:00:00Z', platform: 'twitter',
    originalText: 'a post', originalHash: 'h', originalLength: 6, neutralizedText: '',
    author: '@someone', postUrl: `https://x.com/someone/status/${seq}`, techniques: [],
    overallScore: 0, userAgeCategory: 'adult', aiSource: 'groq', feedSource: 'for-you',
    integrityHash: 'deadbeef', signature: 'sig', publicKeyFingerprint: 'fp',
    chainPosition: seq, kind: 'post', verdict: 'flagged-hidden', ...overrides,
  } as ForensicRecord;
}

function judged(family: string, severity: number) {
  return decisionForJudge({
    mode: 'adult',
    judge: { id: 'judge-v1', hash: 'abc', model: 'm', charged: true, family, severity, effect: 'angry', intent: 'recruit' },
    provider: 'groq', applied: severity >= 8 ? 'hide' : 'soften', mask: false, rewrite: null,
  });
}

function dashboardLine(r: ForensicRecord, lang: Lang): string {
  return renderToString(createElement(I18nProvider, { lang, children: createElement(DecisionNote, { record: r }) }))
    .replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
}

function exportLine(r: ForensicRecord, lang: Lang): string {
  const meta: ExportMetadata = {
    fwVersion: 'V1.0.0-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' },
    publicKeyFingerprint: 'fp16', locale: lang,
  };
  const html = buildForensicHtmlExport([r], meta);
  const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
  expect(m).not.toBeNull();
  (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(m![1]);
  document.body.innerHTML = '<div id="fw-feed"></div>';
  new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${FEED_SCRIPT}`)();
  const line = document.querySelector('#fw-feed .fw-decision');
  expect(line, 'the export card has no decision line').not.toBeNull();
  return line!.textContent ?? '';
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('the why follows the family the reading answered', () => {
  const NOT_HOSTILE = ['threat', 'commercial', 'body', 'profanity'] as const;
  const SEVERITIES = [2, 5, 8, 9];

  for (const lang of UI_LANGUAGES) {
    it(`${lang}: a reading that is not hostile is never called hostile, on the panel card or the export card`, () => {
      for (const family of NOT_HOSTILE) {
        for (const severity of SEVERITIES) {
          const d = judged(family, severity);
          const r = rec({ decision: d });
          const where = `${lang} ${family}:${severity} row ${d.row}`;
          expect(dashboardLine(r, lang), `panel, ${where}`).not.toMatch(HOSTILE);
          const ex = exportLine(r, lang);
          expect(ex, `export, ${where}`).not.toMatch(HOSTILE);
        }
      }
    });

    it(`${lang}: a band row with a family says that family's words on both cards`, () => {
      for (const family of NOT_HOSTILE) {
        const d = judged(family, 8);
        expect(BAND_ROWS as readonly string[]).toContain(d.row);
        const words = MARKER_STRINGS[lang].whyByFamily[family];
        expect(words, `${lang} lacks the words for ${family}`).toBeTruthy();
        const r = rec({ decision: d });
        expect(dashboardLine(r, lang)).toContain(words);
        expect(exportLine(r, lang)).toContain(words);
      }
    });

    it(`${lang}: a hostile reading is still called hostile`, () => {
      const d = judged('hostile', 8);
      const r = rec({ decision: d });
      expect(dashboardLine(r, lang)).toMatch(HOSTILE);
      expect(exportLine(r, lang)).toMatch(HOSTILE);
    });

    it(`${lang}: the legacy path knows a severity and no family, and its words name no family`, () => {
      for (const severity of [5, 8, 10]) {
        const why = whyFor('ai-judge', ['fear-appeal'], severity);
        expect(why, `severity ${severity}`).not.toBeNull();
        expect(BAND_ROWS as readonly string[]).toContain(why!.row);
        expect(whyFragment(lang, why!), `page notice, ${lang} fear-appeal at ${severity}`).not.toMatch(HOSTILE);
        const d = decisionForLegacy({ mode: 'teen', detectionMode: 'ai-judge', techniques: ['fear-appeal'], severity, applied: 'hide', mask: false });
        const r = rec({ decision: d, userAgeCategory: 'teen' });
        expect(dashboardLine(r, lang), `panel, ${lang} fear-appeal at ${severity}`).not.toMatch(HOSTILE);
        expect(exportLine(r, lang), `export, ${lang} fear-appeal at ${severity}`).not.toMatch(HOSTILE);
      }
    });

    it(`${lang}: the page notice takes the family when the caller has one`, () => {
      const why = whyFor('judge-v1', [], 8);
      expect(why?.row).toBe('J2');
      expect(whyFragment(lang, { ...why!, family: 'commercial' })).toBe(MARKER_STRINGS[lang].whyByFamily.commercial);
      expect(whyFragment(lang, { ...why!, family: 'hostile' })).toMatch(HOSTILE);
      // A family on a row that already names its condition changes nothing.
      expect(whyFragment(lang, { row: 'R4', family: 'commercial' })).toBe(MARKER_STRINGS[lang].whyByRow.R4);
    });
  }

  it('no family fragment names a number, a technique id, a model or the product', () => {
    for (const lang of UI_LANGUAGES) {
      for (const [family, text] of Object.entries(MARKER_STRINGS[lang].whyByFamily)) {
        expect(text, `${lang} ${family}`).not.toMatch(/\d/);
        expect(text, `${lang} ${family}`).not.toMatch(/gpt|groq|llama|judge-v|FeelingWise/i);
      }
    }
  });
});
