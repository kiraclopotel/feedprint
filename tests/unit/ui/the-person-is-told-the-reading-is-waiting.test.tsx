/** @vitest-environment jsdom */
// The reading waits for the person's go-ahead and says so (11 Oct 2026, the Tester's full test: "every post as written with
// no dot and no notice, and the popup still shows the licence as OK"). Where the relay's refusal is told to the person:
//   - the popup's consent screen comes back, even when a go-ahead is stored on this device, and only for a key that reads;
//   - the toolbar icon carries a red "!" while the reading waits and gives today's count back after;
//   - the Issues tab shows a card of its own, in all four languages, with the one thing to do.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { installChromeStorageStub } from '../../helpers/chrome-storage';
import { utcDayKey, utcMonthKey, CURRENT_SETTINGS_SCHEMA_VERSION } from '../../../src/storage/settings';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';
import { POPUP_STRINGS } from '../../../src/i18n/popup-strings';
import { UI_LANGUAGES } from '../../../src/i18n';
import { I18nProvider } from '../../../src/i18n/react';
import { needsReadingConsent } from '../../../src/ui/popup/panels/ReadingConsentScreen';
import { OperationalEventsPanel } from '../../../src/ui/dashboard/components/OperationalEventsPanel';
import type { LicenseInfo } from '../../../src/storage/license';
import type { ReadingConsent } from '../../../src/storage/reading-consent';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY: LicenseInfo = { tier: 'starter', secret: 'abc12345' };
const PROVIDER = 'Example Provider Inc., USA';
const GIVEN: ReadingConsent = { textVersion: 'v', textHash: 'a'.repeat(64), at: '2026-10-05T10:00:00.000Z', provider: PROVIDER };
const MARKER = { fingerprint: 'starter:2345', code: 'consent_required', at: 1 };

function stored(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION, lastResetDate: utcDayKey(), lastResetMonth: utcMonthKey(),
    fw_license_key: 'fw-starter-abc12345', dailyCap: 2500, totalChecksToday: 0, totalTokensThisMonth: 0,
    ...extra,
  };
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('the popup', () => {
  const base = { license: KEY, settings: { aiAnalysisEnabled: true, mode: 'teen' as const }, consent: GIVEN as ReadingConsent | null, servedProvider: PROVIDER as string | null, keyRefused: false };

  it('with a go-ahead stored and no refusal from the relay, it asks nothing', () => {
    expect(needsReadingConsent(base)).toBe(false);
  });

  it('with the relay having asked for the go-ahead, it asks again even though one is stored', () => {
    expect(needsReadingConsent({ ...base, relayAsked: true })).toBe(true);
  });

  it('but never for a free install, a reading switched off, a refused key or Strict, which sends nothing', () => {
    expect(needsReadingConsent({ ...base, relayAsked: true, license: { tier: 'free', secret: '' } })).toBe(false);
    expect(needsReadingConsent({ ...base, relayAsked: true, settings: { aiAnalysisEnabled: false, mode: 'teen' } })).toBe(false);
    expect(needsReadingConsent({ ...base, relayAsked: true, keyRefused: true })).toBe(false);
    expect(needsReadingConsent({ ...base, relayAsked: true, settings: { aiAnalysisEnabled: true, mode: 'child' } })).toBe(false);
  });
});

describe('the toolbar icon', () => {
  let badge: { text: string; color: string };

  beforeEach(() => {
    vi.resetModules();
  });

  function installIcon(initial: Record<string, unknown>): void {
    installChromeStorageStub({ initial });
    badge = { text: 'untouched', color: 'untouched' };
    (globalThis as unknown as { chrome: { action: unknown } }).chrome.action = {
      setBadgeText: async ({ text }: { text: string }) => { badge.text = text; },
      setBadgeBackgroundColor: async ({ color }: { color: string }) => { badge.color = color; },
    };
  }

  it('shows a red "!" while the reading waits for the go-ahead, whatever the count is', async () => {
    installIcon(stored({ readingPaused: MARKER, totalNeutralizedToday: 7 }));
    const { paintToolbarIcon } = await import('../../../src/background/toolbar-icon');
    await paintToolbarIcon(7);
    expect(badge).toEqual({ text: '!', color: '#c0392b' });
  });

  it("gives today's count back once the marker is gone, and nothing at zero", async () => {
    installIcon(stored({ totalNeutralizedToday: 4 }));
    const { paintToolbarIcon } = await import('../../../src/background/toolbar-icon');
    await paintToolbarIcon();
    expect(badge).toEqual({ text: '4', color: '#00bcd4' });
    await paintToolbarIcon(0);
    expect(badge.text).toBe('');
  });
});

describe('the Issues tab', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  async function show(initial: Record<string, unknown>, lang: 'en' = 'en'): Promise<string> {
    installChromeStorageStub({ initial });
    await act(async () => {
      root.render(createElement(I18nProvider, { lang, children: createElement(OperationalEventsPanel as never, { initialBuckets: [] }) }));
    });
    for (let i = 0; i < 20; i++) await act(async () => { await Promise.resolve(); });
    return host.textContent ?? '';
  }

  it('has a card that says the reading waits and what to press, when the marker stands', async () => {
    const text = await show(stored({ readingPaused: MARKER }));
    expect(text).toContain(DASHBOARD_STRINGS.en.opsCardReadingPausedTitle);
    expect(text).toContain(DASHBOARD_STRINGS.en.opsCardReadingPausedAction);
  });

  it('has no such card when it does not', async () => {
    const text = await show(stored());
    expect(text).not.toContain(DASHBOARD_STRINGS.en.opsCardReadingPausedTitle);
  });

  it.each(UI_LANGUAGES)('%s: the card has its three words, and the button it names is the one on the popup', (lang) => {
    const d = DASHBOARD_STRINGS[lang];
    for (const text of [d.opsCardReadingPausedTitle, d.opsCardReadingPausedMeaning, d.opsCardReadingPausedAction]) {
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toContain('—');
    }
    expect(d.opsCardReadingPausedAction).toContain(POPUP_STRINGS[lang].consentStart);
  });
});
