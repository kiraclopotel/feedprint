// Per-platform wire parsers, on synthetic response fixtures.
//
// PLAN-2026-09-14 item 4 asks for each platform: the responses that carry feed
// items, and from each item its id, author handle, text or caption, whether it
// is an ad by the platform's own flag, media presence, and the surface. One
// describe block per platform, asserting exactly those.
//
// The fixtures are written by hand under tests/fixtures/wire/: no real handle,
// no real id and no URL beyond the platform's own host. They are shaped like
// the responses, not copied from one.

import { describe, expect, it } from 'vitest';

import { parseTiktokPayload } from '../../../../../src/content/platforms/wire/tiktok';
import { parseInstagramPayload } from '../../../../../src/content/platforms/wire/instagram';
import { parseFacebookPayload } from '../../../../../src/content/platforms/wire/facebook';
import { parseYoutubePayload } from '../../../../../src/content/platforms/wire/youtube';
import { parseXPayload } from '../../../../../src/content/platforms/wire/x';

import tiktokForYou from '../../../../fixtures/wire/tiktok/item-list-for-you.json';
import instagramTimeline from '../../../../fixtures/wire/instagram/feed-timeline.json';
import facebookFeed from '../../../../fixtures/wire/facebook/feed-graphql.json';
import youtubeHome from '../../../../fixtures/wire/youtube/browse-home.json';
import xHomeFeed from '../../../../fixtures/wire/x/tweet-result-home-feed.json';

describe('wire parser — TikTok', () => {
  const url = 'https://www.tiktok.com/api/recommend/item_list/?count=16';

  it('reads id, handle, caption, the ad flag, media and the surface from the item feed', () => {
    const posts = parseTiktokPayload(url, tiktokForYou, { pathname: '/' });
    // Two items; the live room is not one.
    expect(posts.map((p) => p.id)).toEqual([
      'tk-vid-7000000000000000001',
      'tk-vid-7000000000000000002',
    ]);

    const first = posts[0];
    expect(first.author).toBe('example_creator');
    expect(first.text).toBe('Synthetic caption for a for-you video.');
    expect(first.is_sponsored).toBeUndefined();
    expect(first.mediaUrls).toContain('https://www.tiktok.com/static/synthetic-cover-one.jpeg');
    expect(first.feedSource).toBe('for-you');
    expect(first.kind).toBe('video');

    const ad = posts[1];
    expect(ad.is_sponsored).toBe(true);
    expect(ad.text).toBe('');
    expect(ad.mediaUrls?.length).toBeGreaterThan(0);
  });

  it('reads the surface from the page, not the endpoint (the Following tab shares it)', () => {
    expect(parseTiktokPayload(url, tiktokForYou, { pathname: '/following' })[0].feedSource)
      .toBe('following');
    expect(parseTiktokPayload(url, tiktokForYou, { pathname: '/@example_creator' })[0].feedSource)
      .toBe('profile');
  });

  it('returns [] on a body it does not recognise, and never throws', () => {
    expect(parseTiktokPayload(url, null, { pathname: '/' })).toEqual([]);
    expect(parseTiktokPayload(url, { itemList: [{ nope: 1 }] }, { pathname: '/' })).toEqual([]);
    expect(parseTiktokPayload(url, 'not json', { pathname: '/' })).toEqual([]);
  });
});

