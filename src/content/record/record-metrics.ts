// FeelingWise — derive per-item engagement metrics for the forensic record.
//
// The adapters stamp engagement counts on `PostContent.platform_specific`
// (per-platform shapes, see src/types/post.ts). This helper normalizes them
// into the platform-agnostic `RecordMetrics` shape that rides on the signed
// forensic record and renders in the HTML export feed.
//
// Normalization note: X names its per-article counts `replies` / `quoteTweets`;
// the other four platforms use `reply_count`. This helper is the single place
// that rename happens — get it wrong and X reply counts land under the wrong
// key. Returns `undefined` (never `{}`) when nothing was captured, so the
// record's `metrics` field is omitted and metric-less records keep hashing
// byte-identically (canonical-payload omits undefined keys).

import type { PostContent } from '../../types/post';
import type { RecordMetrics } from '../../types/forensic';

export function recordMetricsFromPostContent(
  p: PostContent,
): RecordMetrics | undefined {
  const ps = p.platform_specific;
  if (!ps) return undefined;
  const isCaption = p.kind === 'post' || p.kind === 'video';
  let m: RecordMetrics | undefined;
  switch (ps.platform) {
    case 'twitter': {
      const x = ps.metrics;
      m = {
        likes: x?.likes,
        reply_count: x?.replies, // X names it `replies`
        retweets: x?.retweets,
        quote_tweets: x?.quoteTweets,
        bookmarks: x?.bookmarks,
        views: x?.views,
      };
      break;
    }
    case 'tiktok':
      m = {
        likes: ps.metrics?.likes,
        reply_count: ps.metrics?.reply_count,
        shares: ps.metrics?.shares,
        is_creator_hearted: ps.isCreatorHearted || undefined,
      };
      break;
    case 'youtube':
      m = {
        likes: ps.metrics?.likes,
        reply_count: ps.metrics?.reply_count,
        is_creator_hearted: ps.isCreatorHearted || undefined,
      };
      break;
    case 'instagram':
      // Instagram obscures exact like counts by product policy. On the caption
      // record, record that fact (the export renders "likes hidden by
      // platform") rather than a fabricated number.
      m = isCaption
        ? { likes_obscured: true }
        : { likes: ps.metrics?.likes, reply_count: ps.metrics?.reply_count };
      break;
    case 'facebook':
      m = isCaption
        ? {
            primary_likes: ps.postReactions,
            comments_count: ps.postCommentsCount,
            shares: ps.postShares,
          }
        : { likes: ps.metrics?.likes, reply_count: ps.metrics?.reply_count };
      break;
  }
  if (!m) return undefined;
  // Drop undefined keys so the stored object carries only captured metrics,
  // and omit the whole object when nothing was captured — keeping metric-less
  // records hashing byte-identically to legacy records.
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(m)) {
    if (v !== undefined) cleaned[k] = v;
  }
  return Object.keys(cleaned).length ? (cleaned as RecordMetrics) : undefined;
}
