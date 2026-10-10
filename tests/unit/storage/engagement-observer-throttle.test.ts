// @vitest-environment jsdom
//
// H8 — TikTok + X engagement MutationObservers must be wrapped in the rAF
// body observer with a minimum-interval throttle, mirroring
// youtube-engagement.ts. Pre-fix both modules ran `new MutationObserver(() =>
// runAll())` directly on document.body { subtree: true } — the exact
// un-debounced full-DOM-scan-per-mutation pattern that OOM'd YouTube
// (2026-06-06 youtube-crash-hunt). This locks the structural guarantee:
//
//   (1) the OOM-safe wrapper (createRafBodyObserver) is the only body observer,
//   (2) its callback is throttled to RUN_THROTTLE_MS (~750ms) so a mutation
//       burst can't drive a full-page sweep faster than that window,
//   (3) the periodic setInterval coverage + cleanup teardown survive.
//
// MutationObserver timing itself is not unit-testable in jsdom; this test
// asserts the wrapper + throttle contract on the captured callback directly.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Capture the rAF-observer callback so we can drive it manually ──
const capturedCallbacks: Array<() => void> = [];
const cleanupSpy = vi.fn();

vi.mock('../../../src/content/post-path/raf-observer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/content/post-path/raf-observer')>()),
  createRafBodyObserver: (cb: () => void) => {
    capturedCallbacks.push(cb);
    return { observer: {} as MutationObserver, cleanup: cleanupSpy };
  },
}));

// ── Keep the controllers' sweeps cheap + observable ──
// discoverAllContainers/discoverContainer are spied so each sweep is a no-op DOM
// walk we can count, proving "did a full sweep run?" without real DOM scanning.
const discoverAllSpy = vi.fn(() => []);
const discoverOneSpy = vi.fn(() => null);
vi.mock('../../../src/content/engagement/container-discovery', () => ({
  discoverAllContainers: () => discoverAllSpy(),
  discoverContainer: () => discoverOneSpy(),
}));

vi.mock('../../../src/content/engagement/section-model', () => ({
  startCountChipScan: () => () => {},
}));

vi.mock('../../../src/content/fw-log', () => ({
  fwDebug: () => {},
}));

import { startTikTokEngagementControl } from '../../../src/content/engagement/tiktok-engagement';
import { startTwitterEngagementControl } from '../../../src/content/engagement/twitter-engagement';
import {
  FWSettings,
  FeatureToggles,
  CURRENT_SETTINGS_SCHEMA_VERSION,
} from '../../../src/storage/settings';
import { childPreset } from '../../../src/storage/presets';

