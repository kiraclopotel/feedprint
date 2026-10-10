// @vitest-environment jsdom
//
// The card this tab marks RECOMMENDED, described as "Everything flagged in the
// record this install is keeping now", could build and download a file with
// nothing in it, and then print a SHA-256 receipt inviting the person to paste
// that line into the message they send it with. Its only guard was
// `disabled={busy}`.
//
// Three ordinary states reach it: a fresh install, a month that has just
// rotated into the archives, and a record of nothing but passes and
// advertisements, both of which the export gate drops by design
// (src/forensics/exporter.ts applyExportGate). The person follows the one action
// the dashboard recommends and hands a lawyer an empty packet with a hash.
//
// ChainBanner.tsx had already answered this exact question correctly one tab
// away, and the reason is written beside it: an enabled button there "would
// produce a green check or an empty file over a record that may be intact".
// Found 2026-09-18 by a stranger on a first install, who read "Everything
// flagged" over "0 records included of 6 total" and said, reasonably, that both
// could not be true and they could not tell which was the lie.

import { describe, it, expect, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { ExportTab } from '../../../../../src/ui/dashboard/components/ExportTab';
import { I18nProvider } from '../../../../../src/i18n/react';
import { DASHBOARD_STRINGS } from '../../../../../src/i18n/dashboard-strings';
import { UI_LANGUAGES } from '../../../../../src/i18n';
import type { ForensicRecord } from '../../../../../src/types/forensic';

let seq = 0;
function rec(overrides: Partial<ForensicRecord> = {}): ForensicRecord {
  seq++;
  return {
    id: `r-${seq}`, timestamp: '2026-09-18T10:00:00Z', platform: 'facebook',
    originalText: 'a post', originalHash: 'h', originalLength: 6, neutralizedText: '',
    author: '@a', postUrl: 'https://facebook.com/p/1', techniques: [], overallScore: 0,
    userAgeCategory: 'adult', aiSource: 'cloud', feedSource: 'for-you',
    integrityHash: `hash-${seq}`, signature: 'sig', publicKeyFingerprint: 'fp',
    chainPosition: seq, kind: 'post', verdict: 'pass',
    ...overrides,
  } as unknown as ForensicRecord;
}

function render(records: ForensicRecord[], lang: (typeof UI_LANGUAGES)[number] = 'en'): string {
  return renderToString(createElement(I18nProvider, {
    lang,
    children: createElement(ExportTab, { records, archivedCountSure: true } as never),
  }));
}

/** The markup of the one card, from its data attribute to the end of the tag. */
function recommendedCard(html: string): string {
  const at = html.indexOf('data-export="report"');
  expect(at, 'the recommended card is on the tab').toBeGreaterThan(-1);
  const open = html.lastIndexOf('<button', at);
  const close = html.indexOf('</button>', at);
  return html.slice(open, close);
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('the recommended file is never empty', () => {
  it('is off on a fresh install, where there is no record at all', () => {
    const card = recommendedCard(render([]));
    expect(card, 'a button that would download nothing is not pressable').toContain('disabled');
  });

  // The shape the stranger actually met: records exist, none of them survives
  // the export gate. Passes are dropped, and so are advertisements.
  it('is off when the record holds only passes and advertisements', () => {
    const records = [
      rec({ verdict: 'pass' }),
      rec({ verdict: 'pass' }),
      rec({ verdict: 'flagged-hidden', detectionMode: 'sponsored-ad', accountType: 'advertiser' }),
    ];
    const card = recommendedCard(render(records));
    expect(card).toContain('disabled');
    expect(card, 'and it says why, where the person is looking')
      .toContain(DASHBOARD_STRINGS.en.exportNothingFlagged);
    expect(card, 'the sentence that could not be true is not shown')
      .not.toContain(DASHBOARD_STRINGS.en.exportChooseShowBody);
  });

  // The control. A guard that reached its verdict by disabling the card always
  // would be worthless.
  it('is on, and says the ordinary thing, as soon as one record is flagged', () => {
    const card = recommendedCard(render([rec({ verdict: 'flagged', overallScore: 7 })]));
    expect(card).not.toContain('disabled');
    expect(card).toContain(DASHBOARD_STRINGS.en.exportChooseShowBody);
    expect(card).not.toContain(DASHBOARD_STRINGS.en.exportNothingFlagged);
  });

  // A record of passes only: nothing flagged, and the whole record beside it is not empty. A fresh install with no
  // record at all says that instead (9 Oct 2026: the old sentence told it the whole record file was not empty).
  it('holds in every interface language', () => {
    for (const lang of UI_LANGUAGES) {
      const empty = recommendedCard(render([], lang));
      expect(empty, `${lang} empty card is off`).toContain('disabled');
      expect(empty, `${lang} empty card says nothing is recorded`).toContain(DASHBOARD_STRINGS[lang].exportNothingRecorded);
      const card = recommendedCard(render([rec({ verdict: 'pass' })], lang));
      expect(card, `${lang} card is off`).toContain('disabled');
      expect(card, `${lang} card says why`).toContain(DASHBOARD_STRINGS[lang].exportNothingFlagged);
    }
  });

  // The other half of the same paragraph: the counts line baked a separator
  // into the end of its own template, and the half that follows it renders only
  // when something was excluded, so at zero it ended on a dangling dot.
  it('does not end the counts line on a separator with nothing after it', () => {
    for (const lang of UI_LANGUAGES) {
      const t = DASHBOARD_STRINGS[lang];
      expect(t.exportIncluded(0, 0).trimEnd(), `${lang} counts line`).not.toMatch(/·$/);
      expect(t.exportExcluded(3), `${lang} carries its own separator instead`).toContain('·');
    }
  });
});
