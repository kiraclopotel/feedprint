// FeelingWise - Facebook wire parser.
//
// ENDPOINT (interceptor.ts PATTERNS.facebook holds the same rule):
//   /api/graphql/   every Facebook GraphQL operation. The operation name lives
//                   in the POST body (`fb_api_req_friendly_name` / `doc_id`),
//                   which a URL match cannot see, so the interceptor accepts
//                   the whole endpoint and this parser drops what it does not
//                   recognise. X's endpoint is `/i/api/graphql/` and contains
//                   the same substring, so the interceptor excludes `/i/api/`
//                   explicitly (a live probe on 2026-05-23 caught a phantom
//                   facebook event on x.com without it).
//
// A KNOWN LIMIT, stated rather than hidden: Facebook streams most feed
// responses as several JSON documents separated by newlines. `clone().json()`
// parses the first document and rejects the rest, so this parser sees the
// first chunk of such a response and nothing more. Reading the later chunks
// means reading the body as text and splitting it, which is a change to the
// interceptor (it would have to stop using `.json()`), not to this file. Until
// then a Facebook capture is partial and is treated as a supplement to the DOM
// adapter, never a replacement (see wire-store.ts WIRE_POLICY).
//
// ITEM SHAPE. A feed story is recognised by what it carries: a `post_id`
// string plus a readable message. Facebook nests that under
// `node.comet_sections.content.story` on the Comet feed and under
// `data.node.story` elsewhere; the walk finds it wherever it sits.
//
// FIELDS READ per item:
//   id        `post_id`                       the DOM adapter stamps
//                                             `fb-post-<postId>` /
//                                             `fb-vid-<postId>`
//                                             (facebook.ts:523, :622)
//   author    `actors.0.name` / `.short_name`
//   text      `message.text` or `message_preferred_body.text`
//   ad flag   `sponsored_data` present, or `is_sponsored`, or a
//             `sponsored_label`. Facebook's own marker, which is a better
//             witness than the translated DOM label string the engagement
//             module reads (src/content/engagement/ad-labels.ts).
//   media     attachment `media.image.uri` / `media.playable_url`
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
 * Mirrors `FacebookAdapter._detectFeedSource`
 * (src/content/platforms/facebook.ts:1729) so the two capture paths never
 * disagree about the surface.
 */
function facebookWireSurface(pathname: string): FeedSource {
  if (pathname.includes('/groups/')) return 'following';
  if (pathname.includes('/watch')) return 'for-you';
  if (pathname.includes('/profile') || /^\/[a-zA-Z0-9.]+\/?$/.test(pathname)) return 'profile';
  if (pathname === '/' || pathname === '/home' || pathname.startsWith('/home.php')) return 'for-you';
  return 'unknown';
}

function isFacebookStory(node: Record<string, unknown>): boolean {
  if (str(node.post_id) === undefined) return false;
  return (
    firstString(node, ['message.text', 'message_preferred_body.text']) !== undefined
    || asRecord(node.attachments) !== null
    || Array.isArray(node.attachments)
  );
}

function facebookAuthor(node: Record<string, unknown>): string {
  return (
    firstString(node, [
      'actors.0.short_name',
      'actors.0.name',
      'owner.name',
      'actors.0.__typename',
    ]) ?? 'unknown'
  );
}

function facebookMedia(node: Record<string, unknown>): string[] | undefined {
  const urls: Array<string | undefined> = [];
  const attachments = node.attachments;
  if (Array.isArray(attachments)) {
    for (const att of attachments.slice(0, 5)) {
      urls.push(str(at(att, 'media.image.uri')));
      urls.push(str(at(att, 'media.playable_url')));
      urls.push(str(at(att, 'media.preferred_thumbnail.image.uri')));
    }
  }
  return cleanMedia(urls);
}

/** Facebook's own paid-placement markers, in the order they are trusted. */
function facebookIsSponsored(node: Record<string, unknown>): boolean {
  if (asRecord(node.sponsored_data) !== null) return true;
  if (node.is_sponsored === true) return true;
  if (str(node.sponsored_label) !== undefined) return true;
  return false;
}

/**
 * Parse a Facebook GraphQL response into PostContent[]. Returns [] for
 * anything unrecognised, which on Facebook is most responses. Never throws.
 */
export function parseFacebookPayload(
  _url: string,
  body: unknown,
  ctx: WireContext,
): PostContent[] {
  if (!body || typeof body !== 'object') return [];
  const feedSource = facebookWireSurface(ctx.pathname);
  const isReel = ctx.pathname.startsWith('/reel');
  const seen = new Set<string>();
  const out: PostContent[] = [];

  for (const node of walkObjects(body)) {
    if (!isFacebookStory(node)) continue;
    const postId = str(node.post_id);
    if (!postId || seen.has(postId)) continue;
    seen.add(postId);

    const media = facebookMedia(node);
    out.push({
      ...wirePost({
        // The identity the Facebook DOM adapter stamps. A reel is `fb-vid-`,
        // a feed post is `fb-post-`; the page path decides, exactly as the
        // adapter's own `isReel` branch does.
        id: `fb-${isReel ? 'vid' : 'post'}-${postId}`,
        text: firstString(node, ['message.text', 'message_preferred_body.text']) ?? '',
        author: facebookAuthor(node),
        platform: 'facebook',
        timestamp: isoTimestamp(node.creation_time ?? at(node, 'comet_sections.timestamp')),
        sourceUrl: `https://www.facebook.com/${postId}`,
        feedSource,
        isSponsored: facebookIsSponsored(node),
        mediaUrls: media,
      }),
      ...(isReel ? { kind: 'video' as const, parentVideoId: `fb-vid-${postId}` } : {}),
      platform_specific: {
        platform: 'facebook',
        surfaceKind: isReel ? 'facebook-reel' : 'facebook-home-feed',
      },
    });
  }

  return out;
}
