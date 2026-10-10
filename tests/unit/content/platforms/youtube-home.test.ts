// @vitest-environment jsdom
//
// YouTube's Home, Subscriptions, Trending and Explore grids as records (PLAN-2026-09-17 item 6,
// src/content/platforms/youtube.ts). Until 2026-09-17 the recorder read YouTube's community
// posts and the /watch page only; the home feed, the surface a person is served most, left no
// record. Two-sided, as every new selector must be (.claude/rules/platforms.md):
//   matches: the newer lockup tile (h3 title, metadata rows), the older grid-media tile
//            (#video-title, ytd-channel-name), an ad tile (is_sponsored), a title still hydrating
//            (read from the h3's title attribute);
//   must not: a Shorts tile, a shelf, a tile with no watch link, and any tile on a channel's
//            own video grid, which is sought and not served.
// Then the bound: at most HOME_TILES_PER_PAGE records per page life, and the wire fills the
// channel the DOM could not read.
import { beforeEach, describe, expect, it } from 'vitest';

import {
  HOME_TILES_PER_PAGE,
  YoutubeAdapter,
  extractYoutubeHomeTile,
  watchVideoIdFromHref,
} from '../../../../src/content/platforms/youtube';
import { receiveWirePayload } from '../../../../src/content/page-world/relay';
import { clearWireStore, enrichPostFromWire } from '../../../../src/content/page-world/wire-store';
import browseHome from '../../../fixtures/wire/youtube/browse-home.json';

function setPath(path: string): void {
  window.history.replaceState({}, '', path);
}

/** The lockup layout read live on 2026-09-17: the title on an h3, the channel in the first metadata row. */
function lockupTile(videoId: string, opts: { title?: string; titleAttrOnly?: boolean; channel?: string; ad?: boolean } = {}): HTMLElement {
  const tile = document.createElement('ytd-rich-item-renderer');
  const title = opts.title ?? `Lockup title for ${videoId}`;
  tile.innerHTML = `
    <div id="content">
      ${opts.ad ? '<ytd-ad-slot-renderer></ytd-ad-slot-renderer>' : ''}
      <yt-lockup-view-model>
        <a href="/watch?v=${videoId}" class="ytLockupViewModelContentImage"><yt-thumbnail-view-model><img></yt-thumbnail-view-model></a>
        <div class="ytLockupViewModelMetadata">
          <yt-lockup-metadata-view-model>
            <h3 title="${title}" aria-label="${title}">${opts.titleAttrOnly ? '' : title}</h3>
            <yt-content-metadata-view-model><span>${opts.channel ?? 'Lockup Channel'}</span><span>1.2M views</span></yt-content-metadata-view-model>
          </yt-lockup-metadata-view-model>
        </div>
      </yt-lockup-view-model>
    </div>`;
  return tile;
}

/** The older grid-media layout the filters were written against. */
function gridMediaTile(videoId: string): HTMLElement {
  const tile = document.createElement('ytd-rich-item-renderer');
  tile.innerHTML = `
    <div id="content"><ytd-rich-grid-media>
      <a id="thumbnail" href="/watch?v=${videoId}"></a>
      <div id="details">
        <a id="video-title-link" href="/watch?v=${videoId}"><yt-formatted-string id="video-title">Grid media title ${videoId}</yt-formatted-string></a>
        <ytd-channel-name><div id="container"><a href="/@gridchannel">Grid Channel</a></div></ytd-channel-name>
      </div>
    </ytd-rich-grid-media></div>`;
  return tile;
}

function shortsTile(): HTMLElement {
  const tile = document.createElement('ytd-rich-item-renderer');
  tile.innerHTML = `<div id="content"><ytm-shorts-lockup-view-model><a href="/shorts/abcdefghijk"><h3>A short</h3></a></ytm-shorts-lockup-view-model></div>`;
  return tile;
}

function shelfTile(): HTMLElement {
  const tile = document.createElement('ytd-rich-item-renderer');
  tile.innerHTML = `<div id="content"><ytd-rich-shelf-renderer><h2>Shorts</h2><a href="/watch?v=inShelf12345"><h3>Inside a shelf</h3></a></ytd-rich-shelf-renderer></div>`;
  return tile;
}

