// @vitest-environment jsdom
//
// F1 — X media-only ads (image/video promo with NO tweetText element) never
// enter extraction, so the pipeline's Block Ads hide can't reach them (text
// ads were fixed by a292ccd; media-only articles are also deliberately
// excluded from the D5 re-tickle loop). The engagement-tier scan closes the
// gap: hide + BLOCKED_LOG ('block:ads:media-only-ad-marker') for articles
// with NO [data-testid="tweetText"] descendant that satisfy the sponsored
// signal (extractIsXSponsored — no <time> + bare "Ad" leaf). Text ads stay
// the pipeline's job; organic media-only posts (<time>, no ad leaf) are
// never touched; toggle OFF → complete no-op.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setBlockedRecorder, __resetBlockedRecorderForTest } from '../../../../src/content/engagement/recorder-sink';
import { sendHighStakesForensicLog } from '../../../../src/content/record/forensic-retry';
import {
  startMediaOnlyAdBlocker,
  scanMediaOnlyAds,
  MEDIA_ONLY_AD_HIDDEN_ATTR,
  MEDIA_ONLY_AD_LOGGED_ATTR,
} from '../../../../src/content/engagement/media-only-ad-blocker';
import { _resetForensicRetryBufferForTesting } from '../../../../src/content/record/forensic-retry';
import {
  FWSettings,
  FeatureToggles,
  CURRENT_SETTINGS_SCHEMA_VERSION,
} from '../../../../src/storage/settings';
import { teenPreset } from '../../../../src/storage/presets';

function makeSettings(features: FeatureToggles, mode: FWSettings['mode'] = 'adult'): FWSettings {
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    mode,
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

/** All features OFF except block-ads — isolates the media-only ad scan. */
function settingsWithBlockAds(on: boolean): FWSettings {
  const features = teenPreset();
  for (const key of Object.keys(features)) {
    features[key as keyof typeof features].enabled = false;
  }
  features['block-ads'].enabled = on;
  return makeSettings(features);
}

/** X feed cell: cellInnerDiv wrapper > article (both timeline attrs). */
function makeCell(articleChildren: string): { cell: HTMLElement; article: HTMLElement } {
  const cell = document.createElement('div');
  cell.setAttribute('data-testid', 'cellInnerDiv');
  const article = document.createElement('article');
  article.setAttribute('data-testid', 'tweet');
  article.setAttribute('role', 'article');
  article.innerHTML = articleChildren;
  cell.appendChild(article);
  document.body.appendChild(cell);
  return { cell, article };
}

/** Media-only ad — bare "Ad" leaf shown INSTEAD of a <time>, photo, NO
 *  tweetText (the live-verified extractIsXSponsored ad shape). */
function makeMediaOnlyAd(): { cell: HTMLElement; article: HTMLElement } {
  return makeCell(
    '<div data-testid="User-Name"><a href="/BrandCo">BrandCo</a></div>'
    + '<span>Ad</span>'
    + '<div data-testid="tweetPhoto"><img alt="promo"></div>',
  );
}

/** Text ad — same ad header, but WITH a tweetText: the pipeline path's job
 *  (it stamps fwProcessed/fwActionRow on the tweetText), not this scan's. */
function makeTextAd(): { cell: HTMLElement; article: HTMLElement } {
  return makeCell(
    '<div data-testid="User-Name"><a href="/AdCo">AdCo</a></div>'
    + '<span>Ad</span>'
    + '<div data-testid="tweetText">Buy the thing now</div>',
  );
}

/** Organic media-only post — <time> present, no ad leaf, no tweetText. */
function makeOrganicMediaOnly(): { cell: HTMLElement; article: HTMLElement } {
  return makeCell(
    '<div data-testid="User-Name"><a href="/friend">@friend</a></div>'
    + '<a href="/friend/status/123"><time datetime="2026-08-04">2h</time></a>'
    + '<div data-testid="tweetPhoto"><img alt="cat"></div>',
  );
}

interface SentMessage { type: string; payload: Record<string, unknown> }

function sentBlockedLogs(): SentMessage[] {
  const sendMessage = (globalThis as unknown as {
    chrome: { runtime: { sendMessage: ReturnType<typeof vi.fn> } };
  }).chrome.runtime.sendMessage;
  return sendMessage.mock.calls
    .map((call) => call[0] as SentMessage)
    .filter((msg) => msg?.type === 'BLOCKED_LOG');
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
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
      // { ok: true } = durable SW enqueue confirmed → no retry-buffer timer.
      sendMessage: vi.fn(() => Promise.resolve({ ok: true })),
    },
  };
});

afterEach(() => {
  _resetForensicRetryBufferForTesting();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});


// Receipts' own wiring: the filter hands a blocked item to the sink the entry point installs, and
// this is that sink (src/content/index.ts, PLAN-2026-09-16 item 9.2). Without it a hide records
// nothing, which is exactly what Off does.
beforeEach(() => {
  setBlockedRecorder((payload) => {
    void sendHighStakesForensicLog({ type: 'BLOCKED_LOG', payload });
  });
});
afterEach(() => {
  __resetBlockedRecorderForTest();
});

