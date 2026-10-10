// @vitest-environment jsdom
//
// Receipts says it records no searches. A post with no link of its own keeps
// the address of the page it was seen on, and on a search page that address
// holds the words typed into the search box. The record keeps the page and
// what names a post on it, never the words.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FacebookAdapter } from '../../../../src/content/platforms/facebook';
import { InstagramAdapter } from '../../../../src/content/platforms/instagram';
import { TiktokAdapter, _resetTikTokVideoDedupForTesting } from '../../../../src/content/platforms/tiktok';
import { makeDetailPage } from '../platforms/tiktok-page-fixtures';
import { buildPostUrl } from '../../../../src/content/record/post-url';
import { startMediaTimeout } from '../../../../src/content/engagement/media-timeout';
import { setBlockedRecorder, __resetBlockedRecorderForTest } from '../../../../src/content/engagement/recorder-sink';
import { CURRENT_SETTINGS_SCHEMA_VERSION, type FWSettings } from '../../../../src/storage/settings';
import { teenPreset } from '../../../../src/storage/presets';
import type { BlockedEventInput } from '../../../../src/types/logger-events';
import type { PostContent } from '../../../../src/types/post';

const TYPED = 'words the person typed';
const SYNTHETIC_ID = 'ecfcf8e9-a192-46d7-9f9e-a16f84bd4cf3';

function setLocation(href: string): void {
  Object.defineProperty(window, 'location', {
    value: new URL(href),
    writable: true,
    configurable: true,
  });
}

function makePost(partial: Partial<PostContent>): PostContent {
  return {
    id: '',
    text: 'sample',
    author: '',
    timestamp: new Date().toISOString(),
    platform: 'twitter',
    domRef: new WeakRef(document.createElement('div')),
    feedSource: 'unknown',
    sourceUrl: '',
    ...partial,
  };
}

