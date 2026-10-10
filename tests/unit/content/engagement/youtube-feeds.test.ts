// @vitest-environment jsdom
//
// The two YouTube switches (engagement/youtube-feeds.ts): the home feed and the recommended videos.
// They hide a feed on purpose, so the guard is the other way round from the surface switches: only
// the named YouTube components are ever hidden, by one stylesheet keyed on attributes on <html>, and
// the search box, the guide, the video, its title, description and comments are never touched.
// The pages below carry the element names read on youtube.com signed out on 2026-10-06, with every
// text synthetic.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const counted: Array<Record<string, number>> = [];
vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return {
    ...actual,
    incrementMetricsHidden: vi.fn(async (_n: number, byFeature: Record<string, number>) => { counted.push(byFeature); }),
  };
});

import {
  HOME_FEED_SELECTORS, RECOMMENDED_SELECTORS, YOUTUBE_FEED_FEATURES, YT_FEEDS_STYLE_ID, YT_HOME_ATTR,
  YT_HOME_NOTE_ATTR, YT_HOME_SHOWN_ATTR, YT_RECS_ATTR, resetYouTubeFeedsDOM, startYouTubeFeeds,
} from '../../../../src/content/engagement/youtube-feeds';
import { adultPreset } from '../../../../src/storage/presets';
import type { FWSettings, FeatureId } from '../../../../src/storage/settings';
import { __flushHiddenCountForTest } from '../../../../src/content/engagement/mark-hidden';

function settingsWith(...on: FeatureId[]): FWSettings {
  const features = adultPreset();
  for (const id of on) features[id] = { enabled: true };
  return { features, uiLanguage: 'en' } as unknown as FWSettings;
}

const MASTHEAD = `
<ytd-masthead id="masthead"><div id="center"><ytd-searchbox id="search">
  <form id="search-form"><input name="search_query" placeholder="Search"></form>
</ytd-searchbox></div></ytd-masthead>`;

const GUIDE = `
<tp-yt-app-drawer id="guide"><ytd-guide-renderer id="guide-renderer"><div id="sections">
  <ytd-guide-section-renderer><div id="items">
    <ytd-guide-entry-renderer><a id="endpoint" href="/">Home</a></ytd-guide-entry-renderer>
    <ytd-guide-entry-renderer><a id="endpoint" href="/feed/subscriptions">Subscriptions</a></ytd-guide-entry-renderer>
    <ytd-guide-entry-renderer><a id="endpoint" href="/feed/you">You</a></ytd-guide-entry-renderer>
  </div></ytd-guide-section-renderer>
</div></ytd-guide-renderer></tp-yt-app-drawer>`;

const TILE = (n: number) => `
<ytd-rich-item-renderer><div id="content"><yt-lockup-view-model>
  <a href="/watch?v=tile${n}">thumbnail</a><h3><a href="/watch?v=tile${n}">Tile ${n}</a></h3>
</yt-lockup-view-model></div></ytd-rich-item-renderer>`;

const HOME = `
<ytd-app>${MASTHEAD}${GUIDE}
<div id="content"><ytd-page-manager id="page-manager">
  <ytd-browse page-subtype="home"><ytd-two-column-browse-results-renderer page-subtype="home">
    <div id="primary"><ytd-rich-grid-renderer>
      <div id="header"><ytd-feed-filter-chip-bar-renderer><yt-chip-cloud-chip-renderer>All</yt-chip-cloud-chip-renderer></ytd-feed-filter-chip-bar-renderer></div>
      <div id="contents">${TILE(1)}${TILE(2)}${TILE(3)}
        <ytd-rich-section-renderer><div id="content"><ytd-rich-shelf-renderer is-shorts>
          <a href="/shorts/s1">short</a><a href="/shorts/s2">short</a><a href="/shorts/s3">short</a>
        </ytd-rich-shelf-renderer></div></ytd-rich-section-renderer>
        ${TILE(4)}
      </div>
    </ytd-rich-grid-renderer></div>
    <div id="secondary"></div>
  </ytd-two-column-browse-results-renderer></ytd-browse>
  <ytd-browse page-subtype="subscriptions"><ytd-two-column-browse-results-renderer page-subtype="subscriptions">
    <div id="primary"><ytd-rich-grid-renderer id="subs-grid"><div id="contents">${TILE(9)}</div></ytd-rich-grid-renderer></div>
  </ytd-two-column-browse-results-renderer></ytd-browse>
</ytd-page-manager></div></ytd-app>`;

