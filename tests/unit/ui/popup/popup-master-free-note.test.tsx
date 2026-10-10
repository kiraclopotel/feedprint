// The AI master row in Settings reads what is true. Without a key there is no row: nothing is sent
// or spent, so there is nothing for it to stop. With a key and the breaker on, the switch reads on
// and no note shows; with the breaker off the off-note shows. At Strict the row reads off and locked
// with a key too, and shows the Strict note.

import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { SettingsPanel } from '../../../../src/ui/popup/Popup';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { UI_LANGUAGES } from '../../../../src/i18n';
import type { FWSettings } from '../../../../src/storage/settings';
import { childPreset, teenPreset } from '../../../../src/storage/presets';
import type { LicenseInfo } from '../../../../src/storage/license';

function settingsWith(aiAnalysisEnabled: boolean, mode: 'child' | 'teen' = 'teen'): FWSettings {
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
    features: mode === 'child' ? childPreset() : teenPreset(),
    presets: { appliedAt: '', appliedPreset: mode },
    dashboardTheme: 'dark',
    aiAnalysisEnabled,
  } as unknown as FWSettings;
}

const FREE: LicenseInfo = { tier: 'free', secret: '' } as unknown as LicenseInfo;
const PAID: LicenseInfo = { tier: 'family', secret: 'abc' } as unknown as LicenseInfo;

function render(settings: FWSettings, license: LicenseInfo, lang: 'en' | 'ro' | 'es' | 'pt-BR' = 'en'): string {
  return renderToString(
    createElement(I18nProvider, {
      lang,
      children: createElement(SettingsPanel, {
        settings, license, onBack: () => {}, onChange: async () => {},
      }),
    }),
  );
}

function masterSwitch(html: string, lang: 'en' | 'ro' | 'es' | 'pt-BR' = 'en'): string | undefined {
  return html.match(/<button[^>]*role="switch"[^>]*>/g)
    ?.find((b) => b.includes(POPUP_STRINGS[lang].featAiMasterName.replace(/'/g, '&#x27;')));
}

describe('the master breaker row', () => {
  it('is not there without a key, whatever is stored, in every language', () => {
    for (const lang of UI_LANGUAGES) {
      for (const stored of [true, false]) {
        const html = render(settingsWith(stored), FREE, lang);
        expect(masterSwitch(html, lang), lang).toBeUndefined();
        expect(html).not.toContain(POPUP_STRINGS[lang].featAiMasterOffNote);
      }
    }
  });

  it('with a key and the breaker on, the switch reads on', () => {
    expect(masterSwitch(render(settingsWith(true), PAID))).toContain('aria-checked="true"');
  });

  it('with a key and the breaker on, no note shows', () => {
    expect(render(settingsWith(true), PAID)).not.toContain(POPUP_STRINGS.en.featAiMasterOffNote);
  });

  it('with a key and the breaker off, the off-note stands', () => {
    expect(render(settingsWith(false), PAID)).toContain(POPUP_STRINGS.en.featAiMasterOffNote);
  });
});

describe('the master breaker row at Strict', () => {
  it('reads off and locked with a key, and shows the Strict note in every language', () => {
    for (const lang of UI_LANGUAGES) {
      const html = render(settingsWith(true, 'child'), PAID, lang);
      const master = masterSwitch(html, lang);
      expect(master, lang + ': the master switch renders').toBeTruthy();
      expect(master).toContain('aria-checked="false"');
      expect(master).toContain('disabled');
      expect(html).toContain(POPUP_STRINGS[lang].featAiMasterStrictNote.replace(/'/g, '&#x27;'));
    }
  });
});
