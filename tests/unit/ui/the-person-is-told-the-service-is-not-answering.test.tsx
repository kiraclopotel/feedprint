/** @vitest-environment jsdom */
// The reading service fails outright (the Tester's full test, 11 Oct 2026: a 500 or a dropped connection left "every post as
// written, no dot and no notice, and the popup still shows the licence as OK"). Four failures in a row with no answer
// between them write a marker; the popup's Home tab, the Issues tab and the toolbar icon read it; the first answer from the
// relay, an error status below 500 included, removes it; a marker whose last failure is old counts as gone.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { installChromeStorageStub } from '../../helpers/chrome-storage';
import { readingConsentFor } from '../../helpers/reading-consent';
import { utcDayKey, utcMonthKey, CURRENT_SETTINGS_SCHEMA_VERSION } from '../../../src/storage/settings';
import {
  READING_TROUBLE_AFTER, READING_TROUBLE_FRESH_MS, READING_TROUBLE_GAP_MS, READING_TROUBLE_STORAGE_KEY,
  _resetReadingTroubleForTests, noteReadingAnswered, noteReadingFailure, readingTroubleStands,
} from '../../../src/storage/reading-trouble';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';
import { POPUP_STRINGS } from '../../../src/i18n/popup-strings';
import { UI_LANGUAGES } from '../../../src/i18n';
import { I18nProvider } from '../../../src/i18n/react';
import { OperationalEventsPanel } from '../../../src/ui/dashboard/components/OperationalEventsPanel';
import { HomeTab } from '../../../src/ui/popup/panels/HomeTab';
import { childPreset, teenPreset } from '../../../src/storage/presets';
import type { FWSettings } from '../../../src/storage/settings';
import type { LicenseInfo } from '../../../src/storage/license';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = 'fw-starter-abc12345';
const T0 = 1_800_000_000_000;

function stored(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION, lastResetDate: utcDayKey(), lastResetMonth: utcMonthKey(),
    fw_license_key: KEY, dailyCap: 2500, totalChecksToday: 0, totalTokensThisMonth: 0,
    ...readingConsentFor(KEY),
    ...extra,
  };
}

