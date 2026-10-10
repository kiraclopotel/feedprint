// FeelingWise — X wire parser.
//
// Maps X's TweetDetail / HomeTimeline / SearchTimeline GraphQL JSON
// responses to PostContent[] records. Pure function — no DOM, no
// side effects. Same field semantics as src/content/platforms/twitter.ts
// so downstream pipeline is substrate-agnostic.
//
// Per docs/history/archive/V15_PAGE_WORLD_DESIGN.md. URL substring match drives the
// surfaceKind decision; the parser walks the response tree to find
// every tweet_results.result and emits one PostContent per tweet.

import type { FeedSource, PostContent, PostKind, PlatformSpecificMeta } from '../../../types/post';
import { cleanMedia, str, type WireContext } from './shared';

type TwitterSurfaceKind = NonNullable<
  Extract<PlatformSpecificMeta, { platform: 'twitter' }>['surfaceKind']
>;

/**
 * The operation names that carry posts, widened 2026-09-14 from six to
 * fifteen using the list documented in
 * docs/research/ZEESCHUIMER-2026-09-14.md section 3. The nine added are the
 * ones X created when it split the profile timeline into one operation per
 * tab, plus the list, explore and likes timelines and the older
 * `adaptive.json` path. Order matters only for `detectSurfaceKind` below.
 */
const X_POST_OPERATIONS: readonly string[] = [
  'TweetDetail',
  'TweetResultByRestId',
  'HomeTimeline',
  'HomeLatestTimeline',
  'SearchTimeline',
  'UserTweets',
  'ListLatestTweetsTimeline',
  'UserOriginalsTimeline',
  'UserRepliesTimeline',
  'UserRepostsTimeline',
  'UserPhotoTimeline',
  'UserVideoTimeline',
  'ExplorePage',
  'Likes',
  'adaptive.json',
];

function detectSurfaceKind(url: string): TwitterSurfaceKind {
  if (url.includes('TweetDetail') || url.includes('TweetResultByRestId')) {
    return 'twitter-permalink';
  }
  if (url.includes('HomeTimeline') || url.includes('HomeLatestTimeline')) {
    return 'twitter-home-feed';
  }
  if (url.includes('SearchTimeline') || url.includes('ExplorePage')) return 'twitter-search';
  if (url.includes('ListLatestTweetsTimeline')) return 'twitter-list';
  if (url.includes('UserTweets') || url.includes('UserOriginals') || url.includes('UserReplies')
    || url.includes('UserReposts') || url.includes('UserPhoto') || url.includes('UserVideo')
    || url.includes('Likes')) {
    return 'twitter-profile';
  }
  return 'twitter-home-feed'; // safest default — fewer false-permalink claims
}

/**
 * Where the item was served from, in the vocabulary the record uses. Mirrors
 * `TwitterAdapter._detectFeedSource` (src/content/platforms/twitter.ts:1307)
 * for the surfaces both paths see; the operation name is a better witness than
 * the page path here, because X changes the path without changing the feed.
 * `HomeLatestTimeline` is the "Following" tab, which is the one place X says
 * plainly that the reader chose the source.
 */
function detectFeedSource(surfaceKind: TwitterSurfaceKind, url: string): FeedSource {
  if (url.includes('HomeLatestTimeline')) return 'following';
  if (url.includes('ListLatestTweetsTimeline')) return 'following';
  switch (surfaceKind) {
    case 'twitter-permalink': return 'permalink';
    case 'twitter-search': return 'search';
    case 'twitter-profile': return 'profile';
    case 'twitter-home-feed': return 'for-you';
    default: return 'unknown';
  }
}

function depthToKind(depth: number): PostKind {
  if (depth === 0) return 'post';
  if (depth === 1) return 'top-comment';
  if (depth === 2) return 'reply';
  return 'reply-to-reply';
}

interface XTweetLegacy {
  full_text?: string;
  created_at?: string;
  favorite_count?: number;
  reply_count?: number;
  retweet_count?: number;
  quote_count?: number;
  bookmark_count?: number;
  in_reply_to_status_id_str?: string;
  user_id_str?: string;
  /** Media addresses the payload carried, in both the old and new slot. */
  entities?: { media?: Array<{ media_url_https?: string }> };
  extended_entities?: { media?: Array<{ media_url_https?: string; video_info?: { variants?: Array<{ url?: string }> } }> };
}

interface XUserLegacy {
  screen_name?: string;
  name?: string;
}

interface XTweetResult {
  __typename?: string;
  rest_id?: string;
  legacy?: XTweetLegacy;
  core?: {
    user_results?: {
      result?: {
        legacy?: XUserLegacy;
        is_blue_verified?: boolean;
      };
    };
  };
  note_tweet?: {
    note_tweet_results?: {
      result?: { text?: string };
    };
  };
  views?: { count?: string };
}

/**
 * Walk the response tree and yield every tweet_results.result encountered,
 * along with its conversation depth (root = 0, items[] children = +1).
 */
function* walkTweetResults(
  payload: unknown,
): Generator<{ result: XTweetResult; depth: number }> {
  if (!payload || typeof payload !== 'object') return;
  yield* walkValue(payload, 0);
}

function* walkValue(
  node: unknown,
  depth: number,
): Generator<{ result: XTweetResult; depth: number }> {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) yield* walkValue(item, depth);
    return;
  }
  const obj = node as Record<string, unknown>;

  // Recognize a tweet_results.result node and yield it.
  if (
    'tweet_results' in obj &&
    obj.tweet_results &&
    typeof obj.tweet_results === 'object' &&
    'result' in (obj.tweet_results as Record<string, unknown>)
  ) {
    const r = (obj.tweet_results as Record<string, unknown>).result as XTweetResult;
    if (r && r.rest_id && r.legacy?.full_text) {
      yield { result: r, depth };
    }
  }

  // Conversation-module items represent replies — bump depth one level.
  const childDepth =
    'items' in obj && Array.isArray(obj.items) ? depth + 1 : depth;
  for (const key of Object.keys(obj)) {
    yield* walkValue(obj[key], childDepth);
  }
}