describe('startMediaOnlyAdBlocker — X media-only feed ads (F1)', () => {
  it('hides a media-only ad cell and logs exactly one BLOCKED_LOG across repeat passes', async () => {
    const { cell, article } = makeMediaOnlyAd();

    const stop = startMediaOnlyAdBlocker('twitter', settingsWithBlockAds(true));

    // Initial sweep runs synchronously from start.
    expect(cell.getAttribute(MEDIA_ONLY_AD_HIDDEN_ATTR)).toBe('true');
    expect(cell.style.display).toBe('none');
    expect(article.getAttribute(MEDIA_ONLY_AD_LOGGED_ATTR)).toBe('true');

    // Repeat sweeps (the throttled observer path re-fires scanMediaOnlyAds
    // on every DOM churn window) must not re-hide or re-log.
    scanMediaOnlyAds('adult');
    scanMediaOnlyAds('adult');

    const logs = sentBlockedLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].payload).toMatchObject({
      platform: 'twitter',
      mode: 'adult',
      blockReason: 'ads',
      matchedToken: 'media-only-ad-marker',
      caption: '',
    });
    expect(logs[0].payload.author).toBe('@BrandCo');

    stop();
  });

  it('leaves a text ad untouched — articles with a tweetText are the pipeline path', () => {
    const { cell, article } = makeTextAd();

    const stop = startMediaOnlyAdBlocker('twitter', settingsWithBlockAds(true));

    expect(cell.getAttribute(MEDIA_ONLY_AD_HIDDEN_ATTR)).toBeNull();
    expect(cell.style.display).not.toBe('none');
    expect(article.getAttribute(MEDIA_ONLY_AD_LOGGED_ATTR)).toBeNull();
    expect(sentBlockedLogs().length).toBe(0);

    stop();
  });

  it('leaves an organic media-only post untouched (<time> present, no ad leaf)', () => {
    const { cell, article } = makeOrganicMediaOnly();

    const stop = startMediaOnlyAdBlocker('twitter', settingsWithBlockAds(true));

    expect(cell.getAttribute(MEDIA_ONLY_AD_HIDDEN_ATTR)).toBeNull();
    expect(cell.style.display).not.toBe('none');
    expect(article.getAttribute(MEDIA_ONLY_AD_LOGGED_ATTR)).toBeNull();
    expect(sentBlockedLogs().length).toBe(0);

    stop();
  });

  it('does nothing when block-ads is OFF — no hide, no log, no observer work', async () => {
    vi.useFakeTimers();
    const { cell } = makeMediaOnlyAd();

    const stop = startMediaOnlyAdBlocker('twitter', settingsWithBlockAds(false));

    expect(cell.getAttribute(MEDIA_ONLY_AD_HIDDEN_ATTR)).toBeNull();
    expect(cell.style.display).not.toBe('none');

    // Late-arriving ad + DOM churn: still nothing (the OFF path never
    // attached an observer).
    makeMediaOnlyAd();
    await vi.advanceTimersByTimeAsync(1500);
    expect(document.querySelectorAll(`[${MEDIA_ONLY_AD_HIDDEN_ATTR}="true"]`).length).toBe(0);
    expect(sentBlockedLogs().length).toBe(0);

    stop();
  });

  it('is a no-op on platforms without a verified media-only ad shape', () => {
    const { cell } = makeMediaOnlyAd();
    const stop = startMediaOnlyAdBlocker('facebook', settingsWithBlockAds(true));
    expect(cell.getAttribute(MEDIA_ONLY_AD_HIDDEN_ATTR)).toBeNull();
    expect(sentBlockedLogs().length).toBe(0);
    stop();
  });

  it('observer picks up a late-mounted media-only ad within the throttle window', async () => {
    vi.useFakeTimers();
    const stop = startMediaOnlyAdBlocker('twitter', settingsWithBlockAds(true));

    // Mounted AFTER start — only the MutationObserver sweep can catch it.
    const { cell } = makeMediaOnlyAd();
    await vi.advanceTimersByTimeAsync(700); // THROTTLE_MS = 600

    expect(cell.getAttribute(MEDIA_ONLY_AD_HIDDEN_ATTR)).toBe('true');
    expect(sentBlockedLogs().length).toBe(1);

    stop();
  });

  it('disposer restores hidden cells; a restart re-hides WITHOUT a duplicate ledger record', () => {
    const { cell, article } = makeMediaOnlyAd();

    const stop = startMediaOnlyAdBlocker('twitter', settingsWithBlockAds(true));
    expect(cell.style.display).toBe('none');
    stop();

    // Toggle-off teardown: visual restored, ledger stamp retained.
    expect(cell.getAttribute(MEDIA_ONLY_AD_HIDDEN_ATTR)).toBeNull();
    expect(cell.style.display).not.toBe('none');
    expect(article.getAttribute(MEDIA_ONLY_AD_LOGGED_ATTR)).toBe('true');

    // Settings-change restart (controller teardown → restart cycle):
    // re-hide lands, but the chain does not get a duplicate event.
    const stop2 = startMediaOnlyAdBlocker('twitter', settingsWithBlockAds(true));
    expect(cell.getAttribute(MEDIA_ONLY_AD_HIDDEN_ATTR)).toBe('true');
    expect(cell.style.display).toBe('none');
    expect(sentBlockedLogs().length).toBe(1);

    stop2();
  });
});
