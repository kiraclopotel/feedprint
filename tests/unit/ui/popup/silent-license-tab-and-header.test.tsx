/** @vitest-environment jsdom */
// The License tab and the header chip at Silent (the Strict level), 12 Oct 2026. Silent reads once a key is added and the
// agreement given, so the tab is the ordinary one at every level (the key field, the daily limit with a key, no price),
// and the chip says what Silent does with the key in the tooltip: the filter runs here without one, the posts are read
// with one, nothing leaves until the agreement is given. (Before this day Silent made no call, the tab offered no key and a
// saved key was only "held": that card, and its words, are gone.)

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

describe.each(UI_LANGUAGES)('the License tab at Silent, %s, is the ordinary one', (lang) => {
  const t = POPUP_STRINGS[lang];

  it('free: the key field, the line on what a key adds, no price and no daily limit, as at Calm', () => {
    const silent = keys('child', FREE, lang);
    const calm = keys('teen', FREE, lang);
    expect(silent).toBe(calm);
    expect(silent).toContain('<input');
    expect(silent).toContain(esc(t.keySubFree));
    expect(silent).not.toContain('data-fw-buy-path');
    expect(silent).not.toContain('\u20ac');
    expect(silent).not.toContain(esc(t.dailyLimit));
  });

  it('a key held: the key field, the daily limit and the rows it covers, as at Calm; Remove stays', () => {
    const silent = keys('child', PAID, lang);
    expect(silent).toBe(keys('teen', PAID, lang));
    expect(silent).toContain('<input');
    expect(silent).toContain(esc(t.keySubActive));
    expect(silent).toContain(esc(t.dailyLimit));
    expect(silent).toContain(esc(t.callsPerDay(2000)));
    expect(silent).toContain(esc(t.removeLicense));
  });
});

const header = (lang: Lang, props: Record<string, unknown>) => renderToString(createElement(I18nProvider, {
  lang, children: createElement(PopHeader, { licenseState: 'free', ...props } as never),
}));

describe.each(UI_LANGUAGES)('the header chip at Silent, %s', (lang) => {
  const t = POPUP_STRINGS[lang];

  it('with no key it reads the level, and its tooltip says the filter runs on this computer', () => {
    const html = header(lang, { strict: true });
    expect(html).toContain(`>${esc(t.modeChild)}<`);
    expect(html).toContain(esc(t.strictNoKeyLine));
    expect(html).not.toContain(esc(t.statusFree));
  });

  it('with a key the relay accepts, the chip is the key\'s and the tooltip says the posts are read', () => {
    const html = header(lang, { strict: true, licenseState: 'ok' });
    expect(html).toContain(esc(t.strictKeyLine));
    expect(html).toContain(`>${esc(t.licenseLabel)}<`);
    expect(html).not.toContain(esc(t.strictNoKeyLine));
  });

  it('with a key and no agreement yet, the tooltip says nothing leaves until it is given', () => {
    for (const state of ['ok', 'checking', 'unchecked'] as const) {
      const html = header(lang, { strict: true, agreementWaits: true, licenseState: state });
      expect(html, state).toContain(esc(t.strictNeedsAgreement));
    }
  });

  it('a key the relay refused says so, whatever Silent waits for', () => {
    const html = header(lang, { strict: true, agreementWaits: true, licenseState: 'err' });
    expect(html).toContain(esc(t.statusRevoked));
    expect(html).not.toContain(esc(t.strictNeedsAgreement));
  });

  it('a key not yet checked is told as at every level, never as "saved"', () => {
    const html = header(lang, { strict: true, licenseState: 'unchecked' });
    expect(html).toContain(esc(t.statusUncheckedShort));
    expect(html).toContain(esc(t.statusUnchecked));
  });

  it('away from Silent the chip carries none of the Silent lines', () => {
    const html = header(lang, { strict: false, licenseState: 'ok' });
    expect(html).not.toContain(esc(t.strictKeyLine));
    expect(html).not.toContain(esc(t.strictNeedsAgreement));
    expect(html).toContain(esc(t.statusOk));
  });
});

describe('English words for Silent\'s chip', () => {
  it('read exactly as the card says', () => {
    expect(POPUP_STRINGS.en.strictNoKeyLine).toBe('Silent with no key: the filter runs on this computer.');
    expect(POPUP_STRINGS.en.strictKeyLine).toBe('Silent with a key: posts are read and rephrased before they are shown; account names are replaced by letters.');
    expect(POPUP_STRINGS.en.strictNeedsAgreement).toBe('Live Rephrase is waiting for the agreement. Until then no post leaves this computer.');
  });

  it.each(UI_LANGUAGES)('%s: no em dash, a full stop at the end', (lang) => {
    for (const s of [POPUP_STRINGS[lang].strictNoKeyLine, POPUP_STRINGS[lang].strictKeyLine, POPUP_STRINGS[lang].strictNeedsAgreement]) {
      expect(s).not.toContain('\u2014');
      expect(s).toMatch(/\.$/);
    }
  });
});

describe('the popup hands the header the Silent facts on every screen that shows it', () => {
  const src = readFileSync(join(process.cwd(), 'src/ui/popup/Popup.tsx'), 'utf8');
  it('passes strict and agreementWaits to all three PopHeader uses, and no key-held fact', () => {
    const uses = src.match(/<PopHeader[\s\S]*?\/?>/g) ?? [];
    expect(uses.length).toBe(3);
    for (const u of uses) {
      expect(u, u).toContain('strict={');
      expect(u, u).toContain('agreementWaits={');
      expect(u, u).not.toContain('keyHeld');
    }
  });
});
