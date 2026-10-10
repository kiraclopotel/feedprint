// @vitest-environment jsdom
//
// The page-world endpoint table, asserted without a live page.
//
// The interceptor wraps fetch and XHR in the page's own realm, so every URL it
// matches costs a clone().json(). PLAN-2026-09-14 item 4 turned the patches on
// again; what keeps the bill honest is that the table is per-platform and
// per-endpoint, with a skip list for the responses that are known to carry no
// items. This file pins both sides: what must be read, and what must not.
//
// The endpoint lists are the facts documented in
// docs/research/ZEESCHUIMER-2026-09-14.md section 3, plus the YouTube
// endpoints derived in src/content/platforms/wire/youtube.ts.

import { describe, expect, it } from 'vitest';
import { _matchPlatformForTesting as matches } from '../../../../src/content/page-world/fetch-interceptor';

describe('page-world endpoint table — X', () => {
  it.each([
    'https://x.com/i/api/graphql/aaa/HomeTimeline',
    'https://x.com/i/api/graphql/aaa/HomeLatestTimeline',
    'https://x.com/i/api/graphql/aaa/TweetDetail',
    'https://x.com/i/api/graphql/aaa/SearchTimeline',
    'https://x.com/i/api/graphql/aaa/UserTweets',
    // The nine widened on 2026-09-14: the per-tab profile timelines X split
    // out in 2026, the list timeline, Explore, Likes, and adaptive.json.
    'https://x.com/i/api/graphql/aaa/ListLatestTweetsTimeline',
    'https://x.com/i/api/graphql/aaa/UserOriginalsTimeline',
    'https://x.com/i/api/graphql/aaa/UserRepliesTimeline',
    'https://x.com/i/api/graphql/aaa/UserRepostsTimeline',
    'https://x.com/i/api/graphql/aaa/UserPhotoTimeline',
    'https://x.com/i/api/graphql/aaa/UserVideoTimeline',
    'https://x.com/i/api/graphql/aaa/ExplorePage',
    'https://x.com/i/api/graphql/aaa/Likes',
    'https://x.com/i/api/2/timeline/home.json?adaptive.json',
  ])('reads %s', (url) => {
    expect(matches(url, 'twitter')).toBe(true);
  });

  it.each([
    'https://x.com/i/api/graphql/aaa/CreateTweet',
    'https://x.com/i/api/1.1/jot/client_event.json',
    'https://x.com/home',
  ])('skips %s', (url) => {
    expect(matches(url, 'twitter')).toBe(false);
  });
});

describe('page-world endpoint table — Facebook and the X collision', () => {
  it('reads the Facebook GraphQL endpoint', () => {
    expect(matches('https://www.facebook.com/api/graphql/', 'facebook')).toBe(true);
  });

  it('cannot claim an X response: only the tab\'s own platform rule is consulted', () => {
    // `/i/api/graphql/` contains `/api/graphql/`. A live probe on 2026-05-23
    // caught a phantom facebook event on x.com when the whole table was tried
    // against every URL; matching against the site the tab is on makes the
    // whole class impossible.
    const xUrl = 'https://x.com/i/api/graphql/aaa/SomeUnknownOperation';
    expect(matches(xUrl, 'facebook')).toBe(false);
    expect(matches(xUrl, 'twitter')).toBe(false);
  });

  it('skips the route and beacon chatter on the same host', () => {
    expect(matches('https://www.facebook.com/ajax/bulk-route-definitions/', 'facebook')).toBe(false);
    expect(matches('https://www.facebook.com/ajax/bz', 'facebook')).toBe(false);
  });
});

describe('page-world endpoint table — Instagram', () => {
  it.each([
    'https://www.instagram.com/graphql/query/?doc_id=1',
    'https://i.instagram.com/api/v1/feed/timeline/',
    'https://i.instagram.com/api/v1/feed/reels_media/',
    'https://i.instagram.com/api/v1/discover/web/explore_grid/',
    'https://i.instagram.com/api/v1/media/1/comments/',
  ])('reads %s', (url) => {
    expect(matches(url, 'instagram')).toBe(true);
  });

  it.each([
    'https://www.instagram.com/api/v1/logging_client_events/',
    'https://i.instagram.com/api/v1/feed/injected_story_units/',
    'https://www.instagram.com/ajax/bulk-route-definitions/',
    'https://www.instagram.com/api/v1/qe/sync/',
    'https://www.instagram.com/logging/falco',
  ])('skips %s', (url) => {
    expect(matches(url, 'instagram')).toBe(false);
  });
});

describe('page-world endpoint table — TikTok', () => {
  it.each([
    'https://www.tiktok.com/api/recommend/item_list/?count=16',
    'https://www.tiktok.com/api/post/item_list/?secUid=x',
    'https://www.tiktok.com/api/item_list/',
    'https://www.tiktok.com/api/search/item/?keyword=x',
    'https://www.tiktok.com/api/comment/list/?aweme_id=1',
    'https://www.tiktok.com/aweme/v1/comment/list/reply/',
  ])('reads %s', (url) => {
    expect(matches(url, 'tiktok')).toBe(true);
  });

  it('skips the preload endpoint: it carries items the page has not decided to show', () => {
    expect(matches('https://www.tiktok.com/api/preload/item_list/', 'tiktok')).toBe(false);
  });
});

describe('page-world endpoint table — YouTube', () => {
  it.each([
    'https://www.youtube.com/youtubei/v1/browse?prettyPrint=false',
    'https://www.youtube.com/youtubei/v1/next?prettyPrint=false',
  ])('reads %s', (url) => {
    expect(matches(url, 'youtube')).toBe(true);
  });

  it.each([
    'https://www.youtube.com/youtubei/v1/log_event?alt=json',
    'https://www.youtube.com/youtubei/v1/att/get',
    'https://www.youtube.com/youtubei/v1/player?key=x',
    'https://www.youtube.com/watch?v=x',
  ])('skips %s', (url) => {
    expect(matches(url, 'youtube')).toBe(false);
  });
});