function linklessTile(): HTMLElement {
  const tile = document.createElement('ytd-rich-item-renderer');
  tile.innerHTML = `<div id="content"><yt-lockup-view-model><h3 title="No link yet">No link yet</h3></yt-lockup-view-model></div>`;
  return tile;
}

/** A Mix/playlist lockup tile: a watch link and a title, but no channel anywhere (a Mix has
 * none) — its own metadata-view-model's first row is the contributing artists/songs instead,
 * read live 2026-09-27 from a recorded export: a Mix tile's export showed "Sidewalks and Skeletons, Alan Walker, Egzod, and more" as the author. */
function mixTile(videoId: string, contributors: string): HTMLElement {
  const tile = document.createElement('ytd-rich-item-renderer');
  tile.innerHTML = `
    <div id="content">
      <yt-lockup-view-model>
        <a href="/watch?v=${videoId}" class="ytLockupViewModelContentImage"><yt-thumbnail-view-model><img></yt-thumbnail-view-model></a>
        <div class="ytLockupViewModelMetadata">
          <yt-lockup-metadata-view-model>
            <h3 title="Mix" aria-label="Mix">Mix</h3>
            <yt-content-metadata-view-model><span>${contributors}</span></yt-content-metadata-view-model>
          </yt-lockup-metadata-view-model>
        </div>
      </yt-lockup-view-model>
    </div>`;
  return tile;
}

function grid(...tiles: HTMLElement[]): HTMLElement {
  const g = document.createElement('div');
  for (const t of tiles) g.appendChild(t);
  document.body.appendChild(g);
  return g;
}

beforeEach(() => {
  document.body.innerHTML = '';
  clearWireStore();
  setPath('/');
});

describe('watchVideoIdFromHref', () => {
  it('reads a watch link and refuses everything else', () => {
    expect(watchVideoIdFromHref('/watch?v=Vid0Exampl1')).toBe('Vid0Exampl1');
    expect(watchVideoIdFromHref('https://www.youtube.com/watch?v=Vid0Exampl1&t=12s')).toBe('Vid0Exampl1');
    expect(watchVideoIdFromHref('/watch?list=PL123&v=Vid0Exampl1')).toBe('Vid0Exampl1');
    expect(watchVideoIdFromHref('/shorts/Vid0Exampl1')).toBeNull();
    expect(watchVideoIdFromHref('/@channel/videos')).toBeNull();
    expect(watchVideoIdFromHref(null)).toBeNull();
  });
});

describe('a grid tile as a record', () => {
  it('reads the lockup layout: id, title, channel, the watch link, kind video, surface youtube-home', () => {
    const post = extractYoutubeHomeTile(lockupTile('Vid0Exampl1'), 'for-you')!;
    expect(post).not.toBeNull();
    expect(post.id).toBe('yt-vid-Vid0Exampl1');
    expect(post.parentVideoId).toBe('yt-vid-Vid0Exampl1');
    expect(post.text).toBe('Lockup title for Vid0Exampl1');
    expect(post.author).toBe('Lockup Channel');
    expect(post.sourceUrl).toBe('https://www.youtube.com/watch?v=Vid0Exampl1');
    expect(post.kind).toBe('video');
    expect(post.feedSource).toBe('for-you');
    expect(post.is_sponsored).toBeUndefined();
    expect(post.platform_specific).toEqual({ platform: 'youtube', surfaceKind: 'youtube-home' });
  });

  it('reads the older grid-media layout the same way', () => {
    const post = extractYoutubeHomeTile(gridMediaTile('oldLayout01'), 'for-you')!;
    expect(post.id).toBe('yt-vid-oldLayout01');
    expect(post.text).toBe('Grid media title oldLayout01');
    expect(post.author).toBe('Grid Channel');
  });

  it('reads a title still hydrating from the h3 attribute, and marks an ad tile as paid', () => {
    const hydrating = extractYoutubeHomeTile(lockupTile('hydrating01', { titleAttrOnly: true, title: 'Attribute title' }), 'for-you')!;
    expect(hydrating.text).toBe('Attribute title');
    const ad = extractYoutubeHomeTile(lockupTile('adTile00001', { ad: true }), 'for-you')!;
    expect(ad.is_sponsored).toBe(true);
  });

  it('refuses a Shorts tile, a shelf, and a tile with no watch link', () => {
    expect(extractYoutubeHomeTile(shortsTile(), 'for-you')).toBeNull();
    expect(extractYoutubeHomeTile(shelfTile(), 'for-you')).toBeNull();
    expect(extractYoutubeHomeTile(linklessTile(), 'for-you')).toBeNull();
  });

  it('reads a Mix tile as unknown, not the metadata row\'s stray text, when no channel element exists', () => {
    const post = extractYoutubeHomeTile(mixTile('mixVid00001', 'Sidewalks and Skeletons, Alan Walker, Egzod, and more'), 'for-you')!;
    expect(post.author).toBe('unknown');
    // A real channel tile (the same lockup shape, a channel name in the same metadata row) is unaffected.
    expect(extractYoutubeHomeTile(lockupTile('realChan0001'), 'for-you')!.author).toBe('Lockup Channel');
  });
});

