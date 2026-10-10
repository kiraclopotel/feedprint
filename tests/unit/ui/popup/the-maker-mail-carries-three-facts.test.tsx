// "Write to the maker" (the head's verdict on his in-app chat idea, 8 Oct 2026, DEBATE-in-app-chat-2026-10-08.md):
// not a chat, a prefilled email from Receipts' Home. It carries the install's record key (the short fingerprint the
// exports print), the version and the last error, and nothing else: no site, no page, no switches, no licence key.
// Nothing is sent unless the person sends the email. Its count is what reopens the chat question.

import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { HomeTab } from '../../../../src/ui/popup/Popup';
import { makerMailto, makerLastError } from '../../../../src/ui/popup/maker-mail';
import { REPORT_ADDRESS } from '../../../../src/ui/popup/report-link';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { UI_LANGUAGES } from '../../../../src/i18n';
import type { FWSettings } from '../../../../src/storage/settings';
import { teenPreset } from '../../../../src/storage/presets';
import type { LicenseInfo } from '../../../../src/storage/license';

const en = POPUP_STRINGS.en;
const body = (href: string): string => decodeURIComponent(href.split('&body=')[1] ?? '');
const subject = (href: string): string => decodeURIComponent((href.split('?subject=')[1] ?? '').split('&body=')[0]);

describe('the maker mail', () => {
  it('goes to the support address with its own subject', () => {
    const href = makerMailto({ keyId: '7f8fa1740463197c', version: '2.5.19', lastError: null }, en);
    expect(href.startsWith(`mailto:${REPORT_ADDRESS}?subject=`)).toBe(true);
    expect(subject(href)).toBe(en.makerSubject);
  });

  it('carries the record key, the version and the last error, each on its own line', () => {
    const b = body(makerMailto({ keyId: '7f8fa1740463197c', version: '2.5.19', lastError: 'Downloads refused the file' }, en));
    expect(b).toContain(`${en.makerKey}: 7f8fa1740463197c`);
    expect(b).toContain(`${en.receiptsReportVersion}: 2.5.19`);
    expect(b).toContain(`${en.makerLastError}: Downloads refused the file`);
    expect(b.startsWith(en.makerAsk)).toBe(true);
  });

  it('says none when there is no error, and says the key could not be read rather than inventing one', () => {
    const b = body(makerMailto({ keyId: null, version: '2.5.19', lastError: null }, en));
    expect(b).toContain(`${en.makerLastError}: ${en.offReportNone}`);
    expect(b).toContain(`${en.makerKey}: ${en.makerKeyUnread}`);
  });

  it('carries nothing else: no site, no page, no switches', () => {
    const b = body(makerMailto({ keyId: 'abc', version: '1', lastError: null }, en));
    expect(b.split('\n').filter(l => l.includes(': ')).length).toBe(3);
    for (const word of [en.offReportSite, en.offReportPage, en.offReportSwitches]) expect(b).not.toContain(`${word}:`);
  });

  it('keeps a long error to one short line', () => {
    const b = body(makerMailto({ keyId: 'abc', version: '1', lastError: 'x'.repeat(500) + '\nsecond line' }, en));
    const line = b.split('\n').find(l => l.startsWith(en.makerLastError)) ?? '';
    expect(line.length).toBeLessThanOrEqual(en.makerLastError.length + 2 + 160);
    expect(b).not.toContain('second line');
  });
});

describe('the last error', () => {
  it('is the record backup\'s last failure, and nothing when the last backup went well', () => {
    expect(makerLastError({ lastStatus: 'error', lastError: 'Downloads refused the file' })).toBe('Downloads refused the file');
    expect(makerLastError({ lastStatus: 'saved', lastError: 'old failure' })).toBeNull();
    expect(makerLastError(undefined)).toBeNull();
  });
});

describe('the link on Home', () => {
  function home(lang: (typeof UI_LANGUAGES)[number]): string {
    const settings = {
      mode: 'teen', features: teenPreset(), strictLanguage: false, dailyCap: 0, totalChecksToday: 0,
      totalNeutralizedToday: 0, totalNeutralizedAllTime: 0, totalTokensThisMonth: 0, uiLanguage: lang, dashboardTheme: 'dark',
    } as unknown as FWSettings;
    const license = { tier: 'free', secret: '' } as unknown as LicenseInfo;
    return renderToString(createElement(I18nProvider, {
      lang,
      children: createElement(HomeTab, { settings, license, onOpenDashboard: () => {}, onOpenDashboardSection: () => {} }),
    }));
  }

  // Since 9 Oct 2026 it is the second item of the bottom row's contact menu.
  it.each(UI_LANGUAGES)('%s: sits in the bottom row as a mail link with its own words', (lang) => {
    const html = home(lang);
    const foot = html.slice(html.indexOf('class="foot home-foot"'));
    expect(foot).toContain(`>${POPUP_STRINGS[lang].makerLink}</a>`);
    expect(foot).toContain(`href="mailto:${REPORT_ADDRESS}`);
  });

  it('every language has its own words for the mail', () => {
    for (const lang of UI_LANGUAGES) {
      if (lang === 'en') continue;
      const t = POPUP_STRINGS[lang];
      for (const k of ['makerLink', 'makerSubject', 'makerAsk', 'makerKey', 'makerLastError', 'makerKeyUnread'] as const) {
        expect(t[k], `${lang}.${k}`).not.toBe(en[k]);
        expect(t[k], `${lang}.${k}`).not.toContain('—');
      }
    }
  });
});
