// @vitest-environment jsdom
//
// When the extension is reloaded under an open tab, Chrome leaves the old content script running with a runtime that
// has lost its id and no chrome.storage at all. The context guard used to trust its own flag, which only a failed
// message could flip, so Off's starts went on to chrome.storage.onChanged and threw "reading 'onChanged'" in a loop,
// each one an Error in chrome://extensions. An orphaned script now says one line, to refresh the tab, and nothing else.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adultPreset } from '../../../../src/storage/presets';
import { CURRENT_SETTINGS_SCHEMA_VERSION, type FWSettings } from '../../../../src/storage/settings';

function makeSettings(): FWSettings {
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    mode: 'adult',
    strictLanguage: false, hideUnrewritable: false, aiAnalysisEnabled: true,
    parentPin: '', dailyCap: 5000, monthlyUsdCapOverride: null, locale: 'en',
    outputLanguage: 'auto', uiLanguage: 'auto',
    totalChecksToday: 0, totalNeutralizedToday: 0, totalTokensToday: 0,
    estimatedCostToday: 0, lastResetDate: '',
    totalChecksThisMonth: 0, totalTokensThisMonth: 0, lastResetMonth: '',
    totalTokensAllTime: 0, totalChecksAllTime: 0,
    totalNeutralizedAllTime: 0, estimatedCostAllTime: 0,
    features: adultPreset(),
    presets: { appliedAt: '', appliedPreset: 'adult' },
    dashboardTheme: 'dark',
  };
}

/** What an orphaned content script sees: a runtime without its id, and no storage. */
const orphan = () => vi.stubGlobal('chrome', { runtime: {} });
const alive = () => vi.stubGlobal('chrome', {
  runtime: { id: 'fw-test', sendMessage: async () => undefined },
  storage: {
    local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    onChanged: { addListener: () => {}, removeListener: () => {} },
  },
});

let info: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
const refreshLines = () => info.mock.calls.filter((c: unknown[]) => String(c[0]).includes('refresh this tab'));
const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => { unhandled.push(reason); };

beforeEach(() => {
  vi.resetModules();
  info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  unhandled.length = 0;
  process.on('unhandledRejection', onUnhandled);
});

afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
  vi.doUnmock('../../../../src/storage/settings');
  vi.doUnmock('../../../../src/content/engagement/controller');
  vi.doUnmock('../../../../src/content/platforms/adapter');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the context guard knows an orphan without waiting for a failed message', () => {
  it('a runtime without its id and no storage reads as gone, said once', async () => {
    orphan();
    const { isContextAlive } = await import('../../../../src/storage/context-guard');
    expect(isContextAlive()).toBe(false);
    expect(isContextAlive()).toBe(false);
    expect(refreshLines()).toHaveLength(1);
  });

  it('a live extension, and a page with no chrome at all, read as alive', async () => {
    alive();
    let guard = await import('../../../../src/storage/context-guard');
    expect(guard.isContextAlive()).toBe(true);
    vi.resetModules();
    vi.stubGlobal('chrome', undefined);
    guard = await import('../../../../src/storage/context-guard');
    expect(guard.isContextAlive()).toBe(true);
    expect(refreshLines()).toHaveLength(0);
  });
});

describe('the parts that listen to storage start and stop quietly in an orphan', () => {
  it('the picks, the picker, the read-this marker and the recorder stamp neither throw nor warn', async () => {
    orphan();
    const picker = await import('../../../../src/content/engagement/picker');
    const { startReadThis } = await import('../../../../src/content/markers/read-this');
    const { keepRecorderStamp } = await import('../../../../src/content/engagement/recorder-runs');
    const settings = makeSettings();

    const stops = [
      picker.startPickedBlocks('twitter', settings),
      picker.startPicker('twitter', settings),
      startReadThis('twitter', settings),
      keepRecorderStamp('twitter', settings, async () => settings, '0.0.0-test'),
    ];
    for (const stop of stops) expect(() => stop()).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

describe('a start that was reading settings when the extension went away', () => {
  it('resolves to a stop that does nothing, and no filter warns that it did not start', async () => {
    alive();
    vi.doMock('../../../../src/storage/settings', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
      // The reload lands while settings are read.
      return { ...actual, getSettings: async () => { orphan(); return makeSettings(); } };
    });
    const { _setProductForTesting } = await import('../../../../src/product');
    _setProductForTesting('off');
    const { initEngagementControl } = await import('../../../../src/content/engagement/controller');

    const opening = initEngagementControl('twitter');
    await expect(opening).resolves.toBeTypeOf('function');
    const stop = await opening;
    expect(() => stop()).not.toThrow();
    expect(warn.mock.calls.filter((c: unknown[]) => String(c[0]).includes('[FW engagement]'))).toEqual([]);
    expect(refreshLines()).toHaveLength(1);
    _setProductForTesting(null);
  });
});

describe('Off in an orphaned tab', () => {
  it('a first start that fails on the vanished storage is not reported as Off failing', async () => {
    vi.doMock('../../../../src/content/platforms/adapter', () => ({
      detectCurrentPlatform: () => 'twitter',
      isPrivateMessageSurface: () => false,
    }));
    vi.doMock('../../../../src/content/engagement/controller', () => ({
      initEngagementControl: async () => {
        orphan();
        throw new TypeError("Cannot read properties of undefined (reading 'onChanged')");
      },
    }));
    alive();
    await import('../../../../src/products/off/content');
    await new Promise((r) => setTimeout(r, 10));

    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(unhandled).toEqual([]);
  });

  it('a start again after a conversation that fails on the vanished storage leaves no uncaught rejection', async () => {
    vi.useFakeTimers();
    try {
      const page = { isPrivate: false, starts: 0 };
      vi.doMock('../../../../src/content/platforms/adapter', () => ({
        detectCurrentPlatform: () => (page.isPrivate ? null : 'twitter'),
        isPrivateMessageSurface: () => page.isPrivate,
      }));
      vi.doMock('../../../../src/content/engagement/controller', () => ({
        initEngagementControl: async () => {
          page.starts += 1;
          if (page.starts === 1) return () => {};
          orphan();
          throw new TypeError("Cannot read properties of undefined (reading 'onChanged')");
        },
      }));
      const { PRIVATE_SURFACE_POLL_MS } = await import('../../../../src/products/off/private-surface-watch');
      alive();
      await import('../../../../src/products/off/content');
      await vi.advanceTimersByTimeAsync(0);

      page.isPrivate = true;
      await vi.advanceTimersByTimeAsync(PRIVATE_SURFACE_POLL_MS + 1);
      page.isPrivate = false;
      await vi.advanceTimersByTimeAsync(PRIVATE_SURFACE_POLL_MS + 1);
      vi.useRealTimers();
      await new Promise((r) => setTimeout(r, 10));

      expect(page.starts).toBe(2);
      expect(unhandled).toEqual([]);
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