const RECS = `<ytd-watch-next-secondary-results-renderer><div id="items">
  <ytd-item-section-renderer section-identifier="sid-wn-chips"><div id="contents">
    <yt-lockup-view-model><a href="/watch?v=rec1">Rec 1</a></yt-lockup-view-model>
    <yt-lockup-view-model><a href="/watch?v=rec2">Rec 2</a></yt-lockup-view-model>
  </div></ytd-item-section-renderer>
</div></ytd-watch-next-secondary-results-renderer>`;

const PLAYER = `
<div id="movie_player" class="html5-video-player">
  <div class="html5-video-container"><video class="video-stream html5-main-video"></video></div>
  <div class="ytp-chrome-bottom"><button class="ytp-play-button">Play</button>
    <div class="ytp-autonav-toggle"><div class="ytp-autonav-toggle-button" aria-checked="true"></div></div></div>
  <div class="ytp-ce-element ytp-ce-video"><a href="/watch?v=card1">Card</a></div>
  <div class="ytp-endscreen-content"><a class="ytp-videowall-still" href="/watch?v=wall1">Wall</a></div>
  <div class="ytp-autonav-endscreen-countdown-overlay"><div class="ytp-autonav-endscreen-upnext-container">Up next</div></div>
  <div class="ytp-fullscreen-grid"><div class="ytp-fullscreen-grid-stills-container"><a href="/watch?v=fs1">Still</a></div></div>
</div>`;

const WATCH = (recsUnder = false) => `
<ytd-app>${MASTHEAD}${GUIDE}
<div id="content"><ytd-page-manager id="page-manager"><ytd-watch-flexy>
  <div id="columns">
    <div id="primary"><div id="primary-inner">
      <div id="player"><ytd-player id="ytd-player"><div id="container">${PLAYER}</div></ytd-player></div>
      <div id="below">
        <ytd-watch-metadata><div id="title"><h1><yt-formatted-string>Video title</yt-formatted-string></h1></div>
          <div id="description"><ytd-text-inline-expander>Description</ytd-text-inline-expander></div></ytd-watch-metadata>
        ${recsUnder ? `<div id="related">${RECS}</div>` : ''}
        <ytd-comments id="comments"><ytd-item-section-renderer id="sections" section-identifier="comment-item-section">
          <ytd-comment-thread-renderer>A comment</ytd-comment-thread-renderer>
        </ytd-item-section-renderer></ytd-comments>
      </div>
    </div></div>
    <div id="secondary"><div id="secondary-inner">
      <div id="panels"><ytd-engagement-panel-section-list-renderer target-id="engagement-panel-transcript">Transcript</ytd-engagement-panel-section-list-renderer></div>
      <ytd-playlist-panel-renderer id="playlist"><div id="items"><a href="/watch?v=mine1&list=PLmine">My list</a></div></ytd-playlist-panel-renderer>
      ${recsUnder ? '' : `<div id="related">${RECS}</div>`}
    </div></div>
  </div>
</ytd-watch-flexy></ytd-page-manager></div></ytd-app>`;

const hiddenBy = (el: Element | null): boolean => {
  if (!el) throw new Error('missing element');
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    if (getComputedStyle(cur).display === 'none') return true;
  }
  return false;
};
const q = (sel: string): Element | null => document.querySelector(sel);

let stop: (() => void) | null = null;
function start(...on: FeatureId[]): void { stop = startYouTubeFeeds(settingsWith(...on)); }
const navigate = (path: string): void => {
  window.history.pushState({}, '', path);
  document.dispatchEvent(new Event('yt-navigate-finish'));
};

beforeEach(() => {
  // The hide tally is batched across calls; write out what earlier tests left before counting afresh.
  __flushHiddenCountForTest();
  counted.length = 0;
  document.body.innerHTML = '';
  window.history.pushState({}, '', '/');
});
afterEach(() => {
  stop?.();
  stop = null;
  resetYouTubeFeedsDOM();
});