describe('wire parser — Instagram', () => {
  const url = 'https://www.instagram.com/graphql/query/?doc_id=0000';

  it('reads shortcode, username, caption, the ad flags, media and the surface', () => {
    const posts = parseInstagramPayload(url, instagramTimeline, { pathname: '/' });
    expect(posts.map((p) => p.id)).toEqual(['SyntheticAA1', 'SyntheticAA2', 'SyntheticAA3']);

    expect(posts[0]).toMatchObject({
      author: 'example_person',
      text: 'Synthetic caption on a photo post.',
      feedSource: 'for-you',
    });
    expect(posts[0].is_sponsored).toBeUndefined();
    expect(posts[0].mediaUrls).toEqual([
      'https://www.instagram.com/static/synthetic-photo-one.jpg',
    ]);

    // `injected` is Instagram's own marker on an ad it slid into the feed.
    expect(posts[1].is_sponsored).toBe(true);
    expect(posts[1].text).toBe('');
    expect(posts[1].platform_specific).toMatchObject({ surfaceKind: 'instagram-reel' });

    // `is_paid_partnership` is the creator's own declaration.
    expect(posts[2].is_sponsored).toBe(true);
    expect(posts[2].platform_specific).toMatchObject({ hasCarousel: true });
    expect(posts[2].mediaUrls).toHaveLength(2);
  });

  it('reads the surface from the page', () => {
    expect(parseInstagramPayload(url, instagramTimeline, { pathname: '/explore/' })[0].feedSource)
      .toBe('for-you');
    expect(parseInstagramPayload(url, instagramTimeline, { pathname: '/example_person/' })[0].feedSource)
      .toBe('profile');
  });

  it('returns [] on a body it does not recognise, and never throws', () => {
    expect(parseInstagramPayload(url, undefined, { pathname: '/' })).toEqual([]);
    expect(parseInstagramPayload(url, { data: { items: [{ code: 'x' }] } }, { pathname: '/' })).toEqual([]);
  });
});

describe('wire parser — Facebook', () => {
  const url = 'https://www.facebook.com/api/graphql/';

  it('reads post_id, actor, message, the sponsored marker, media and the surface', () => {
    const posts = parseFacebookPayload(url, facebookFeed, { pathname: '/' });
    expect(posts.map((p) => p.id)).toEqual(['fb-post-4000000000000001', 'fb-post-4000000000000002']);

    expect(posts[0]).toMatchObject({
      author: 'example_person',
      text: 'Synthetic feed post body.',
      feedSource: 'for-you',
    });
    expect(posts[0].is_sponsored).toBeUndefined();
    expect(posts[0].mediaUrls).toEqual([
      'https://www.facebook.com/static/synthetic-photo-one.jpg',
    ]);

    expect(posts[1].is_sponsored).toBe(true);
    expect(posts[1].author).toBe('example_store');
    expect(posts[1].text).toBe('');
  });

  it('stamps the reel identity on /reel, which is what the DOM adapter uses there', () => {
    const posts = parseFacebookPayload(url, facebookFeed, { pathname: '/reel/4000000000000001' });
    expect(posts[0].id).toBe('fb-vid-4000000000000001');
    expect(posts[0].kind).toBe('video');
    expect(posts[0].platform_specific).toMatchObject({ surfaceKind: 'facebook-reel' });
  });

  it('reads the surface from the page', () => {
    expect(parseFacebookPayload(url, facebookFeed, { pathname: '/groups/123' })[0].feedSource)
      .toBe('following');
  });

  it('returns [] on a body it does not recognise, and never throws', () => {
    expect(parseFacebookPayload(url, null, { pathname: '/' })).toEqual([]);
    expect(parseFacebookPayload(url, { data: {} }, { pathname: '/' })).toEqual([]);
  });
});

