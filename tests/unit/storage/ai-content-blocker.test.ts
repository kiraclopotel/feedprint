// @vitest-environment jsdom
//
// FIX #2 — AI Content Blocker SPA-navigation re-scan.
//
// Context: pre-fix, startAiContentBlocker only ran via initial scan +
// MutationObserver(body) + 2s setInterval. SPA-route changes (twitter feed
// click, YT video-click, etc.) leak AI-flagged content for up to 2s — or
// indefinitely if the polling tick happens to read stale virtualized DOM.
//
// Fix: popstate listener + 1s URL-poll + (YT only) yt-navigate-finish, all
// debounced (300 ms) into a single runOnce.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setBlockedRecorder, __resetBlockedRecorderForTest } from '../../../src/content/engagement/recorder-sink';
import { sendHighStakesForensicLog } from '../../../src/content/record/forensic-retry';
import { startAiContentBlocker } from '../../../src/content/engagement/ai-content-blocker';
import {
  FWSettings,
  FeatureToggles,
  CURRENT_SETTINGS_SCHEMA_VERSION,
} from '../../../src/storage/settings';
import { teenPreset } from '../../../src/storage/presets';
import { levelOf } from '../../../src/types/mode';

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

function settingsWithAiBlockerOn(): FWSettings {
  // Start from teenPreset and isolate the AI blocker: turn off every
  // feature, then explicitly turn `block-ai-content` ON. Under the
  // opt-in factory policy (CYCLE N+6) `block-ai-content` is OFF by
  // default in both presets — the parent opts in. This fixture forces
  // the blocker on so the SPA-rescan + hashtag-fallback contracts can
  // be tested in isolation.
  const features = teenPreset();
  for (const key of Object.keys(features)) {
    features[key as keyof typeof features].enabled = false;
  }
  features['block-ai-content'].enabled = true;
  return makeSettings(features);
}

function makeTwitterAiTweet(text: string): HTMLElement {
  const article = document.createElement('article');
  article.setAttribute('data-testid', 'tweet');
  const tweetText = document.createElement('div');
  tweetText.setAttribute('data-testid', 'tweetText');
  tweetText.textContent = text;
  article.appendChild(tweetText);
  return article;
}

function makeYouTubeAiItem(text: string): HTMLElement {
  const item = document.createElement('ytd-rich-item-renderer');
  const titleHost = document.createElement('h2');
  const title = document.createElement('yt-formatted-string');
  title.textContent = text;
  titleHost.appendChild(title);
  item.appendChild(titleHost);
  return item;
}

const PRISTINE_PUSH = history.pushState.bind(history);
const PRISTINE_REPLACE = history.replaceState.bind(history);

// Minimal chrome.storage / chrome.runtime stub. The blocker's runOnce path
// fires incrementMetricsHidden() (touches chrome.storage.local) and
// safeSendMessage() (touches chrome.runtime.sendMessage). Without these
// stubs, both throw "chrome is not defined" as unhandled rejections.
beforeEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  history.pushState = PRISTINE_PUSH;
  history.replaceState = PRISTINE_REPLACE;
  history.replaceState({}, '', '/');

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