describe('the adapter on the grids', () => {
  it('records the home grid once per tile and leaves unreadable tiles for the next pass', () => {
    const adapter = new YoutubeAdapter();
    const g = grid(lockupTile('homeTile001'), shortsTile(), linklessTile(), gridMediaTile('homeTile002'));
    const first = adapter.extractPosts(g.childNodes);
    expect(first.map((p) => p.id).sort()).toEqual(['yt-vid-homeTile001', 'yt-vid-homeTile002']);
    // Read tiles are stamped; the unreadable ones are not, so a later pass may read them.
    expect(g.querySelectorAll('ytd-rich-item-renderer[data-fw-processed]').length).toBe(2);
    expect(adapter.extractPosts(g.childNodes)).toEqual([]);
  });

  it('reads Subscriptions and Trending as home-class surfaces, and not a channel video grid or a search', () => {
    const adapter = new YoutubeAdapter();
    for (const [path, expected] of [['/feed/subscriptions', 1], ['/feed/trending', 1], ['/@somechannel/videos', 0], ['/results?search_query=x', 0]] as const) {
      document.body.innerHTML = '';
      setPath(path);
      const g = grid(lockupTile('pathTile001'));
      expect(adapter.extractPosts(g.childNodes).length, path).toBe(expected);
    }
  });

  it('does nothing on /watch, whatever the tiles', () => {
    setPath('/watch?v=abc');
    const adapter = new YoutubeAdapter();
    const g = grid(lockupTile('watchSide01'));
    expect(adapter.extractPosts(g.childNodes)).toEqual([]);
  });

  it(`stops at ${HOME_TILES_PER_PAGE} tiles per page life and leaves the rest unstamped`, () => {
    const adapter = new YoutubeAdapter();
    const tiles = Array.from({ length: HOME_TILES_PER_PAGE + 5 }, (_, i) => lockupTile(`cap${String(i).padStart(7, '0')}`));
    const g = grid(...tiles);
    expect(adapter.extractPosts(g.childNodes).length).toBe(HOME_TILES_PER_PAGE);
    expect(g.querySelectorAll('ytd-rich-item-renderer:not([data-fw-processed])').length).toBe(5);
    expect(adapter.extractPosts(g.childNodes)).toEqual([]);
  });
});

describe('the wire fills what the tile could not read', () => {
  it('a channel the DOM did not carry comes from the browse response for the same videoId', () => {
    receiveWirePayload('youtube', 'https://www.youtube.com/youtubei/v1/browse', browseHome, { pathname: '/' });
    const tile = lockupTile('SyntheticV01', { channel: '' });
    tile.querySelector('yt-content-metadata-view-model')!.remove();
    const post = extractYoutubeHomeTile(tile, 'for-you')!;
    expect(post.author).toBe('unknown');
    const filled = enrichPostFromWire(post);
    expect(filled).toContain('author');
    expect(post.author).toBe('Synthetic Channel One');
    // The title the page showed is never replaced by the wire's, even when they differ.
    expect(post.text).toBe('Lockup title for SyntheticV01');
  });
});
