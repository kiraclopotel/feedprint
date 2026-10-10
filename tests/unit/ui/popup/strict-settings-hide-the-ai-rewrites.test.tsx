/** @vitest-environment jsdom */
// B2 unit 4 (M1; QUALITY Q5). At Strict, Settings with a key held showed "Calmer rewrites (AI)" and "Rewrite
// flagged comments", though Strict sends nothing and neither can work there. At Strict neither shows; at
// Moderate and Relaxed both are still there. The stored choices are not touched (leaving Strict gives them back).

import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

import { SettingsPanel } from '../../../../src/ui/popup/Popup';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { UI_LANGUAGES } from '../../../../src/i18n';
import { type FWSettings } from '../../../../src/storage/settings';
import { adultPreset, childPreset, teenPreset } from '../../../../src/storage/presets';
import type { LicenseInfo } from '../../../../src/storage/license';

vi.mock('../../../../src/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/ai/client')>();
  return { ...actual, probeProxy: vi.fn(async () => 'ok') };
});

type Mode = 'child' | 'teen' | 'adult';
const PAID: LicenseInfo = { tier: 'family', secret: 'abc' } as unknown as LicenseInfo;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;');

function settingsWith(mode: Mode): FWSettings {
  return {
    settingsSchemaVersion: '14', mode, strictLanguage: false, hideUnrewritable: false,
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
    dashboardTheme: 'dark', aiAnalysisEnabled: true,
  } as unknown as FWSettings;
}

const settingsPanel = (mode: Mode, lang: (typeof UI_LANGUAGES)[number]) => renderToString(createElement(I18nProvider, {
  lang,
  children: createElement(SettingsPanel, {
    settings: settingsWith(mode), license: PAID, onBack: () => {}, onChange: async () => {},
  }),
}));

describe.each(UI_LANGUAGES)('Settings with a key held, %s', (lang) => {
  const t = POPUP_STRINGS[lang];

  it('at Strict neither AI rewrite switch shows', () => {
    const html = settingsPanel('child', lang);
    expect(html).not.toContain(esc(t.reframeRewritesName));
    expect(html).not.toContain(esc(t.featRewriteName));
  });

  it.each(['teen', 'adult'] as const)('at %s both still show', (mode) => {
    const html = settingsPanel(mode, lang);
    expect(html).toContain(esc(t.reframeRewritesName));
    expect(html).toContain(esc(t.featRewriteName));
  });
});
