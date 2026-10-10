// @vitest-environment jsdom
//
// B8 unit 2 (P33), follow-up (the head, IN.md 15:32; F44 measured by the verifier on the product's own code, VERIFY.md 15:31).
// A shortened count is the same number on every platform: "1.2K" and "1,2K" are 1200. Two faults were left after the shared
// parser landed, both on the way TO the parser:
//   1. TikTok read its own counts with a private reader that dropped every comma, so "1,2K" (a decimal comma) was 12000.
//   2. A comment's likes pattern on Instagram and Facebook had no room for the K, so "1.2K likes" gave the record NO like
//      count at all (a missing number, not a wrong one).
// The parser's own table (the-count-parser-reads-the-page-language.test.ts) is not edited: this file holds the call-site
// cases, which need a page or the TikTok reader.

import { describe, it, expect, beforeEach } from 'vitest';
import { InstagramAdapter } from '../../../../src/content/platforms/instagram';
import { FacebookAdapter } from '../../../../src/content/platforms/facebook';
import { parseEngagementNumber } from '../../../../src/content/platforms/tiktok-bundle';
import type { PostContent } from '../../../../src/types/post';

function setLocation(url: string): void {
  Object.defineProperty(window, 'location', { value: new URL(url), writable: true, configurable: true });
}

// ─── TikTok: the count reader ───────────────────────────────────────────────────────────────────────────────────────────

describe('TikTok reads a shortened count the way every other platform does', () => {
  it.each<[string, number | undefined]>([
    ['966', 966],
    ['1,234', 1234],
    ['1.2K', 1200],
    ['1,2K', 1200],
    ['1.2k', 1200],
    ['234K', 234000],
    ['3M', 3000000],
    ['2,5M', 2500000],
    ['2B', 2000000000],
    ['', undefined],
    ['abc', undefined],
  ])('%j reads as %s', (text, expected) => {
    expect(parseEngagementNumber(text)).toBe(expected);
  });
});

// ─── Instagram and Facebook: a comment's likes with a K ────────────────────────────────────────────────────────────────

type Metrics = { likes?: number; reply_count?: number };
const metricsOf = (p: PostContent): Metrics =>
  ((p.platform_specific as unknown as { metrics?: Metrics } | undefined)?.metrics ?? {});

function mountInstagram(chrome: string): void {
  Object.defineProperty(window, 'location', {
    value: { hostname: 'www.instagram.com', pathname: '/reels/AbCdEf123/' }, writable: true, configurable: true,
  });
  document.body.innerHTML = '';
  const main = document.createElement('main');
  const reel = document.createElement('div');
  reel.innerHTML = `
    <video></video>
    <a href="/creator_handle/"><span>creator_handle</span></a>
    <span dir="auto">A reel caption that is long enough to be picked up as caption text.</span>
  `;
  main.appendChild(reel);
  const overlay = document.createElement('div');
  const ul = document.createElement('ul');
  ul.innerHTML = `
    <li>
      <a href="/creator_handle/"><span>creator_handle</span></a>
      <span dir="auto">A reel caption that is long enough to be picked up as caption text.</span>
    </li>
    <li>
      <a href="/viewer_one/"><span>viewer_one</span></a>
      <div><span dir="auto">a perfectly ordinary sentence with no numbers in it at all</span></div>
      ${chrome}
    </li>
  `;
  overlay.appendChild(ul);
  main.appendChild(overlay);
  document.body.appendChild(main);
}

function instagramLikes(): number | undefined {
  const posts = new InstagramAdapter().extractPosts(document.createElement('div').querySelectorAll('article'));
  const c = posts.find((p) => p.kind === 'top-comment');
  expect(c, 'the comment was extracted at all').toBeTruthy();
  return metricsOf(c!).likes;
}

function mountFacebook(chrome: string): void {
  setLocation('https://www.facebook.com/SomePage/posts/123');
  document.body.innerHTML = `
    <div role="article">
      <div data-ad-rendering-role="story_message">
        <div dir="auto">post body long enough for threshold</div>
      </div>
      <div role="article" aria-label="Comment by Maria">
        <a href="/maria" role="link">Maria</a>
        <div dir="auto">a perfectly ordinary comment with no special words</div>
        ${chrome}
      </div>
    </div>`;
}

function facebookLikes(): number | undefined {
  const posts = new FacebookAdapter().extractPosts(document.body.childNodes);
  const c = posts.find((p) => p.kind === 'top-comment');
  expect(c, 'the comment was extracted at all').toBeTruthy();
  return metricsOf(c!).likes;
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('Instagram: a comment showing a shortened like count gets that count', () => {
  it.each<[string, number]>([
    ['41 likes', 41],
    ['1,234 likes', 1234],
    ['1.2K likes', 1200],
    ['1,2K likes', 1200],
    ['3M likes', 3000000],
    ['1.2 K likes', 1200],
  ])('%j gives %s', (chrome, expected) => {
    mountInstagram(`<span>${chrome}</span>`);
    expect(instagramLikes()).toBe(expected);
  });
});

describe('Facebook: a comment showing a shortened like count gets that count', () => {
  it.each<[string, number]>([
    ['12 likes', 12],
    ['1,234 likes', 1234],
    ['1.2K likes', 1200],
    ['1,2K likes', 1200],
    ['3M likes', 3000000],
    ['1.2 K likes', 1200],
  ])('%j gives %s', (chrome, expected) => {
    mountFacebook(`<span>${chrome}</span>`);
    expect(facebookLikes()).toBe(expected);
  });
});

describe('a person\'s own sentence is still not a counter', () => {
  it('Instagram: "got 5K likes" in the body gives no count', () => {
    mountInstagram('');
    document.querySelector('li:nth-of-type(2) span[dir="auto"]')!.textContent = 'honestly I got 5K likes on my last post';
    expect(instagramLikes()).toBeUndefined();
  });

  it('Facebook: "got 5K likes" in the body gives no count', () => {
    mountFacebook('');
    document.querySelector('[aria-label="Comment by Maria"] div[dir="auto"]')!.textContent = 'honestly I got 5K likes on my last post';
    expect(facebookLikes()).toBeUndefined();
  });
});