describe('wire parser — YouTube', () => {
  const url = 'https://www.youtube.com/youtubei/v1/browse?prettyPrint=false';

  it('reads videoId, channel, title, the ad markers, the thumbnail and the surface', () => {
    const posts = parseYoutubePayload(url, youtubeHome, { pathname: '/' });
    expect(posts.map((p) => p.id)).toEqual([
      'yt-vid-SyntheticV01',
      'yt-vid-SyntheticAd1',
      'yt-vid-SyntheticV02',
    ]);

    expect(posts[0]).toMatchObject({
      author: 'Synthetic Channel One',
      feedSource: 'for-you',
      kind: 'video',
    });
    expect(posts[0].text).toBe('Synthetic home tile title\nA short description snippet.');
    expect(posts[0].is_sponsored).toBeUndefined();
    expect(posts[0].mediaUrls).toContain('https://i.ytimg.com/vi/SyntheticV01/hqdefault.jpg');

    // An adSlotRenderer wraps the tile it sells.
    expect(posts[1].is_sponsored).toBe(true);
    expect(posts[1].author).toBe('Synthetic Advertiser');
    // A BADGE_STYLE_TYPE_AD badge marks a plain videoRenderer that was sold.
    expect(posts[2].is_sponsored).toBe(true);
    expect(posts[2].author).toBe('Synthetic Channel Two');
  });

  it('reads the surface from the page: Home, Subscriptions and the watch rail differ', () => {
    expect(parseYoutubePayload(url, youtubeHome, { pathname: '/feed/subscriptions' })[0].feedSource)
      .toBe('following');
    const watch = parseYoutubePayload(
      'https://www.youtube.com/youtubei/v1/next',
      youtubeHome,
      { pathname: '/watch' },
    );
    expect(watch[0].feedSource).toBe('unknown');
    expect(watch[0].platform_specific).toMatchObject({ surfaceKind: 'youtube-watch' });
    // Off the watch page there is no surfaceKind in this vocabulary for a
    // Home tile, so the field is absent rather than wrong.
    const home = parseYoutubePayload(url, youtubeHome, { pathname: '/' });
    expect((home[0].platform_specific as { surfaceKind?: string }).surfaceKind).toBeUndefined();
  });

  it('returns [] on a body it does not recognise, and never throws', () => {
    expect(parseYoutubePayload(url, null, { pathname: '/' })).toEqual([]);
    expect(parseYoutubePayload(url, { contents: { videoId: 'x' } }, { pathname: '/' })).toEqual([]);
  });
});

describe('wire parser — X', () => {
  it('stamps the surface and reads media off the home-timeline fixture', () => {
    const posts = parseXPayload(
      'https://x.com/i/api/graphql/abc/HomeTimeline',
      xHomeFeed,
      { pathname: '/home' },
    );
    expect(posts.length).toBeGreaterThan(0);
    for (const p of posts) {
      expect(p.platform).toBe('twitter');
      expect(p.feedSource).toBe('for-you');
    }
  });

  it('reads the Following tab as following, and a profile tab as profile', () => {
    const following = parseXPayload(
      'https://x.com/i/api/graphql/abc/HomeLatestTimeline',
      xHomeFeed,
      { pathname: '/home' },
    );
    expect(following[0].feedSource).toBe('following');

    const profile = parseXPayload(
      'https://x.com/i/api/graphql/abc/UserRepliesTimeline',
      xHomeFeed,
      { pathname: '/example_origin/with_replies' },
    );
    expect(profile[0].feedSource).toBe('profile');
    expect(profile[0].platform_specific).toMatchObject({ surfaceKind: 'twitter-profile' });
  });

  it("marks a promoted tweet from X's own promotedMetadata wrapper", () => {
    const promoted = {
      data: {
        home: {
          home_timeline_urt: {
            instructions: [{
              type: 'TimelineAddEntries',
              entries: [{
                entryId: 'promoted-tweet-9200000000000000001',
                content: {
                  itemContent: {
                    itemType: 'TimelineTweet',
                    promotedMetadata: { advertiser_results: {} },
                    tweet_results: {
                      result: {
                        __typename: 'Tweet',
                        rest_id: '9200000000000000001',
                        core: { user_results: { result: { legacy: { screen_name: 'example_brand' } } } },
                        legacy: { full_text: 'Synthetic promoted post body.' },
                      },
                    },
                  },
                },
              }],
            }],
          },
        },
      },
    };
    const posts = parseXPayload('https://x.com/i/api/graphql/abc/HomeTimeline', promoted, { pathname: '/home' });
    expect(posts).toHaveLength(1);
    expect(posts[0].is_sponsored).toBe(true);
    expect(posts[0].author).toBe('example_brand');
  });
});