describe('startAiContentBlocker — SPA-navigation re-scan (FIX #2)', () => {
  it('popstate after URL change re-scans newly-injected AI content (twitter)', async () => {
    vi.useFakeTimers();
    const settings = settingsWithAiBlockerOn();

    // First AI-flagged tweet present at startup.
    const first = makeTwitterAiTweet('this image was made with ai');
    document.body.appendChild(first);

    const stop = startAiContentBlocker('twitter', settings);
    // initial runOnce is synchronous from start
    expect(first.getAttribute('data-fw-blocked')).toBe('ai-content');

    // Simulate SPA navigation: a second AI-flagged tweet enters the DOM
    // AFTER the user routes to a new path.
    const second = makeTwitterAiTweet('look at this generated by ai clip');
    document.body.appendChild(second);

    // Path change + popstate dispatch
    history.pushState({}, '', '/some/profile');
    window.dispatchEvent(new PopStateEvent('popstate'));

    // Advance debounce window (300 ms) plus margin
    await vi.advanceTimersByTimeAsync(400);

    expect(second.getAttribute('data-fw-blocked')).toBe('ai-content');

    stop();
  });

  it('URL-poll detects pushState without popstate dispatch', async () => {
    vi.useFakeTimers();
    const settings = settingsWithAiBlockerOn();
    const stop = startAiContentBlocker('twitter', settings);

    // Inject AFTER startup. The URL-poll alone (1000 ms tick) should
    // detect the path change and queue a re-scan.
    const newTweet = makeTwitterAiTweet('this is ai generated content for sure');
    document.body.appendChild(newTweet);

    // pushState, no popstate. Poll runs at 1000 ms; debounce adds 300 ms.
    history.pushState({}, '', '/different-path');
    await vi.advanceTimersByTimeAsync(1400);

    expect(newTweet.getAttribute('data-fw-blocked')).toBe('ai-content');

    stop();
  });

  it('yt-navigate-finish (YouTube only) re-scans newly-injected AI content', async () => {
    vi.useFakeTimers();
    const settings = settingsWithAiBlockerOn();
    const stop = startAiContentBlocker('youtube', settings);

    const item = makeYouTubeAiItem('Made with AI compilation');
    document.body.appendChild(item);

    document.dispatchEvent(new CustomEvent('yt-navigate-finish'));
    await vi.advanceTimersByTimeAsync(400);

    expect(item.getAttribute('data-fw-blocked')).toBe('ai-content');

    stop();
  });

  it('cleanup detaches popstate + clears nav-poll + (YT) detaches yt-navigate-finish', async () => {
    vi.useFakeTimers();
    const settings = settingsWithAiBlockerOn();

    const removeWindowListenerSpy = vi.spyOn(window, 'removeEventListener');
    const removeDocListenerSpy = vi.spyOn(document, 'removeEventListener');

    const stop = startAiContentBlocker('youtube', settings);

    // Sanity: cleanup function exists
    expect(typeof stop).toBe('function');

    stop();

    expect(
      removeWindowListenerSpy.mock.calls.some(call => call[0] === 'popstate'),
    ).toBe(true);
    expect(
      removeDocListenerSpy.mock.calls.some(call => call[0] === 'yt-navigate-finish'),
    ).toBe(true);

    // After cleanup, dispatching navigation events should NOT process new
    // injected content — the listeners are gone and the URL-poll is cleared.
    const lateItem = makeYouTubeAiItem('made with ai post-cleanup');
    document.body.appendChild(lateItem);

    history.pushState({}, '', '/post-cleanup');
    window.dispatchEvent(new PopStateEvent('popstate'));
    document.dispatchEvent(new CustomEvent('yt-navigate-finish'));
    await vi.advanceTimersByTimeAsync(2000);

    expect(lateItem.getAttribute('data-fw-blocked')).toBeNull();
  });

  it('same-path popstate burst does NOT schedule additional debounced re-scans', async () => {
    vi.useFakeTimers();
    const settings = settingsWithAiBlockerOn();

    history.replaceState({}, '', '/feed');
    const stop = startAiContentBlocker('twitter', settings);

    // Spy on setTimeout AFTER blocker startup so we only count scheduleRescan
    // debounce timers (300 ms = RESCAN_DEBOUNCE_MS), not the initial-mount
    // setInterval/setTimeout setup.
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');

    // First nav: changes path -> onUrlMaybeChanged fires -> scheduleRescan
    // queues one 300 ms debounced timer.
    history.pushState({}, '', '/profile-a');
    window.dispatchEvent(new PopStateEvent('popstate'));

    const debounceCallsAfterFirstNav = setTimeoutSpy.mock.calls.filter(
      ([, delay]) => delay === 300,
    ).length;
    expect(debounceCallsAfterFirstNav).toBe(1);

    // Burst of 5 popstates on the SAME path. onUrlMaybeChanged sees
    // next === lastPath and short-circuits before scheduleRescan, so NO
    // additional 300 ms debounce timers should have been queued.
    for (let i = 0; i < 5; i++) {
      window.dispatchEvent(new PopStateEvent('popstate'));
    }

    const debounceCallsAfterBurst = setTimeoutSpy.mock.calls.filter(
      ([, delay]) => delay === 300,
    ).length;
    expect(debounceCallsAfterBurst).toBe(debounceCallsAfterFirstNav);

    // Drain the debounce timer so the rescan fires before stop().
    await vi.advanceTimersByTimeAsync(400);

    stop();
  });

  it('engagement-hider markers on sibling DOM survive re-scan and cleanup', async () => {
    vi.useFakeTimers();
    const settings = settingsWithAiBlockerOn();

    // Engagement-hider's marker on a sibling node, untouched by ai-blocker.
    const sibling = document.createElement('div');
    sibling.setAttribute('data-fw-action-rail', 'bar');
    document.body.appendChild(sibling);

    // AI-flagged tweet so the blocker has something to chew on.
    const ai = makeTwitterAiTweet('made with ai');
    document.body.appendChild(ai);

    const stop = startAiContentBlocker('twitter', settings);

    // Trigger a re-scan via popstate-after-pushState path.
    history.pushState({}, '', '/somewhere');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await vi.advanceTimersByTimeAsync(400);

    // The AI tweet was blocked.
    expect(ai.getAttribute('data-fw-blocked')).toBe('ai-content');
    // The sibling's engagement-hider marker is untouched.
    expect(sibling.getAttribute('data-fw-action-rail')).toBe('bar');

    // Cleanup: ai-blocker resets only its own DOM. The sibling marker
    // survives — engagement-hider lifecycle is independent.
    stop();
    expect(sibling.getAttribute('data-fw-action-rail')).toBe('bar');
  });
});

