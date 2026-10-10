// FeelingWise — YouTube platform adapter.
//
// What this file does:
//   • Community posts (`ytd-backstage-post-renderer`) on channel pages.
//   • Since 2026-09-17 (PLAN-2026-09-17 item 6): the video tiles of the Home,
//     Subscriptions, Trending and Explore grids (`ytd-rich-item-renderer`), one
//     `kind:'video'` record per tile the page showed, in the exact shape the
//     /watch session record already has (yt-watch-comments.ts: id `yt-vid-<v>`,
//     text = title, author = channel, sourceUrl = the watch link), so the
//     dashboard, the wire enrichment (page-world/wire-store.ts, which files
//     what YouTube's own browse response said about the same videoId) and the
//     export need no new shape. A tile is read once (`fwProcessed`), and at
//     most HOME_TILES_PER_PAGE tiles are read per page life, counted when the
//     bound is hit: the interceptor's pending cap, its churn breaker and the
//     heap valve bound the observer, this bounds the records.
//
// What it deliberately does NOT do:
//   • Anything on /watch. The watch page's DOM is huge and the interceptor's
//     MutationObserver would otherwise walk the whole page on every mutation
//     (the 2026-06 renderer OOM); /watch is captured by yt-watch-comments.ts
//     through one scoped observer instead.
//   • Shorts shelves and Shorts tiles inside the grids: a different surface
//     (`youtube-shorts`, the video pipeline), and a tile whose link is not a
//     watch link is not a home impression.
//   • Channel video grids (`/@name/videos`): the same tile shape, but a
//     profile is sought, not served; only the surfaces the classifier calls
//     youtube-home are read (post-path/surfaces.ts).
//
// Two tile layouts exist side by side on 2026-09-17 (read live, logged out):
// the older `ytd-rich-grid-media` with `#video-title` and `ytd-channel-name`,
// and the newer `yt-lockup-view-model` whose title sits on an `h3` (as text
// or as its `title` attribute while the text hydrates) and whose channel is
// the first row of `yt-content-metadata-view-model`. Both are read; a tile the
// wire has already described fills whatever the DOM could not.

import { PostContent, FeedSource } from '../../types/post';
import { findChatOverlayAncestor, PlatformAdapter } from './adapter';
import { extractTextWithFallback, queryWithFallback } from './selector-chain';
import { classifySurface } from '../post-path/surfaces';
import { bumpCounter } from '../../diagnostics/diagnostics';

/** The grid tile every YouTube feed surface is built from. */
const YT_HOME_TILE_SELECTOR = 'ytd-rich-item-renderer';
/** Records read from the grids of one page life; past it, tiles are counted and not read. */
export const HOME_TILES_PER_PAGE = 400;
/** The ad wrappers YouTube puts inside a grid tile; the wire's isSponsored covers the rest. */
const YT_TILE_AD_SELECTOR = 'ytd-ad-slot-renderer, ytd-promoted-video-renderer, ytd-in-feed-ad-layout-renderer, ytd-display-ad-renderer';

export class YoutubeAdapter implements PlatformAdapter {
  readonly platform = 'youtube' as const;
  private _homeTilesRead = 0;
  private _homeCapNoted = false;

  detectPlatform(): boolean {
    return window.location.hostname.includes('youtube.com');
  }

  getPostSelector(): string {
    return `ytd-backstage-post-renderer, ${YT_HOME_TILE_SELECTOR}`;
  }

  extractPosts(nodes: NodeList): PostContent[] {
    // YouTube /watch extraction is OFF. The watch-page DOM is huge and the
    // interceptor's MutationObserver would otherwise spam querySelectorAll
    // over the entire page on every mutation. yt-watch-comments.ts covers it.
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/watch')) {
      return [];
    }

    const posts: PostContent[] = [];
    const feedSource = this._detectFeedSource();
    const onHome = this._isHomeSurface();