describe('youtube-feeds: the home feed switch', () => {
  it('hides the grid on the home page with its chips and its Shorts shelf, and nothing else', () => {
    document.body.innerHTML = HOME;
    start('hide-home-feed');
    expect(document.documentElement.getAttribute(YT_HOME_ATTR)).toBe('on');
    expect(document.getElementById(YT_FEEDS_STYLE_ID)).not.toBeNull();
    expect(hiddenBy(q('ytd-browse[page-subtype="home"] ytd-rich-grid-renderer'))).toBe(true);
    expect(hiddenBy(q('ytd-feed-filter-chip-bar-renderer'))).toBe(true);
    expect(hiddenBy(q('ytd-rich-shelf-renderer'))).toBe(true);
    // What stays: the search box, the guide with Subscriptions and You, and the subscriptions page's own grid.
    expect(hiddenBy(q('input[name="search_query"]'))).toBe(false);
    expect(hiddenBy(q('ytd-guide-renderer'))).toBe(false);
    expect(hiddenBy(q('a[href="/feed/subscriptions"]'))).toBe(false);
    expect(hiddenBy(q('#subs-grid'))).toBe(false);
    expect(hiddenBy(q('ytd-browse[page-subtype="home"] #primary'))).toBe(false);
  });

  it('says in the empty space that Off hid it, and one click shows it for this visit only', () => {
    document.body.innerHTML = HOME;
    start('hide-home-feed');
    const note = q(`[${YT_HOME_NOTE_ATTR}]`) as HTMLElement;
    expect(note).not.toBeNull();
    expect(note.closest('ytd-browse[page-subtype="home"] #primary')).not.toBeNull();
    expect(note.textContent).toContain('Off is hiding your YouTube home feed');
    const show = note.querySelector('button') as HTMLButtonElement;
    expect(show.textContent).toBe('Show it this time');
    show.click();
    expect(document.documentElement.hasAttribute(YT_HOME_SHOWN_ATTR)).toBe(true);
    expect(hiddenBy(q('ytd-browse[page-subtype="home"] ytd-rich-grid-renderer'))).toBe(false);
    expect(q(`[${YT_HOME_NOTE_ATTR}]`)).toBeNull();
    // The next page YouTube navigates to ends the visit: home is hidden again when the person comes back.
    navigate('/watch?v=x');
    navigate('/');
    expect(document.documentElement.hasAttribute(YT_HOME_SHOWN_ATTR)).toBe(false);
    expect(hiddenBy(q('ytd-browse[page-subtype="home"] ytd-rich-grid-renderer'))).toBe(true);
    expect(q(`[${YT_HOME_NOTE_ATTR}]`)).not.toBeNull();
  });

  it('puts the note only on the home page, and takes it away on another page', () => {
    document.body.innerHTML = HOME;
    window.history.pushState({}, '', '/feed/subscriptions');
    start('hide-home-feed');
    expect(q(`[${YT_HOME_NOTE_ATTR}]`)).toBeNull();
    navigate('/');
    expect(q(`[${YT_HOME_NOTE_ATTR}]`)).not.toBeNull();
    navigate('/results?search_query=x');
    expect(q(`[${YT_HOME_NOTE_ATTR}]`)).toBeNull();
  });

  it('writes the note once, however often the route is read', () => {
    document.body.innerHTML = HOME;
    start('hide-home-feed');
    navigate('/');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(document.querySelectorAll(`[${YT_HOME_NOTE_ATTR}]`).length).toBe(1);
  });
});

describe('youtube-feeds: the recommended videos switch', () => {
  it('hides the column beside the video, the end screen, the end cards and the Up next countdown', () => {
    document.body.innerHTML = WATCH();
    window.history.pushState({}, '', '/watch?v=abc');
    start('hide-recommended-videos');
    expect(document.documentElement.getAttribute(YT_RECS_ATTR)).toBe('on');
    expect(hiddenBy(q('ytd-watch-next-secondary-results-renderer'))).toBe(true);
    expect(hiddenBy(q('.ytp-endscreen-content'))).toBe(true);
    expect(hiddenBy(q('.ytp-ce-element'))).toBe(true);
    expect(hiddenBy(q('.ytp-autonav-endscreen-countdown-overlay'))).toBe(true);
    expect(hiddenBy(q('.ytp-fullscreen-grid-stills-container'))).toBe(true);
  });

  it('leaves the video, the player controls, the title, the description, the comments and the person\'s own playlist', () => {
    document.body.innerHTML = WATCH();
    window.history.pushState({}, '', '/watch?v=abc');
    start('hide-recommended-videos');
    for (const sel of ['video', '#movie_player', '.ytp-play-button', '.ytp-autonav-toggle-button', 'ytd-watch-metadata h1',
      '#description', 'ytd-comments#comments', 'ytd-comment-thread-renderer', 'ytd-playlist-panel-renderer',
      'ytd-engagement-panel-section-list-renderer', '#secondary', 'input[name="search_query"]']) {
      expect(hiddenBy(q(sel)), sel).toBe(false);
    }
  });

  it('hides the list where a narrow window moves it, under the video', () => {
    document.body.innerHTML = WATCH(true);
    window.history.pushState({}, '', '/watch?v=abc');
    start('hide-recommended-videos');
    expect(q('#below ytd-watch-next-secondary-results-renderer')).not.toBeNull();
    expect(hiddenBy(q('#below ytd-watch-next-secondary-results-renderer'))).toBe(true);
    expect(hiddenBy(q('ytd-comments#comments'))).toBe(false);
  });

  it('does not touch the home page, and the home switch does not touch the watch page', () => {
    document.body.innerHTML = HOME;
    start('hide-recommended-videos');
    expect(hiddenBy(q('ytd-browse[page-subtype="home"] ytd-rich-grid-renderer'))).toBe(false);
    expect(q(`[${YT_HOME_NOTE_ATTR}]`)).toBeNull();
    stop?.();
    document.body.innerHTML = WATCH();
    window.history.pushState({}, '', '/watch?v=abc');
    stop = startYouTubeFeeds(settingsWith('hide-home-feed'));
    expect(hiddenBy(q('ytd-watch-next-secondary-results-renderer'))).toBe(false);
    expect(hiddenBy(q('.ytp-endscreen-content'))).toBe(false);
  });
});