describe('startAiContentBlocker — search-result hashtag fallback', () => {
  it('YouTube Shorts: hashtag in non-caption DOM still triggers a block', async () => {
    vi.useFakeTimers();
    const settings = settingsWithAiBlockerOn();

    // YT Shorts container: the description with hashtags is rendered in a
    // sibling/overlay element that the descriptor.caption selectors
    // (#title, h2 yt-formatted-string, #description-inline-expander,
    // yt-formatted-string#content) do not match. The hashtag still lives
    // inside the post wrapper container.textContent.
    const reel = document.createElement('ytd-reel-video-renderer');
    const overlay = document.createElement('div');
    overlay.textContent = 'Some unrelated UI label #lifehabits #fruits #commonmistakes #drama #ai';
    reel.appendChild(overlay);
    document.body.appendChild(reel);

    const stop = startAiContentBlocker('youtube', settings);

    expect(reel.getAttribute('data-fw-blocked')).toBe('ai-content');
    expect(reel.getAttribute('data-fw-block-reason')).toContain('hashtag');

    stop();
  });

  it('Facebook search wrapper: hashtag in non-caption text triggers a block', async () => {
    vi.useFakeTimers();
    const settings = settingsWithAiBlockerOn();

    // FB search-result article: caption-typed selectors miss when search
    // results render their post body in a non-standard wrapper, but the
    // hashtag stays inside container.textContent.
    const article = document.createElement('div');
    article.setAttribute('role', 'article');
    const body = document.createElement('div');
    body.textContent = 'Sponsored: a clip about #aifruit and friends';
    article.appendChild(body);
    document.body.appendChild(article);

    const stop = startAiContentBlocker('facebook', settings);

    expect(article.getAttribute('data-fw-blocked')).toBe('ai-content');
    expect(article.getAttribute('data-fw-block-reason')).toContain('hashtag');

    stop();
  });

  it('caption-only hashtag still wins token attribution over container scan', async () => {
    vi.useFakeTimers();
    const settings = settingsWithAiBlockerOn();

    // When the hashtag IS inside the descriptor.caption selectors, the
    // caption pass should resolve first so token attribution remains
    // pinned to the canonical caption text.
    const article = document.createElement('article');
    article.setAttribute('data-testid', 'tweet');
    const tweetText = document.createElement('div');
    tweetText.setAttribute('data-testid', 'tweetText');
    tweetText.textContent = 'check this out #aifruit';
    article.appendChild(tweetText);
    document.body.appendChild(article);

    const stop = startAiContentBlocker('twitter', settings);

    expect(article.getAttribute('data-fw-blocked')).toBe('ai-content');
    expect(article.getAttribute('data-fw-block-reason')).toBe('hashtag:#aifruit');

    stop();
  });

  // Modern TikTok permalink (`/@<user>/video/<id>`) renders the caption +
  // music + AI-label badge in a SIBLING info panel, not as descendants of
  // the focused-video container. The standard descriptor.container walk +
  // container.textContent fallback both miss because the text isn't in the
  // container's DOM subtree. Page-level evaluator at `runOnce` queries
  // document-scope and blocks the focused container at
  // `[data-scroll-index="0"]`.
  describe('TikTok permalink-via-search (sibling-caption topology)', () => {
    it('blocks focused video at data-scroll-index="0" when sibling browse-video-desc has blocked hashtag', () => {
      vi.useFakeTimers();
      history.replaceState({}, '', '/@example_blocked_a/video/7100000000000000011');
      const settings = settingsWithAiBlockerOn();

      const focused = document.createElement('div');
      focused.setAttribute('data-e2e', 'recommend-list-item-container');
      focused.setAttribute('data-scroll-index', '0');
      document.body.appendChild(focused);

      const caption = document.createElement('div');
      caption.setAttribute('data-e2e', 'browse-video-desc');
      caption.textContent = 'Partea 1 #ai #fruit #fruitai #dramastory #fruitstory';
      document.body.appendChild(caption);

      const stop = startAiContentBlocker('tiktok', settings);

      expect(focused.getAttribute('data-fw-blocked')).toBe('ai-content');
      expect(focused.getAttribute('data-fw-block-reason')).toContain('hashtag');

      stop();
    });

    it('blocks focused video when document-level Romanian AI-label badge is present', () => {
      vi.useFakeTimers();
      history.replaceState({}, '', '/@example_blocked_b/video/7100000000000000012');
      const settings = settingsWithAiBlockerOn();

      const focused = document.createElement('div');
      focused.setAttribute('data-e2e', 'recommend-list-item-container');
      focused.setAttribute('data-scroll-index', '0');
      document.body.appendChild(focused);

      const labelBadge = document.createElement('div');
      labelBadge.textContent = 'Conține materiale generate de IA';
      document.body.appendChild(labelBadge);

      const stop = startAiContentBlocker('tiktok', settings);

      expect(focused.getAttribute('data-fw-blocked')).toBe('ai-content');
      expect(focused.getAttribute('data-fw-block-reason')).toContain('ai-label');

      stop();
    });

    it('does NOT fire the page-level path on non-permalink TikTok URLs', () => {
      vi.useFakeTimers();
      history.replaceState({}, '', '/foryou');
      const settings = settingsWithAiBlockerOn();

      const focused = document.createElement('div');
      focused.setAttribute('data-e2e', 'recommend-list-item-container');
      focused.setAttribute('data-scroll-index', '0');
      document.body.appendChild(focused);

      const caption = document.createElement('div');
      caption.setAttribute('data-e2e', 'browse-video-desc');
      caption.textContent = '#aifruit';
      document.body.appendChild(caption);

      const stop = startAiContentBlocker('tiktok', settings);

      // /foryou: page-level evaluator gated to permalink only; the standard
      // container walk also misses because caption is sibling, not descendant
      // (this DOM shape mimics permalink for test isolation; real /foryou
      // pages have caption inside the container).
      expect(focused.getAttribute('data-fw-blocked')).not.toBe('ai-content');

      stop();
    });
  });
});

