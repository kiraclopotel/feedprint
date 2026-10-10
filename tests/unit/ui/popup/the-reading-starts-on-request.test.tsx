/** @vitest-environment jsdom */
// The paid reading starts on the person's request. The popup asks once per licence key, in every
// level that reads (Strict sends nothing and is never asked), only while the reading is on; the button stores the text version, the hash of the words
// shown and the time, under a digest of the key; "Not now" is the caller's to turn the reading off;
// and every paid call carries the stored consent in the header the proxy reads.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { installChromeStorageStub } from '../../../helpers/chrome-storage';
import { utcDayKey, utcMonthKey, CURRENT_SETTINGS_SCHEMA_VERSION } from '../../../../src/storage/settings';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { UI_LANGUAGES } from '../../../../src/i18n';
import { sha256 } from '../../../../src/forensics/hasher';
import type { LicenseInfo } from '../../../../src/storage/license';
import type { ReadingConsent } from '../../../../src/storage/reading-consent';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY: LicenseInfo = { tier: 'starter', secret: 'abc12345' };
const OTHER: LicenseInfo = { tier: 'family', secret: 'zzz99999' };
const PROVIDER = 'Example Provider Inc., USA';
const GIVEN: ReadingConsent = { textVersion: 'v', textHash: 'a'.repeat(64), at: '2026-10-05T10:00:00.000Z', provider: PROVIDER };

function stored(): Record<string, unknown> {
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION, lastResetDate: utcDayKey(), lastResetMonth: utcMonthKey(),
    fw_license_key: 'fw-starter-abc12345', dailyCap: 2500, totalChecksToday: 0, totalTokensThisMonth: 100,
  };
}

