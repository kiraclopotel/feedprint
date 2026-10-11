// @vitest-environment jsdom
//
// The surface switches (engagement/surface-switches.ts): every box is found
// from an anchor the platform cannot drop and computed by relationship, never
// by class; a box that would take the feed, two posts or a place to type is
// refused; a page rule hides the main column on its route and frees it after;
// stop restores everything. The fixtures carry the shapes read live on
// 2026-09-03 (STRUCTURE-MAP.md), with every class name left out on purpose.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const counted: Array<{ n: number; byFeature: Record<string, number> }> = [];
vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return {
    ...actual,
    incrementMetricsHidden: vi.fn(async (n: number, byFeature: Record<string, number>) => { counted.push({ n, byFeature }); }),
  };
});

import {
  SURFACE_HIDDEN_MARKER, applyPageRules, resetSurfaceDOM, scanSurfaces, startSurfaceSwitches, surfaceRulesFor,
} from '../../../../src/content/engagement/surface-switches';
import { __flushHiddenCountForTest } from '../../../../src/content/engagement/mark-hidden';
import { adultPreset } from '../../../../src/storage/presets';
import type { FWSettings, FeatureId } from '../../../../src/storage/settings';
import type { Platform } from '../../../../src/types/post';

function settingsWith(...on: FeatureId[]): FWSettings {
  const features = adultPreset();
  for (const id of on) features[id] = { enabled: true };
  return { features } as unknown as FWSettings;
}

function rules(platform: Platform, ...on: FeatureId[]) {
  return surfaceRulesFor(platform, settingsWith(...on)).rules;
}

const hidden = (): string[] => Array.from(document.querySelectorAll(`[${SURFACE_HIDDEN_MARKER}]`))
  .map(el => `${el.tagName.toLowerCase()}#${el.id || '?'}=${el.getAttribute(SURFACE_HIDDEN_MARKER)}`);

beforeEach(() => {
  document.body.innerHTML = '';
  counted.length = 0;
  window.history.pushState({}, '', '/');
});
afterEach(() => { resetSurfaceDOM(); });

// ─── Instagram ───

const IG_COLUMN = `
<main role="main"><div><div id="row">
  <div id="feed"><article><a href="/p/abc/">post</a><span dir="auto">hello</span></article></div>
  <div id="column"><div><div id="stack">
    <div id="account"><a href="/me/">me</a><div role="button">Switch</div></div>
    <div id="suggested"><div><div><div><span dir="auto">Suggested for you</span></div><a href="/explore/people/"><span dir="auto">See all</span></a></div>
      <div><a href="/a/">a</a><button>Follow</button><a href="/b/">b</a><button>Follow</button></div></div></div>
    <div id="footer"><a href="/about/">About</a> <a href="/help/">Help</a></div>
  </div></div></div>
</div></div></main>`;

