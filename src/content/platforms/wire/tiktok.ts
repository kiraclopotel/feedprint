// FeelingWise - TikTok wire parser.
//
// Reads the item feed TikTok serves as JSON, which is the only place a For You
// video's caption exists in a form the recorder can read: the DOM node the
// TikTok adapter walks (`recommend-list-item-container`,
// src/content/platforms/tiktok.ts) carries the player and the action rail, and
// on a music-only video it carries no caption at all. That is the blind
// surface PLAN-2026-09-14 item 4 is about.
//
// ENDPOINTS (interceptor.ts PATTERNS.tiktok holds the same list):
//   /api/recommend/item_list/   For You and Following (the tab is in the page
//                               path and in `from_page`, not in the path of
//                               the request, so the surface is read from the
//                               WireContext).
//   /api/post/item_list/        a profile's own videos.
//   /api/item_list/             the older item-feed path, still served.
//   /api/search/item/           search results.
//   /comment/list/              the comment family the interceptor already
//                               matched; parsed here for the caption that
//                               rides along, never for the comments (those
//                               are the DOM adapter's and the batch judge's).
// /api/preload/ is deliberately NOT matched: it carries items the page has
// not decided to show.
//
// ITEM SHAPES. One response carries its items under one of four keys, and
// which one it is has changed more than once: `itemList`, `item_list`,
// `ItemModule` (an object keyed by id, from the embedded page state) or a bare
// `data` array. Rather than guess, the parser walks the response and
// recognises an item by what it carries: a string `id` plus an `author` object
// with a `uniqueId`. Live rooms (`liveRoomInfo`) are dropped: a broadcast is
// not an item, and docs/design/SURFACES-2026-09-06.md stands the recorder down
// on live surfaces.
//
// FIELDS READ per item:
//   id          `id`                      the video id
//   author      `author.uniqueId`         the handle, not the display name
//   text        `desc`                    the caption
//   ad flag     `isAd` / `adAuthorization`  TikTok's own booleans
//   media       `video.cover`, `video.playAddr`, `imagePost` covers
//   surface     the page path (WireContext), not the request URL
//
// The identity a captured item carries is `tk-vid-<id>`, which is the identity
// the TikTok DOM adapter stamps (tiktok.ts:805). Same identity, same record:
// see src/content/page-world/wire-store.ts for what that guarantees.

import type { FeedSource, PostContent } from '../../../types/post';
import {
  asRecord,
  at,
  cleanMedia,
  firstString,
  isoTimestamp,
  str,
  walkObjects,
  wirePost,
  type WireContext,
} from './shared';

/**
 * The surface, read from the page the reader is on. Mirrors
 * `TiktokAdapter._detectFeedSource` (src/content/platforms/tiktok.ts:934) so a
 * wire-captured item and a DOM-captured one never disagree about where the
 * feed came from.
 */
function tiktokWireSurface(pathname: string): FeedSource {
  if (pathname === '/' || pathname === '/foryou' || pathname.startsWith('/for-you')) return 'for-you';
  if (pathname.startsWith('/following')) return 'following';
  if (pathname.startsWith('/@')) return 'profile';
  if (pathname.startsWith('/search') || pathname.startsWith('/tag/')) return 'search';
  return 'unknown';
}

function isTiktokItem(node: Record<string, unknown>): boolean {
  if (str(node.id) === undefined) return false;
  if (node.liveRoomInfo !== undefined) return false;
  const author = asRecord(node.author);
  return author !== null && str(author.uniqueId) !== undefined;
}

function tiktokMedia(node: Record<string, unknown>): string[] | undefined {
  const urls: Array<string | undefined> = [
    str(at(node, 'video.cover')),
    str(at(node, 'video.originCover')),
    str(at(node, 'video.playAddr')),
  ];
  const images = at(node, 'imagePost.images');
  if (Array.isArray(images)) {
    for (const img of images.slice(0, 5)) {
      urls.push(str(at(img, 'imageURL.urlList.0')));
    }
  }
  return cleanMedia(urls);
}

/**
 * Parse a TikTok item-feed or comment-list response into PostContent[].
 *
 * Returns [] for anything unrecognised, including a response whose items the
 * shape test rejects. Never throws.
 */
export function parseTiktokPayload(
  _url: string,
  body: unknown,
  ctx: WireContext,
): PostContent[] {
  if (!body || typeof body !== 'object') return [];
  const feedSource = tiktokWireSurface(ctx.pathname);
  const seen = new Set<string>();
  const out: PostContent[] = [];

  for (const node of walkObjects(body)) {
    if (!isTiktokItem(node)) continue;
    const videoId = str(node.id);
    if (!videoId || seen.has(videoId)) continue;
    seen.add(videoId);

    const handle = firstString(node, ['author.uniqueId']) ?? 'unknown';
    const caption = str(node.desc) ?? '';
    // TikTok's own ad flag. `isAd` is the paid placement and alone makes the item one for standing decision 1 (ads are never
    // harm). `adAuthorization` is the creator's own paid-partnership declaration on an ordinary creator video: read as an ad
    // it collapsed the video when Block Ads is on and moved the feed under the person (F47: 1 of 35 guest rows carried it
    // with no isAd, team/VERIFY.md 1 Oct 04:02). A row that carries both stays sponsored through isAd.
    const isSponsored = node.isAd === true;

    out.push({
      ...wirePost({
        id: `tk-vid-${videoId}`,
        text: caption,
        author: handle,
        platform: 'tiktok',
        timestamp: isoTimestamp(node.createTime),
        sourceUrl: `https://www.tiktok.com/@${handle}/video/${videoId}`,
        feedSource,
        isSponsored,
        mediaUrls: tiktokMedia(node),
      }),
      kind: 'video',
      parentVideoId: `tk-vid-${videoId}`,
      platform_specific: {
        platform: 'tiktok',
        surfaceKind: feedSource === 'unknown' ? 'tiktok-permalink' : 'tiktok-feed',
      },
    });
  }

  return out;
}