// example_account regression — 2026-05-22. Instagram dropped <article>
// on /p/<id>/ + /reels/<id>/ permalink surfaces and uses the label
// "Contains AI-generated media" (hyphenated, noun=media) which the
// prior token list missed. New `instagram:permalink` surface descriptor
// uses `main` container with pathname gate; new tokens cover the
// hyphenated form.
describe('startAiContentBlocker — Instagram permalink (a reported account regression)', () => {
  it('blocks an IG /p/ permalink page where main contains "Contains AI-generated media"', () => {
    history.replaceState({}, '', '/p/DExAmPle0a1/');
    const settings = settingsWithAiBlockerOn();

    const main = document.createElement('main');
    const wrapper = document.createElement('div');
    wrapper.textContent = 'example_account Contains AI-generated media CapCut Editing made easy';
    main.appendChild(wrapper);
    document.body.appendChild(main);

    const stop = startAiContentBlocker('instagram', settings);
    expect(main.getAttribute('data-fw-blocked')).toBe('ai-content');
    expect(main.getAttribute('data-fw-block-reason')).toMatch(/ai-label/);

    stop();
  });

  it('blocks an IG /reels/ permalink page with the AI-generated label', () => {
    history.replaceState({}, '', '/reels/ABC123_xyz/');
    const settings = settingsWithAiBlockerOn();

    const main = document.createElement('main');
    main.textContent = 'some reel title contains ai-generated media here';
    document.body.appendChild(main);

    const stop = startAiContentBlocker('instagram', settings);
    expect(main.getAttribute('data-fw-blocked')).toBe('ai-content');

    stop();
  });

  it('does NOT block IG home feed via the permalink surface (pathname gate)', () => {
    history.replaceState({}, '', '/');
    const settings = settingsWithAiBlockerOn();

    const main = document.createElement('main');
    main.textContent = 'home feed mentions ai-generated stuff somewhere casually';
    document.body.appendChild(main);

    const stop = startAiContentBlocker('instagram', settings);
    // The permalink descriptor's pathname gate /^\/(p|reel|reels)\// does not
    // match `/` — the home feed scan only happens via the article surface,
    // which finds nothing here (no article in this fixture).
    expect(main.getAttribute('data-fw-blocked')).not.toBe('ai-content');

    stop();
  });
});

