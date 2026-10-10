// @vitest-environment jsdom
//
// B7 unit 3 (P32), site 2b (S4, critic 1's two gaps on site 2): (a) startPlatformEngagement starts about ten modules in a
// row and returns one cleanup only at its end, so a start that throws at module k leaves modules 1 to k-1 running with
// nothing holding them, and a cleanup that throws partway leaves the modules after it running; (b) the first start at page
// load (initEngagementControl) has no guard, so a throw there leaves the page with no filters until reload and, for Off, an
// unhandled rejection. Now a failed start undoes what it started before it fails, a cleanup that throws still lets every
// other cleanup run (the first error is rethrown, so the rebuild's own catch still sees it), and the first start is tried
// once more with a counter at each failure. The harness is a copy of the top of a-throw-in-the-rebuild-keeps-the-page-
// filtered.test.ts (site 2's own file, not edited); the sidebar-ad and surface modules are replaced by recorders so the test
// can see which started sets were undone.
//
// F49 (1 Oct, the head's order IN 16:54, gate 5): what a start that throws does changed. Each module now starts in a guard of its own: a
// module whose start throws is counted, started once more at once, and if it throws again skipped alone; the modules around it stay
// live and nothing is undone (a removed filter is a removed protection), and the page-load retry of the whole set is gone. The three
// cases below that said the whole set is undone and started again now say what happens instead; the control and the cleanup case
// are as they were.

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
  return { ...actual, startPicker: (...a: unknown[]) => startPicker(...(a as [])) };
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

describe('a start that throws partway undoes what it started', () => {
  it('control: a whole start, then a stop, stops each module once', async () => {
    startTwitterEngagementControl.mockReturnValueOnce(vi.fn());
    const stop = await initEngagementControl('twitter');
    expect(sets.sidebar).toHaveLength(1);
    stop();
    expect(sets.sidebar[0]).toHaveBeenCalledTimes(1);
    expect(sets.surface[0]).toHaveBeenCalledTimes(1);
    expect(counters().engagementFirstStartThrew).toBeUndefined();
  });

  it('the first start throws at the platform module: that module is started once more at once, one count, nothing else undone, nothing unhandled', async () => {
    const platformStop = vi.fn();
    startTwitterEngagementControl.mockImplementationOnce(thrower('the first start threw')).mockReturnValueOnce(platformStop);
    const opening = initEngagementControl('twitter');
    await expect(opening, 'the first start does not reject').resolves.toBeTypeOf('function');
    const stop = await opening;
    expect(startTwitterEngagementControl, 'that module alone was started once more after the throw').toHaveBeenCalledTimes(2);
    expect(counters().engagementFirstStartThrew, 'one counter moved, once').toBe(1);
    expect(counters().engagementFirstStartRetryThrew).toBeUndefined();
    expect(sets.sidebar, 'one set was started: the set is not started again for one module').toHaveLength(1);
    expect(sets.sidebar[0], 'the early module is still running').not.toHaveBeenCalled();
    expect(sets.surface[0], 'the late module is still running').not.toHaveBeenCalled();
    expect(unhandled, 'nothing is left unhandled').toEqual([]);
    stop();
    expect(sets.sidebar[0]).toHaveBeenCalledTimes(1);
    expect(sets.surface[0]).toHaveBeenCalledTimes(1);
    expect(platformStop).toHaveBeenCalledTimes(1);
  });

  it('a platform module that throws twice is counted twice over, skipped alone, the rest stays live, and stopping afterwards is safe', async () => {
    startTwitterEngagementControl.mockImplementation(thrower('the start keeps throwing'));
    const opening = initEngagementControl('twitter');
    await expect(opening, 'the first start does not reject').resolves.toBeTypeOf('function');
    const stop = await opening;
    expect(counters().engagementFirstStartThrew).toBe(1);
    expect(counters().engagementFirstStartRetryThrew).toBe(1);
    expect(sets.sidebar, 'one set, started once').toHaveLength(1);
    for (const cleanup of [...sets.sidebar, ...sets.surface]) expect(cleanup, 'the other modules stay live').not.toHaveBeenCalled();
    expect(unhandled).toEqual([]);
    expect(() => stop(), 'stopping afterwards is safe').not.toThrow();
    for (const cleanup of [...sets.sidebar, ...sets.surface]) expect(cleanup, 'and stops each of them once').toHaveBeenCalledTimes(1);
  });

  it('a throw in the rebuild: the module that threw is started once more at once and the set is not undone', async () => {
    const first = vi.fn();
    const third = vi.fn();
    startTwitterEngagementControl
      .mockReturnValueOnce(first)
      .mockImplementationOnce(thrower('the rebuild threw'))
      .mockReturnValueOnce(third);
    const stop = await initEngagementControl('twitter');
    await changeSetting();
    expect(sets.sidebar, 'opened, then rebuilt once').toHaveLength(2);
    expect(sets.sidebar[0], 'the old set was stopped by the teardown').toHaveBeenCalledTimes(1);
    expect(sets.sidebar[1], 'the rebuilt set was not undone').not.toHaveBeenCalled();
    expect(sets.surface[1], 'all of it').not.toHaveBeenCalled();
    expect(counters().engagementRebuildThrew).toBe(1);
    expect(counters().engagementRebuildRetryThrew).toBeUndefined();
    stop();
    expect(sets.sidebar[1]).toHaveBeenCalledTimes(1);
    expect(third).toHaveBeenCalledTimes(1);
  });
});

describe('a cleanup that throws does not stop the others', () => {
  it('every other module is still stopped, and the error still reaches the caller', async () => {
    const platformStop = vi.fn();
    startTwitterEngagementControl.mockReturnValueOnce(platformStop);
    const stop = await initEngagementControl('twitter');
    sets.sidebarCleanupThrows = true;
    expect(() => stop(), 'the first error is rethrown').toThrow(/a cleanup threw/);
    expect(platformStop, 'the platform module ran before it').toHaveBeenCalledTimes(1);
    expect(sets.sidebar[0]).toHaveBeenCalledTimes(1);
    expect(sets.surface[0], 'the module after the throwing one was still stopped').toHaveBeenCalledTimes(1);
  });
});
