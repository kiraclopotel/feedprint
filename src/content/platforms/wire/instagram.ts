// FeelingWise - Instagram wire parser.
//
// ENDPOINTS (interceptor.ts PATTERNS.instagram holds the same list):
//   /graphql/query/                       the feed, the explore grid and the
//                                         profile grid, discriminated by a
//                                         query hash the URL carries and the
//                                         parser does not read (the hash
//                                         rotates every two to four weeks;
//                                         the item shape does not).
//   /api/v1/feed/                         the internal timeline and reels
//                                         feeds.
//   /api/v1/discover/web/explore_grid/    Explore.
//   /api/v1/media/                        a single media and its comments.
//
// SKIPPED, per docs/research/ZEESCHUIMER-2026-09-14.md section 3: response
// URLs containing `logging_client_events`, `injected_story_units`,
// `bulk-route-definitions`, `qe/sync` and `/logging/`. They carry no items and
// clone().json() on them is pure cost. The skip list lives in interceptor.ts
// so the page realm never parses them at all.
//
// ITEM SHAPES. Instagram has three live at once and one response may carry
// two of them:
//   1. `xdt_api__v1__feed__timeline__connection.edges[].node.media`
//   2. `items[].media_or_ad` (the internal feed)
//   3. `edge_owner_to_timeline_media.edges[].node` (the older web GraphQL)
// The parser recognises a media node by what it carries: a `code` (the
// shortcode the URL uses) or a `pk`, plus a `user` with a `username`.
//
// FIELDS READ per item:
//   id        `code` (preferred) or `pk`   the shortcode the DOM adapter uses
//                                          as its post id (instagram.ts:590)
//   author    `user.username`
//   text      `caption.text` or `edge_media_to_caption.edges.0.node.text`
//   ad flag   `injected` present, or `is_paid_partnership`, or a non-empty
//             `sponsor_tags`. Instagram marks an injected ad by giving the
//             item an `injected` object with the label it shows; a paid
//             partnership is the creator's own declaration.
//   media     `image_versions2.candidates.0.url`, `video_versions.0.url`,
//             `display_url`, and the first entries of `carousel_media`
//   surface   the page path (WireContext)

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
 * Mirrors `InstagramAdapter._detectFeedSource`
 * (src/content/platforms/instagram.ts:1763) so the two capture paths never
 * disagree about the surface.
 */
function instagramWireSurface(pathname: string): FeedSource {
  if (pathname === '/' || pathname === '') return 'for-you';
  if (pathname.startsWith('/explore')) return 'for-you';
  if (pathname.includes('/p/') || pathname.includes('/reel/')) return 'unknown';
  if (/^\/[a-zA-Z0-9_.]{1,30}\/?$/.test(pathname)) return 'profile';
  return 'unknown';
}

function isInstagramMedia(node: Record<string, unknown>): boolean {
  const user = asRecord(node.user) ?? asRecord(node.owner);
  if (!user || str(user.username) === undefined) return false;
  return str(node.code) !== undefined || str(node.pk) !== undefined || str(node.shortcode) !== undefined;
}

function instagramCaption(node: Record<string, unknown>): string {
  return (
    firstString(node, [
      'caption.text',
      'edge_media_to_caption.edges.0.node.text',
      'accessibility_caption',
    ]) ?? ''
  );
}

function instagramMedia(node: Record<string, unknown>): string[] | undefined {
  const urls: Array<string | undefined> = [
    str(at(node, 'image_versions2.candidates.0.url')),
    str(at(node, 'video_versions.0.url')),
    str(node.display_url),
    str(node.thumbnail_src),
  ];
  const carousel = node.carousel_media;
  if (Array.isArray(carousel)) {
    for (const child of carousel.slice(0, 5)) {
      urls.push(str(at(child, 'image_versions2.candidates.0.url')));
      urls.push(str(at(child, 'video_versions.0.url')));
    }
  }
  return cleanMedia(urls);
}

/**
 * Instagram's own paid-placement flags. `injected` is the object the platform
 * attaches to an ad it slid into the feed (it carries the label the page
 * prints); `is_paid_partnership` and `sponsor_tags` are the creator's
 * declaration. Either makes the item a paid placement for standing decision 1.
 */
function instagramIsSponsored(node: Record<string, unknown>): boolean {
  if (asRecord(node.injected) !== null) return true;
  if (node.is_paid_partnership === true) return true;
  const tags = node.sponsor_tags;
  if (Array.isArray(tags) && tags.length > 0) return true;
  return false;
}

/**
 * Parse an Instagram feed / explore / media response into PostContent[].
 * Returns [] for anything unrecognised. Never throws.
 */
export function parseInstagramPayload(
  _url: string,
  body: unknown,
  ctx: WireContext,
): PostContent[] {
  if (!body || typeof body !== 'object') return [];
  const feedSource = instagramWireSurface(ctx.pathname);
  const seen = new Set<string>();
  const out: PostContent[] = [];

  for (const node of walkObjects(body)) {
    if (!isInstagramMedia(node)) continue;
    const id = str(node.code) ?? str(node.shortcode) ?? str(node.pk);
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const user = asRecord(node.user) ?? asRecord(node.owner);
    const handle = str(user?.username) ?? 'unknown';
    const isReel = node.product_type === 'clips' || node.media_type === 2;

    out.push({
      ...wirePost({
        id,
        text: instagramCaption(node),
        author: handle,
        platform: 'instagram',
        timestamp: isoTimestamp(node.taken_at ?? node.taken_at_timestamp),
        sourceUrl: `https://www.instagram.com/${isReel ? 'reel' : 'p'}/${id}/`,
        feedSource,
        isSponsored: instagramIsSponsored(node),
        mediaUrls: instagramMedia(node),
      }),
      platform_specific: {
        platform: 'instagram',
        surfaceKind: isReel ? 'instagram-reel' : 'instagram-post',
        ...(Array.isArray(node.carousel_media) && node.carousel_media.length > 1
          ? { hasCarousel: true }
          : {}),
      },
    });
  }

  return out;
}