describe('Instagram', () => {
  it('hides the "Suggested for you" block from its See all link, and neither the account row nor the footer nor the feed', () => {
    document.body.innerHTML = IG_COLUMN;
    expect(scanSurfaces(document, rules('instagram', 'hide-suggestions'))).toBe(1);
    expect(hidden()).toEqual(['div#suggested=instagram:suggestions']);
    expect(document.getElementById('suggested')!.getAttribute('data-fw-block-reason')).toBe('hide-suggestions:suggestions');
    // Instagram keeps the box inside main (Q87): visibility, never display,
    // or the windowed feed stops loading (known-issues M135).
    const box = document.getElementById('suggested')!;
    expect(box.style.display).toBe('');
    expect(box.style.visibility).toBe('hidden');
    expect(box.getAttribute('data-fw-hide-mode')).toBe('visibility');
    resetSurfaceDOM();
    expect(box.style.visibility).toBe('');
    expect(box.hasAttribute('data-fw-hide-mode')).toBe(false);
  });

  it('refuses the suggestions block when it holds a post', () => {
    document.body.innerHTML = IG_COLUMN;
    document.getElementById('suggested')!.appendChild(document.createElement('article'));
    expect(scanSurfaces(document, rules('instagram', 'hide-suggestions'))).toBe(0);
  });

  it('hides the whole column beside the feed as the right column, never the feed', () => {
    document.body.innerHTML = IG_COLUMN;
    scanSurfaces(document, rules('instagram', 'hide-right-column'));
    expect(hidden()).toEqual(['div#column=instagram:right-column']);
  });

  const IG_TRAY = (pagelet: boolean) => `
<main role="main"><div><div id="col">
  <div id="traywrap"><div><div ${pagelet ? 'data-pagelet="story_tray"' : ''}><div><div><div><div role="presentation"><div>
    <ul>${'<li><div role="button"><button>x</button><span dir="auto">user</span></div></li>'.repeat(6)}</ul>
  </div></div><div><button aria-label="Next"></button></div></div></div></div></div></div></div>
  <div id="feed"><article>post</article><article>post</article></div>
  <div id="after"><span>more</span></div>
</div></div></main>`;

  it('hides the stories tray by its pagelet, and by the tray of buttons alone when the pagelet is gone', () => {
    document.body.innerHTML = IG_TRAY(true);
    scanSurfaces(document, rules('instagram', 'hide-stories'));
    expect(hidden()).toEqual(['div#traywrap=instagram:stories']);
    resetSurfaceDOM();
    document.body.innerHTML = IG_TRAY(false);
    scanSurfaces(document, rules('instagram', 'hide-stories'));
    expect(hidden()).toEqual(['div#traywrap=instagram:stories']);
  });

  it('takes the Reels nav entry under block-reels', () => {
    document.body.innerHTML = '<div role="navigation"><div><a href="/reels/">Reels</a></div><div><a href="/explore/">Explore</a></div></div>';
    scanSurfaces(document, rules('instagram', 'block-reels'));
    expect(document.querySelector('a[href="/reels/"]')!.parentElement!.getAttribute(SURFACE_HIDDEN_MARKER)).toBe('instagram:reels-nav');
    expect(document.querySelector('a[href="/explore/"]')!.parentElement!.hasAttribute(SURFACE_HIDDEN_MARKER)).toBe(false);
  });
});

// ─── Facebook ───