function makeSettings(features: FeatureToggles): FWSettings {
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    mode: 'teen',
    strictLanguage: false, hideUnrewritable: false, aiAnalysisEnabled: true,
    parentPin: '', dailyCap: 5000, monthlyUsdCapOverride: null, locale: 'en',
    outputLanguage: 'auto', uiLanguage: 'auto',
    totalChecksToday: 0, totalNeutralizedToday: 0, totalTokensToday: 0,
    estimatedCostToday: 0, lastResetDate: '',
    totalChecksThisMonth: 0, totalTokensThisMonth: 0, lastResetMonth: '',
    totalTokensAllTime: 0, totalChecksAllTime: 0,
    totalNeutralizedAllTime: 0, estimatedCostAllTime: 0,
    features,
    presets: { appliedAt: '', appliedPreset: 'teen' },
    dashboardTheme: 'dark',
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  capturedCallbacks.length = 0;
  cleanupSpy.mockClear();
  discoverAllSpy.mockClear();
  discoverOneSpy.mockClear();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('H8 — engagement observers use the rAF-throttled body observer', () => {
  describe('TikTok', () => {
    it('wires its body observer through createRafBodyObserver (OOM-safe wrapper)', () => {
      startTikTokEngagementControl(makeSettings(childPreset()));
      // Exactly one body observer, via the wrapper — not a raw MutationObserver.
      expect(capturedCallbacks).toHaveLength(1);
    });

    it('throttles the observer callback to ~750ms, trailing: a burst sweeps once at the window end', () => {
      vi.setSystemTime(0);
      startTikTokEngagementControl(makeSettings(childPreset()));
      // The constructor runs one immediate runAll (controlActionRail →
      // discoverAllContainers). Baseline the sweep count after construction.
      const afterStart = discoverAllSpy.mock.calls.length;
      expect(afterStart).toBeGreaterThan(0);

      const tick = capturedCallbacks[0];
      // A burst within the throttle window must NOT sweep inside the window...
      vi.setSystemTime(100);
      tick();
      vi.setSystemTime(300);
      tick();
      expect(discoverAllSpy.mock.calls.length).toBe(afterStart);

      // ...but it is not dropped either (2026-09-03): exactly one sweep runs
      // when the window closes, so a video inserted right after a sweep is
      // not left visible until the 2 s poll.
      vi.advanceTimersByTime(650);
      expect(discoverAllSpy.mock.calls.length).toBe(afterStart + 1);

      // Well past the window, a tick sweeps at once.
      vi.setSystemTime(5000);
      tick();
      expect(discoverAllSpy.mock.calls.length).toBe(afterStart + 2);
    });

    it('cleanup tears down the wrapper observer + clears the interval', () => {
      const stop = startTikTokEngagementControl(makeSettings(childPreset()));
      const intervalSpy = vi.spyOn(globalThis, 'clearInterval');
      stop();
      expect(cleanupSpy).toHaveBeenCalledTimes(1);
      expect(intervalSpy).toHaveBeenCalled();
      intervalSpy.mockRestore();
    });

    it('periodic setInterval sweep still runs (coverage preserved)', () => {
      vi.setSystemTime(0);
      startTikTokEngagementControl(makeSettings(childPreset()));
      const afterStart = discoverAllSpy.mock.calls.length;
      // setInterval(runAll, 2000) calls runAll directly, bypassing the throttle.
      vi.advanceTimersByTime(2000);
      expect(discoverAllSpy.mock.calls.length).toBeGreaterThan(afterStart);
    });
  });

  describe('X / Twitter', () => {
    it('wires its body observer through createRafBodyObserver (OOM-safe wrapper)', () => {
      startTwitterEngagementControl(makeSettings(childPreset()));
      expect(capturedCallbacks).toHaveLength(1);
    });

    it('throttles the observer callback to ~750ms, trailing: a burst sweeps once at the window end', () => {
      vi.setSystemTime(0);
      startTwitterEngagementControl(makeSettings(childPreset()));
      // Construction runs controlTwitterActionRows → discoverActionRows →
      // discoverAllContainers fallback (the role="group" fast path returns []
      // in an empty jsdom, so the fallback fires and we can count it).
      const afterStart = discoverAllSpy.mock.calls.length;
      expect(afterStart).toBeGreaterThan(0);

      const tick = capturedCallbacks[0];
      vi.setSystemTime(100);
      tick();
      vi.setSystemTime(300);
      tick();
      expect(discoverAllSpy.mock.calls.length).toBe(afterStart);

      // The burst is not dropped: one sweep at the window end.
      vi.advanceTimersByTime(650);
      expect(discoverAllSpy.mock.calls.length).toBe(afterStart + 1);

      vi.setSystemTime(5000);
      tick();
      expect(discoverAllSpy.mock.calls.length).toBe(afterStart + 2);
    });

    it('cleanup tears down the wrapper observer + clears the interval', () => {
      const stop = startTwitterEngagementControl(makeSettings(childPreset()));
      const intervalSpy = vi.spyOn(globalThis, 'clearInterval');
      stop();
      expect(cleanupSpy).toHaveBeenCalledTimes(1);
      expect(intervalSpy).toHaveBeenCalled();
      intervalSpy.mockRestore();
    });
  });
});
