// Home holds one button, Open your record (his word, 9 Oct 2026): "Read this for me" came off Home, in every mode,
// with or without a key, in every language. Until then this file held the card's own promises (present in Adult with
// a key, absent elsewhere); the page side that the button armed stays in src/content/markers/read-this.ts.

import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { HomeTab } from '../../../../src/ui/popup/Popup';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { UI_LANGUAGES } from '../../../../src/i18n';
import type { FWSettings } from '../../../../src/storage/settings';
import type { LicenseInfo } from '../../../../src/storage/license';

type Lang = (typeof UI_LANGUAGES)[number];
const FREE = { tier: 'free', secret: '' } as unknown as LicenseInfo;
const PAID = { tier: 'family', secret: 'abc' } as unknown as LicenseInfo;
const settingsWith = (mode: string) => ({
  mode, features: {}, strictLanguage: false, dailyCap: 0, totalChecksToday: 0, totalNeutralizedToday: 0,
  totalNeutralizedAllTime: 0, totalTokensThisMonth: 0, uiLanguage: 'en', dashboardTheme: 'dark', aiAnalysisEnabled: true,
} as unknown as FWSettings);
const home = (lang: Lang, mode: string, license: LicenseInfo) => renderToString(createElement(I18nProvider, {
  lang, children: createElement(HomeTab, { settings: settingsWith(mode), license, probeResult: 'ok', onOpenDashboard: () => {}, onOpenDashboardSection: () => {} }),
}));
const buttons = (html: string) => (html.match(/<button[^>]*class="pop-cta[^"]*"/g) ?? []).length;

describe('Home keeps one button', () => {
  for (const lang of UI_LANGUAGES) {
    for (const mode of ['adult', 'teen', 'child']) {
      for (const [name, license] of [['a key', PAID], ['no key', FREE]] as const) {
        it(`${lang}, ${mode}, ${name}: Open your record, and no reading button`, () => {
          const html = home(lang, mode, license);
          expect(html).toContain(POPUP_STRINGS[lang].openDashboard);
          expect(html).not.toContain('read-this');
          expect(buttons(html), 'one main button').toBe(1);
        });
      }
    }
  }
});
