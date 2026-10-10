// @vitest-environment jsdom
//
// B7 unit 3 (P32), site 2c (S4, critic 1's gaps on site 2b, B7u3s2b-CRITIC.md point 4): (a) initEngagementControl starts the
// picker (Off's account picker) after the filters have started and with no guard, so a throw there rejects the whole call
// AFTER the filters are running: the master cleanup is never returned, no settings listener is attached, and Off, which keeps
// no stop, starts a second set beside the first on the next run; (b) the master cleanup stops the picker first and then the
// filters, the DOM reset and the listener removal in one line each, so a picker that throws on stop leaves the filters, the
// DOM reset and the storage listener in place, which for Off means filters still running when the recorder takes over.
// Now the picker start is guarded like the first start (a counter, a no-op stop), and the master cleanup runs every step in
// its own try and rethrows the first error after all have run. The harness is a copy of the top of site 2b's own test file
// (a-start-that-throws-partway-undoes-what-it-started.test.ts, not edited).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adultPreset } from '../../../../src/storage/presets';
import { CURRENT_SETTINGS_SCHEMA_VERSION, type FWSettings, type FeatureToggles } from '../../../../src/storage/settings';

const getSettings = vi.fn<() => Promise<FWSettings>>();
const isContextAlive = vi.fn(() => true);
const pickerCleanup = vi.fn();
const startPicker = vi.fn(() => pickerCleanup);
const startTwitterEngagementControl = vi.fn<() => () => void>();
const sets = vi.hoisted(() => ({
  sidebar: [] as Array<() => void>,
  surface: [] as Array<() => void>,
  sidebarCleanupThrows: false,
}));

vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return { ...actual, getSettings: () => getSettings() };
});
vi.mock('../../../../src/storage/context-guard', () => ({ isContextAlive: () => isContextAlive() }));
vi.mock('../../../../src/content/engagement/picker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/content/engagement/picker')>();
  // The picks module keeps a storage listener of its own; it is held out so the count below is the settings listener's.
  return { ...actual, startPicker: (...a: unknown[]) => startPicker(...(a as [])), startPickedBlocks: () => () => {} };
});
vi.mock('../../../../src/content/engagement/twitter-engagement', () => ({
  startTwitterEngagementControl: (...a: unknown[]) => startTwitterEngagementControl(...(a as [])),
}));
// A module started early in the set and one started late, each a recorder of its own cleanup.
vi.mock('../../../../src/content/engagement/sidebar-ad-blocker', () => ({
  startSidebarAdBlocker: () => {
    const cleanup = vi.fn(() => { if (sets.sidebarCleanupThrows) throw new Error('injected: a cleanup threw'); });
    sets.sidebar.push(cleanup);
    return cleanup;
  },
}));
vi.mock('../../../../src/content/engagement/surface-switches', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/content/engagement/surface-switches')>();
  return {
    ...actual,
    startSurfaceSwitches: () => {
      const cleanup = vi.fn();
      sets.surface.push(cleanup);
      return cleanup;
    },
  };
});

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
  sets.sidebar.length = 0;
  sets.surface.length = 0;
  sets.sidebarCleanupThrows = false;
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
  getSettings.mockReset().mockResolvedValue(makeSettings(adultPreset()));
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
const thrower = (what: string) => () => { throw new Error(`injected: ${what}`); };

describe('a picker that throws at the first start', () => {
  it('control: a whole start attaches the settings listener, and the stop stops the picker, the filters and the listener', async () => {
    const platformStop = vi.fn();
    startTwitterEngagementControl.mockReturnValueOnce(platformStop);
    const stop = await initEngagementControl('twitter');
    expect(listeners, 'the settings listener is attached').toHaveLength(1);
    stop();
    expect(pickerCleanup).toHaveBeenCalledTimes(1);
    expect(platformStop).toHaveBeenCalledTimes(1);
    expect(listeners, 'the listener is removed').toHaveLength(0);
    expect(counters().engagementPickerStartThrew).toBeUndefined();
  });

  it('the call still resolves, the filters that started keep their stop, the listener is attached and it counts once', async () => {
    const platformStop = vi.fn();
    startTwitterEngagementControl.mockReturnValueOnce(platformStop);
    startPicker.mockImplementationOnce(thrower('the picker start threw'));
    const opening = initEngagementControl('twitter');
    await expect(opening, 'the call does not reject after the filters started').resolves.toBeTypeOf('function');
    const stop = await opening;
    expect(counters().engagementPickerStartThrew, 'one counter moved, once').toBe(1);
    expect(listeners, 'the settings listener is attached').toHaveLength(1);
    expect(unhandled, 'nothing is left unhandled').toEqual([]);
    stop();
    expect(platformStop, 'the filters that started are stopped by the returned stop').toHaveBeenCalledTimes(1);
    expect(sets.sidebar[0]).toHaveBeenCalledTimes(1);
    expect(listeners, 'the listener is removed').toHaveLength(0);
  });
});

describe('a master stop that throws at the picker', () => {
  it('still stops the filters, resets the page and removes the settings listener, and the error still reaches the caller', async () => {
    const platformStop = vi.fn();
    startTwitterEngagementControl.mockReturnValueOnce(platformStop);
    pickerCleanup.mockImplementationOnce(thrower('the picker stop threw'));
    const hidden = document.createElement('div');
    hidden.dataset.fwOrphanLabel = 'true';
    hidden.style.display = 'none';
    document.body.append(hidden);
    const stop = await initEngagementControl('twitter');
    expect(() => stop(), 'the first error is rethrown').toThrow(/the picker stop threw/);
    expect(platformStop, 'the filters were stopped after it').toHaveBeenCalledTimes(1);
    expect(hidden.dataset.fwOrphanLabel, 'the page was reset after it').toBeUndefined();
    expect(listeners, 'the settings listener was removed after it').toHaveLength(0);
  });
});