    nodes.forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      this._extractCommunityPosts(node, feedSource, posts);
      if (onHome) this._extractHomeTiles(node, feedSource, posts);
    });

    return posts;
  }

  /** Home, Subscriptions, Trending, Explore: the surfaces the classifier names youtube-home. */
  private _isHomeSurface(): boolean {
    if (typeof window === 'undefined') return false;
    return classifySurface('youtube', window.location.pathname).surface === 'youtube-home';
  }

  private _extractHomeTiles(root: HTMLElement, feedSource: FeedSource, posts: PostContent[]): void {
    for (const tile of this._collectContainers(root, YT_HOME_TILE_SELECTOR)) {
      if (tile.dataset.fwProcessed) continue;
      if (findChatOverlayAncestor(tile)) continue;
      if (this._homeTilesRead >= HOME_TILES_PER_PAGE) {
        if (!this._homeCapNoted) {
          this._homeCapNoted = true;
          bumpCounter('youtube.homeTileCapHit');
        }
        return;
      }
      const post = extractYoutubeHomeTile(tile, feedSource);
      // A tile with no watch link (a Shorts item, a shelf, a tile still hydrating) is left for the
      // next pass; only a read tile is stamped.
      if (!post) continue;
      tile.dataset.fwProcessed = 'true';
      this._homeTilesRead++;
      posts.push(post);
    }
  }

  private _extractCommunityPosts(
    root: HTMLElement,
    feedSource: FeedSource,
    posts: PostContent[],
  ): void {
    const containers = this._collectContainers(root, 'ytd-backstage-post-renderer');

    for (const container of containers) {
      // YouTube has no native DMs, but a recognized overlay must still never
      // turn a community-post-shaped subtree into public-feed input.
      if (findChatOverlayAncestor(container)) continue;
      if (container.dataset.fwProcessed) continue;

      const result = extractTextWithFallback(
        container,
        ['#content-text yt-attributed-string', '#content-text', '#content-text span'],
        20,
        'yt-community',
      );
      if (!result) {
        // Counted, not fixed (2026-09-19). Twenty is this helper's generic
        // default, taken as-is at this call site with no measurement behind it,
        // unlike every other length constant in this file. A community post
        // reading "AMA time" or "New video out now" clears no selector and the
        // post is skipped whole: not shortened, not marked, absent from the
        // record, and until now absent from every counter too.
        //
        // The floor is left alone on purpose. Choosing a number by feel at the
        // moment of noticing is how this one got here. What changes is that the
        // hole is now measurable, so the number can be chosen from what it
        // actually drops. The counter names its own surface so it can never be
        // read as a total across platforms.
        if ((container.textContent ?? '').trim().length > 0) {
          bumpCounter('shortDrop.youtube.community');
        }
        continue;
      }

      const authorEl = queryWithFallback(container, ['#author-text'], 'yt-community-author');
      const author = authorEl?.textContent?.trim() ?? 'unknown';

      const id = this._extractCommunityPostId(container);

      posts.push({
        id,
        text: result.text,
        author,
        timestamp: new Date().toISOString(),
        platform: 'youtube',
        domRef: new WeakRef(result.element),
        feedSource,
        sourceUrl: this._extractCommunityPostUrl(container),
        // Stamp kind + parentVideoId + platform_specific so the encounter
        // dispatch at encounter-builder.ts:107-113 routes through the
        // rich `assembleYouTubeEncounter` path. Pre-2026-05-24 these
        // fields were undefined → dispatch fell through to legacy + the
        // assembler was structurally unreachable for community posts
        // (audit A8-BLOCKER-2). parentVideoId aliases to id because the
        // assembler's videoId lookup reads `parentVideoId` for non-video
        // kinds — community posts have no parent video, so self-id is
        // the semantically-closest container handle.
        kind: 'post',
        parentVideoId: id,
        platform_specific: {
          platform: 'youtube',
          surfaceKind: 'youtube-community',
        },
      });
      container.dataset.fwProcessed = 'true';
    }
  }

  private _collectContainers(root: HTMLElement, selector: string): HTMLElement[] {
    const results: HTMLElement[] = [];
    if (root.matches?.(selector)) {
      results.push(root);
    }
    root.querySelectorAll<HTMLElement>(selector).forEach((el) => results.push(el));
    return results;
  }

  private _extractCommunityPostId(container: Element): string {
    const link = container.querySelector<HTMLAnchorElement>('a[href*="/post/"]');
    if (link) {
      const match = link.href.match(/\/post\/([^/?]+)/);
      if (match) return match[1];
    }
    return crypto.randomUUID();
  }

  private _extractCommunityPostUrl(container: Element): string {
    const link = container.querySelector<HTMLAnchorElement>('a[href*="/post/"]');
    return link?.href ?? '';
  }

  private _detectFeedSource(): FeedSource {
    const path = window.location.pathname;
    if (path === '/' || path === '/feed/trending') return 'for-you';
    if (path.startsWith('/results')) return 'search';
    if (path.startsWith('/@') || path.startsWith('/channel/') || path.startsWith('/c/')) return 'profile';
    if (path.startsWith('/watch')) return 'unknown';
    if (path.startsWith('/shorts/')) return 'for-you';
    return 'unknown';
  }
}