/**
 * The media addresses the payload carried for this tweet. Photos sit in
 * `entities.media[].media_url_https`; a video's playable variants sit in
 * `extended_entities.media[].video_info.variants[].url`, with the photo slot
 * holding the poster frame. Both are read; nothing is fetched.
 */
function xMediaUrls(legacy: XTweetLegacy): string[] | undefined {
  const urls: Array<string | undefined> = [];
  for (const m of legacy.extended_entities?.media ?? []) {
    urls.push(str(m.media_url_https));
    for (const v of m.video_info?.variants ?? []) urls.push(str(v.url));
  }
  for (const m of legacy.entities?.media ?? []) urls.push(str(m.media_url_https));
  return cleanMedia(urls);
}

/**
 * X's own paid-placement marker. A promoted tweet arrives as a timeline ENTRY
 * carrying `promotedMetadata` beside the tweet it sells, never as a field on
 * the tweet itself, so the ids are collected from the wrapper and applied to
 * the tweets found inside it. This is the platform's own flag, which standing
 * decision 1 prefers over a translated DOM label.
 */
function collectPromotedIds(node: unknown, into: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) collectPromotedIds(child, into);
    return;
  }
  const obj = node as Record<string, unknown>;
  if (obj.promotedMetadata !== undefined || obj.promoted_metadata !== undefined) {
    for (const t of walkTweetResults(obj)) {
      if (t.result.rest_id) into.add(t.result.rest_id);
    }
    return;
  }
  for (const key of Object.keys(obj)) collectPromotedIds(obj[key], into);
}

function mapToPostContent(
  result: XTweetResult,
  depth: number,
  surfaceKind: TwitterSurfaceKind,
  parentIdHint: string | undefined,
  feedSource: FeedSource,
  promotedIds: ReadonlySet<string>,
): PostContent | null {
  const id = result.rest_id;
  const text =
    result.note_tweet?.note_tweet_results?.result?.text ??
    result.legacy?.full_text;
  if (!id || !text) return null;

  const legacy = result.legacy ?? {};
  const user = result.core?.user_results?.result;
  const author = user?.legacy?.screen_name ?? 'unknown';
  const verified = user?.is_blue_verified ?? false;

  const timestampIso = legacy.created_at
    ? new Date(legacy.created_at).toISOString()
    : new Date().toISOString();

  const safeDepth = Math.min(Math.max(depth, 0), 3) as 0 | 1 | 2 | 3;
  const parent_id = legacy.in_reply_to_status_id_str ?? parentIdHint;

  const isPermalink = surfaceKind === 'twitter-permalink';
  // children-of-root get parentVideoId = root id (mirrors twitter.ts so the
  // comment-batch path buckets them under the focused tweet).
  const parentVideoId = isPermalink && safeDepth >= 1 ? parent_id : undefined;

  const platform_specific: Extract<PlatformSpecificMeta, { platform: 'twitter' }> = {
    platform: 'twitter',
    surfaceKind,
    verified,
    metrics: {
      likes: legacy.favorite_count,
      retweets: legacy.retweet_count,
      replies: legacy.reply_count,
      bookmarks: legacy.bookmark_count,
      quoteTweets: legacy.quote_count,
      views: result.views?.count ? Number(result.views.count) : undefined,
    },
  };

  const mediaUrls = xMediaUrls(legacy);

  return {
    id,
    text: text.trim(),
    author,
    timestamp: timestampIso,
    platform: 'twitter',
    domRef: undefined as unknown as WeakRef<HTMLElement>, // wire path has no DOM ref
    sourceUrl: `https://x.com/${author}/status/${id}`,
    feedSource,
    kind: depthToKind(safeDepth),
    depth: safeDepth,
    parent_id,
    parentVideoId,
    // Omitted when false so the flag on a record always means "the platform
    // said paid placement", never "nobody checked".
    ...(promotedIds.has(id) ? { is_sponsored: true } : {}),
    ...(mediaUrls ? { mediaUrls } : {}),
    platform_specific,
  };
}

/**
 * Parse an X GraphQL payload into PostContent[].
 *
 * Defensive against:
 *   - null / undefined body
 *   - missing data.* root
 *   - tweet entries with missing rest_id or legacy.full_text (silently skipped)
 *
 * Returns [] when nothing usable found.
 */
// X names the surface in the endpoint itself, so the tab path the other
// parsers need is accepted and not read.
export function parseXPayload(url: string, body: unknown, _ctx?: WireContext): PostContent[] {
  if (!body || typeof body !== 'object') return [];
  const surfaceKind = detectSurfaceKind(url);
  const feedSource = detectFeedSource(surfaceKind, url);

  const promotedIds = new Set<string>();
  collectPromotedIds(body, promotedIds);

  // Identify the root tweet id (for parentVideoId on children-of-root).
  let rootId: string | undefined;
  const tweets: { result: XTweetResult; depth: number }[] = [];
  for (const t of walkTweetResults(body)) {
    if (t.depth === 0 && rootId === undefined) rootId = t.result.rest_id;
    tweets.push(t);
  }

  const out: PostContent[] = [];
  for (const t of tweets) {
    const parentIdHint = t.depth >= 1 ? rootId : undefined;
    const pc = mapToPostContent(t.result, t.depth, surfaceKind, parentIdHint, feedSource, promotedIds);
    if (pc) out.push(pc);
  }
  return out;
}
