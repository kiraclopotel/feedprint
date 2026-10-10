// FeelingWise — recordMetricsFromPostContent unit tests.
//
// Locks the normalization from per-platform `platform_specific` shapes to the
// platform-agnostic RecordMetrics that rides on the signed forensic record.
// The single most error-prone spot is the X `replies` -> `reply_count` /
// `quoteTweets` -> `quote_tweets` rename; every platform is covered plus the
// "captured nothing -> undefined" guard that keeps metric-less records hashing
// byte-identically.

import { describe, it, expect } from 'vitest';
import type { PostContent, PlatformSpecificMeta, PostKind } from '../../../../src/types/post';
import { recordMetricsFromPostContent } from '../../../../src/content/record/record-metrics';

function post(
  ps: PlatformSpecificMeta | undefined,
  kind: PostKind = 'comment',
): PostContent {
  return {
    id: 'p1',
    text: 'x',
    author: '@a',
    timestamp: '2026-05-30T00:00:00Z',
    platform: (ps?.platform ?? 'twitter') as PostContent['platform'],
    domRef: new WeakRef({} as HTMLElement),
    kind,
    platform_specific: ps,
  };
}

describe('recordMetricsFromPostContent', () => {
  it('X: renames replies->reply_count, quoteTweets->quote_tweets, carries retweets/bookmarks/views', () => {
    const m = recordMetricsFromPostContent(
      post({
        platform: 'twitter',
        metrics: { likes: 10, retweets: 2, replies: 3, views: 1000, bookmarks: 1, quoteTweets: 4 },
      }),
    );
    expect(m).toEqual({
      likes: 10,
      reply_count: 3,
      retweets: 2,
      quote_tweets: 4,
      bookmarks: 1,
      views: 1000,
    });
  });

  it('TikTok comment: carries likes/reply_count + creator heart', () => {
    const m = recordMetricsFromPostContent(
      post({ platform: 'tiktok', metrics: { likes: 5, reply_count: 1 }, isCreatorHearted: true }),
    );
    expect(m).toEqual({ likes: 5, reply_count: 1, is_creator_hearted: true });
  });

  it('YouTube comment: omits creator heart when false', () => {
    const m = recordMetricsFromPostContent(
      post({ platform: 'youtube', metrics: { likes: 7, reply_count: 2 }, isCreatorHearted: false }),
    );
    expect(m).toEqual({ likes: 7, reply_count: 2 });
    expect(m).not.toHaveProperty('is_creator_hearted');
  });

  it('Instagram caption: records likes_obscured (platform hides exact count)', () => {
    const m = recordMetricsFromPostContent(
      post({ platform: 'instagram', metrics: { likes: 3, reply_count: 0 } }, 'post'),
    );
    expect(m).toEqual({ likes_obscured: true });
  });

  it('Instagram comment: carries likes/reply_count', () => {
    const m = recordMetricsFromPostContent(
      post({ platform: 'instagram', metrics: { likes: 3, reply_count: 0 } }, 'comment'),
    );
    expect(m).toEqual({ likes: 3, reply_count: 0 });
  });

  it('Facebook caption: carries aggregate post reactions/comments/shares', () => {
    const m = recordMetricsFromPostContent(
      post({ platform: 'facebook', postReactions: 100, postCommentsCount: 20, postShares: 5 }, 'video'),
    );
    expect(m).toEqual({ primary_likes: 100, comments_count: 20, shares: 5 });
  });

  it('Facebook comment: carries likes/reply_count', () => {
    const m = recordMetricsFromPostContent(
      post({ platform: 'facebook', metrics: { likes: 2, reply_count: 1 } }, 'comment'),
    );
    expect(m).toEqual({ likes: 2, reply_count: 1 });
  });

  it('returns undefined when no platform_specific is present', () => {
    expect(recordMetricsFromPostContent(post(undefined))).toBeUndefined();
  });

  it('returns undefined (not {}) when nothing was captured — keeps metric-less records hashing identically', () => {
    const m = recordMetricsFromPostContent(post({ platform: 'twitter', metrics: {} }));
    expect(m).toBeUndefined();
  });
});
