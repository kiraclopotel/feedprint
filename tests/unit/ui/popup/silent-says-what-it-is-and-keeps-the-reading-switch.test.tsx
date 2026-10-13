// At Silent (the Strict level) with a key the popup is the ordinary popup (12 Oct 2026, Silent reads once a key is added and
// agreed to): the licence card says the key is active, and the reading switch is a live switch whose stored choice is shown
// as it is, with the off note when it is off. Silent's own words sit beside the level choice in Settings and in the header
// chip, and nowhere on Home.

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
  const sq = (s: string) => s.replace(/'/g, '&#x27;');

  // His word, 8 Oct 2026: the level says what it is beside the level choice in Settings, and nowhere on Home.
  it('the home panel carries no Silent line, at Silent or at Calm', () => {
    for (const mode of ['child', 'teen'] as const) {
      const html = home(settingsWith(mode), lang);
      for (const line of [t.strictNoKeyLine, t.strictKeyLine, t.strictNeedsAgreement]) expect(html).not.toContain(sq(line));
    }
  });

  it('the licence card says the key is active at Silent, as at Calm', () => {
    expect(keys(settingsWith('child'), lang)).toContain(t.keySubActive);
    expect(keys(settingsWith('teen'), lang)).toContain(t.keySubActive);
  });

  it('the reading switch shows what is stored at Silent, enabled, and the off note only when it is off', () => {
    const master = (html: string) => html.match(/<button[^>]*aria-label="[^"]*"[^>]*role="switch"[^>]*>|<button[^>]*role="switch"[^>]*aria-label="[^"]*"[^>]*>/g)
      ?.find((b) => b.includes(sq(t.featAiMasterName)));
    const on = settingsPanel(settingsWith('child', true), lang);
    expect(master(on), 'the master switch renders').toBeTruthy();
    expect(master(on)).toContain('aria-checked="true"');
    expect(master(on)).not.toContain('aria-disabled');
    expect(on).not.toContain(sq(t.featAiMasterOffNote));
    const off = settingsPanel(settingsWith('child', false), lang);
    expect(master(off)).toContain('aria-checked="false"');
    expect(master(off)).not.toContain('aria-disabled');
    expect(off).toContain(sq(t.featAiMasterOffNote));
  });
});
