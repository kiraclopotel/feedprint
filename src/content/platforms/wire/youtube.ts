// FeelingWise - YouTube wire parser.
//
// DERIVED HERE, not borrowed. Zeeschuimer has no YouTube module
// (docs/research/ZEESCHUIMER-2026-09-14.md section 3: "Zeeschuimer has no
// YouTube module, so there is nothing to borrow"), so the endpoints and the
// item shapes below were derived from YouTube's own web client and are
// written down so the next session does not have to derive them again.
//
// HOW THE DERIVATION GOES, so it can be checked or redone:
//   1. youtube.com is a single-page app served by one internal JSON API under
//      `/youtubei/v1/`. The first page load carries its feed inside the HTML
//      as `ytInitialData`; every later page of the same feed arrives as a
//      `POST /youtubei/v1/browse` response, and the watch page's "up next"
//      rail arrives as `POST /youtubei/v1/next`. Those two are the feed
//      endpoints. `ytInitialData` is NOT reachable from a fetch wrapper (it is
//      in the document, not in a request), so the first screen of Home is
//      captured by the DOM or not at all; this parser covers every scroll
//      after it.
//   2. A browse response for Home carries
//      `contents.twoColumnBrowseResultsRenderer` on the first page and
//      `onResponseReceivedActions[].appendContinuationItemsAction` on every
//      continuation. Both end in a `richGridRenderer` whose `contents` are
//      `richItemRenderer` wrappers around one `videoRenderer` each.
//   3. A next response carries `compactVideoRenderer` items instead, under
//      `contents.twoColumnWatchNextResults.secondaryResults`.
//   4. Both renderers carry the same four things this recorder needs:
//      `videoId`, `title` (a runs/simpleText node), the channel under
//      `ownerText` / `longBylineText` / `shortBylineText`, and
//      `thumbnail.thumbnails[]`.
//   5. An advertisement arrives as an `adSlotRenderer` or a
//      `promotedVideoRenderer`, or as an ordinary `videoRenderer` carrying a
//      badge whose `metadataBadgeRenderer.style` is `BADGE_STYLE_TYPE_AD`.
//      All three are read below; the badge is the one that survives being
//      wrapped in a rich grid item.
// Rather than depend on any of those wrapper paths staying put, the parser
// walks the response and recognises an item by the keys the item itself
// carries (`videoId` plus a readable title), which is the same judgement the
// other four wire parsers make.
//
// FIELDS READ per item:
//   id        `videoId`, stamped as `yt-vid-<videoId>` so it is the SAME
//             identity src/content/platforms/yt-watch-comments.ts:151 gives the watch
//             page's own video. One identity, one record.
//   author    `ownerText` / `longBylineText` / `shortBylineText`
//   text      `title`, plus `descriptionSnippet` when the tile carries one.
//             A Home tile's title is the only text YouTube puts on it.
//   ad flag   `adSlotRenderer` / `promotedVideoRenderer` ancestor, or a
//             BADGE_STYLE_TYPE_AD badge on the item
//   media     `thumbnail.thumbnails[].url`
//   surface   the page path (WireContext): `/` is Home, `/feed/subscriptions`
//             is Following, `/watch` is the up-next rail.
//
// WHAT THIS DOES NOT DO. The YouTube DOM adapter
// (src/content/platforms/youtube.ts) models community posts only and returns
// an empty array on `/watch`, so nothing in the DOM path competes with these
// items on Home. The relay decides what may be done with them; see
// src/content/page-world/wire-store.ts.

import type { FeedSource, PostContent } from '../../../types/post';
import {
  asRecord,
  at,
  cleanMedia,
  isoTimestamp,
  str,
  walkObjects,
  wirePost,
  ytText,
  type WireContext,
} from './shared';

/**
 * Mirrors `YoutubeAdapter._detectFeedSource`
 * (src/content/platforms/youtube.ts:154) and adds the one surface that
 * adapter has no rule for, because it never extracts there: the subscriptions
 * feed, which is the platform's own "following".
 */
