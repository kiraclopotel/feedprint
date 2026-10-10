// @vitest-environment jsdom
//
// YouTube ads outside the feed (Brand seat 2026-10-09 00:09; tester 01:25).
// Read logged out the same night (scripts/verify/youtube-ad-shapes.mjs, three
// watch pages): Off 1.0.13 left a "Sponsored" panel in the watch page's right
// column on 3 of 3, drawn as the companion slot above the related videos
// (#player-ads > ytd-player-legacy-desktop-watch-ads-renderer >
// ytd-companion-slot-renderer) or as an ads engagement panel
// (panel-ad-header-image-lockup-view-model in its header). Receipts at any
// level hid none of the search page's ad slots: the DOM rule stood down there
// and the pipeline's YouTube ad shapes are home tiles only. The ad inside the
// player is never touched.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const recorded: { platform: string; blockReason: string; matchedToken: string }[] = [];
vi.mock('../../../../src/content/engagement/recorder-sink', () => ({
  recordBlocked: (p: { platform: string; blockReason: string; matchedToken: string }) => { recorded.push(p); },
}));
vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return { ...actual, incrementMetricsHidden: vi.fn(() => Promise.resolve()) };
});

import { _setProductForTesting } from '../../../../src/product';
import { namedAdSlots, scanFeedAds, startFeedAdBlocker, FEED_AD_HIDDEN_MARKER } from '../../../../src/content/engagement/feed-ad-blocker';
import { recorderRuns, RECORDER_RUNS_ATTR } from '../../../../src/content/engagement/recorder-runs';
import type { Platform } from '../../../../src/types/post';
import { type FWSettings, CURRENT_SETTINGS_SCHEMA_VERSION } from '../../../../src/storage/settings';
import { adultPreset } from '../../../../src/storage/presets';

function settings(): FWSettings {
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
    features: adultPreset(),
    presets: { appliedAt: '', appliedPreset: 'adult' },
    dashboardTheme: 'dark',
  };
}

const BADGE = '<ad-avatar-lockup-view-model><div><div><ad-badge-view-model><badge-shape><div>Sponsored</div></badge-shape></ad-badge-view-model></div></div></ad-avatar-lockup-view-model>';

/** The watch page as read: the player with its own ad badge, the right column with one of the two ad shapes. */
const WATCH = (side: string) => `
  <ytd-watch-flexy><div id="columns">
    <div id="primary"><div id="player"><div id="movie_player" class="ad-showing">
      <div><div id="player-overlay-layout:0"><div><span id="ad-badge:6"><div id="ad-simple-attributed-string:7">Sponsored</div></span></div></div></div>
    </div></div></div>
    <div id="secondary"><div id="secondary-inner">${side}
      <div id="related"><ytd-compact-video-renderer id="rel"><span>A related video</span></ytd-compact-video-renderer></div>
    </div></div>
  </div></ytd-watch-flexy>`;

const COMPANION = `<div id="player-ads"><ytd-player-legacy-desktop-watch-ads-renderer id="companion-host"><ytd-companion-slot-renderer>
  <div id="companion"><top-banner-image-text-icon-buttoned-layout-view-model><div><div>${BADGE}</div></div></top-banner-image-text-icon-buttoned-layout-view-model></div>
  </ytd-companion-slot-renderer></ytd-player-legacy-desktop-watch-ads-renderer></div>`;

const AD_PANEL = `<div id="panels">
  <ytd-engagement-panel-section-list-renderer id="ad-panel" target-id="engagement-panel-ads" visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED">
    <div id="header"><panel-ad-header-image-lockup-view-model><div><div><div>${BADGE}</div></div></div></panel-ad-header-image-lockup-view-model></div>
    <div id="content"><span>Install now</span></div>
  </ytd-engagement-panel-section-list-renderer>
  <ytd-engagement-panel-section-list-renderer id="comments-panel" target-id="engagement-panel-comments-section">
    <div id="content"><ytd-comment-view-model><span>Sponsored</span></ytd-comment-view-model></div>
  </ytd-engagement-panel-section-list-renderer>
</div>`;