describe('Facebook', () => {
  it('hides the Stories region from its /stories/ links, not a region with one story shared in it', () => {
    document.body.innerHTML = `<div role="main">
      <div id="stories" role="region" aria-label="Stories"><div role="grid"><a href="/stories/1/">a</a><a href="/stories/2/">b</a><a href="/stories/3/">c</a></div></div>
      <div id="one" role="region" aria-label="Something"><a href="/stories/9/">one</a></div></div>`;
    scanSurfaces(document, rules('facebook', 'hide-stories'));
    expect(hidden()).toEqual(['div#stories=facebook:stories']);
  });

  it('hides the Reels tray unit (three or more reel links) under block-reels, not a post that shares one reel', () => {
    document.body.innerHTML = `<div role="main">
      <div id="tray" aria-posinset="7"><h3>Reels</h3>${'<a href="/reel/123/">r</a>'.repeat(6)}</div>
      <div id="post" aria-posinset="8"><div role="article"><a href="/reel/555/">a reel</a></div></div></div>`;
    scanSurfaces(document, rules('facebook', 'block-reels'));
    expect(hidden()).toEqual(['div#tray=facebook:reels-tray']);
  });

  const FB_NAV = `<div role="navigation" aria-label="Facebook"><ul>
      <li id="home"><a href="/">Home</a></li><li id="reels"><a href="/reel/">Reels</a></li>
      <li id="mk"><a href="/marketplace/">Marketplace</a></li><li id="groups"><a href="/groups/">Groups</a></li></ul></div>
    <div role="navigation" aria-label="Shortcuts"><ul><li id="mygroup"><a href="/groups/190000000000052/">My group</a></li></ul></div>
    <div role="main"><a id="inpost" href="/marketplace/item/1/">an item in a post</a></div>`;

  it('takes the Marketplace, Groups and Reels nav entries by their routes, never a group or an item link in a post', () => {
    document.body.innerHTML = FB_NAV;
    scanSurfaces(document, rules('facebook', 'hide-marketplace', 'hide-groups', 'block-reels'));
    expect(hidden().sort()).toEqual(['li#groups=facebook:groups', 'li#mk=facebook:marketplace', 'li#reels=facebook:reels-nav']);
  });

  it('hides the right column, but not one that holds a place to type', () => {
    document.body.innerHTML = '<div id="col" role="complementary"><h3>Sponsored</h3><h3>Contacts</h3></div>';
    scanSurfaces(document, rules('facebook', 'hide-right-column'));
    expect(hidden()).toEqual(['div#col=facebook:right-column']);
    resetSurfaceDOM();
    document.body.innerHTML = '<div id="col" role="complementary"><div contenteditable="true"></div></div>';
    expect(scanSurfaces(document, rules('facebook', 'hide-right-column'))).toBe(0);
  });

  it('hides the People you may know unit from its See all link', () => {
    document.body.innerHTML = `<div role="main"><div id="pymk" aria-posinset="2"><h3>People you may know</h3>
      <a href="/x/">x</a><div role="button">Add friend</a><a href="/friends/suggestions/">See all</a></div>
      <div id="post" aria-posinset="3"><div role="article">text</div></div></div>`;
    scanSurfaces(document, rules('facebook', 'hide-suggestions'));
    expect(hidden()).toEqual(['div#pymk=facebook:suggestions']);
  });

  it('blanks the Marketplace page on its route and frees it when the route changes', () => {
    document.body.innerHTML = '<div id="main" role="main">page</div>';
    const { pages } = surfaceRulesFor('facebook', settingsWith('hide-marketplace', 'hide-groups'));
    window.history.pushState({}, '', '/marketplace/category/vehicles');
    applyPageRules(pages);
    expect(hidden()).toEqual(['div#main=facebook:marketplace-page']);
    window.history.pushState({}, '', '/groups/190000000000052/');
    applyPageRules(pages);
    expect(hidden()).toEqual([]);
    window.history.pushState({}, '', '/groups/feed/');
    applyPageRules(pages);
    expect(hidden()).toEqual(['div#main=facebook:groups-page']);
  });
});

// ─── X ───

describe('X', () => {
  const X_SIDEBAR = `<div data-testid="sidebarColumn"><div><div><div id="stack">
      <div id="search"><form><input placeholder="Search"></form></div>
      <div id="premium"><h2>Subscribe to Premium</h2><a href="/i/premium">go</a></div>
      <div id="wtf"><h2>Who to follow</h2><div data-testid="UserCell"><button data-testid="1-follow">Follow</button></div><div data-testid="UserCell"><button data-testid="2-follow">Follow</button></div></div>
    </div></div></div></div>`;

  it('hides every sidebar module but the search box as the right column', () => {
    document.body.innerHTML = X_SIDEBAR;
    scanSurfaces(document, rules('twitter', 'hide-right-column'));
    expect(hidden().sort()).toEqual(['div#premium=twitter:right-column', 'div#wtf=twitter:right-column']);
  });

  it('hides the Who to follow module by its follow buttons, and a timeline cell of user cells, never a post', () => {
    document.body.innerHTML = X_SIDEBAR + `<div id="cell" data-testid="cellInnerDiv"><div data-testid="UserCell"><button data-testid="3-follow">Follow</button></div></div>
      <div id="tweetcell" data-testid="cellInnerDiv"><article data-testid="tweet"><button data-testid="4-follow">Follow</button></article></div>`;
    scanSurfaces(document, rules('twitter', 'hide-suggestions'));
    expect(hidden().sort()).toEqual(['div#cell=twitter:suggestions', 'div#wtf=twitter:suggestions']);
  });
});

// ─── YouTube ───