function expectNoTyping(url: string): void {
  expect(url).not.toContain('words');
  expect(url).not.toContain('?q=');
  expect(url).not.toContain('#');
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('a post with no link of its own, seen on a search page', () => {
  it('Facebook: the record keeps the search page, not the search', () => {
    setLocation(`https://www.facebook.com/search/posts/?q=${encodeURIComponent(TYPED)}#results`);
    const unit = document.createElement('div');
    unit.setAttribute('aria-posinset', '1');
    unit.innerHTML = '<div data-ad-rendering-role="story_message"><span>A search result post body long enough to be extracted as content</span></div>';
    document.body.appendChild(unit);

    const [post] = new FacebookAdapter().extractPosts(document.body.childNodes);
    expect(post).toBeDefined();
    expect(post.sourceUrl).toBe('https://www.facebook.com/search/posts/');
    expect(buildPostUrl(post)).toBe('https://www.facebook.com/search/posts/');
  });

  it('Facebook: a single-post page keeps the parameters that name the post and drops the rest', () => {
    setLocation('https://www.facebook.com/permalink.php?story_fbid=1234567890&id=100001&__cft__=x&ref=search#comments');
    const unit = document.createElement('div');
    unit.setAttribute('aria-posinset', '1');
    unit.innerHTML = '<div data-ad-rendering-role="story_message"><span>A single post body long enough to be extracted as content here</span></div>';
    document.body.appendChild(unit);

    const [post] = new FacebookAdapter().extractPosts(document.body.childNodes);
    expect(post.sourceUrl).toBe('https://www.facebook.com/permalink.php?story_fbid=1234567890&id=100001');
  });

  it('Instagram: a comment under a post with no shortcode keeps the search page, not the search', () => {
    setLocation(`https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(TYPED)}`);
    const article = document.createElement('article');
    article.innerHTML = `
      <a href="/janedoe/" role="link"><span>janedoe</span></a>
      <span dir="auto">Main caption text that is long enough to be extracted by the adapter.</span>
      <ul>
        <li><span>Caption row placeholder ignored by walker</span></li>
        <li>
          <a href="/viewer1/"><span>viewer1</span></a>
          <span>First reaction comment that needs flagging</span>
        </li>
      </ul>
    `;
    const holder = document.createElement('div');
    holder.appendChild(article);

    const posts = new InstagramAdapter().extractPosts(holder.querySelectorAll('article'));
    const comment = posts.find((p) => p.kind === 'top-comment');
    expect(comment).toBeDefined();
    expect(comment!.sourceUrl).toBe('https://www.instagram.com/explore/search/keyword/');
  });

  it('TikTok: a video with no caption, opened from search, keeps the video page, not the search', () => {
    // A search query can ride on a video page's address; the video itself is named by the path.
    _resetTikTokVideoDedupForTesting();
    setLocation(`https://www.tiktok.com/@vlogger/video/7012345678901234567?q=${encodeURIComponent(TYPED)}&t=1700000000000`);
    document.body.appendChild(makeDetailPage({
      caption: '',
      author: 'vlogger',
      comments: [{ author: 'viewer1', text: 'A reaction comment under a music-only video' }],
    }));

    const posts = new TiktokAdapter().extractPosts(document.body.childNodes);
    const video = posts.find((p) => p.kind === 'video');
    const comment = posts.find((p) => p.kind === 'top-comment');
    expect(video).toBeDefined();
    expect(comment).toBeDefined();
    expect(video!.sourceUrl).toBe('https://www.tiktok.com/@vlogger/video/7012345678901234567');
    expect(comment!.sourceUrl).toBe('https://www.tiktok.com/@vlogger/video/7012345678901234567');
  });
});

describe('buildPostUrl, when the page address is all there is', () => {
  it('X: a post whose identity was refused keeps the search page, not the search', () => {
    setLocation(`https://x.com/search?q=${encodeURIComponent(TYPED)}&src=typed_query&f=live`);
    const url = buildPostUrl(makePost({ platform: 'twitter', id: SYNTHETIC_ID, author: 'unknown' }));
    expect(url).toBe('https://x.com/search');
  });

  it('YouTube: the results page keeps no search_query', () => {
    setLocation(`https://www.youtube.com/results?search_query=${encodeURIComponent(TYPED)}`);
    const url = buildPostUrl(makePost({ platform: 'youtube', id: SYNTHETIC_ID }));
    expect(url).toBe('https://www.youtube.com/results');
  });

  it('YouTube: a watch page keeps the video and the playlist, and drops the search it came from', () => {
    // A watch link can carry other parameters, and `pp` can encode the search it came from.
    setLocation('https://www.youtube.com/watch?v=abc123&pp=ygUFd29yZHM%3D&list=PL0001#t=10');
    const url = buildPostUrl(makePost({ platform: 'youtube', id: SYNTHETIC_ID }));
    expect(url).toBe('https://www.youtube.com/watch?v=abc123&list=PL0001');
  });

  it('Instagram, TikTok and Facebook: the search is dropped and the path stays', () => {
    setLocation(`https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(TYPED)}`);
    expect(buildPostUrl(makePost({ platform: 'instagram', id: SYNTHETIC_ID })))
      .toBe('https://www.instagram.com/explore/search/keyword/');

    setLocation(`https://www.tiktok.com/search?q=${encodeURIComponent(TYPED)}&t=1700000000000`);
    const tiktok = buildPostUrl(makePost({ platform: 'tiktok', id: SYNTHETIC_ID, author: '@someone' }));
    expect(tiktok).toBe('https://www.tiktok.com/search');

    setLocation(`https://www.facebook.com/search/top/?q=${encodeURIComponent(TYPED)}`);
    const facebook = buildPostUrl(makePost({ platform: 'facebook', id: 'fb-post-1' }));
    expect(facebook).toBe('https://www.facebook.com/search/top/');
    for (const url of [tiktok, facebook]) expectNoTyping(url);
  });

  it('a post that carries its own link keeps it exactly as it was', () => {
    setLocation(`https://www.facebook.com/search/posts/?q=${encodeURIComponent(TYPED)}`);
    const own = 'https://www.facebook.com/someuser/posts/abc123?comment_id=9';
    expect(buildPostUrl(makePost({ platform: 'facebook', id: 'fb-post-1', sourceUrl: own }))).toBe(own);
  });
});

describe('a blocked item recorded on a search page', () => {
  afterEach(() => {
    __resetBlockedRecorderForTest();
  });

  it('the media timeout record keeps the search page, not the search', () => {
    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener: () => {} } },
      runtime: { sendMessage: () => Promise.resolve() },
    };
    const seen: BlockedEventInput[] = [];
    setBlockedRecorder((payload) => { seen.push(payload); });
    setLocation(`https://www.tiktok.com/search?q=${encodeURIComponent(TYPED)}`);

    const features = teenPreset();
    for (const key of Object.keys(features)) features[key as keyof typeof features].enabled = false;
    features['media-timeout'] = { enabled: true };
    const settings = {
      settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
      mode: 'child',
      features,
    } as unknown as FWSettings;

    const stop = startMediaTimeout('tiktok', settings);
    stop();
    expect(seen).toHaveLength(1);
    expect(seen[0].postUrl).toBe('https://www.tiktok.com/search');
  });
});