/** The search page: one ad slot among results. */
const SEARCH = `<ytd-search><ytd-item-section-renderer>
  <ytd-video-renderer id="organic"><span>A bread video</span></ytd-video-renderer>
  <ytd-ad-slot-renderer id="search-ad"><ytd-in-feed-ad-layout-renderer><div>${BADGE}</div></ytd-in-feed-ad-layout-renderer></ytd-ad-slot-renderer>
</ytd-item-section-renderer></ytd-search>`;

/** The home page: an ad tile inside a rich item, which Receipts' pipeline hides and records itself. */
const HOME = `<ytd-rich-grid-renderer><ytd-rich-item-renderer id="home-tile">
  <ytd-ad-slot-renderer><ytd-in-feed-ad-layout-renderer><div>${BADGE}</div></ytd-in-feed-ad-layout-renderer></ytd-ad-slot-renderer>
</ytd-rich-item-renderer></ytd-rich-grid-renderer>`;

const byId = (id: string) => document.getElementById(id)!;
const hidden = (id: string) => byId(id).getAttribute(FEED_AD_HIDDEN_MARKER) === 'true';

let stop: () => void = () => {};
beforeEach(() => { document.body.innerHTML = ''; recorded.length = 0; });
afterEach(() => { stop(); stop = () => {}; _setProductForTesting(null); document.body.innerHTML = ''; });

describe('Off: the watch page right column', () => {
  it('the companion slot above the related videos is hidden whole', () => {
    document.body.innerHTML = WATCH(COMPANION);
    scanFeedAds(document, 'youtube');
    expect(hidden('companion-host')).toBe(true);
    expect(byId('companion-host').style.display).toBe('none');
    expect(hidden('rel')).toBe(false);
  });

  it('the ads engagement panel is hidden whole; the comments panel stays', () => {
    document.body.innerHTML = WATCH(AD_PANEL);
    scanFeedAds(document, 'youtube');
    expect(hidden('ad-panel')).toBe(true);
    expect(byId('ad-panel').style.display).toBe('none');
    expect(byId('comments-panel').hasAttribute(FEED_AD_HIDDEN_MARKER)).toBe(false);
  });

  it('an ad slot inside any other panel hides alone; the panel stays (head fresh check, 9 Oct)', () => {
    document.body.innerHTML = WATCH(`<div id="panels"><ytd-engagement-panel-section-list-renderer id="desc-panel" target-id="engagement-panel-structured-description">
      <div id="content"><span>The video's description</span><ytd-ad-slot-renderer id="slot-in-panel"><div>${BADGE}</div></ytd-ad-slot-renderer></div>
    </ytd-engagement-panel-section-list-renderer></div>`);
    scanFeedAds(document, 'youtube');
    expect(hidden('slot-in-panel')).toBe(true);
    expect(byId('desc-panel').hasAttribute(FEED_AD_HIDDEN_MARKER)).toBe(false);
    expect(byId('desc-panel').style.display).toBe('');
  });

  it('the player and its own ad badge are never touched', () => {
    document.body.innerHTML = WATCH(COMPANION);
    scanFeedAds(document, 'youtube');
    for (const el of byId('movie_player').querySelectorAll('*')) expect(el.hasAttribute(FEED_AD_HIDDEN_MARKER)).toBe(false);
    expect(byId('movie_player').hasAttribute(FEED_AD_HIDDEN_MARKER)).toBe(false);
    expect(byId('player').style.display).toBe('');
  });
});

