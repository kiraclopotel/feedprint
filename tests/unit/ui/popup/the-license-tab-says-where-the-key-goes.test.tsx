/** @vitest-environment jsdom */
// Setup used to say where the key and a post's text go once a key is used; that note left with the setup license
// screen. The two places a key holder meets say it instead: the License tab, where the key is typed, says the key
// goes only to FeelingWise's server; the consent screen before the first reading says what goes out and to whom
// (tests/unit/ui/popup/the-reading-starts-on-request.test.tsx). At Strict nothing goes out and the tab offers no key.

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

import { KeysTab } from '../../../../src/ui/popup/Popup';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { UI_LANGUAGES } from '../../../../src/i18n';
import type { FWSettings } from '../../../../src/storage/settings';
import { childPreset, teenPreset } from '../../../../src/storage/presets';
import type { LicenseInfo } from '../../../../src/storage/license';
import type { Mode } from '../../../../src/types/mode';

type Lang = (typeof UI_LANGUAGES)[number];

const FREE = { tier: 'free', secret: '' } as unknown as LicenseInfo;
const PAID = { tier: 'family', secret: 'abc' } as unknown as LicenseInfo;
const esc = (s: string) => s.replace(/'/g, '&#x27;');

function settingsWith(mode: Mode): FWSettings {
  return {
    settingsSchemaVersion: '14', mode, strictLanguage: false, hideUnrewritable: false,
    parentPin: '1234', dailyCap: 2000, monthlyUsdCapOverride: null, locale: 'en', outputLanguage: 'auto', uiLanguage: 'auto',
    totalChecksToday: 0, totalNeutralizedToday: 0, totalTokensToday: 0, estimatedCostToday: 0, lastResetDate: '',
    totalChecksThisMonth: 0, totalTokensThisMonth: 0, lastResetMonth: '', totalTokensAllTime: 0, totalChecksAllTime: 0,
    totalNeutralizedAllTime: 0, estimatedCostAllTime: 0, metricsHiddenToday: 0, metricsHiddenAllTime: 0,
    features: mode === 'child' ? childPreset() : teenPreset(),
    presets: { appliedAt: '', appliedPreset: mode }, dashboardTheme: 'dark', aiAnalysisEnabled: true,
  } as unknown as FWSettings;
}

const keysTab = (mode: Mode, license: LicenseInfo, lang: Lang) => renderToString(createElement(I18nProvider, {
  lang,
  children: createElement(KeysTab, { settings: settingsWith(mode), license, probeResult: 'unknown', onChange: async () => {} }),
}));

describe.each(UI_LANGUAGES)('%s: the License tab says where the key goes', (lang) => {
  const t = POPUP_STRINGS[lang];

  it.each([['with no key', FREE], ['with a key', PAID]] as const)('at Moderate, %s', (_name, license) => {
    expect(keysTab('teen', license, lang)).toContain(esc(t.licenseStaysOnDevice));
  });

  it.each([['with no key', FREE], ['with a key', PAID]] as const)('at Strict, %s, the tab has no key field and no line on where a key goes', (_name, license) => {
    const html = keysTab('child', license, lang);
    expect(html).not.toContain(esc(t.licenseStaysOnDevice));
    expect(html).not.toContain(`aria-label="${esc(t.licCardName)}"`);
  });

  // With no key, the line under the card says Receipts is free, so the tab does not read as a gate before a payment.
  it('at Moderate with no key, the line under the card says Receipts is free', () => {
    expect(keysTab('teen', FREE, lang)).toContain(esc(t.keySubFree));
    expect(t.keySubFree).toMatch(/free|gratuit|gratis/i);
  });

  it('the line names FeelingWise as the one place the key goes', () => {
    expect(t.licenseStaysOnDevice).toContain('FeelingWise');
  });
});
