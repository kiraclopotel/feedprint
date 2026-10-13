// A paid key at Silent (the Strict level) buys the reading, like at Calm and Open (12 Oct 2026). Until then Silent sent nothing
// and Settings said the reading was off there. Now Home says nothing about Silent and shows the same as at Calm, and Settings
// says it where the level is chosen: one sentence says posts arrive rephrased, and the reading switch is the ordinary one.

import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { HomeTab, SettingsPanel } from '../../../../src/ui/popup/Popup';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { UI_LANGUAGES } from '../../../../src/i18n';
import type { FWSettings } from '../../../../src/storage/settings';
import { childPreset, teenPreset, adultPreset } from '../../../../src/storage/presets';
import type { LicenseInfo } from '../../../../src/storage/license';

type Mode = 'child' | 'teen' | 'adult';
type Lang = (typeof UI_LANGUAGES)[number];

function settingsWith(mode: Mode): FWSettings {
  return {
    settingsSchemaVersion: '14',
    mode,
    strictLanguage: false,
    hideUnrewritable: false,
    parentPin: '1234', dailyCap: 2000, monthlyUsdCapOverride: null, locale: 'en',
    outputLanguage: 'auto', uiLanguage: 'auto',
    totalChecksToday: 0, totalNeutralizedToday: 0, totalTokensToday: 0,
    estimatedCostToday: 0, lastResetDate: '',
    totalChecksThisMonth: 0, totalTokensThisMonth: 0, lastResetMonth: '',
    totalTokensAllTime: 0, totalChecksAllTime: 0,
    totalNeutralizedAllTime: 0, estimatedCostAllTime: 0,
    metricsHiddenToday: 0, metricsHiddenAllTime: 0,
    features: mode === 'child' ? childPreset() : mode === 'teen' ? teenPreset() : adultPreset(),
    presets: { appliedAt: '', appliedPreset: mode },
    dashboardTheme: 'dark',
    aiAnalysisEnabled: true,
  } as unknown as FWSettings;
}

const PAID: LicenseInfo = { tier: 'family', secret: 'abc' } as unknown as LicenseInfo;

function home(mode: Mode, lang: Lang): string {
  return renderToString(createElement(I18nProvider, {
    lang,
    children: createElement(HomeTab, {
      settings: settingsWith(mode), license: PAID, probeResult: 'unknown',
      onOpenDashboard: () => {}, onOpenDashboardSection: () => {},
    }),
  }));
}

function settings(mode: Mode, lang: Lang): string {
  return renderToString(createElement(I18nProvider, {
    lang,
    children: createElement(SettingsPanel, { settings: settingsWith(mode), license: PAID, onBack: () => {}, onChange: async () => {} }),
  }));
}

const esc = (s: string) => s.replace(/'/g, '&#x27;');

describe('a paid key at Silent', () => {
  for (const lang of UI_LANGUAGES) {
    const t = POPUP_STRINGS[lang];
    it(`${lang}: Home says nothing about Silent and is the page Calm shows`, () => {
      const html = home('child', lang);
      expect(html).not.toContain('data-testid="strict-no-calls"');
      for (const line of [t.strictNoKeyLine, t.strictKeyLine, t.strictNeedsAgreement]) expect(html).not.toContain(esc(line));
      // Home's markup differs between the levels only by the name the dots carry; the key's count lives on the License tab.
      expect(html.includes('class="pop-tier"')).toBe(home('teen', lang).includes('class="pop-tier"'));
    });

    it(`${lang}: Settings says it where the level is chosen: posts arrive rephrased, and the reading switch is live`, () => {
      expect(t.levelSentenceChild).toMatch(/rephrased|reformulat|reescrit/);
      const html = settings('child', lang);
      expect(html).toContain(esc(t.levelSentenceChild));
      expect(html).toContain(esc(t.featAiMasterName));
      expect(html).not.toContain('aria-disabled="true"');
    });
  }
});