describe('YouTube', () => {
  const tile = (href: string) => `<ytd-rich-item-renderer><a href="${href}">v</a></ytd-rich-item-renderer>`;
  it('hides the Shorts shelf (every tile a Short), the guide entry and the lone Shorts tiles of a grid, never the videos', () => {
    document.body.innerHTML = `<ytd-rich-grid-renderer>
        <ytd-rich-section-renderer id="shelf"><ytd-rich-shelf-renderer><div>${tile('/shorts/a')}${tile('/shorts/b')}${tile('/shorts/c')}</div></ytd-rich-shelf-renderer></ytd-rich-section-renderer>
        <div id="grid">${tile('/watch?v=1')}${tile('/watch?v=2')}${tile('/shorts/d')}${tile('/shorts/e')}${tile('/shorts/f')}</div>
      </ytd-rich-grid-renderer>
      <ytd-guide-entry-renderer id="guide"><a href="/shorts/">Shorts</a></ytd-guide-entry-renderer>`;
    scanSurfaces(document, rules('youtube', 'block-reels'));
    // The shelf's own tiles go with it and are not hidden twice; the grid's three Shorts tiles are hidden one by one.
    expect(hidden().sort()).toEqual([
      'ytd-guide-entry-renderer#guide=youtube:shorts-nav',
      'ytd-rich-item-renderer#?=youtube:shorts-tile',
      'ytd-rich-item-renderer#?=youtube:shorts-tile',
      'ytd-rich-item-renderer#?=youtube:shorts-tile',
      'ytd-rich-section-renderer#shelf=youtube:shorts-shelf',
    ]);
  });

  // The search results page as read live on 2026-09-26: Shorts in a shelf among ordinary results.
  const video = (id: string, href: string) => `<ytd-video-renderer id="${id}"><a href="${href}">t</a><div><a href="${href}">title</a></div></ytd-video-renderer>`;
  const results = (items: string) => `<ytd-app id="app"><ytd-search><ytd-two-column-search-results-renderer><div id="primary"><ytd-section-list-renderer><ytd-item-section-renderer><div id="contents">${items}</div></ytd-item-section-renderer></ytd-section-list-renderer></div></ytd-two-column-search-results-renderer></ytd-search></ytd-app>`;

  it('hides a Shorts shelf in search results and none of the ordinary results', () => {
    const shelf = `<grid-shelf-view-model id="shelf"><div>${['a', 'b', 'c', 'd'].map(x => `<ytm-shorts-lockup-view-model><a href="/shorts/${x}">s</a></ytm-shorts-lockup-view-model>`).join('')}</div></grid-shelf-view-model>`;
    document.body.innerHTML = results(video('v1', '/watch?v=1') + shelf + video('v2', '/watch?v=2'));
    scanSurfaces(document, rules('youtube', 'block-reels'));
    expect(hidden()).toEqual(['grid-shelf-view-model#shelf=youtube:shorts-shelf']);
  });

  // A single Short among ordinary videos (11 Oct 2026, the night walk): Off's "Block Reels and Shorts" was on and a
  // watch page still listed four Shorts tiles, each leading to a page that says "Off blocks Shorts on this page."
  // The shelf rule rightly refuses a box holding ordinary videos, so a Short that sits alone is hidden by its own
  // tile: never the page, never the videos around it.
  it('hides the tile of each single Short among ordinary results, and nothing around it', () => {
    document.body.innerHTML = results(video('v1', '/watch?v=1') + video('s1', '/shorts/aaa') + video('v2', '/watch?v=2') + video('s2', '/shorts/bbb'));
    scanSurfaces(document, rules('youtube', 'block-reels'));
    expect(hidden().sort()).toEqual(['ytd-video-renderer#s1=youtube:shorts-tile', 'ytd-video-renderer#s2=youtube:shorts-tile']);
  });

  // The watch page's recommendations: the new lockup tile, and the older compact tile.
  const lockup = (id: string, href: string) => `<yt-lockup-view-model id="${id}"><a href="${href}">thumb</a><h3><a href="${href}">title</a></h3></yt-lockup-view-model>`;
  const watchPage = (items: string) => `<ytd-app><ytd-watch-flexy><div id="secondary"><ytd-watch-next-secondary-results-renderer><div id="items">${items}</div></ytd-watch-next-secondary-results-renderer></div></ytd-watch-flexy></ytd-app>`;

  it('hides a Shorts tile in a watch page\'s recommendations, in either tile layout', () => {
    const compact = (id: string, href: string) => `<ytd-compact-video-renderer id="${id}"><a href="${href}">t</a></ytd-compact-video-renderer>`;
    document.body.innerHTML = watchPage(lockup('v1', '/watch?v=1') + lockup('s1', '/shorts/aaa') + compact('v2', '/watch?v=2') + compact('s2', '/shorts/bbb'));
    scanSurfaces(document, rules('youtube', 'block-reels'));
    expect(hidden().sort()).toEqual(['yt-lockup-view-model#s1=youtube:shorts-tile', 'ytd-compact-video-renderer#s2=youtube:shorts-tile']);
  });

  it('hides the outer tile, not the inner box, when a Short sits in a lockup inside a grid item', () => {
    const inner = `<ytm-shorts-lockup-view-model><a href="/shorts/aaa">s</a></ytm-shorts-lockup-view-model>`;
    document.body.innerHTML = `<ytd-rich-grid-renderer><div id="grid"><ytd-rich-item-renderer id="short">${inner}</ytd-rich-item-renderer><ytd-rich-item-renderer id="video"><a href="/watch?v=1">v</a></ytd-rich-item-renderer></div></ytd-rich-grid-renderer>`;
    scanSurfaces(document, rules('youtube', 'block-reels'));
    expect(hidden()).toEqual(['ytd-rich-item-renderer#short=youtube:shorts-tile']);
  });

  it('leaves a tile that holds a watch link, and a Shorts link that sits in no tile', () => {
    document.body.innerHTML = watchPage(
      `<yt-lockup-view-model id="both"><a href="/watch?v=1">v</a><a href="/shorts/aaa">a short by the same channel</a></yt-lockup-view-model>`
      + `<ytd-comment-view-model id="comment"><a href="/shorts/bbb">my short</a></ytd-comment-view-model>`
      + `<p id="description">see <a href="/shorts/ccc">this</a></p>`,
    );
    scanSurfaces(document, rules('youtube', 'block-reels'));
    expect(hidden()).toEqual([]);
  });

  it('leaves a tile that lists more than one Short to the shelf rule', () => {
    document.body.innerHTML = watchPage(`<yt-lockup-view-model id="two"><a href="/shorts/aaa">a</a><a href="/shorts/bbb">b</a></yt-lockup-view-model>` + lockup('v1', '/watch?v=1'));
    scanSurfaces(document, rules('youtube', 'block-reels'));
    expect(hidden()).toEqual([]);
  });
});

// ─── The runner ───

describe('startSurfaceSwitches', () => {
  it('is a no-op with every switch off, hides on start, follows inserted subtrees, tallies under the switch, and restores on stop', async () => {
    document.body.innerHTML = '<div role="main"><div id="a" role="complementary">x</div></div>';
    expect(startSurfaceSwitches('facebook', settingsWith())).toBeTypeOf('function');
    expect(hidden()).toEqual([]);
    // Earlier tests' hides are still pending in the shared one-second batch.
    __flushHiddenCountForTest();
    counted.length = 0;
    const stop = startSurfaceSwitches('facebook', settingsWith('hide-right-column'));
    expect(hidden()).toEqual(['div#a=facebook:right-column']);
    const late = document.createElement('div');
    late.innerHTML = '<div id="b" role="complementary">y</div>';
    document.body.appendChild(late);
    await new Promise(r => setTimeout(r, 0));
    expect(hidden().sort()).toEqual(['div#a=facebook:right-column', 'div#b=facebook:right-column']);
    __flushHiddenCountForTest();
    expect(counted.at(-1)?.byFeature['hide-right-column']).toBe(2);
    stop();
    expect(hidden()).toEqual([]);
    expect(document.getElementById('a')!.style.display).toBe('');
  });
});