/** The Shorts player as read signed out 2026-10-09: the ad card holds its video, its overlay is the ad slot. */
const SHORTS = `<div id="shorts-inner-container"><div id="reel-overlay-container">
  <ytd-reel-video-renderer id="ad-card"><video></video><div id="experiment-overlay"><ytd-ad-slot-renderer><div id="fulfilled-layout">
    <ytd-in-feed-ad-layout-renderer><div id="rendering-content"><reels-player-overlay-layout-view-model><div><div>
      <reels-ad-card-buttoned-view-model><yt-ad-metadata-shape><div><div>${BADGE.replace('<ad-avatar-lockup-view-model><div><div>', '').replace('</div></div></ad-avatar-lockup-view-model>', '')}</div></div></yt-ad-metadata-shape></reels-ad-card-buttoned-view-model>
    </div></div></reels-player-overlay-layout-view-model></div></ytd-in-feed-ad-layout-renderer>
  </div></ytd-ad-slot-renderer></div></ytd-reel-video-renderer>
  <ytd-reel-video-renderer id="next-card"><video></video><div id="experiment-overlay"></div></ytd-reel-video-renderer>
</div></div>`;

describe('Shorts: an ad card goes whole, the next card stays', () => {
  it('Off hides the ad card (its box kept), silences it, leaves the next card', () => {
    document.body.innerHTML = SHORTS;
    scanFeedAds(document, 'youtube');
    expect(hidden('ad-card')).toBe(true);
    expect(byId('ad-card').style.visibility).toBe('hidden');
    expect(byId('ad-card').style.display).toBe('');
    // On a single-player feed the card is paused and kept paused, not muted: the player carries
    // muted over to the next card (hide-primitives.ts muteAndPauseMedia).
    expect(byId('ad-card').getAttribute('data-fw-silenced')).toBe('true');
    expect(byId('next-card').hasAttribute(FEED_AD_HIDDEN_MARKER)).toBe(false);
  });

  it('Feedprint hides it and writes one record', () => {
    _setProductForTesting('receipts');
    document.body.innerHTML = SHORTS;
    stop = startFeedAdBlocker('youtube', settings());
    scanFeedAds(document, 'youtube', 'en', { mode: 'adult' });
    expect(hidden('ad-card')).toBe(true);
    expect(recorded.map((r) => r.blockReason)).toEqual(['ads']);
  });
});

describe('Receipts: the search page and the right column, each with one record', () => {
  it('hides the search ad slot and the companion, one record each, across passes', () => {
    _setProductForTesting('receipts');
    document.body.innerHTML = SEARCH + WATCH(COMPANION);
    stop = startFeedAdBlocker('youtube', settings());
    scanFeedAds(document, 'youtube', 'en', { mode: 'adult' });
    expect(hidden('search-ad')).toBe(true);
    expect(hidden('companion-host')).toBe(true);
    expect(hidden('organic')).toBe(false);
    expect(recorded.map((r) => [r.platform, r.blockReason])).toEqual([['youtube', 'ads'], ['youtube', 'ads']]);
  });

  it('leaves a home tile to the pipeline: not hidden here, no record here', () => {
    _setProductForTesting('receipts');
    document.body.innerHTML = HOME;
    stop = startFeedAdBlocker('youtube', settings());
    expect(hidden('home-tile')).toBe(false);
    expect(recorded).toEqual([]);
  });

  it('stays off on the other sites, where the pipeline hides and records feed ads', () => {
    _setProductForTesting('receipts');
    document.body.innerHTML = '<div role="article" aria-posinset="1" id="fb"><div><h3><a href="/p">Page</a></h3><span>Sponsored</span></div></div>';
    stop = startFeedAdBlocker('facebook', settings());
    expect(byId('fb').hasAttribute(FEED_AD_HIDDEN_MARKER)).toBe(false);
    expect(recorded).toEqual([]);
  });

  it('Off writes no record', () => {
    _setProductForTesting('off');
    document.body.innerHTML = SEARCH;
    stop = startFeedAdBlocker('youtube', settings());
    expect(hidden('search-ad')).toBe(true);
    expect(recorded).toEqual([]);
  });
});

