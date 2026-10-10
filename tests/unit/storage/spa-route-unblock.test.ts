// @vitest-environment jsdom
//
// SPA-route unblock: page-level blocks must not outlive their URL gate.
//
// Instagram's SPA reuses the SAME page-level element (main / body) across
// routes. Both URL-gated blockers used to apply their hide on a matching
// route and never reverse it when the route changed, so navigating from
// /reels/ (reels-blocker) or /p/<id>/ (ai-content-blocker permalink surface)
// back to the home feed left the whole feed hidden until reload. This file
// locks the reversal:
//   - reels-blocker runOnce releases all blocks when the URL gate is off.
//   - ai-content-blocker runOnce releases a blocked page-level MAIN on
//     instagram when the permalink pattern no longer matches.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startReelsBlocker } from '../../../src/content/engagement/reels-blocker';
import { startAiContentBlocker } from '../../../src/content/engagement/ai-content-blocker';
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
    strictLanguage: false,
    hideUnrewritable: false,
    aiAnalysisEnabled: true,
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

function withOnly(featureId: keyof FeatureToggles): FWSettings {
  const features = teenPreset();
  for (const key of Object.keys(features)) {
    features[key as keyof typeof features].enabled = false;
  }
  features[featureId].enabled = true;
  return makeSettings(features);
}

const PRISTINE_PLAY = HTMLMediaElement.prototype.play;
const PRISTINE_PAUSE = HTMLMediaElement.prototype.pause;

beforeEach(() => {
  document.body.replaceChildren();
  document.head.replaceChildren();
  HTMLMediaElement.prototype.play =
    vi.fn(() => Promise.resolve()) as unknown as HTMLMediaElement['play'];
  HTMLMediaElement.prototype.pause = vi.fn() as unknown as HTMLMediaElement['pause'];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => { /* no-op */ }),
        remove: vi.fn(async () => { /* no-op */ }),
      },
      onChanged: { addListener: vi.fn() },
    },
    runtime: { sendMessage: vi.fn(() => Promise.resolve()) },
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  HTMLMediaElement.prototype.play = PRISTINE_PLAY;
  HTMLMediaElement.prototype.pause = PRISTINE_PAUSE;
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
  history.replaceState({}, '', '/');
});

describe('reels-blocker — leaving the reels route unblocks the reused container', () => {
  it('IG main blocked on /reels/ is released after SPA navigation to the feed', () => {
    history.replaceState({}, '', '/reels/12345/');
    const main = document.createElement('main');
    main.setAttribute('role', 'main');
    document.body.appendChild(main);

    const stop = startReelsBlocker('instagram', withOnly('block-reels'));
    expect(main.getAttribute('data-fw-blocked')).toBe('reel-surface');

    // SPA navigation home: same element, new URL. popstate re-runs runOnce.
    history.replaceState({}, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(main.getAttribute('data-fw-blocked')).toBeNull();
    expect(main.style.getPropertyValue('display')).toBe('');
    stop();
  });
});

describe('ai-content-blocker — permalink MAIN block released off-permalink', () => {
  it('IG main blocked on /p/<id>/ is released after SPA navigation to the feed', () => {
    vi.useFakeTimers();
    history.replaceState({}, '', '/p/abc123/');
    const main = document.createElement('main');
    const caption = document.createElement('h1');
    caption.textContent = 'look at this #aifruit clip';
    main.appendChild(caption);
    document.body.appendChild(main);

    const stop = startAiContentBlocker('instagram', withOnly('block-ai-content'));
    expect(main.getAttribute('data-fw-blocked')).toBe('ai-content');

    history.replaceState({}, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
    // The blocker debounces its rescan; advance past the debounce window.
    vi.advanceTimersByTime(2_000);

    expect(main.getAttribute('data-fw-blocked')).toBeNull();
    expect(main.style.getPropertyValue('visibility')).toBe('');

    // A per-post article block persists across the same navigation.
    stop();
  });

  it('a per-post article block is NOT released by leaving a permalink', () => {
    vi.useFakeTimers();
    history.replaceState({}, '', '/');
    const article = document.createElement('article');
    const caption = document.createElement('h1');
    caption.textContent = 'my new clip #aifruit';
    article.appendChild(caption);
    document.body.appendChild(article);

    const stop = startAiContentBlocker('instagram', withOnly('block-ai-content'));
    expect(article.getAttribute('data-fw-blocked')).toBe('ai-content');

    history.replaceState({}, '', '/somewhere-else/');
    window.dispatchEvent(new PopStateEvent('popstate'));
    vi.advanceTimersByTime(2_000);

    expect(article.getAttribute('data-fw-blocked')).toBe('ai-content');
    stop();
  });
});