/** The video id of a watch link, or null for any other link (Shorts, playlists, channels). */
export function watchVideoIdFromHref(href: string | null | undefined): string | null {
  if (!href) return null;
  const m = /(?:^|\/)watch\?(?:[^#]*&)?v=([A-Za-z0-9_-]{6,})/.exec(href);
  return m ? m[1] : null;
}

/**
 * One grid tile as a record, or null when the tile carries no watch link (a Shorts item, a
 * shelf, a tile still hydrating) or no title. Pure and exported for the fixture test.
 */
export function extractYoutubeHomeTile(tile: HTMLElement, feedSource: FeedSource): PostContent | null {
  // Shorts tiles and shelves inside the grid are another surface.
  if (tile.querySelector('ytm-shorts-lockup-view-model, ytd-reel-shelf-renderer, ytd-rich-shelf-renderer, a[href^="/shorts/"]')) {
    return null;
  }
  let videoId: string | null = null;
  for (const a of tile.querySelectorAll<HTMLAnchorElement>('a[href*="watch?v="]')) {
    videoId = watchVideoIdFromHref(a.getAttribute('href'));
    if (videoId) break;
  }
  if (!videoId) return null;

  // The title: the older layout's #video-title, or the newer lockup's h3 (its text, or its
  // title attribute while the text is still hydrating).
  const titleEl =
    tile.querySelector<HTMLElement>('#video-title') ??
    tile.querySelector<HTMLElement>('yt-lockup-metadata-view-model h3, h3');
  const title = (titleEl?.textContent?.trim() || titleEl?.getAttribute('title')?.trim() || titleEl?.getAttribute('aria-label')?.trim() || '');
  if (title.length === 0) return null;

  // The channel: the older layout's ytd-channel-name, or a channel link, or the first metadata
  // row of the lockup (a real lockup tile names its channel there in plain text, with no link at
  // all — read live 2026-09-17, still true of the fixture below). A Mix or playlist tile has no
  // single channel, so that same row instead holds its contributing artists/songs, comma-
  // separated (his own report, RECORD-VIEW-BRIEF-2026-09-27.md: a Mix tile's author showed as
  // "Sidewalks and Skeletons, Alan Walker, Egzod, and more") — a shape no real channel name has.
  // Rejecting a comma inside the bare-span fallback only (never the two real signals above) keeps
  // every real channel this file already reads, live or fixtured, and stops a Mix's own list from
  // being read as one; the case this cannot tell apart, a channel whose real name contains a
  // comma, is counted rather than guessed at.
  const channelEl =
    tile.querySelector<HTMLElement>('ytd-channel-name a, ytd-channel-name #text, #channel-name a') ??
    tile.querySelector<HTMLElement>('a[href^="/@"], a[href^="/channel/"]');
  const fallbackEl = channelEl ? null : tile.querySelector<HTMLElement>('yt-content-metadata-view-model span');
  const fallbackText = fallbackEl?.textContent?.trim() ?? '';
  const fallbackLooksLikeAList = fallbackText.indexOf(',') !== -1;
  if (!channelEl && (!fallbackEl || fallbackLooksLikeAList)) bumpCounter('unknownAuthor.youtube.home');
  const author = channelEl?.textContent?.trim() || (fallbackLooksLikeAList ? '' : fallbackText) || 'unknown';

  const isAd = tile.querySelector(YT_TILE_AD_SELECTOR) !== null;

  return {
    id: `yt-vid-${videoId}`,
    text: title,
    author,
    timestamp: new Date().toISOString(),
    platform: 'youtube',
    domRef: new WeakRef(titleEl ?? tile),
    feedSource,
    sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
    kind: 'video',
    parentVideoId: `yt-vid-${videoId}`,
    ...(isAd ? { is_sponsored: true } : {}),
    platform_specific: {
      platform: 'youtube',
      surfaceKind: 'youtube-home',
    },
  };
}
