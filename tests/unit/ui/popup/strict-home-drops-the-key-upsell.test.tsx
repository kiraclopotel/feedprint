/** @vitest-environment jsdom */
// B2 unit 2 (P3a; walker rows V2, B12, B14, R6). Home at Strict said "Free plan · a license key turns on the
// AI reading" and "0 AI readings today" right above a note saying Strict makes no AI calls. At Moderate and
// Relaxed the same key upsell was said three times on one screen (the plan line, the "AI reading: optional"
// banner, and on Relaxed a third line with a link). At Strict Home now says neither; at Moderate and Relaxed
// the key is mentioned once.

import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

import { HomeTab, KeysTab } from '../../../../src/ui/popup/Popup';
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

type Lang = (typeof UI_LANGUAGES)[number];
type Mode = 'child' | 'teen' | 'adult';

const PAID: LicenseInfo = { tier: 'family', secret: 'abc' } as unknown as LicenseInfo;
const FREE: LicenseInfo = { tier: 'free', secret: '' } as unknown as LicenseInfo;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;');
const count = (html: string, s: string) => html.split(esc(s)).length - 1;
// The plan line that sold the key (the metaFree string, removed with this unit), by its opening words.
const PLAN_LINE_START: Record<string, string> = { en: 'Free plan · ', es: 'Plan gratuito · ', 'pt-BR': 'Plano gratuito · ', ro: 'Plan gratuit · ' };

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

const keys = (mode: Mode, license: LicenseInfo, lang: Lang) => renderToString(createElement(I18nProvider, {
  lang,
  children: createElement(KeysTab, { settings: settingsWith(mode), license, probeResult: 'unknown', onChange: async () => {} }),
}));

const home = (mode: Mode, license: LicenseInfo, lang: Lang) => renderToString(createElement(I18nProvider, {
  lang,
  children: createElement(HomeTab, {
    settings: settingsWith(mode), license, probeResult: 'unknown', onOpenDashboard: () => {}, onOpenDashboardSection: () => {},
  }),
}));

describe.each(UI_LANGUAGES)('Home at Strict, %s', (lang) => {
  const s = POPUP_STRINGS[lang];

  it('free plan: no plan-upsell line and no AI count', () => {
    const html = home('child', FREE, lang);
    expect(html).not.toContain(esc(PLAN_LINE_START[lang]));
    expect(html, 'no counters line either: Receipts hides no counters').not.toContain('pop-hero-secondary');
    // His word, 8 Oct 2026: Strict is said beside the level choice in Settings, not on Home.
    for (const line of [s.strictNoKeyLine, s.strictKeyLine, s.strictNeedsAgreement]) expect(html, 'no Silent sentence on Home').not.toContain(esc(line));
  });

  it('with a key: the header chip alone says the key\'s state, and Home carries no AI count', () => {
    const html = home('child', PAID, lang);
    expect(html, 'no plan line under the chip').not.toContain('pop-tier');
  });
});

describe.each(UI_LANGUAGES)('Home at Moderate and Relaxed, %s', (lang) => {
  const s = POPUP_STRINGS[lang];

  // Since 9 Oct 2026 (his word: a clean Home) Home offers no key at all, and an active key's count opens the License tab.
  it.each(['teen', 'adult'] as const)('%s, free: Home does not offer the key', (mode) => {
    const html = home(mode, FREE, lang);
    expect(html, 'no AI word on Home').not.toMatch(/\b(AI|IA)\b/);
    expect(count(html, PLAN_LINE_START[lang]), 'the plan line no longer sells the key').toBe(0);
  });

  it.each(['teen', 'adult'] as const)('%s with a key: the AI count is on the License tab, not on Home', (mode) => {
    expect(home(mode, PAID, lang)).not.toContain('class="pop-tier"');
    expect(keys(mode, PAID, lang)).toContain(esc(s.metaUsage(0, 2000, 0)));
  });
});