describe('youtube-feeds: off, stop, and the inverted guard', () => {
  it('does nothing when both switches are off', () => {
    document.body.innerHTML = HOME;
    start();
    expect(document.documentElement.hasAttribute(YT_HOME_ATTR)).toBe(false);
    expect(document.documentElement.hasAttribute(YT_RECS_ATTR)).toBe(false);
    expect(document.getElementById(YT_FEEDS_STYLE_ID)).toBeNull();
    expect(q(`[${YT_HOME_NOTE_ATTR}]`)).toBeNull();
  });

  it('stop takes the attributes, the stylesheet and the note away, and the route listeners with them', () => {
    document.body.innerHTML = HOME;
    start('hide-home-feed', 'hide-recommended-videos');
    stop?.();
    stop = null;
    expect(document.documentElement.hasAttribute(YT_HOME_ATTR)).toBe(false);
    expect(document.documentElement.hasAttribute(YT_RECS_ATTR)).toBe(false);
    expect(document.getElementById(YT_FEEDS_STYLE_ID)).toBeNull();
    expect(q(`[${YT_HOME_NOTE_ATTR}]`)).toBeNull();
    expect(hiddenBy(q('ytd-browse[page-subtype="home"] ytd-rich-grid-renderer'))).toBe(false);
    navigate('/');
    expect(q(`[${YT_HOME_NOTE_ATTR}]`)).toBeNull();
  });

  it('tallies one hide per home visit and one per video watched, for the popup\'s count', () => {
    document.body.innerHTML = HOME;
    start('hide-home-feed', 'hide-recommended-videos');
    navigate('/watch?v=a');
    navigate('/watch?v=a');
    navigate('/watch?v=b');
    navigate('/');
    __flushHiddenCountForTest();
    const total = (id: string) => counted.reduce((n, c) => n + (c[id] ?? 0), 0);
    expect(total('hide-home-feed')).toBe(2);
    expect(total('hide-recommended-videos')).toBe(2);
  });

  it('holds the note by reference: the route tick never searches the whole page for it', () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = HOME;
      start('hide-home-feed', 'hide-recommended-videos');
      navigate('/watch?v=a');
      const all = vi.spyOn(document, 'querySelectorAll');
      vi.advanceTimersByTime(10_000);
      expect(all).not.toHaveBeenCalled();
      all.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it('names only YouTube\'s own feed components, never a page column or a container of the page', () => {
    const ALL = [...HOME_FEED_SELECTORS, ...RECOMMENDED_SELECTORS];
    expect(YOUTUBE_FEED_FEATURES).toEqual(['hide-home-feed', 'hide-recommended-videos']);
    for (const sel of ALL) {
      // The last compound of each selector is the box that is hidden.
      const target = sel.trim().split(/\s+/).pop() as string;
      expect(target, sel).not.toMatch(/^(html|body|main|ytd-app|ytd-page-manager|ytd-browse|ytd-watch-flexy|#primary|#secondary|#columns|#below|#related|#content|#movie_player|video)\b/);
    }
    // The player has no element names inside it, so its parts are the only class names, each scoped to the player.
    for (const sel of ALL.filter(s => s.includes('.'))) expect(sel, sel).toMatch(/^#movie_player \.ytp-/);
  });
});
