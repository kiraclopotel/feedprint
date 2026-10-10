// A paid key at Strict buys no reading: Strict makes no outside call. Until 8 Oct 2026 Home said so in two
// sentences inside a blue box; that was too much explanation for Home, so it moved to
// Settings: the Strict level line says nothing leaves, and the AI switch there says it is off in Strict. So a paying
// user is still told, once, where the level is chosen, and Home carries no sentence about Strict at all.

import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { HomeTab } from '../../../../src/ui/popup/Popup';
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

function home(mode: Mode, license: LicenseInfo, lang: Lang): string {
  return renderToString(createElement(I18nProvider, {
    lang,
    children: createElement(HomeTab, {
      settings: settingsWith(mode), license, probeResult: 'unknown',
      onOpenDashboard: () => {}, onOpenDashboardSection: () => {},
    }),
  }));
}

const esc = (s: string) => s.replace(/'/g, '&#x27;');

describe('a paid key at Strict', () => {
  for (const lang of UI_LANGUAGES) {
    const t = POPUP_STRINGS[lang];
    it(`${lang}: Home says nothing about Strict and shows no AI count`, () => {
      const html = home('child', PAID, lang);
      expect(html).not.toContain('data-testid="strict-no-calls"');
      expect(html).not.toContain(esc(t.strictNoCallsLine));
      expect(html).not.toContain('class="pop-tier"');
    });

    it(`${lang}: Settings says it where the level and the AI switch are: nothing leaves, the AI is off in Strict`, () => {
      expect(t.modeExplainChildBody).toMatch(/nothing leaves|nimic nu pleacă|nada sale|nada sai/);
      expect(t.featAiMasterStrictNote).toContain(t.modeChild);
    });
  }


});
