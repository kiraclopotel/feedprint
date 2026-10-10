// @vitest-environment jsdom
//
// Regression — reels-blocker registry-shadowing bug (Ship after 2026-05-24).
//
// Background. `sharedSurfaceDetector` is a global registry consumed by
// multiple engagement modules (ai-content-blocker, reels-blocker, …). Each
// consumer registers its own descriptors at module load and queries the
// registry at runtime. Before the fix, `reels-blocker:runOnce` inspected
// `surfaceMatches[0].descriptor.pathnamePattern?.source` to decide whether
// the URL gate had matched. ai-content-blocker registers some YouTube
// descriptors with `pathnamePattern: null` (match-any); whenever any of
// those descriptors landed at index [0] of the returned array, the reels-
// blocker read a null pattern, computed `matched = null`, and returned
// early — never reaching `blockContainer`. The page stayed visible on
// `/shorts/…`, `/reels/…`, `/reel/…` even with `block-reels` ON.
//
// Fix. `runOnce` filters `matchAndWalk` results to its own descriptors
// (`id.startsWith('reels-blocker:')`) before reading the pattern.
//
// This test locks the fix by simulating the shadow condition: register a
// foreign match-any descriptor for the platform before invoking
// `startReelsBlocker`, then assert that the block still fires.

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

describe('reels-blocker — registry-shadowing regression', () => {
  it('blocks YT /shorts even when a foreign match-any descriptor exists in the shared registry', () => {
    // Register a foreign match-any descriptor for YouTube — this is what
    // ai-content-blocker does in production. Unique id per test run so
    // re-runs don't collide on the shared registry.
    const foreignId = `test-foreign:youtube:any:${Date.now()}`;
    sharedSurfaceDetector.register({
      id: foreignId,
      platform: 'youtube',
      surfaceKind: 'feed',
      pathnamePattern: null,
      containerSelectors: ['ytd-rich-item-renderer'],
      dynamicContentRescan: false,
    });

    history.replaceState({}, '', '/shorts/test-id');
    const ytdShorts = document.createElement('ytd-shorts');
    document.body.appendChild(ytdShorts);

    const stop = startReelsBlocker('youtube', settingsWithReelsBlockerOn());

    // The fix: runOnce filters to reels-blocker descriptors, so the
    // foreign match-any entry can't shadow the /shorts pattern. body
    // (the ultimate fallback container) must carry the block marker.
    expect(document.body.getAttribute('data-fw-blocked')).toBe('reel-surface');
    expect(ytdShorts.getAttribute('data-fw-blocked')).toBe('reel-surface');

    stop();
  });

  it('blocks IG /reels/ under the same shadow condition (cross-platform regression)', () => {
    const foreignId = `test-foreign:instagram:any:${Date.now()}`;
    sharedSurfaceDetector.register({
      id: foreignId,
      platform: 'instagram',
      surfaceKind: 'feed',
      pathnamePattern: null,
      containerSelectors: ['article'],
      dynamicContentRescan: false,
    });

    history.replaceState({}, '', '/reels/abc/');
    const main = document.createElement('main');
    main.setAttribute('role', 'main');
    document.body.appendChild(main);

    const stop = startReelsBlocker('instagram', settingsWithReelsBlockerOn());

    expect(document.body.getAttribute('data-fw-blocked')).toBe('reel-surface');

    stop();
  });

  it('non-reels URL still no-ops cleanly even when foreign descriptor matches', () => {
    const foreignId = `test-foreign:youtube:control:${Date.now()}`;
    sharedSurfaceDetector.register({
      id: foreignId,
      platform: 'youtube',
      surfaceKind: 'feed',
      pathnamePattern: null,
      containerSelectors: ['body'],
      dynamicContentRescan: false,
    });

    // Not on /shorts — reels-blocker should leave body alone.
    history.replaceState({}, '', '/watch?v=abc');

    const stop = startReelsBlocker('youtube', settingsWithReelsBlockerOn());

    expect(document.body.getAttribute('data-fw-blocked')).toBeNull();

    stop();
  });
});
