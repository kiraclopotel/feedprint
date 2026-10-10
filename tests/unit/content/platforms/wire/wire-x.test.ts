// V1.5 substrate swap — X wire parser tests.
//
// Fixture-driven coverage of parseXPayload across the 3 X surfaces
// Session 1 must support: TweetDetail (permalink), HomeTimeline
// (home feed), SearchTimeline (search results). Plus defensive
// coverage of malformed / missing / partial payloads.

import { describe, expect, it } from 'vitest';
import { parseXPayload } from '../../../../../src/content/platforms/wire/x';
import permalinkFixture from '../../../../fixtures/wire/x/tweet-detail-permalink.json';
import homeFeedFixture from '../../../../fixtures/wire/x/tweet-result-home-feed.json';
import searchFixture from '../../../../fixtures/wire/x/tweet-result-search.json';

describe('sanitized X fixture schema', () => {
  it.each([
    ['permalink', permalinkFixture],
    ['home', homeFeedFixture],
    ['search', searchFixture],
  ])('preserves discriminator keys for %s', (_name, fixture) => {
    const serialized = JSON.stringify(fixture);
    expect(serialized).toContain('"entryType":"TimelineTimelineItem"');
    expect(serialized).toContain('"itemType":"TimelineTweet"');
    expect(serialized).toContain('"__typename":"User"');
  });

  it('preserves the nested conversation entry identifier', () => {
    expect(JSON.stringify(permalinkFixture)).toContain(
      '"entryId":"conversationthread-9100000000000000001-tweet-9100000000000000002"',
    );
  });
});

describe('parseXPayload — TweetDetail (permalink)', () => {
  it('extracts the root post + 1 reply from the permalink response', () => {
    const url = 'https://x.com/i/api/graphql/abc/TweetDetail?variables=...';
    const posts = parseXPayload(url, permalinkFixture);
    expect(posts).toHaveLength(2);

    const root = posts.find((p) => p.id === '9100000000000000001');
    expect(root).toBeDefined();
    expect(root!.text).toBe('Original post body text here.');
    expect(root!.author).toBe('example_origin');
    expect(root!.platform).toBe('twitter');
    expect(root!.kind).toBe('post');
    expect(root!.depth).toBe(0);
    expect(root!.platform_specific).toMatchObject({
      platform: 'twitter',
      verified: true,
      metrics: {
        likes: 1234,
        retweets: 78,
        replies: 56,
        bookmarks: 12,
        quoteTweets: 9,
        views: 98765,
      },
    });

    const reply = posts.find((p) => p.id === '9100000000000000002');
    expect(reply).toBeDefined();
    expect(reply!.text).toBe('Reply one body.');
    expect(reply!.author).toBe('replier1');
    expect(reply!.kind).toBe('top-comment');
    expect(reply!.depth).toBe(1);
    expect(reply!.parent_id).toBe('9100000000000000001');
    expect(reply!.parentVideoId).toBe('9100000000000000001');
  });

  it('stamps surfaceKind=twitter-permalink when URL contains /TweetDetail', () => {
    const url = 'https://x.com/i/api/graphql/abc/TweetDetail?variables=...';
    const posts = parseXPayload(url, permalinkFixture);
    expect(posts[0].platform_specific).toMatchObject({
      surfaceKind: 'twitter-permalink',
    });
  });

  it('builds sourceUrl from author + tweet id', () => {
    const url = 'https://x.com/i/api/graphql/abc/TweetDetail?variables=...';
    const posts = parseXPayload(url, permalinkFixture);
    const root = posts.find((p) => p.id === '9100000000000000001');
    expect(root!.sourceUrl).toBe('https://x.com/example_origin/status/9100000000000000001');
  });

  it('converts created_at to ISO-8601 timestamp', () => {
    const url = 'https://x.com/i/api/graphql/abc/TweetDetail?variables=...';
    const posts = parseXPayload(url, permalinkFixture);
    const root = posts.find((p) => p.id === '9100000000000000001');
    // created_at "Sat May 17 18:13:42 +0000 2026" → 2026-05-17T18:13:42.000Z
    expect(root!.timestamp).toBe('2026-05-17T18:13:42.000Z');
  });
});

describe('parseXPayload — HomeTimeline', () => {
  it('extracts a single feed item with surfaceKind=twitter-home-feed', () => {
    const url = 'https://x.com/i/api/graphql/abc/HomeTimeline?variables=...';
    const posts = parseXPayload(url, homeFeedFixture);
    expect(posts).toHaveLength(1);
    expect(posts[0].id).toBe('9000000000000000001');
    expect(posts[0].text).toBe('Home feed item.');
    expect(posts[0].kind).toBe('post');
    expect(posts[0].depth).toBe(0);
    expect(posts[0].platform_specific).toMatchObject({
      surfaceKind: 'twitter-home-feed',
    });
  });
});

describe('parseXPayload — SearchTimeline', () => {
  it('extracts a single search result with surfaceKind=twitter-search', () => {
    const url = 'https://x.com/i/api/graphql/abc/SearchTimeline?variables=...';
    const posts = parseXPayload(url, searchFixture);
    expect(posts).toHaveLength(1);
    expect(posts[0].id).toBe('7000000000000000001');
    expect(posts[0].text).toBe('Search result tweet body.');
    expect(posts[0].platform_specific).toMatchObject({
      surfaceKind: 'twitter-search',
    });
  });
});

describe('parseXPayload — defensive', () => {
  it('returns [] for null/undefined body', () => {
    expect(
      parseXPayload('https://x.com/i/api/graphql/abc/TweetDetail', null),
    ).toEqual([]);
    expect(
      parseXPayload('https://x.com/i/api/graphql/abc/TweetDetail', undefined),
    ).toEqual([]);
  });

  it('returns [] for body missing data.* shape', () => {
    expect(
      parseXPayload('https://x.com/i/api/graphql/abc/TweetDetail', {}),
    ).toEqual([]);
    expect(
      parseXPayload('https://x.com/i/api/graphql/abc/TweetDetail', { data: {} }),
    ).toEqual([]);
  });

  it('skips tweet entries with missing rest_id or legacy.full_text', () => {
    const broken = {
      data: {
        threaded_conversation_with_injections_v2: {
          instructions: [
            {
              type: 'TimelineAddEntries',
              entries: [
                {
                  entryId: 'tweet-broken',
                  content: {
                    entryType: 'TimelineTimelineItem',
                    itemContent: {
                      itemType: 'TimelineTweet',
                      tweet_results: { result: { __typename: 'Tweet' } },
                    },
                  },
                },
              ],
            },
          ],
        },
      },
    };
    expect(
      parseXPayload('https://x.com/i/api/graphql/abc/TweetDetail', broken),
    ).toEqual([]);
  });

  it('emitted PostContent carries every field required for canonical-payload hashing', () => {
    const posts = parseXPayload(
      'https://x.com/i/api/graphql/abc/TweetDetail',
      permalinkFixture,
    );
    for (const p of posts) {
      expect(p.id).toBeTruthy();
      expect(p.text).toBeTruthy();
      expect(p.author).toBeTruthy();
      expect(p.timestamp).toBeTruthy();
      expect(p.platform).toBe('twitter');
      // wire path has no DOM ref — downstream must tolerate undefined domRef
      expect(p.domRef).toBeUndefined();
      expect(p.sourceUrl).toMatch(/^https:\/\/x\.com\//);
    }
  });
});
