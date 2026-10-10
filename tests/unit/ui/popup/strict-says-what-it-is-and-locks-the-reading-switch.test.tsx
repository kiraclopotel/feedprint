// In Strict the popup says, in one line, what the site and the store say: the filter runs on this
// computer and nothing leaves it. The reading switch reads off and cannot be turned on (the stored
// choice is kept, so leaving Strict gives it back), and the licence card says it is not checked.
// The same screens in Moderate say none of it.

import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { HomeTab, KeysTab, SettingsPanel } from '../../../../src/ui/popup/Popup';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { UI_LANGUAGES } from '../../../../src/i18n';
import type { FWSettings } from '../../../../src/storage/settings';
import { childPreset, teenPreset } from '../../../../src/storage/presets';
import type { LicenseInfo } from '../../../../src/storage/license';

function settingsWith(mode: 'child' | 'teen', aiAnalysisEnabled = true): FWSettings {
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
    features: mode === 'child' ? childPreset() : teenPreset(),
    presets: { appliedAt: '', appliedPreset: mode },
    dashboardTheme: 'dark',
    aiAnalysisEnabled,
  } as unknown as FWSettings;
}

const PAID: LicenseInfo = { tier: 'family', secret: 'abc' } as unknown as LicenseInfo;
type Lang = (typeof UI_LANGUAGES)[number];

function wrap(lang: Lang, child: ReturnType<typeof createElement>): string {
  return renderToString(createElement(I18nProvider, { lang, children: child }));
}

const home = (s: FWSettings, lang: Lang) => wrap(lang, createElement(HomeTab, {
  settings: s, license: PAID, probeResult: 'unknown', onOpenDashboard: () => {}, onOpenDashboardSection: () => {},
}));
const keys = (s: FWSettings, lang: Lang) => wrap(lang, createElement(KeysTab, {
  settings: s, license: PAID, probeResult: 'unknown', onChange: async () => {},
}));
const settingsPanel = (s: FWSettings, lang: Lang) => wrap(lang, createElement(SettingsPanel, {
  settings: s, license: PAID, onBack: () => {}, onChange: async () => {},
}));

describe.each(UI_LANGUAGES)('%s', (lang) => {
  const t = POPUP_STRINGS[lang];

  // His word, 8 Oct 2026: Strict says what it is beside the level choice in Settings, and nowhere on Home.
  it('the home panel carries no Strict line, in Strict or in Moderate', () => {
    expect(home(settingsWith('child'), lang)).not.toContain(t.strictNoCallsLine.replace(/'/g, '&#x27;'));
    expect(home(settingsWith('teen'), lang)).not.toContain(t.strictNoCallsLine.replace(/'/g, '&#x27;'));
  });

  it('the licence card says it is not checked in Strict, not that the reading is on', () => {
    const strict = keys(settingsWith('child'), lang);
    expect(strict).toContain(t.keySubStrict);
    expect(strict).not.toContain(t.keySubActive);
    const moderate = keys(settingsWith('teen'), lang);
    expect(moderate).toContain(t.keySubActive);
    expect(moderate).not.toContain(t.keySubStrict);
  });

  it('the reading switch reads off and locked in Strict whatever is stored, and works in Moderate', () => {
    for (const stored of [true, false]) {
      const strict = settingsPanel(settingsWith('child', stored), lang);
      expect(strict).toContain(t.featAiMasterStrictNote.replace(/'/g, '&#x27;'));
      expect(strict).not.toContain(t.featAiMasterOffNote);
      const master = strict.match(/<button[^>]*aria-label="[^"]*"[^>]*role="switch"[^>]*>|<button[^>]*role="switch"[^>]*aria-label="[^"]*"[^>]*>/g)
        ?.find((b) => b.includes(t.featAiMasterName.replace(/'/g, '&#x27;')));
      expect(master, 'the master switch renders').toBeTruthy();
      expect(master).toContain('aria-checked="false"');
      expect(master).toContain('aria-disabled="true"');
    }
    const moderate = settingsPanel(settingsWith('teen', true), lang);
    expect(moderate).not.toContain(t.featAiMasterStrictNote.replace(/'/g, '&#x27;'));
  });
});
