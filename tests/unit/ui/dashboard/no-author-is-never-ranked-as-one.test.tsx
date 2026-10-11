/** @vitest-environment jsdom */
// A Facebook ad whose page named no account showed on its card as "Unknown author", and in the export every flagged
// item without an author piled into one row that topped the accounts list. An ad's account is its advertiser, so the
// card says it is a sponsored post with no advertiser shown; and an absent author is never ranked as an author, in the
// dashboard or the export, but counted apart as "no author shown". Display and ranking only: the record is unchanged.

import { beforeEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FeedCard } from '../../../../src/ui/dashboard/components/FeedCard';
import { RecidivistAuthorsPanel } from '../../../../src/ui/dashboard/components/RecidivistAuthorsPanel';
import { computeAccountLedger, countFlaggedWithoutAuthor } from '../../../../src/ui/dashboard/components/account-ledger';
import { computeOverview } from '../../../../src/ui/dashboard/components/overview-data';
import { computeFeedBehavior } from '../../../../src/ui/dashboard/components/feed-behavior-data';
import { buildEvidenceReportHTML } from '../../../../src/forensics/exporter';
import { I18nProvider } from '../../../../src/i18n/react';
import { DASHBOARD_STRINGS } from '../../../../src/i18n/dashboard-strings';
import { UI_LANGUAGES } from '../../../../src/i18n';
import { buildForensicHtmlExport, BEHAVIOR_SCRIPT, FEED_SCRIPT, I18N, type ExportMetadata } from '../../../../src/forensics/html-export';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../../src/forensics/export-numbers-inline';
import type { ForensicRecord } from '../../../../src/types/forensic';

let seq = 0;
function rec(overrides: Partial<ForensicRecord> = {}): ForensicRecord {
  seq++;
  return {
    id: `r-${seq}`, timestamp: new Date(Date.parse('2026-10-10T10:00:00Z') + seq * 60_000).toISOString(),
    platform: 'facebook', originalText: 'sample', originalHash: 'h', originalLength: 6, neutralizedText: '',
    author: '@someone', postUrl: '', techniques: [], overallScore: 0, userAgeCategory: 'adult', aiSource: 'cloud',
    feedSource: 'for-you', integrityHash: 'ih', signature: 'sig', publicKeyFingerprint: 'fp', chainPosition: seq,
    kind: 'post', verdict: 'pass', ...overrides,
  } as ForensicRecord;
}
const hiddenAd = (author: string) => rec({
  author, verdict: 'blocked', detectionMode: 'block:ads:platform-ad-marker', originalText: 'Sponsored Daily chances to win',
  techniques: [{ name: 'ai-content-block', severity: 10, confidence: 1 }],
});
const flagged = (author: string) => rec({
  author, verdict: 'flagged', overallScore: 8, techniques: [{ name: 'fear-appeal', severity: 8, confidence: 0.9 }],
});

const card = (record: ForensicRecord, lang: typeof UI_LANGUAGES[number] = 'en') => renderToStaticMarkup(
  React.createElement(I18nProvider, { lang, children: React.createElement(FeedCard, { record }) }),
);

describe('an ad with no author on its card', () => {
  it('says it is a sponsored post with no advertiser shown, in every language, and never "Unknown author"', () => {
    for (const lang of UI_LANGUAGES) {
      const html = card(hiddenAd('unknown'), lang);
      const t = DASHBOARD_STRINGS[lang];
      expect(html, lang).toContain(t.feedAdAuthorNotShown);
      expect(html, lang).not.toContain(t.feedUnknownAuthor);
    }
  });

  it('names the advertiser when the record carries one', () => {
    const html = card(hiddenAd('Acme Shop'));
    expect(html).toContain('Acme Shop');
    expect(html).not.toContain(DASHBOARD_STRINGS.en.feedAdAuthorNotShown);
  });

  it('still says "Unknown author" for a post that is not an ad', () => {
    expect(card(rec({ author: 'unknown' }))).toContain(DASHBOARD_STRINGS.en.feedUnknownAuthor);
  });
});

// The advertiser's name, on posts seen on three days, so every served-count list would take it if ads could rank.
const namedAd = (i: number) => ({
  ...hiddenAd('Acme Shop'),
  timestamp: new Date(Date.parse('2026-10-07T10:00:00Z') + i * 86_400_000).toISOString(),
} as ForensicRecord);
const passed = (i: number) => rec({ author: '@real', timestamp: new Date(Date.parse('2026-10-07T11:00:00Z') + i * 86_400_000).toISOString() });

describe('an ad never ranks as an author', () => {
  const records = [namedAd(0), namedAd(1), namedAd(2), namedAd(3), passed(0), passed(1), passed(2)];

  it('in the frequent flaggers’ ledger', () => {
    expect(computeAccountLedger(records).map((r) => r.author)).toEqual(['@real']);
  });

  it('in the Overview’s accounts served most often', () => {
    expect(computeOverview(records)?.sources.map((s) => s.author)).toEqual(['@real']);
  });

  it('in Feed behavior’s recurring voices', () => {
    expect(computeFeedBehavior(records)?.voices.map((v) => v.author)).toEqual(['@real']);
  });
});

