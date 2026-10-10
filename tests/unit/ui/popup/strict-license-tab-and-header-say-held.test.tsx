/** @vitest-environment jsdom */
// B2 unit 3 (P3b + M4; walker rows V3, Q4). At Strict the License tab still showed a key field, the price,
// "Paste a license key above..." and a daily-limit card, and with a key saved the header chip said "Not
// checked" and "Could not check the license right now", which read as a fault. Strict makes no calls, so it
// never checks. At Strict the tab now shows the Strict sentence, and a held key says it is saved and that
// Strict does not check it. Away from Strict nothing changes.

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

import { KeysTab, PopHeader } from '../../../../src/ui/popup/Popup';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { UI_LANGUAGES } from '../../../../src/i18n';
import { type FWSettings } from '../../../../src/storage/settings';
import { childPreset, teenPreset } from '../../../../src/storage/presets';
import type { LicenseInfo } from '../../../../src/storage/license';

vi.mock('../../../../src/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/ai/client')>();
  return { ...actual, probeProxy: vi.fn(async () => 'ok') };
});

type Lang = (typeof UI_LANGUAGES)[number];
type Mode = 'child' | 'teen';

const PAID: LicenseInfo = { tier: 'family', secret: 'abc' } as unknown as LicenseInfo;
const FREE: LicenseInfo = { tier: 'free', secret: '' } as unknown as LicenseInfo;
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
    features: mode === 'child' ? childPreset() : teenPreset(),
    presets: { appliedAt: '', appliedPreset: mode },
    dashboardTheme: 'dark', aiAnalysisEnabled: true,
  } as unknown as FWSettings;
}

const keys = (mode: Mode, license: LicenseInfo, lang: Lang) => renderToString(createElement(I18nProvider, {
  lang,
  children: createElement(KeysTab, { settings: settingsWith(mode), license, probeResult: 'unknown', onChange: async () => {} }),
}));

describe.each(UI_LANGUAGES)('the License tab at Strict, %s', (lang) => {
  const t = POPUP_STRINGS[lang];

  it('free: "Not checked in Strict", no key field, no price, no daily limit', () => {
    const html = keys('child', FREE, lang);
    expect(html).toContain(esc(t.keySubStrict));
    expect(html, 'the long Strict sentence left this tab on 8 Oct 2026').not.toContain(esc(t.strictNoCallsLine));
    expect(html, 'no key input').not.toContain('<input');
    expect(html, 'no price').not.toContain('€');
    expect(html).not.toContain('data-fw-buy-path');
    expect(html).not.toContain(esc(t.dailyLimit));
    expect(html).not.toContain(esc(t.keySubFree));
  });

  it('a key held: it says "Not checked in Strict" once, and Remove stays', () => {
    const html = keys('child', PAID, lang);
    expect(html.split(esc(t.keySubStrict)).length - 1).toBe(1);
    expect(html).toContain(esc(t.removeLicense));
    expect(html, 'no key input').not.toContain('<input');
    expect(html, 'no daily-limit card').not.toContain(esc(t.dailyLimit));
    expect(html).not.toContain(esc(t.callsPerDay(2000)));
  });
});

describe.each(UI_LANGUAGES)('the License tab at Moderate, %s, is unchanged', (lang) => {
  const t = POPUP_STRINGS[lang];

  // Since 9 Oct 2026 a free install shows no AI word: the key field stays, the daily limit (the AI's) does not.
  it('free: the key field is there, with no daily limit and no price', () => {
    const html = keys('teen', FREE, lang);
    expect(html).toContain('<input');
    expect(html).not.toContain('data-fw-buy-path');
    expect(html).not.toContain('€');
    expect(html).not.toContain(esc(t.dailyLimit));
    expect(html).not.toContain(esc(t.strictNoCallsLine));
  });

  it('paid: key field and the daily cap are there', () => {
    const html = keys('teen', PAID, lang);
    expect(html).toContain('<input');
    expect(html).toContain(esc(t.dailyLimit));
  });
});

// M4: the header chip at Strict with a key saved.
const header = (lang: Lang, state: 'unchecked' | 'checking' | 'ok' | 'free', keyHeld: boolean) => renderToString(createElement(I18nProvider, {
  lang, children: createElement(PopHeader, { licenseState: state, keyHeld }),
}));

describe.each(UI_LANGUAGES)('the header chip at Strict with a saved key, %s', (lang) => {
  const t = POPUP_STRINGS[lang];

  it.each(['unchecked', 'checking'] as const)('%s: says the key is saved, never "Not checked" or "Could not check"', (state) => {
    const html = header(lang, state, true);
    expect(html).toContain(esc(t.statusKeyHeldShort));
    expect(html).toContain(esc(t.statusKeyHeld));
    expect(html).not.toContain(esc(t.statusUncheckedShort));
    expect(html).not.toContain(esc(t.statusUnchecked));
    expect(html).not.toContain(esc(t.statusCheckingShort));
  });

  it('away from Strict the unchecked words are unchanged', () => {
    const html = header(lang, 'unchecked', false);
    expect(html).toContain(esc(t.statusUncheckedShort));
    expect(html).toContain(esc(t.statusUnchecked));
    expect(html).not.toContain(esc(t.statusKeyHeldShort));
  });
});

describe('English words for M4', () => {
  it('reads exactly as the card says', () => {
    expect(POPUP_STRINGS.en.statusKeyHeldShort).toBe('Key saved');
    expect(POPUP_STRINGS.en.statusKeyHeld).toBe('Key saved. Strict makes no calls, so the key is not checked.');
  });

  it.each(UI_LANGUAGES)('%s: no em dash, no age word', (lang) => {
    for (const s of [POPUP_STRINGS[lang].statusKeyHeldShort, POPUP_STRINGS[lang].statusKeyHeld]) {
      expect(s).not.toContain('—');
      expect(s.length).toBeGreaterThan(5);
    }
  });
});

describe('the popup hands the header the Strict-with-key fact on every screen that shows it', () => {
  const src = readFileSync(join(process.cwd(), 'src/ui/popup/Popup.tsx'), 'utf8');
  it('passes keyHeld to all three PopHeader uses', () => {
    const uses = src.match(/<PopHeader[\s\S]*?\/?>/g) ?? [];
    expect(uses.length).toBe(3);
    for (const u of uses) expect(u, u).toContain('keyHeld=');
  });
});
