// @vitest-environment jsdom
//
// PERF-4 (M79#3) — reels-blocker's document.body MutationObserver was
// completely unthrottled: every mutation batch called runOnce() directly,
// unlike its section-model/structural-finder siblings which coalesce bursts
// to one scan per ~250ms via a scheduleScan()+setTimeout(runScan, intervalMs)
// pattern. On a reel/shorts surface where the platform's own player churns
// the DOM at high frequency, this was the one MutationObserver in the
// audited set with zero rate-limiting.
//
// This test proves a burst of SEPARATE mutation ticks (each its own
// microtask-flushed MutationObserver callback, simulating rapid player
// churn) coalesces into a single downstream scan within one throttle window,
// rather than firing once per tick.
//
// sharedSurfaceDetector.matchAndWalk is the first meaningful call inside
// runOnce (before the early-return on a non-matching URL), so counting its
// invocations counts runOnce invocations without needing an internal export.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startReelsBlocker } from '../../../src/content/engagement/reels-blocker';
import { sharedSurfaceDetector } from '../../../src/content/post-path/surface-detector';
import {
  FWSettings,
  FeatureToggles,
  CURRENT_SETTINGS_SCHEMA_VERSION,
} from '../../../src/storage/settings';
import { teenPreset } from '../../../src/storage/presets';

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

function settingsWithReelsBlockerOn(): FWSettings {
  const features = teenPreset();
  for (const key of Object.keys(features)) {
    features[key as keyof typeof features].enabled = false;
  }
  features['block-reels'].enabled = true;
  return makeSettings(features);
}

const PRISTINE_PUSH = history.pushState.bind(history);
const PRISTINE_REPLACE = history.replaceState.bind(history);

beforeEach(() => {
  document.body.replaceChildren();
  document.head.replaceChildren();
  history.pushState = PRISTINE_PUSH;
  history.replaceState = PRISTINE_REPLACE;

  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => { /* no-op */ }),
        remove: vi.fn(async () => { /* no-op */ }),
      },
      onChanged: { addListener: vi.fn() },
    },
    runtime: {
      sendMessage: vi.fn(() => Promise.resolve()),
    },
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  history.pushState = PRISTINE_PUSH;
  history.replaceState = PRISTINE_REPLACE;
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

describe('reels-blocker — MutationObserver throttle (PERF-4)', () => {
  it('coalesces a burst of separate mutation ticks into one scan per throttle window, not one scan per tick', async () => {
    vi.useFakeTimers();
    history.replaceState({}, '', '/shorts/test-id');
    const ytdShorts = document.createElement('ytd-shorts');
    document.body.appendChild(ytdShorts);

    const spy = vi.spyOn(sharedSurfaceDetector, 'matchAndWalk');
    const stop = startReelsBlocker('youtube', settingsWithReelsBlockerOn());

    // The synchronous initial runOnce() call at start is unaffected by the
    // throttle — clear it so we only count MutationObserver-driven scans.
    spy.mockClear();

    // Simulate rapid player DOM churn: several SEPARATE mutation batches,
    // each flushed as its own MutationObserver callback (real microtask
    // semantics survive vi.useFakeTimers — only timers are faked).
    for (let i = 0; i < 5; i++) {
      const marker = document.createElement('div');
      ytdShorts.appendChild(marker);
      await Promise.resolve();
      await Promise.resolve();
    }

    // Unthrottled (old behavior): 5 separate runOnce calls by now.
    // Throttled (fix): still 0 — the coalesced scan hasn't fired because the
    // throttle window (setTimeout) hasn't elapsed yet under fake timers.
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1);

    // Advance past the throttle window — exactly one coalesced scan fires.
    await vi.advanceTimersByTimeAsync(300);

    expect(spy.mock.calls.length).toBe(1);

    stop();
  });

  it('still blocks the reel surface on the synchronous initial call (unaffected by the throttle)', () => {
    history.replaceState({}, '', '/shorts/test-id');
    const ytdShorts = document.createElement('ytd-shorts');
    document.body.appendChild(ytdShorts);

    const stop = startReelsBlocker('youtube', settingsWithReelsBlockerOn());

    expect(ytdShorts.getAttribute('data-fw-blocked')).toBe('reel-surface');

    stop();
  });

  it('still catches a late-mounted container after the throttle window elapses', async () => {
    vi.useFakeTimers();
    history.replaceState({}, '', '/shorts/test-id');
    // Start with NO matching container in the DOM at all.
    const stop = startReelsBlocker('youtube', settingsWithReelsBlockerOn());

    // Late-mount the surface, simulating SPA hydration drift after first paint.
    const ytdShorts = document.createElement('ytd-shorts');
    document.body.appendChild(ytdShorts);
    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(300);

    expect(ytdShorts.getAttribute('data-fw-blocked')).toBe('reel-surface');

    stop();
  });
});
