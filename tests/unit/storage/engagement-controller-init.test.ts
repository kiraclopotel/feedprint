// @vitest-environment jsdom
//
// initEngagementControl is the content script's one entry into the engagement
// modules: it reads settings once, starts the platform's modules (in Off, which
// holds them all), starts the picker exactly once, and re-runs on a settings change that
// can move a switch and on nothing else. Named by no test until 2026-09-06.
//
// The list of keys that can move a switch was mode, features and presets until
// 2026-09-19, when a read of the free product found "No swearing" missing from
// it. That switch is a top-level key rather than a square of the feature grid,
// and the word filter reads it directly, so turning it on in the free popup did
// nothing to the page the person was looking at until they reloaded. The same
// read found that two changes close together could leave a set of scanners
// running with nothing holding their cleanup. Both are held below.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adultPreset } from '../../../src/storage/presets';
import { CURRENT_SETTINGS_SCHEMA_VERSION, type FWSettings, type FeatureToggles } from '../../../src/storage/settings';

const getSettings = vi.fn<() => Promise<FWSettings>>();
const isContextAlive = vi.fn(() => true);
const pickerCleanup = vi.fn();
const startPicker = vi.fn(() => pickerCleanup);
const twitterCleanup = vi.fn();
const startTwitterEngagementControl = vi.fn(() => twitterCleanup);

vi.mock('../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/storage/settings')>();
  return { ...actual, getSettings: () => getSettings() };
});
vi.mock('../../../src/storage/context-guard', () => ({ isContextAlive: () => isContextAlive() }));
vi.mock('../../../src/content/engagement/picker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/content/engagement/picker')>();
  // The picks module listens to storage itself; the listener counts below are the controller's alone.
  return { ...actual, startPicker: (...a: unknown[]) => startPicker(...(a as [])), startPickedBlocks: () => () => {} };
});
vi.mock('../../../src/content/engagement/word-filter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/content/engagement/word-filter')>();
  return { ...actual, startWordFilter: () => () => {} };
});
vi.mock('../../../src/content/engagement/twitter-engagement', () => ({
  startTwitterEngagementControl: (...a: unknown[]) => startTwitterEngagementControl(...(a as [])),
}));

import { initEngagementControl } from '../../../src/content/engagement/controller';
import { _setProductForTesting } from '../../../src/product';

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

/** Every engagement switch off: nothing to control in the recorder. */
function allOff(): FeatureToggles {
  const f = adultPreset();
  for (const key of Object.keys(f)) f[key as keyof typeof f].enabled = false;
  return f;
}

type Listener = (changes: Record<string, chrome.storage.StorageChange>) => void;
let listeners: Listener[];

beforeEach(() => {
  // The whole module set runs in Off; Receipts starts only its ad modules.
  _setProductForTesting('off');
  listeners = [];
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
  startTwitterEngagementControl.mockClear();
  twitterCleanup.mockClear();
});

afterEach(() => {
  _setProductForTesting(null);
  vi.unstubAllGlobals();
});

const settle = () => new Promise<void>(r => setTimeout(r, 0));