beforeEach(() => {
  _resetReadingTroubleForTests();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('the marker', () => {
  it('is written at the fourth failure in a row, not before', () => {
    const stub = installChromeStorageStub({ initial: stored() });
    for (let i = 0; i < READING_TROUBLE_AFTER - 1; i++) noteReadingFailure(T0 + i * 1000);
    expect(stub.state[READING_TROUBLE_STORAGE_KEY]).toBeUndefined();
    noteReadingFailure(T0 + 4000);
    expect(stub.state[READING_TROUBLE_STORAGE_KEY]).toMatchObject({ since: T0, at: T0 + 4000, failures: READING_TROUBLE_AFTER });
  });

  it('an answer between the failures starts the count again', () => {
    const stub = installChromeStorageStub({ initial: stored() });
    noteReadingFailure(T0); noteReadingFailure(T0 + 1000); noteReadingFailure(T0 + 2000);
    noteReadingAnswered(T0 + 3000);
    noteReadingFailure(T0 + 4000); noteReadingFailure(T0 + 5000);
    expect(stub.state[READING_TROUBLE_STORAGE_KEY]).toBeUndefined();
  });

  it('failures far apart do not add up', () => {
    const stub = installChromeStorageStub({ initial: stored() });
    for (let i = 0; i < 6; i++) noteReadingFailure(T0 + i * (READING_TROUBLE_GAP_MS + 1000));
    expect(stub.state[READING_TROUBLE_STORAGE_KEY]).toBeUndefined();
  });

  it('is removed by the first answer, and kept fresh while the trouble goes on', () => {
    const stub = installChromeStorageStub({ initial: stored() });
    for (let i = 0; i < READING_TROUBLE_AFTER; i++) noteReadingFailure(T0 + i * 1000);
    expect(stub.state[READING_TROUBLE_STORAGE_KEY]).toBeDefined();
    noteReadingFailure(T0 + 30_000);
    expect((stub.state[READING_TROUBLE_STORAGE_KEY] as { at: number }).at, 'written at most once a minute').toBe(T0 + 3000);
    noteReadingFailure(T0 + 90_000);
    expect((stub.state[READING_TROUBLE_STORAGE_KEY] as { at: number }).at).toBe(T0 + 90_000);
    noteReadingAnswered(T0 + 100_000);
    expect(stub.state[READING_TROUBLE_STORAGE_KEY]).toBeUndefined();
  });

  it('an answer removes a marker another page wrote', async () => {
    const stub = installChromeStorageStub({ initial: stored({ [READING_TROUBLE_STORAGE_KEY]: { since: T0, at: T0, failures: 5 } }) });
    noteReadingAnswered(T0 + 60_000);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(stub.state[READING_TROUBLE_STORAGE_KEY]).toBeUndefined();
  });

  it('counts as standing only while its last failure is recent', () => {
    const marker = { since: T0, at: T0, failures: 5 };
    expect(readingTroubleStands(marker, T0 + 60_000)).toBe(true);
    expect(readingTroubleStands(marker, T0 + READING_TROUBLE_FRESH_MS + 1)).toBe(false);
    expect(readingTroubleStands(undefined)).toBe(false);
    expect(readingTroubleStands('x')).toBe(false);
  });
});

describe('the client', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let stub: ReturnType<typeof installChromeStorageStub>;

  function response(status: number, body: unknown = {}): Response {
    const res = {
      ok: status >= 200 && status < 300, status,
      headers: { get: () => null },
      json: () => Promise.resolve(body),
      clone: () => res,
    };
    return res as unknown as Response;
  }
  const good = () => response(200, { choices: [{ message: { content: 'fine' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } });

  beforeEach(() => {
    vi.resetModules();
    fetchSpy = vi.fn();
    (globalThis as { fetch: unknown }).fetch = fetchSpy;
    stub = installChromeStorageStub({ initial: stored(), sendMessage: () => undefined });
  });
  afterEach(() => { vi.useRealTimers(); });

  async function modules() {
    const trouble = await import('../../../src/storage/reading-trouble');
    trouble._resetReadingTroubleForTests();
    const { callAI } = await import('../../../src/ai/client');
    return { callAI, trouble };
  }

  it('four calls the relay fails with a 500 leave the marker; a call it answers takes it away', async () => {
    const { callAI } = await modules();
    fetchSpy.mockResolvedValue(response(500));
    for (let i = 0; i < READING_TROUBLE_AFTER; i++) {
      const r = await callAI('sys', `usr ${i}`);
      expect(r.ok).toBe(false);
    }
    expect(stub.state[READING_TROUBLE_STORAGE_KEY]).toBeDefined();
    fetchSpy.mockResolvedValue(good());
    const r = await callAI('sys', 'usr ok');
    expect(r.ok).toBe(true);
    expect(stub.state[READING_TROUBLE_STORAGE_KEY]).toBeUndefined();
  });

  it('dropped connections count the same', async () => {
    const { callAI } = await modules();
    fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));
    for (let i = 0; i < READING_TROUBLE_AFTER; i++) await callAI('sys', `usr ${i}`);
    expect(stub.state[READING_TROUBLE_STORAGE_KEY]).toBeDefined();
  });

  it('a relay that refuses with a 4xx is there, and writes no marker', async () => {
    const { callAI } = await modules();
    fetchSpy.mockResolvedValue(response(400, { error: { code: 'json_validate_failed' } }));
    for (let i = 0; i < READING_TROUBLE_AFTER + 2; i++) await callAI('sys', `usr ${i}`);
    expect(stub.state[READING_TROUBLE_STORAGE_KEY]).toBeUndefined();
  });
});

describe('the toolbar icon', () => {
  let badge: { text: string; color: string };
  let hover: string;

  beforeEach(() => { vi.resetModules(); });

  function installIcon(initial: Record<string, unknown>): void {
    installChromeStorageStub({ initial });
    badge = { text: 'untouched', color: 'untouched' };
    hover = 'untouched';
    const g = globalThis as unknown as { chrome: Record<string, unknown> };
    g.chrome.action = {
      setBadgeText: async ({ text }: { text: string }) => { badge.text = text; },
      setBadgeBackgroundColor: async ({ color }: { color: string }) => { badge.color = color; },
      setTitle: async ({ title }: { title: string }) => { hover = title; },
    };
    const messages: Record<string, string> = {
      receiptsActionTitle: 'Feedprint by FeelingWise',
      actionTitleReadingPaused: 'waiting for your go-ahead',
      actionTitleReadingTrouble: 'the reading service is not answering',
    };
    g.chrome.i18n = { getMessage: (key: string) => messages[key] ?? '' };
    g.chrome.runtime = { ...(g.chrome.runtime as object), getManifest: () => ({ action: { default_title: '__MSG_receiptsActionTitle__' } }) };
  }

  it('shows an amber "!" while the service is not answering', async () => {
    installIcon(stored({ [READING_TROUBLE_STORAGE_KEY]: { since: Date.now() - 60_000, at: Date.now(), failures: 6 }, totalNeutralizedToday: 7 }));
    const { paintToolbarIcon } = await import('../../../src/background/toolbar-icon');
    await paintToolbarIcon(7);
    expect(badge).toEqual({ text: '!', color: '#d98a00' });
    expect(hover, 'the hover text says why').toBe('the reading service is not answering');
  });

  it('keeps the red one for the go-ahead, which needs the person', async () => {
    installIcon(stored({ readingPaused: { fingerprint: 'x', code: 'consent_required', at: 1 }, [READING_TROUBLE_STORAGE_KEY]: { since: Date.now(), at: Date.now(), failures: 6 } }));
    const { paintToolbarIcon } = await import('../../../src/background/toolbar-icon');
    await paintToolbarIcon(3);
    expect(badge).toEqual({ text: '!', color: '#c0392b' });
    expect(hover, 'and the red one says what it waits for').toBe('waiting for your go-ahead');
  });

  it('gives the count back when the marker is old', async () => {
    installIcon(stored({ [READING_TROUBLE_STORAGE_KEY]: { since: 1, at: 1, failures: 6 }, totalNeutralizedToday: 2 }));
    const { paintToolbarIcon } = await import('../../../src/background/toolbar-icon');
    await paintToolbarIcon(2);
    expect(badge).toEqual({ text: '2', color: '#00bcd4' });
    expect(hover, 'the name again once no "!" shows').toBe('Feedprint by FeelingWise');
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

  async function show(initial: Record<string, unknown>): Promise<string> {
    installChromeStorageStub({ initial });
    await act(async () => {
      root.render(createElement(I18nProvider, { lang: 'en', children: createElement(OperationalEventsPanel as never, { initialBuckets: [] }) }));
    });
    for (let i = 0; i < 20; i++) await act(async () => { await Promise.resolve(); });
    return host.textContent ?? '';
  }

  it('has a card when the marker stands, and none when it does not', async () => {
    const text = await show(stored({ [READING_TROUBLE_STORAGE_KEY]: { since: Date.now() - 1000, at: Date.now(), failures: 5 } }));
    expect(text).toContain(DASHBOARD_STRINGS.en.opsCardReadingTroubleTitle);
    expect(text).toContain(DASHBOARD_STRINGS.en.opsCardReadingTroubleAction);
  });

  it('has no card for an old marker or none', async () => {
    expect(await show(stored({ [READING_TROUBLE_STORAGE_KEY]: { since: 1, at: 1, failures: 5 } }))).not.toContain(DASHBOARD_STRINGS.en.opsCardReadingTroubleTitle);
    act(() => root.unmount());
    root = createRoot(host);
    expect(await show(stored())).not.toContain(DASHBOARD_STRINGS.en.opsCardReadingTroubleTitle);
  });

  it.each(UI_LANGUAGES)('%s: three words each on the card and the popup, no dash, none the English left over', (lang) => {
    const d = DASHBOARD_STRINGS[lang];
    const p = POPUP_STRINGS[lang];
    for (const text of [d.opsCardReadingTroubleTitle, d.opsCardReadingTroubleMeaning, d.opsCardReadingTroubleAction, p.readingTroubleTitle, p.readingTroubleBody]) {
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toContain('—');
    }
    if (lang !== 'en') {
      expect(d.opsCardReadingTroubleTitle).not.toBe(DASHBOARD_STRINGS.en.opsCardReadingTroubleTitle);
      expect(p.readingTroubleBody).not.toBe(POPUP_STRINGS.en.readingTroubleBody);
    }
  });
});

describe("the popup's Home tab", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    installChromeStorageStub({ initial: stored() });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  const PAID: LicenseInfo = { tier: 'starter', secret: 'abc12345' } as unknown as LicenseInfo;
  function settingsWith(mode: 'child' | 'teen'): FWSettings {
    return {
      settingsSchemaVersion: '14', mode, strictLanguage: false, hideUnrewritable: false,
      parentPin: '1234', dailyCap: 2000, monthlyUsdCapOverride: null, locale: 'en', outputLanguage: 'auto', uiLanguage: 'auto',
      totalChecksToday: 0, totalNeutralizedToday: 0, totalTokensToday: 0, estimatedCostToday: 0, lastResetDate: '',
      totalChecksThisMonth: 0, totalTokensThisMonth: 0, lastResetMonth: '', totalTokensAllTime: 0, totalChecksAllTime: 0,
      totalNeutralizedAllTime: 0, estimatedCostAllTime: 0, metricsHiddenToday: 0, metricsHiddenAllTime: 0,
      features: mode === 'child' ? childPreset() : teenPreset(),
      presets: { appliedAt: '', appliedPreset: mode }, dashboardTheme: 'dark', aiAnalysisEnabled: true, levelChosen: true,
    } as unknown as FWSettings;
  }

  async function home(mode: 'child' | 'teen', readingTrouble: boolean, probeResult: 'ok' | 'revoked' = 'ok'): Promise<string> {
    await act(async () => {
      root.render(createElement(I18nProvider, {
        lang: 'en',
        children: createElement(HomeTab, {
          settings: settingsWith(mode), license: PAID, probeResult, readingTrouble,
          onOpenDashboard: () => undefined, onOpenDashboardSection: () => undefined,
        }),
      }));
    });
    for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve(); });
    return host.textContent ?? '';
  }

  it('says the reading is not getting through, with a good licence', async () => {
    expect(await home('teen', true)).toContain(POPUP_STRINGS.en.readingTroubleTitle);
  });

  it('says nothing when the trouble is over, at Strict (which calls nothing), or when the key is the problem', async () => {
    expect(await home('teen', false)).not.toContain(POPUP_STRINGS.en.readingTroubleTitle);
    expect(await home('child', true)).not.toContain(POPUP_STRINGS.en.readingTroubleTitle);
    expect(await home('teen', true, 'revoked')).not.toContain(POPUP_STRINGS.en.readingTroubleTitle);
  });
});