function youtubeWireSurface(pathname: string): FeedSource {
  if (pathname === '/' || pathname === '/feed/trending') return 'for-you';
  if (pathname.startsWith('/feed/subscriptions')) return 'following';
  if (pathname.startsWith('/results')) return 'search';
  if (pathname.startsWith('/@') || pathname.startsWith('/channel/') || pathname.startsWith('/c/')) {
    return 'profile';
  }
  if (pathname.startsWith('/shorts/')) return 'for-you';
  return 'unknown';
}

function youtubeAuthor(node: Record<string, unknown>): string {
  return (
    ytText(node.ownerText)
    ?? ytText(at(node, 'longBylineText'))
    ?? ytText(at(node, 'shortBylineText'))
    ?? ytText(at(node, 'ownerBadges'))
    ?? 'unknown'
  );
}

/**
 * YouTube's own paid-placement markers on an item. A promoted tile arrives
 * wrapped in `adSlotRenderer` or as a `promotedVideoRenderer`; an ordinary
 * `videoRenderer` that was sold carries a badge whose style says so.
 */
function youtubeIsAd(node: Record<string, unknown>): boolean {
  if (node.promotedVideoRenderer !== undefined || node.adSlotRenderer !== undefined) return true;
  const badges = node.badges;
  if (Array.isArray(badges)) {
    for (const badge of badges) {
      const style = str(at(badge, 'metadataBadgeRenderer.style'));
      if (style === 'BADGE_STYLE_TYPE_AD') return true;
    }
  }
  if (asRecord(node.adBadge) !== null) return true;
  return false;
}

function youtubeMedia(node: Record<string, unknown>): string[] | undefined {
  const thumbs = at(node, 'thumbnail.thumbnails');
  const urls: Array<string | undefined> = [];
  if (Array.isArray(thumbs)) {
    for (const t of thumbs.slice(-2)) urls.push(str(asRecord(t)?.url));
  }
  return cleanMedia(urls);
}

/**
 * Parse a YouTube `browse` or `next` response into PostContent[]. Returns []
 * for anything unrecognised. Never throws.
 */
export function parseYoutubePayload(
  _url: string,
  body: unknown,
  ctx: WireContext,
): PostContent[] {
  if (!body || typeof body !== 'object') return [];
  const feedSource = youtubeWireSurface(ctx.pathname);
  const isWatchRail = ctx.pathname.startsWith('/watch');
  const seen = new Set<string>();
  const out: PostContent[] = [];
  // An ad slot wraps the item it sells, so the flag is collected on the way in
  // and applied to the videoId found inside it.
  const adVideoIds = new Set<string>();

  for (const node of walkObjects(body)) {
    if (!youtubeIsAd(node)) continue;
    for (const inner of walkObjects(node, 5_000)) {
      const vid = str(inner.videoId);
      if (vid) adVideoIds.add(vid);
    }
  }

  for (const node of walkObjects(body)) {
    const videoId = str(node.videoId);
    if (!videoId || seen.has(videoId)) continue;
    const title = ytText(node.title);
    if (title === undefined) continue;
    seen.add(videoId);

    const description = ytText(node.descriptionSnippet);
    out.push({
      ...wirePost({
        id: `yt-vid-${videoId}`,
        text: description ? `${title}\n${description}` : title,
        author: youtubeAuthor(node),
        platform: 'youtube',
        timestamp: isoTimestamp(at(node, 'publishedTimeText.simpleText')),
        sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
        feedSource,
        isSponsored: adVideoIds.has(videoId),
        mediaUrls: youtubeMedia(node),
      }),
      kind: 'video',
      parentVideoId: `yt-vid-${videoId}`,
      platform_specific: {
        platform: 'youtube',
        // Only the watch rail has a surfaceKind this vocabulary can name. A
        // Home or Subscriptions tile is none of 'youtube-watch' /
        // 'youtube-shorts' / 'youtube-community', so the field is left off
        // rather than filled with the nearest wrong word; `feedSource` above
        // already says where the item came from.
        ...(isWatchRail ? { surfaceKind: 'youtube-watch' as const } : {}),
      },
    });
  }

  return out;
}