describe('initEngagementControl', () => {
  it('starts the picker once and the platform modules, even with every switch off, and stops both', async () => {
    // Off's slur rule is always on, so its modules always run.
    getSettings.mockResolvedValue(makeSettings(allOff()));
    const stop = await initEngagementControl('twitter');
    expect(startPicker).toHaveBeenCalledTimes(1);
    expect(startTwitterEngagementControl).toHaveBeenCalledTimes(1);
    expect(listeners).toHaveLength(1);
    stop();
    expect(pickerCleanup).toHaveBeenCalledTimes(1);
    expect(twitterCleanup).toHaveBeenCalledTimes(1);
    expect(listeners).toHaveLength(0);
  });

  it('turning on no swearing restarts the filter on the open page', async () => {
    // The switch the popup writes is `strictLanguage`, on its own, with no
    // touch to features or mode. Before the fix this listener returned early
    // and the swearing stayed on screen until a reload.
    getSettings.mockResolvedValue(makeSettings(adultPreset()));
    const stop = await initEngagementControl('twitter');
    expect(startTwitterEngagementControl).toHaveBeenCalledTimes(1);

    [...listeners].forEach(l => l({ strictLanguage: { oldValue: false, newValue: true } }));
    await settle();
    expect(getSettings, 'the new setting is read').toHaveBeenCalledTimes(2);
    expect(twitterCleanup, 'the old modules stop').toHaveBeenCalledTimes(1);
    expect(startTwitterEngagementControl, 'and start again under it').toHaveBeenCalledTimes(2);
    stop();
  });

  it('two changes at once leave one set of modules running, not two', async () => {
    // Applying a preset writes more than one key, and the popup's own switches
    // can land within a frame of each other. Each run stops the modules and
    // then awaits settings, so without a guard the slower run overwrote the
    // faster run's cleanup and the faster run's scanners were left with
    // nothing able to stop them. `stop()` at the end is the measure: after it,
    // every set of modules that was started must have been stopped.
    let release: (() => void) | null = null;
    getSettings.mockImplementation(() => new Promise<FWSettings>((resolve) => {
      release = () => resolve(makeSettings(adultPreset()));
    }));
    const init = initEngagementControl('twitter');
    await settle();
    release!();
    const stop = await init;
    expect(startTwitterEngagementControl).toHaveBeenCalledTimes(1);

    // Two changes, neither's settings read resolved yet.
    const pending: Array<() => void> = [];
    getSettings.mockImplementation(() => new Promise<FWSettings>((resolve) => {
      pending.push(() => resolve(makeSettings(adultPreset())));
    }));
    [...listeners].forEach(l => l({ features: { oldValue: {}, newValue: {} } }));
    [...listeners].forEach(l => l({ mode: { oldValue: 'adult', newValue: 'teen' } }));
    await settle();
    expect(pending, 'both runs are waiting on settings').toHaveLength(2);
    pending[0]();
    pending[1]();
    await settle();

    // Only the newer run started modules; the overtaken one gave up. Without
    // the guard this is 3, and the middle set is the orphan: `activeCleanup`
    // holds the third, so nothing can ever stop the second.
    expect(startTwitterEngagementControl, 'one restart, not two').toHaveBeenCalledTimes(2);
    stop();
  });

  it('reads the new settings before it strips the page', async () => {
    // The order was stop, reset, read. Every write to a watched key took the
    // media-timeout overlay off the page, removed every style tag, every hide
    // marker and every inline hide, and only then awaited a storage round trip
    // before putting anything back. A child's page was fully visible with no
    // blockers for the length of that read, and the same write invalidates the
    // settings cache, so it is a real round trip (2026-09-19).
    const order: string[] = [];
    getSettings.mockImplementation(async () => { order.push('read'); return makeSettings(adultPreset()); });
    const stop = await initEngagementControl('twitter');
    twitterCleanup.mockImplementation(() => { order.push('stop'); });
    order.length = 0;

    [...listeners].forEach(l => l({ features: { oldValue: {}, newValue: {} } }));
    await settle();
    expect(order, 'the read comes first').toEqual(['read', 'stop']);
    stop();
  });

  it('a run that has been overtaken does not strip the page on its way out', async () => {
    // It used to stop and reset before checking, so the loser of a race still
    // cleared the page for a snapshot already out of date.
    const pending: Array<() => void> = [];
    getSettings.mockImplementation(() => new Promise<FWSettings>((resolve) => {
      pending.push(() => resolve(makeSettings(adultPreset())));
    }));
    const init = initEngagementControl('twitter');
    await settle();
    pending.shift()!();
    const stop = await init;
    twitterCleanup.mockClear();

    [...listeners].forEach(l => l({ features: { oldValue: {}, newValue: {} } }));
    [...listeners].forEach(l => l({ mode: { oldValue: 'adult', newValue: 'teen' } }));
    await settle();
    expect(pending, 'both are waiting').toHaveLength(2);
    pending[0]();
    await settle();
    expect(twitterCleanup, 'the overtaken run touched nothing').not.toHaveBeenCalled();
    pending[1]();
    await settle();
    expect(twitterCleanup, 'and the winner did the one teardown').toHaveBeenCalledTimes(1);
    stop();
  });

  it('re-reads settings on a key that can move a switch and on nothing else', async () => {
    getSettings.mockResolvedValue(makeSettings(allOff()));
    const stop = await initEngagementControl('twitter');
    expect(getSettings).toHaveBeenCalledTimes(1);

    [...listeners].forEach(l => l({ dailyCap: { oldValue: 1, newValue: 2 } }));
    await settle();
    expect(getSettings).toHaveBeenCalledTimes(1);

    getSettings.mockResolvedValue(makeSettings(adultPreset()));
    [...listeners].forEach(l => l({ features: { oldValue: {}, newValue: {} } }));
    await settle();
    expect(getSettings).toHaveBeenCalledTimes(2);
    expect(startTwitterEngagementControl).toHaveBeenCalledTimes(2);

    // Each change that can move a switch stops the running set and starts it again from the new settings.
    getSettings.mockResolvedValue(makeSettings(allOff()));
    [...listeners].forEach(l => l({ mode: { oldValue: 'adult', newValue: 'teen' } }));
    await settle();
    expect(twitterCleanup).toHaveBeenCalledTimes(2);
    expect(startTwitterEngagementControl).toHaveBeenCalledTimes(3);
    // The picker survived every restart: a pick must not disarm it.
    expect(startPicker).toHaveBeenCalledTimes(1);
    expect(pickerCleanup).not.toHaveBeenCalled();
    stop();
  });

  it('a dead extension context makes init a no-op and unhooks the listener on the next change', async () => {
    isContextAlive.mockReturnValue(false);
    const stop = await initEngagementControl('twitter');
    expect(getSettings).not.toHaveBeenCalled();
    expect(listeners).toHaveLength(0);
    stop();

    isContextAlive.mockReturnValue(true);
    getSettings.mockResolvedValue(makeSettings(allOff()));
    await initEngagementControl('twitter');
    expect(listeners).toHaveLength(1);
    isContextAlive.mockReturnValue(false);
    [...listeners].forEach(l => l({ mode: { oldValue: 'adult', newValue: 'child' } }));
    await settle();
    expect(listeners).toHaveLength(0);
    expect(getSettings).toHaveBeenCalledTimes(1);
  });
});