beforeEach(() => {
  vi.resetModules();
  installChromeStorageStub({ initial: stored(), sendMessage: () => undefined });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('when the popup asks', () => {
  it('only with a key, the reading on, a level that reads (never Strict), no consent for the key, and a key the proxy did not refuse', async () => {
    const { needsReadingConsent } = await import('../../../../src/ui/popup/panels/ReadingConsentScreen');
    const base = { license: KEY, settings: { aiAnalysisEnabled: true, mode: 'adult' as const }, consent: null, servedProvider: PROVIDER as string | null, keyRefused: false };
    expect(needsReadingConsent(base)).toBe(true);
    expect(needsReadingConsent({ ...base, settings: { aiAnalysisEnabled: true, mode: 'teen' } })).toBe(true);
    expect(needsReadingConsent({ ...base, settings: { aiAnalysisEnabled: true, mode: 'child' } })).toBe(false);
    expect(needsReadingConsent({ ...base, settings: { aiAnalysisEnabled: true, mode: 'teen', levelChosen: false } })).toBe(false);
    expect(needsReadingConsent({ ...base, settings: { aiAnalysisEnabled: false, mode: 'adult' } })).toBe(false);
    expect(needsReadingConsent({ ...base, license: { tier: 'free', secret: '' } })).toBe(false);
    expect(needsReadingConsent({ ...base, consent: GIVEN })).toBe(false);
    expect(needsReadingConsent({ ...base, consent: undefined })).toBe(false);
    expect(needsReadingConsent({ ...base, keyRefused: true })).toBe(false);
  });

  it('asks again when the company the proxy names now is not the one the person agreed to, and never for a name not served', async () => {
    const { needsReadingConsent } = await import('../../../../src/ui/popup/panels/ReadingConsentScreen');
    const base = { license: KEY, settings: { aiAnalysisEnabled: true, mode: 'adult' as const }, consent: GIVEN, keyRefused: false };
    expect(needsReadingConsent({ ...base, servedProvider: PROVIDER })).toBe(false);
    expect(needsReadingConsent({ ...base, servedProvider: 'Another Company Ltd., EU' })).toBe(true);
    expect(needsReadingConsent({ ...base, servedProvider: null })).toBe(false);
    expect(needsReadingConsent({ ...base, servedProvider: 'Another Company Ltd., EU', settings: { aiAnalysisEnabled: true, mode: 'child' } })).toBe(false);
    // Moderate still reads, so it still asks when the company changes.
    expect(needsReadingConsent({ ...base, servedProvider: 'Another Company Ltd., EU', settings: { aiAnalysisEnabled: true, mode: 'teen', levelChosen: true } })).toBe(true);
  });
});

describe('what the button stores', () => {
  it('the version, the hash of the words shown, the time and the name shown, once per key, under a digest of the key', async () => {
    const rc = await import('../../../../src/storage/reading-consent');
    expect(await rc.getReadingConsent(rc.bearerOf(KEY))).toBeNull();
    const c = await rc.recordReadingConsent(rc.bearerOf(KEY), 'the words shown', PROVIDER, new Date('2026-10-05T10:00:00.000Z'));
    expect(c).toEqual({ textVersion: rc.READING_CONSENT_TEXT_VERSION, textHash: await sha256('the words shown'), at: '2026-10-05T10:00:00.000Z', provider: PROVIDER });
    expect(await rc.getReadingConsent(rc.bearerOf(KEY))).toEqual(c);
    expect(await rc.getReadingConsent(rc.bearerOf(OTHER))).toBeNull();
    const all = JSON.stringify(await chrome.storage.local.get('readingConsent'));
    expect(all).not.toContain(KEY.secret);
  });

  it('sends four fields in the header, the shape the proxy accepts', async () => {
    const rc = await import('../../../../src/storage/reading-consent');
    expect(rc.READING_CONSENT_HEADER).toBe('X-FW-Consent');
    expect(JSON.parse(rc.consentHeaderValue(GIVEN))).toEqual({ v: 'v', h: 'a'.repeat(64), at: '2026-10-05T10:00:00.000Z', p: PROVIDER });
  });
});

describe('the paid call', () => {
  function okResponse(): Response {
    const res = {
      ok: true, status: 200, headers: { get: () => null },
      json: () => Promise.resolve({ choices: [{ message: { content: 'answer' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
      clone: () => res,
    };
    return res as unknown as Response;
  }

  it('carries the stored consent, and calls without one when none is stored (a grandfathered key)', async () => {
    const fetchSpy = vi.fn(async () => okResponse());
    (globalThis as { fetch: unknown }).fetch = fetchSpy;
    const { callAI } = await import('../../../../src/ai/client');
    const rc = await import('../../../../src/storage/reading-consent');

    await callAI('sys', 'usr');
    const before = (fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(before['X-FW-Consent']).toBeUndefined();

    const c = await rc.recordReadingConsent(rc.bearerOf(KEY), 'the words shown', PROVIDER);
    await callAI('sys', 'usr 2');
    const after = (fetchSpy.mock.calls[1] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(after['X-FW-Consent']).toBe(rc.consentHeaderValue(c));
  });
});

describe('the screen', () => {
  let root: Root | null = null;
  afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); root = null; });

  it.each(UI_LANGUAGES)('%s: guides through why, what stays, what goes out, to whom and the money line, with two equal answers', async (lang) => {
    const { ReadingConsentScreen, readingConsentText } = await import('../../../../src/ui/popup/panels/ReadingConsentScreen');
    // The same module instance as the screen's, since the modules were reset for this test.
    const { I18nProvider } = await import('../../../../src/i18n/react');
    const t = POPUP_STRINGS[lang];
    const onStart = vi.fn();
    const onNotNow = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(createElement(I18nProvider, { lang, children: createElement(ReadingConsentScreen, { provider: PROVIDER, onStart, onNotNow }) })); });
    const text = host.textContent ?? '';
    for (const line of [t.consentTitle, t.consentWhy, t.consentWhatGoes, t.consentToWhom(PROVIDER), t.consentWhatDoesNot, t.consentMoney]) expect(text).toContain(line);
    expect(text).toContain(PROVIDER);
    // The guided order: why, what stays, what leaves, who, the money.
    const order = [t.consentWhy, t.consentWhatDoesNot, t.consentWhatGoes, t.consentToWhom(PROVIDER), t.consentMoney].map((s) => text.indexOf(s));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(host.querySelectorAll('button')).toHaveLength(2);
    // A real choice: the two answers carry the same class, and neither is focused first.
    const start = host.querySelector('[data-testid="consent-start"]') as HTMLButtonElement;
    const notNow = host.querySelector('[data-testid="consent-not-now"]') as HTMLButtonElement;
    expect(start.className).toBe(notNow.className);
    expect(document.activeElement).not.toBe(start);
    expect(document.activeElement).not.toBe(notNow);
    await act(async () => { (host.querySelector('[data-testid="consent-start"]') as HTMLButtonElement).click(); });
    expect(onStart).toHaveBeenCalledWith(readingConsentText(t, PROVIDER), PROVIDER);
    await act(async () => { (host.querySelector('[data-testid="consent-not-now"]') as HTMLButtonElement).click(); });
    expect(onNotNow).toHaveBeenCalledTimes(1);
  });
});

describe('a name the proxy did not serve', () => {
  let root: Root | null = null;
  afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); root = null; });

  it.each(UI_LANGUAGES)('%s: says why it cannot start, and the button does nothing, so no one agrees to an unnamed company', async (lang) => {
    const { ReadingConsentScreen } = await import('../../../../src/ui/popup/panels/ReadingConsentScreen');
    const { I18nProvider } = await import('../../../../src/i18n/react');
    const t = POPUP_STRINGS[lang];
    const onStart = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(createElement(I18nProvider, { lang, children: createElement(ReadingConsentScreen, { provider: null, onStart, onNotNow: vi.fn() }) })); });
    expect(host.textContent).toContain(t.consentProviderUnknown);
    const start = host.querySelector('[data-testid="consent-start"]') as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    await act(async () => { start.click(); });
    expect(onStart).not.toHaveBeenCalled();
  });
});

describe('the name the licence probe serves', () => {
  function probeAnswer(header: string | null): Response {
    return { status: 200, headers: { get: (n: string) => (n.toLowerCase() === 'x-fw-provider-legal' ? header : null) } } as unknown as Response;
  }

  it('is read from the probe answer, kept with the probe result, and dropped when the answer carries none', async () => {
    const { probeProxy, servedProviderName } = await import('../../../../src/ai/client');
    (globalThis as { fetch: unknown }).fetch = vi.fn(async () => probeAnswer('  Deep Infra Inc., USA  '));
    expect(await probeProxy('fw-starter-aaa11111')).toBe('ok');
    expect(servedProviderName('fw-starter-aaa11111')).toBe('Deep Infra Inc., USA');
    expect(servedProviderName('fw-starter-bbb22222')).toBeNull();

    (globalThis as { fetch: unknown }).fetch = vi.fn(async () => probeAnswer(null));
    expect(await probeProxy('fw-starter-bbb22222')).toBe('ok');
    expect(servedProviderName('fw-starter-bbb22222')).toBeNull();

    (globalThis as { fetch: unknown }).fetch = vi.fn(async () => probeAnswer('x'.repeat(200)));
    await probeProxy('fw-starter-ccc33333');
    expect(servedProviderName('fw-starter-ccc33333')).toBeNull();
  });
});
