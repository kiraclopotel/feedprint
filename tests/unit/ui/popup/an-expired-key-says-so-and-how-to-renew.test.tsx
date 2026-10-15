// A paid key that ran out reads differently from a key the server refused (the open board's R038, 14 Oct 2026): the
// relay answers 401 with the code license_expired for the one and license_revoked for the other
// (worker/src/proxy.ts), and the popup said "License key not accepted" for both, with no word "expired" and no way
// to renew. The probe now keeps the code, and Home and the License tab say expired and link to getting a key.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { HomeTab, KeysTab } from '../../../../src/ui/popup/Popup';
import { KEY_HELP_URL } from '../../../../src/ui/popup/panels/KeysTab';
import { computeAiBannerState, computeStatusStates } from '../../../../src/ui/popup/panels/status';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { CURRENT_SETTINGS_SCHEMA_VERSION, utcDayKey, utcMonthKey, type FWSettings } from '../../../../src/storage/settings';
import type { LicenseInfo } from '../../../../src/storage/license';
import { installChromeStorageStub } from '../../../helpers/chrome-storage';
import { readingConsentFor } from '../../../helpers/reading-consent';

const KEY = 'fw-starter-abc12345';
const PAID: LicenseInfo = { tier: 'starter', secret: 'abc12345' };
const settingsStub = { mode: 'adult', dailyCap: 2000, totalChecksToday: 3, uiLanguage: 'en' } as unknown as FWSettings;
const en = POPUP_STRINGS.en;

const refusal = (code: string | null) => ({
  ok: false, status: 401, headers: { get: () => null },
  json: () => (code === null ? Promise.reject(new SyntaxError('not JSON')) : Promise.resolve({ error: { message: 'x', code } })),
});

function installStore(): void {
  installChromeStorageStub({
    initial: {
      settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION, lastResetDate: utcDayKey(), lastResetMonth: utcMonthKey(),
      fw_license_key: KEY, mode: 'adult', dailyCap: 2500, totalChecksToday: 0, totalTokensThisMonth: 0,
      ...readingConsentFor(KEY),
    },
    sendMessage: () => undefined,
  });
}

beforeEach(() => { vi.resetModules(); vi.spyOn(console, 'warn').mockImplementation(() => undefined); });
afterEach(() => { vi.restoreAllMocks(); });

describe('the probe keeps the reason the relay gave', () => {
  it('license_expired is expired, license_revoked and an unreadable refusal stay revoked', async () => {
    installStore();
    const { probeProxy } = await import('../../../../src/ai/client');
    (globalThis as any).fetch = vi.fn().mockResolvedValue(refusal('license_expired'));
    expect(await probeProxy(`${KEY}a`)).toBe('expired');
    (globalThis as any).fetch = vi.fn().mockResolvedValue(refusal('license_revoked'));
    expect(await probeProxy(`${KEY}b`)).toBe('revoked');
    (globalThis as any).fetch = vi.fn().mockResolvedValue(refusal(null));
    expect(await probeProxy(`${KEY}c`)).toBe('revoked');
  });

  it('an expired key is a fault on the header dot and has its own banner', () => {
    expect(computeStatusStates(PAID, 'expired').licenseState).toBe('err');
    expect(computeAiBannerState(PAID, 'expired')).toBe('expired');
    expect(computeAiBannerState(PAID, 'revoked')).toBe('revoked');
  });
});

const render = (tab: 'home' | 'keys', probeResult: 'expired' | 'revoked') => renderToString(createElement(I18nProvider, {
  lang: 'en',
  children: tab === 'home'
    ? createElement(HomeTab, { settings: settingsStub, license: PAID, probeResult, onOpenDashboard: () => {}, onOpenDashboardSection: () => {} })
    : createElement(KeysTab, { settings: settingsStub, license: PAID, probeResult, onChange: async () => {} }),
}));
const escaped = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;');

describe('Home and the License tab say expired and how to get a key again', () => {
  for (const tab of ['home', 'keys'] as const) {
    it(`${tab}: an expired key shows the expired words and the link, never the not-accepted card`, () => {
      const html = render(tab, 'expired');
      expect(html).toContain(escaped(en.licenseExpiredTitle));
      expect(html).toContain(escaped(tab === 'home' ? en.licenseExpiredBody : en.licenseExpiredBodyKeysTab));
      expect(html).toContain(`href="${KEY_HELP_URL}"`);
      expect(html).toContain(escaped(en.licenseRenewLink));
      expect(html).not.toContain(escaped(en.licenseInvalidTitle));
    });
    it(`${tab}: a refused key keeps the not-accepted card and no expired word`, () => {
      const html = render(tab, 'revoked');
      expect(html).toContain(escaped(en.licenseInvalidTitle));
      expect(html).not.toContain(escaped(en.licenseExpiredTitle));
    });
  }
  it('the License tab marks an expired key with its own pill', () => {
    expect(render('keys', 'expired')).toContain(escaped(en.licenseExpiredPill));
  });
});

describe('the words exist in every language and say expired in English', () => {
  for (const lang of ['en', 'ro', 'es', 'pt-BR'] as const) {
    it(lang, () => {
      const t = POPUP_STRINGS[lang];
      for (const k of ['licenseExpiredTitle', 'licenseExpiredBody', 'licenseExpiredBodyKeysTab', 'licenseExpiredPill', 'licenseRenewLink'] as const) {
        expect(t[k].length, k).toBeGreaterThan(0);
      }
      expect(t.licenseExpiredTitle).not.toBe(t.licenseInvalidTitle);
    });
  }
  it('the English title says expired', () => { expect(en.licenseExpiredTitle).toMatch(/expired/i); });
});