// The tester's finding 5 (9 Oct 2026): a channel's "Shop" shelf of product cards stayed under the video with every Off switch
// on. Read signed out the same night on a Fox News watch page as ytd-merch-shelf-renderer. It was Off's alone at first; with
// both installed Off leaves ads to Feedprint, and the shelf showed under both (the two-product finding, 9 Oct 2026), so
// Feedprint hides and records it too.
const SHOP = `<ytd-watch-flexy><div id="below"><ytd-merch-shelf-renderer id="shop"><div id="title">Shop the channel's store</div>
  <a href="https://shop.example/item">A mug, $19.99</a></ytd-merch-shelf-renderer>
  <div id="comments-area"><span>A comment</span></div></div></ytd-watch-flexy>`;

describe('a channel shop shelf', () => {
  it('Off hides it with "Block ads"', () => {
    _setProductForTesting('off');
    document.body.innerHTML = SHOP;
    stop = startFeedAdBlocker('youtube', settings());
    expect(hidden('shop')).toBe(true);
    expect(byId('comments-area').hasAttribute(FEED_AD_HIDDEN_MARKER)).toBe(false);
  });

  it('Feedprint hides it and records it once', () => {
    _setProductForTesting('receipts');
    document.body.innerHTML = SHOP;
    stop = startFeedAdBlocker('youtube', settings());
    expect(hidden('shop')).toBe(true);
    expect(recorded.filter((r) => r.blockReason === 'ads')).toHaveLength(1);
  });

  it('with both installed (Feedprint\'s stamp names ads, so Off leaves them to it) the shelf is hidden', () => {
    const rootEl = document.documentElement;
    rootEl.setAttribute(RECORDER_RUNS_ATTR, 'ads words');
    rootEl.setAttribute('data-fw-recorder', 'true');
    try {
      const runs = recorderRuns();
      expect(runs !== null && runs !== 'all' && runs.has('ads')).toBe(true); // Off's controller leaves ads to Feedprint
      _setProductForTesting('receipts');
      document.body.innerHTML = SHOP;
      stop = startFeedAdBlocker('youtube', settings());
      expect(hidden('shop')).toBe(true);
    } finally {
      rootEl.removeAttribute(RECORDER_RUNS_ATTR);
      rootEl.removeAttribute('data-fw-recorder');
    }
  });
});

// The hand-off loses nothing: on every platform where Feedprint runs this rule, every slot Off hides by its name alone is
// one Feedprint hides too, by the lists and on the page. A slot named for Off alone would show again with both installed.
describe('Feedprint covers every slot Off names', () => {
  const PLATFORMS: Platform[] = ['youtube', 'facebook', 'instagram', 'tiktok', 'twitter'];

  it('by the lists', () => {
    for (const platform of PLATFORMS) {
      const fp = namedAdSlots(platform, 'feedprint');
      if (!fp) continue; // Feedprint does not run this rule there: its pipeline reads that platform's ads
      const fpNames = new Set(fp.split(',').map((s) => s.trim()));
      for (const name of namedAdSlots(platform, 'off').split(',').map((s) => s.trim()).filter(Boolean)) {
        expect(fpNames.has(name), `${platform}: ${name}`).toBe(true);
      }
    }
  });

  it('on the page: each of Off\'s named YouTube slots, under a watch page, is hidden and recorded by Feedprint', () => {
    for (const name of namedAdSlots('youtube', 'off').split(',').map((s) => s.trim()).filter(Boolean)) {
      recorded.length = 0;
      document.body.innerHTML = `<ytd-watch-flexy><div id="secondary"><${name} id="slot"><span>Shop or ad words</span></${name}></div></ytd-watch-flexy>`;
      scanFeedAds(document, 'youtube', 'en', { mode: 'adult' });
      const slot = document.getElementById('slot')!;
      const gone = slot.getAttribute(FEED_AD_HIDDEN_MARKER) === 'true' || !!slot.closest(`[${FEED_AD_HIDDEN_MARKER}="true"]`);
      expect(gone, name).toBe(true);
      expect(recorded.length, name).toBe(1);
    }
  });
});
