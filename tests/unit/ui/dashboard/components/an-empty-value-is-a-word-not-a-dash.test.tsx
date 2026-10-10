// @vitest-environment jsdom
//
// The dashboard marked a value it did not have with a long dash: "last record —" at 0 records,
// the peak hour at 0, and the gap cell of the ledger's oldest row. The house writes no long dash a
// reader sees, and a dash says nothing a word cannot. A value that will come says so in a word
// ("none yet"); a ledger cell with nothing to measure is left empty. The Feed behavior line at 0
// records ended on a stray mark where the empty date range was; it now names no range when there
// is none.

import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ForensicsTab } from '../../../../../src/ui/dashboard/components/ForensicsTab';
import { FeedLogTab } from '../../../../../src/ui/dashboard/components/FeedLogTab';
import { DashHeader } from '../../../../../src/ui/dashboard/components/DashHeader';
import { I18nProvider } from '../../../../../src/i18n/react';
import { DASHBOARD_STRINGS } from '../../../../../src/i18n/dashboard-strings';
import { UI_LANGUAGES } from '../../../../../src/i18n';
import type { ForensicRecord } from '../../../../../src/types/forensic';

type Lang = (typeof UI_LANGUAGES)[number];

/** A long dash (U+2014) or a spaced short one (U+2013), the two the screens used. */
const DASH = /—|\s–\s/;

function record(i: number): ForensicRecord {
  return {
    id: `r${i}`, timestamp: `2026-09-29T07:35:0${i}.000Z`, platform: 'twitter', originalText: `post ${i}`,
    originalHash: 'h', originalLength: 6, neutralizedText: '', author: `user${i}`, postUrl: '', techniques: [],
    overallScore: 0, userAgeCategory: 'relaxed', aiSource: 'cloud', feedSource: 'for-you', integrityHash: 'ih',
    verdict: 'skipped', kind: 'post', chainPosition: i,
  } as unknown as ForensicRecord;
}

function text(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // The record banner's figures are measured by the browser after the first paint, which a static
  // render never reaches; they are not among the empty values this file is about.
  for (const el of Array.from(doc.querySelectorAll('.chain-banner-stat'))) el.remove();
  return doc.body.textContent ?? '';
}

function recordTab(records: ForensicRecord[], lang: Lang): string {
  return text(renderToStaticMarkup(React.createElement(I18nProvider, {
    lang,
    children: React.createElement(ForensicsTab, {
      records, integrity: null, anchorCreatedAt: '2026-09-29T07:00:00.000Z', fingerprint: 'ffee', archivedMonthCount: 0,
    } as unknown as React.ComponentProps<typeof ForensicsTab>),
  })));
}

// The rows the Record tab's ledger held are on the Feed log since 10 Oct 2026.
function feedLog(records: ForensicRecord[], lang: Lang): string {
  return text(renderToStaticMarkup(React.createElement(I18nProvider, {
    lang,
    children: React.createElement(FeedLogTab, {
      records, loadingRest: false, filter: { window: 'all' }, onFilter: () => {}, integrity: null,
    } as unknown as React.ComponentProps<typeof FeedLogTab>),
  })));
}

function header(lang: Lang): string {
  return text(renderToStaticMarkup(React.createElement(I18nProvider, {
    lang,
    children: React.createElement(DashHeader, {
      records: [], integrity: null, license: { tier: 'free', secret: '' }, theme: 'dark', setTheme: () => {},
    } as unknown as React.ComponentProps<typeof DashHeader>),
  })));
}

describe.each(UI_LANGUAGES)('%s', (lang) => {
  const t = DASHBOARD_STRINGS[lang];

  it('the header at 0 records says "none yet" after "last record", with no dash', () => {
    const h = header(lang);
    expect(h).toContain(t.hdrLastRecord);
    expect(h).toContain(t.noneYet);
    expect(h).not.toMatch(DASH);
  });

  it('the Record tab at 0 records shows no dash, and the peak value is "none yet"', () => {
    const r = recordTab([], lang);
    expect(r).not.toMatch(DASH);
    expect(r).toContain(t.noneYet);
  });

  it('the Feed log with records shows no dash in its cells', () => {
    expect(feedLog([record(0), record(1), record(2)], lang)).not.toMatch(DASH);
    expect(recordTab([record(0), record(1), record(2)], lang)).not.toMatch(DASH);
  });

  it('the Feed behavior line at 0 records ends without a stray mark', () => {
    const line = t.patIntro(0, '', '');
    expect(line).not.toMatch(/[–—-]\s*\.$/);
    expect(line).not.toMatch(/,\s*\.$/);
    expect(line).not.toMatch(DASH);
  });

  it('the Feed behavior line with records names its range without a dash', () => {
    const line = t.patIntro(6, '27 Sep', '29 Sep');
    expect(line).toContain('27 Sep');
    expect(line).toContain('29 Sep');
    expect(line).not.toMatch(DASH);
  });
});
