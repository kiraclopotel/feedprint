// @vitest-environment jsdom
//
// B7 unit 3 (P32), site 2 (S4): a throw in the rebuild after a settings change. The engagement controller tears the page's
// filters down and rebuilds them in an async block nobody waits for, so a throw in that block left the page unfiltered until
// reload with an unhandled rejection as the only trace (Off's only runtime path; Receipts runs the same code). Now the filters
// are started again once from the settings just read, a failed read leaves the old filters running, and a counter moves at
// each failure. The harness is a copy of the top of engagement-controller-init.test.ts (kept as its own file: an existing
// check is never edited by the maker).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adultPreset } from '../../../../src/storage/presets';
import { CURRENT_SETTINGS_SCHEMA_VERSION, type FWSettings, type FeatureToggles } from '../../../../src/storage/settings';

const getSettings = vi.fn<() => Promise<FWSettings>>();
const isContextAlive = vi.fn(() => true);
const pickerCleanup = vi.fn();
const startPicker = vi.fn(() => pickerCleanup);
const startTwitterEngagementControl = vi.fn<() => () => void>();

vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return { ...actual, getSettings: () => getSettings() };
});
vi.mock('../../../../src/storage/context-guard', () => ({ isContextAlive: () => isContextAlive() }));
vi.mock('../../../../src/content/engagement/picker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/content/engagement/picker')>();
  return { ...actual, startPicker: (...a: unknown[]) => startPicker(...(a as [])) };
});
vi.mock('../../../../src/content/engagement/twitter-engagement', () => ({
  startTwitterEngagementControl: (...a: unknown[]) => startTwitterEngagementControl(...(a as [])),
}));

import { initEngagementControl } from '../../../../src/content/engagement/controller';
import { _setProductForTesting } from '../../../../src/product';
import { _resetDiagnosticsForTesting, _getDiagnosticCountersForTesting } from '../../../../src/diagnostics/diagnostics';

function makeSettings(features: FeatureToggles): FWSettings {
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
    features,
    presets: { appliedAt: '', appliedPreset: 'adult' },
    dashboardTheme: 'dark',
  };
}

type Listener = (changes: Record<string, chrome.storage.StorageChange>) => void;
let listeners: Listener[];
const unhandled: unknown[] = [];
const onUnhandled = (e: unknown): void => { unhandled.push(e); };

beforeEach(() => {
  // The whole module set runs in Off; Receipts starts only its ad modules.
  _setProductForTesting('off');
  listeners = [];
  unhandled.length = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.stubGlobal('chrome', {
    storage: {
      onChanged: {
        addListener: (l: Listener) => { listeners.push(l); },
        removeListener: (l: Listener) => { listeners = listeners.filter(x => x !== l); },
      },
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    },
    runtime: { id: 'test' },
  });
  getSettings.mockReset();
  isContextAlive.mockReset().mockReturnValue(true);
  startPicker.mockClear();
  pickerCleanup.mockClear();
  startTwitterEngagementControl.mockReset();
  _resetDiagnosticsForTesting();
  process.removeListener('unhandledRejection', onUnhandled);
  process.on('unhandledRejection', onUnhandled);
});

afterEach(() => {
  _setProductForTesting(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const settle = async () => { for (let i = 0; i < 4; i++) await new Promise<void>(r => setTimeout(r, 0)); };
const changeSetting = async () => { [...listeners].forEach(l => l({ strictLanguage: { newValue: true } as chrome.storage.StorageChange })); await settle(); };
const counters = () => _getDiagnosticCountersForTesting();

describe('a throw in the rebuild after a settings change leaves the page filtered', () => {
  it('control: a change with nothing throwing tears down once, starts once more, counts nothing', async () => {
    const first = vi.fn();
    const second = vi.fn();
    startTwitterEngagementControl.mockReturnValueOnce(first).mockReturnValueOnce(second);
    getSettings.mockResolvedValue(makeSettings(adultPreset()));
    const stop = await initEngagementControl('twitter');
    await changeSetting();
    expect(first, 'the old filters were stopped').toHaveBeenCalledTimes(1);
    expect(startTwitterEngagementControl).toHaveBeenCalledTimes(2);
    expect(counters().engagementRebuildThrew).toBeUndefined();
    stop();
    expect(second, 'the new filters are the ones running').toHaveBeenCalledTimes(1);
  });

  it('a throw while the filters are started again: they are started once more, one count, nothing unhandled', async () => {
    const first = vi.fn();
    const third = vi.fn();
    startTwitterEngagementControl
      .mockReturnValueOnce(first)
      .mockImplementationOnce(() => { throw new Error('injected: the rebuild threw'); })
      .mockReturnValueOnce(third);
    getSettings.mockResolvedValue(makeSettings(adultPreset()));
    const stop = await initEngagementControl('twitter');
    await changeSetting();
    expect(startTwitterEngagementControl, 'started at open, at the change, and once more after the throw').toHaveBeenCalledTimes(3);
    expect(counters().engagementRebuildThrew, 'one counter moved, once').toBe(1);
    expect(counters().engagementRebuildRetryThrew).toBeUndefined();
    expect(unhandled, 'nothing is left unhandled').toEqual([]);
    stop();
    expect(third, 'the filters that run are the ones started after the throw').toHaveBeenCalledTimes(1);
  });

  it('a rebuild that throws twice is counted twice over and still never unhandled', async () => {
    startTwitterEngagementControl
      .mockReturnValueOnce(vi.fn())
      .mockImplementation(() => { throw new Error('injected: the rebuild keeps throwing'); });
    getSettings.mockResolvedValue(makeSettings(adultPreset()));
    const stop = await initEngagementControl('twitter');
    await changeSetting();
    expect(counters().engagementRebuildThrew).toBe(1);
    expect(counters().engagementRebuildRetryThrew).toBe(1);
    expect(unhandled).toEqual([]);
    expect(() => stop(), 'stopping afterwards is safe').not.toThrow();
  });

  it('a failed read of the settings leaves the old filters running, and counts', async () => {
    const first = vi.fn();
    startTwitterEngagementControl.mockReturnValueOnce(first);
    getSettings.mockResolvedValueOnce(makeSettings(adultPreset()));
    const stop = await initEngagementControl('twitter');
    getSettings.mockRejectedValueOnce(new Error('injected: the settings read threw'));
    await changeSetting();
    expect(first, 'nothing was torn down').not.toHaveBeenCalled();
    expect(startTwitterEngagementControl, 'nothing was started again').toHaveBeenCalledTimes(1);
    expect(counters().engagementRebuildThrew).toBe(1);
    expect(unhandled).toEqual([]);
    stop();
    expect(first, 'the old filters are the ones still held').toHaveBeenCalledTimes(1);
  });
});
