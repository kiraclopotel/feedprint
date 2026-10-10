// The tester's fresh install, 9 Oct 2026 02:30 (tester/dashboard-empty-first-look/): with nothing recorded, "The whole
// record" saved a 510,568-byte file holding 0 records, printed a SHA-256 line to paste into a message, and the file
// opened green, "VERIFIED ... Every included record matched", over nothing. The report card beside it was already off
// for this reason. Now the whole-record card is off too while the install holds no record at all, active or archived,
// and both cards say why; a record in the archives alone is still worth saving, so it stays on then.

import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { ExportTab } from '../../../../../src/ui/dashboard/components/ExportTab';
import { I18nProvider } from '../../../../../src/i18n/react';
import { DASHBOARD_STRINGS } from '../../../../../src/i18n/dashboard-strings';
import { UI_LANGUAGES } from '../../../../../src/i18n';
import type { ForensicRecord } from '../../../../../src/types/forensic';

const ONE = {
  id: 'r-1', timestamp: '2026-10-09T10:00:00Z', platform: 'facebook', originalText: 'a post', originalHash: 'h',
  originalLength: 6, neutralizedText: '', author: '@a', postUrl: 'https://facebook.com/p/1', techniques: [],
  overallScore: 0, userAgeCategory: 'adult', aiSource: 'cloud', feedSource: 'for-you', integrityHash: 'hash-1',
  signature: 'sig', publicKeyFingerprint: 'fp', chainPosition: 0, kind: 'post', verdict: 'pass',
} as unknown as ForensicRecord;

// archivedCountSure: the dashboard read the archive count completely. The dashboard's own path, where the count is
// pending, throws or misses a month, is the-whole-record-stays-on-until-the-archives-say-zero.
function render(records: ForensicRecord[], archivedCount: number, lang: (typeof UI_LANGUAGES)[number] = 'en', archivedCountSure = true): string {
  return renderToString(createElement(I18nProvider, {
    lang,
    children: createElement(ExportTab, { records, archivedCount, archivedCountSure } as never),
  }));
}
function card(html: string, kind: string): string {
  const at = html.indexOf(`data-export="${kind}"`);
  expect(at, `the ${kind} card is on the tab`).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<button', at), html.indexOf('</button>', at));
}

describe('an install with no record at all', () => {
  it.each(UI_LANGUAGES)('%s: the whole-record card is off and says nothing is recorded yet', (lang) => {
    const html = render([], 0, lang);
    const whole = card(html, 'everything');
    expect(whole).toContain('disabled');
    expect(whole).toContain(DASHBOARD_STRINGS[lang].exportNothingRecorded);
    expect(card(html, 'report'), 'the report card no longer says the file beside it is not empty')
      .toContain(DASHBOARD_STRINGS[lang].exportNothingRecorded);
  });
});

describe('an install with something to keep', () => {
  it('a record in the active chain turns the whole-record card on', () => {
    expect(card(render([ONE], 0), 'everything')).not.toContain('disabled');
  });

  it('archived months alone turn it on too', () => {
    expect(card(render([], 250), 'everything')).not.toContain('disabled');
  });

  it('a zero that is not sure (not yet counted, or the count failed) keeps it on', () => {
    const html = render([], 0, 'en', false);
    expect(card(html, 'everything')).not.toContain('disabled');
    expect(html).not.toContain(DASHBOARD_STRINGS.en.exportNothingRecorded);
  });
});

describe('every language has its own words', () => {
  it('none repeats the English, none carries an em dash', () => {
    for (const lang of UI_LANGUAGES) {
      const s = DASHBOARD_STRINGS[lang].exportNothingRecorded;
      expect(s).not.toContain('—');
      if (lang !== 'en') expect(s).not.toBe(DASHBOARD_STRINGS.en.exportNothingRecorded);
    }
  });
});