describe('the dashboard’s frequent flaggers', () => {
  const records = [flagged('unknown'), flagged('unknown'), flagged(''), flagged('@real'), flagged('@real')];

  it('a non-ad item with no author is counted on its own "No author shown" line, never as an author row', () => {
    const rows = computeAccountLedger(records);
    expect(rows.map((r) => r.author)).toEqual(['@real']);
    expect(countFlaggedWithoutAuthor(records)).toBe(3);
  });

  it('says the count under the list, in every language', () => {
    for (const lang of UI_LANGUAGES) {
      const html = renderToStaticMarkup(React.createElement(I18nProvider, {
        lang, children: React.createElement(RecidivistAuthorsPanel, { records, onPickAuthor: () => {} }),
      }));
      expect(html, lang).toContain(DASHBOARD_STRINGS[lang].recidNoAuthor(3));
      expect(html, lang).not.toContain('@unknown');
    }
  });
});

describe('the export’s accounts list', () => {
  const META: ExportMetadata = {
    fwVersion: 'V1.0.0-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' }, publicKeyFingerprint: 'fp16', locale: 'en',
  };
  beforeEach(() => {
    document.body.innerHTML = '';
    delete (window as unknown as { __FW_EXPORT__?: unknown }).__FW_EXPORT__;
  });
  // The export page as it loads: its data, the numbers engine first, then one of its scripts into its mount.
  const run = (records: ForensicRecord[], script: string, mount: string, locale: ExportMetadata['locale']): string => {
    const html = buildForensicHtmlExport(records, { ...META, locale });
    const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
    (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(m![1]);
    document.body.innerHTML = `<div id="${mount}"></div>`;
    new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${script}`)();
    return (document.getElementById(mount) as HTMLElement).innerHTML;
  };
  const feed = (records: ForensicRecord[], locale: ExportMetadata['locale'] = 'en') => run(records, FEED_SCRIPT, 'fw-feed', locale);
  const behavior = (records: ForensicRecord[]) => run(records, BEHAVIOR_SCRIPT, 'fw-behavior', 'en');

  it('ranks only named accounts, and says the items with no author shown on a line of their own', () => {
    const html = feed([flagged('unknown'), flagged('unknown'), flagged('unknown'), flagged(''), flagged('@real')]);
    const list = /<div class="fw-people">[\s\S]*?<\/div><article/.exec(html)?.[0] ?? '';
    const names = [...list.matchAll(/<span class="fw-person-name">([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(names).toEqual(['@real']);
    expect(list).toContain(`${I18N.en.feedPeopleNoAuthor}: 4 ${I18N.en.feedPeopleItems}`);
    expect(list).not.toMatch(/unknown/i);
  });

  it('an ad never ranks there, even flagged and named, and a non-ad item with no author is counted on its own "No author shown" line', () => {
    const flaggedAd = (author: string) => ({ ...hiddenAd(author), verdict: 'flagged', overallScore: 8 } as ForensicRecord);
    const html = feed([flaggedAd('Acme Shop'), flaggedAd('Acme Shop'), flaggedAd('unknown'), flagged('unknown'), flagged('@real')]);
    const list = /<div class="fw-people">[\s\S]*?<\/div><article/.exec(html)?.[0] ?? '';
    expect([...list.matchAll(/<span class="fw-person-name">([^<]*)<\/span>/g)].map((m) => m[1])).toEqual(['@real']);
    expect(list).toContain(`${I18N.en.feedPeopleNoAuthor}: 1 ${I18N.en.feedPeopleItems}`);
  });

  it('an ad card with no advertiser named says so in the dashboard card’s words, never "(unknown)", in every language', () => {
    for (const lang of UI_LANGUAGES) {
      const html = feed([hiddenAd('unknown'), flagged('@real')], lang);
      const adCard = /<article[^>]*>(?:(?!<\/article>)[\s\S])*?Sponsored Daily chances to win[\s\S]*?<\/article>/.exec(html)?.[0] ?? '';
      expect(adCard, lang).toContain(I18N[lang].feedAdAuthorNotShown);
      expect(adCard, lang).not.toContain('(unknown)');
      expect(I18N[lang].feedAdAuthorNotShown, lang).toBe(DASHBOARD_STRINGS[lang].feedAdAuthorNotShown);
    }
  });

  it('the report and the PDF say the same for an ad with no advertiser named, in every language', async () => {
    for (const lang of UI_LANGUAGES) {
      const report = await buildEvidenceReportHTML([hiddenAd('unknown')], lang);
      expect(report, lang).toContain(DASHBOARD_STRINGS[lang].feedAdAuthorNotShown);
      expect(report, lang).not.toContain('(unknown)');
    }
  });

  it('an ad never shows among the recurring voices, even named and served on four days', () => {
    const html = behavior([namedAd(0), namedAd(1), namedAd(2), namedAd(3), passed(0), passed(1), passed(2)]);
    expect(html).toContain('@real');
    expect(html).not.toContain('Acme Shop');
  });

  it('has the label in every language the export speaks', () => {
    for (const lang of Object.keys(I18N) as Array<keyof typeof I18N>) {
      expect(I18N[lang].feedPeopleNoAuthor, String(lang)).toMatch(/\S/);
    }
  });
});