describe('W74 — IG "AI creator" persona badge is a block signal (live-attested 2026-08-11)', () => {
  it('blocks a post whose actor row carries the AI creator badge', () => {
    const settings = settingsWithAiBlockerOn();
    const tweet = makeTwitterAiTweet('AI creator');
    document.body.appendChild(tweet);

    const stop = startAiContentBlocker('twitter', settings);
    expect(tweet.getAttribute('data-fw-blocked')).toBe('ai-content');
    stop();
  });
});

// Record-completeness audit (2026-08-24 browse export): a live Copy
// Diagnostics capture showed 23/200 (11.5%) of recent records with NO
// configSnapshot at all. Root cause traced to `logBlockedEvent`
// (BlockedEventInput never carried a `configSnapshot` field): every blocked
// record hard-coded `configSnapshot: undefined` in logger.ts, regardless of
// whether the media-understanding gates had resolved. Not a gate-timing
// race — the field was simply never wired for this record type.
describe('startAiContentBlocker — blocked records carry a configSnapshot (record-completeness)', () => {
  it('sends a BLOCKED_LOG payload whose configSnapshot is a real object, not omitted', () => {
    const settings = settingsWithAiBlockerOn();
    const tweet = makeTwitterAiTweet('this image was made with ai');
    document.body.appendChild(tweet);

    const stop = startAiContentBlocker('twitter', settings);

    const sendMessage = (globalThis as unknown as { chrome: { runtime: { sendMessage: ReturnType<typeof vi.fn> } } })
      .chrome.runtime.sendMessage;
    const blockedCall = sendMessage.mock.calls.find(
      (call) => (call[0] as { type?: string })?.type === 'BLOCKED_LOG',
    );
    expect(blockedCall).toBeDefined();
    const payload = (blockedCall![0] as { payload: { configSnapshot?: unknown; mode?: string; dailyCap?: number } }).payload;
    expect(payload.configSnapshot).toBeDefined();
    expect(payload.configSnapshot).toMatchObject({ mode: levelOf(settings.mode), dailyCap: settings.dailyCap });

    stop();
  });
});
