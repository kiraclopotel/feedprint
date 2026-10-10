// @vitest-environment jsdom
//
// §CT-26f (2026-05-04) — Twitter adapter Encounter-signal extraction.
//
// Per `.brain/PER_PLATFORM_V1_SPEC_2026-05-04.md` §5.1 and
// `.brain/COMMENT_BURST_MEASUREMENT_X_2026-05-04.md` §3.
//
// Locks the §CT-26f data-layer behavior: each PostContent extracted by
// TwitterAdapter carries `kind` + `depth` + `parent_id` (for permalink
// surfaces) plus `platform_specific.{verified, metrics, communityNotesPresent,
// isQuoteTweet, surfaceKind}` so the Encounter constructor (downstream in
// content/index.ts in §CT-26g+) can lift them into PostNode + CommentNode +
// PlatformSurface fields without re-DOM-walking.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TwitterAdapter } from '../../../../src/content/platforms/twitter';
import {
  _resetSelectorHealthForTesting,
} from '../../../../src/diagnostics/selector-health';
import type { PlatformSpecificMeta } from '../../../../src/types/post';

type TwitterMeta = Extract<PlatformSpecificMeta, { platform: 'twitter' }>;

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

function setLocation(url: string): void {
  // jsdom — re-set window.location.href via the supported `Location.assign`
  // / direct-assign path. Using Object.defineProperty preserves readability
  // of `window.location.pathname` (and other URL parts) inside the adapter.
  delete (window as unknown as { location?: unknown }).location;
  (window as unknown as { location: URL }).location = new URL(url);
}

beforeEach(() => {
  _resetSelectorHealthForTesting();
  document.body.innerHTML = '';
  setLocation('https://x.com/');
});

afterEach(() => {
  _resetSelectorHealthForTesting();
  document.body.innerHTML = '';
});

// ─── Surface detection ──────────────────────────────────────────────────

describe('TwitterAdapter §CT-26f — surface detection from window.location', () => {
  function extractMeta(): TwitterMeta | undefined {
    const root = mount(`
      <article role="article" data-testid="tweet">
        <a href="/User" role="link"><span>U</span></a>
        <a href="/User/status/1" role="link">12:00</a>
        <div data-testid="tweetText" lang="en" dir="ltr">hi</div>
      </article>
    `);
    const posts = new TwitterAdapter().extractPosts(root.childNodes);
    return posts[0]?.platform_specific as TwitterMeta | undefined;
  }

  it('home-feed surface for "/"', () => {
    setLocation('https://x.com/');
    expect(extractMeta()?.surfaceKind).toBe('twitter-home-feed');
  });

  it('home-feed surface for "/home"', () => {
    setLocation('https://x.com/home');
    expect(extractMeta()?.surfaceKind).toBe('twitter-home-feed');
  });

  it('permalink surface for "/<handle>/status/<id>"', () => {
    setLocation('https://x.com/User/status/1');
    expect(extractMeta()?.surfaceKind).toBe('twitter-permalink');
  });

  it('photo-modal surface for "/<handle>/status/<id>/photo/<n>"', () => {
    setLocation('https://x.com/User/status/1/photo/1');
    expect(extractMeta()?.surfaceKind).toBe('twitter-photo-modal');
  });

  it('search surface for "/search?q=..."', () => {
    setLocation('https://x.com/search?q=feelingwise');
    expect(extractMeta()?.surfaceKind).toBe('twitter-search');
  });

  it('list surface for "/i/lists/<id>"', () => {
    setLocation('https://x.com/i/lists/12345');
    expect(extractMeta()?.surfaceKind).toBe('twitter-list');
  });

  it('profile surface for "/<handle>"', () => {
    setLocation('https://x.com/SomeUser');
    expect(extractMeta()?.surfaceKind).toBe('twitter-profile');
  });
});

// ─── Per-article metrics extraction ─────────────────────────────────────

describe('TwitterAdapter §CT-26f — per-article metrics extraction', () => {
  function extractFirstMetrics(html: string): TwitterMeta['metrics'] {
    const root = mount(html);
    const posts = new TwitterAdapter().extractPosts(root.childNodes);
    const meta = posts[0]?.platform_specific as TwitterMeta | undefined;
    return meta?.metrics;
  }

  it('parses likes / retweets / replies / bookmarks via [data-testid="*"] count cells', () => {
    const m = extractFirstMetrics(`
      <article role="article" data-testid="tweet">
        <a href="/U" role="link"><span>U</span></a>
        <a href="/U/status/1" role="link">12:00</a>
        <div data-testid="tweetText" lang="en" dir="ltr">post</div>
        <div data-testid="reply">
          <div data-testid="app-text-transition-container">39</div>
        </div>
        <div data-testid="retweet">
          <div data-testid="app-text-transition-container">71</div>
        </div>
        <div data-testid="like">
          <div data-testid="app-text-transition-container">4.4K</div>
        </div>
        <div data-testid="bookmark">
          <div data-testid="app-text-transition-container">423</div>
        </div>
      </article>
    `);
    expect(m?.likes).toBe(4400);
    expect(m?.retweets).toBe(71);
    expect(m?.replies).toBe(39);
    expect(m?.bookmarks).toBe(423);
  });

  it('parses K / M / B suffixes and comma-separated counts', () => {
    const m = extractFirstMetrics(`
      <article role="article" data-testid="tweet">
        <a href="/U" role="link"><span>U</span></a>
        <a href="/U/status/1" role="link">12:00</a>
        <div data-testid="tweetText" lang="en" dir="ltr">post</div>
        <div data-testid="like">
          <div data-testid="app-text-transition-container">2.5M</div>
        </div>
        <div data-testid="retweet">
          <div data-testid="app-text-transition-container">5,300</div>
        </div>
        <div data-testid="reply">
          <div data-testid="app-text-transition-container">1B</div>
        </div>
      </article>
    `);
    expect(m?.likes).toBe(2_500_000);
    expect(m?.retweets).toBe(5_300);
    expect(m?.replies).toBe(1_000_000_000);
  });

  it('falls back to "unlike" / "removeBookmark" toggled selectors when user already engaged', () => {
    const m = extractFirstMetrics(`
      <article role="article" data-testid="tweet">
        <a href="/U" role="link"><span>U</span></a>
        <a href="/U/status/1" role="link">12:00</a>
        <div data-testid="tweetText" lang="en" dir="ltr">post</div>
        <div data-testid="unlike">
          <div data-testid="app-text-transition-container">100</div>
        </div>
        <div data-testid="removeBookmark">
          <div data-testid="app-text-transition-container">5</div>
        </div>
      </article>
    `);
    expect(m?.likes).toBe(100);
    expect(m?.bookmarks).toBe(5);
  });

  it('returns undefined for empty engagement cells (preserves "0 vs unknown")', () => {
    const m = extractFirstMetrics(`
      <article role="article" data-testid="tweet">
        <a href="/U" role="link"><span>U</span></a>
        <a href="/U/status/1" role="link">12:00</a>
        <div data-testid="tweetText" lang="en" dir="ltr">post</div>
        <div data-testid="like">
          <div data-testid="app-text-transition-container"></div>
        </div>
      </article>
    `);
    expect(m?.likes).toBeUndefined();
  });

  it('parses views from analytics anchor (root-post-only signal)', () => {
    const m = extractFirstMetrics(`
      <article role="article" data-testid="tweet">
        <a href="/U" role="link"><span>U</span></a>
        <a href="/U/status/1" role="link">12:00</a>
        <a href="/U/status/1/analytics">629.9K Views</a>
        <div data-testid="tweetText" lang="en" dir="ltr">post</div>
      </article>
    `);
    expect(m?.views).toBe(629_900);
  });
});

// ─── Verified / community notes / quote tweet flags ─────────────────────

describe('TwitterAdapter §CT-26f — author + post flags', () => {
  function extractMeta(html: string): TwitterMeta | undefined {
    const root = mount(html);
    const posts = new TwitterAdapter().extractPosts(root.childNodes);
    return posts[0]?.platform_specific as TwitterMeta | undefined;
  }

  it('verified=true when [data-testid="icon-verified"] present', () => {
    const meta = extractMeta(`
      <article role="article" data-testid="tweet">
        <a href="/U" role="link"><span>U</span></a>
        <a href="/U/status/1" role="link">12:00</a>
        <svg data-testid="icon-verified"></svg>
        <div data-testid="tweetText" lang="en" dir="ltr">post</div>
      </article>
    `);
    expect(meta?.verified).toBe(true);
  });

  it('verified=false when no badge', () => {
    const meta = extractMeta(`
      <article role="article" data-testid="tweet">
        <a href="/U" role="link"><span>U</span></a>
        <a href="/U/status/1" role="link">12:00</a>
        <div data-testid="tweetText" lang="en" dir="ltr">post</div>
      </article>
    `);
    expect(meta?.verified).toBe(false);
  });

  it('communityNotesPresent=true when birdwatch-pivot OR /i/birdwatch/ link present', () => {
    const m1 = extractMeta(`
      <article role="article" data-testid="tweet">
        <a href="/U" role="link"><span>U</span></a>
        <a href="/U/status/1" role="link">12:00</a>
        <div data-testid="tweetText" lang="en" dir="ltr">post</div>
        <div data-testid="birdwatch-pivot">Note pivot</div>
      </article>
    `);
    expect(m1?.communityNotesPresent).toBe(true);

    const m2 = extractMeta(`
      <article role="article" data-testid="tweet">
        <a href="/U" role="link"><span>U</span></a>
        <a href="/U/status/1" role="link">12:00</a>
        <div data-testid="tweetText" lang="en" dir="ltr">post</div>
        <a href="/i/birdwatch/n/12345">Readers added context</a>
      </article>
    `);
    expect(m2?.communityNotesPresent).toBe(true);
  });

  it('isQuoteTweet=true when nested <article role="link"> with [data-testid="tweetText"] is embedded', () => {
    const meta = extractMeta(`
      <article role="article" data-testid="tweet">
        <a href="/U" role="link"><span>U</span></a>
        <a href="/U/status/1" role="link">12:00</a>
        <div data-testid="tweetText" lang="en" dir="ltr">outer post</div>
        <article role="link">
          <a href="/Other" role="link"><span>O</span></a>
          <div data-testid="tweetText" lang="en" dir="ltr">quoted text</div>
        </article>
      </article>
    `);
    expect(meta?.isQuoteTweet).toBe(true);
  });

  it('isQuoteTweet=false for a plain tweet with no embed', () => {
    const meta = extractMeta(`
      <article role="article" data-testid="tweet">
        <a href="/U" role="link"><span>U</span></a>
        <a href="/U/status/1" role="link">12:00</a>
        <div data-testid="tweetText" lang="en" dir="ltr">plain</div>
      </article>
    `);
    expect(meta?.isQuoteTweet).toBe(false);
  });
});

// ─── Permalink tree walk: kind / depth / parent_id ──────────────────────

describe('TwitterAdapter §CT-26f — permalink tree walk', () => {
  beforeEach(() => {
    setLocation('https://x.com/synthetic_focus/status/8100000000000000003');
  });

  it('synthetic nested-harm page: post / ancestor-comment / focused / children depth+kind+parent_id', () => {
    // Mirror of the §CT-26e measurement structure: idx 0 = post, idx 1 =
    // ancestor comment, idx 2 = focused (tabindex=-1), idx 3-5 = children.
    const root = mount(`
      <div>
        <article role="article" data-testid="tweet">
          <a href="/synthetic_root" role="link"><span>synthetic_root</span></a>
          <a href="/synthetic_root/status/8100000000000000001" role="link">5h</a>
          <div data-testid="tweetText" lang="en" dir="ltr">synthetic root</div>
        </article>
        <article role="article" data-testid="tweet">
          <a href="/synthetic_ancestor" role="link"><span>synthetic_ancestor</span></a>
          <a href="/synthetic_ancestor/status/8100000000000000002" role="link">5h</a>
          <div data-testid="tweetText" lang="en" dir="ltr">grandparent text</div>
        </article>
        <article role="article" data-testid="tweet" tabindex="-1">
          <a href="/synthetic_focus" role="link"><span>synthetic_focus</span></a>
          <a href="/synthetic_focus/status/8100000000000000003" role="link">3h</a>
          <div data-testid="tweetText" lang="en" dir="ltr">focused text</div>
        </article>
        <article role="article" data-testid="tweet">
          <a href="/synthetic_child_a" role="link"><span>synthetic_child_a</span></a>
          <a href="/synthetic_child_a/status/3001" role="link">2h</a>
          <div data-testid="tweetText" lang="en" dir="ltr">child 1</div>
        </article>
        <article role="article" data-testid="tweet">
          <a href="/synthetic_child_b" role="link"><span>synthetic_child_b</span></a>
          <a href="/synthetic_child_b/status/3002" role="link">1h</a>
          <div data-testid="tweetText" lang="en" dir="ltr">synthetic harmful reply</div>
        </article>
        <article role="article" data-testid="tweet">
          <a href="/synthetic_child_c" role="link"><span>synthetic_child_c</span></a>
          <a href="/synthetic_child_c/status/3003" role="link">3h</a>
          <div data-testid="tweetText" lang="en" dir="ltr">child 3</div>
        </article>
      </div>
    `);
    const posts = new TwitterAdapter().extractPosts(root.childNodes);
    // Posts order matches DOM iteration; map by tweet id for assertions.
    const byId = new Map(posts.map(p => [p.id, p]));

    const post = byId.get('8100000000000000001');
    expect(post?.kind).toBe('post');
    expect(post?.depth).toBe(0);
    expect(post?.parent_id).toBeUndefined();
    // §CT-26g.2.2 — post is depth=0; not a child-of-focused → no parentVideoId.
    expect(post?.parentVideoId).toBeUndefined();

    const grand = byId.get('8100000000000000002');
    expect(grand?.kind).toBe('top-comment');
    expect(grand?.depth).toBe(1);
    expect(grand?.parent_id).toBe('8100000000000000001');
    // §CT-26g.2.2 — ancestor; not a child-of-focused → no parentVideoId,
    // falls through to per-post pipeline (its chain record still gets
    // a depth=1 mirror).
    expect(grand?.parentVideoId).toBeUndefined();

    const focused = byId.get('8100000000000000003');
    expect(focused?.kind).toBe('reply');
    expect(focused?.depth).toBe(2);
    expect(focused?.parent_id).toBe('8100000000000000002');
    // §CT-26g.2.2 — focused itself is the user's focal article; not a
    // child-of-focused (it IS focused) → no parentVideoId, per-post pipeline.
    expect(focused?.parentVideoId).toBeUndefined();

    const c1 = byId.get('3001');
    expect(c1?.kind).toBe('reply-to-reply');
    expect(c1?.depth).toBe(3);
    expect(c1?.parent_id).toBe('8100000000000000003');
    // §CT-26g.2.2 — child-of-focused → parentVideoId = focused-tweet-id;
    // routes to comment-batch path which buildEncounterForFlushBatch
    // lifts into rich Encounter.children with [ANCESTRY] context.
    expect(c1?.parentVideoId).toBe('8100000000000000003');

    const cMerde = byId.get('3002');
    expect(cMerde?.kind).toBe('reply-to-reply');
    expect(cMerde?.depth).toBe(3);
    expect(cMerde?.parent_id).toBe('8100000000000000003');
    // §CT-26g.2.2 — same as c1: the single-slur case routes to comment-batch.
    expect(cMerde?.parentVideoId).toBe('8100000000000000003');
  });

  it('uses the focused article current status when a stale permalink is still mounted first', () => {
    const root = mount(`
      <div>
        <article role="article" data-testid="tweet" tabindex="-1">
          <a data-testid="User-Name" href="/CurrentFocus" role="link"><span>Current Focus</span></a>
          <a href="/StaleFocus/status/111" role="link">old</a>
          <a href="/CurrentFocus/status/222" role="link">now</a>
          <div data-testid="tweetText" lang="en" dir="ltr">focused text</div>
        </article>
        <article role="article" data-testid="tweet">
          <a data-testid="User-Name" href="/ChildAuthor" role="link"><span>Child Author</span></a>
          <a href="/ChildAuthor/status/333" role="link">reply</a>
          <div data-testid="tweetText" lang="en" dir="ltr">child text</div>
        </article>
      </div>
    `);

    const byId = new Map(new TwitterAdapter().extractPosts(root.childNodes).map(post => [post.id, post]));
    const child = byId.get('333');

    expect(byId.get('222')).toBeDefined();
    expect(child?.parent_id).toBe('222');
    expect(child?.parentVideoId).toBe('222');
  });

  it('removes child parent binding when the focused slot changes only its body', () => {
    const root = mount(`
      <div>
        <div data-testid="cellInnerDiv">
          <article role="article" data-testid="tweet" tabindex="-1">
            <a data-testid="User-Name" href="/FocusedAuthor" role="link"><span>Focused Author</span></a>
            <a href="/FocusedAuthor/status/700" role="link">focus</a>
            <div data-testid="tweetText" lang="en" dir="ltr">original focused body</div>
          </article>
        </div>
        <article role="article" data-testid="tweet">
          <a data-testid="User-Name" href="/ChildAuthor" role="link"><span>Child Author</span></a>
          <a href="/ChildAuthor/status/800" role="link">reply</a>
          <div data-testid="tweetText" lang="en" dir="ltr">child body</div>
        </article>
      </div>
    `);
    const adapter = new TwitterAdapter();
    const first = new Map(adapter.extractPosts(root.childNodes).map(post => [post.id, post]));
    expect(first.get('800')?.parent_id).toBe('700');

    root.querySelector<HTMLElement>('[data-testid="cellInnerDiv"] [data-testid="tweetText"]')!.outerHTML =
      '<div data-testid="tweetText" lang="en" dir="ltr">new focused body</div>';
    const recycled = adapter.extractPosts(root.childNodes);
    const child = recycled.find(post => post.id === '800');

    expect(recycled.some(post => post.id === '700')).toBe(false);
    expect(child?.parent_id).toBeUndefined();
    expect(child?.parentVideoId).toBeUndefined();
  });

  it('waits for a focused truncated post to expand before binding its identity', () => {
    const root = mount(`
      <div>
        <div data-testid="cellInnerDiv">
          <article role="article" data-testid="tweet" tabindex="-1">
            <a data-testid="User-Name" href="/ExpandedAuthor" role="link"><span>Expanded Author</span></a>
            <a href="/ExpandedAuthor/status/900" role="link">focus</a>
            <div data-testid="tweetText" lang="en" dir="ltr">partial focused body</div>
            <button data-testid="tweet-text-show-more-link">Show more</button>
          </article>
        </div>
        <article role="article" data-testid="tweet">
          <a data-testid="User-Name" href="/ChildAuthor" role="link"><span>Child Author</span></a>
          <a href="/ChildAuthor/status/901" role="link">reply</a>
          <div data-testid="tweetText" lang="en" dir="ltr">child body</div>
        </article>
      </div>
    `);
    const adapter = new TwitterAdapter();
    const partial = adapter.extractPosts(root.childNodes);

    expect(partial.some(post => post.id === '900')).toBe(false);
    expect(partial.find(post => post.id === '901')?.parent_id).toBeUndefined();

    root.querySelector('[data-testid="tweet-text-show-more-link"]')!.remove();
    root.querySelector<HTMLElement>('[data-testid="cellInnerDiv"] [data-testid="tweetText"]')!.textContent =
      'complete expanded focused body';
    const expanded = new Map(adapter.extractPosts(root.childNodes).map(post => [post.id, post]));

    expect(expanded.get('900')?.author).toBe('ExpandedAuthor');
    expect(expanded.get('901')?.parent_id).toBe('900');
    expect(expanded.get('901')?.parentVideoId).toBe('900');
  });

  it('home-feed (no tabindex=-1) → every article is depth=0 / kind=post / no parent_id', () => {
    setLocation('https://x.com/home');
    const root = mount(`
      <div>
        <article role="article" data-testid="tweet">
          <a href="/A" role="link"><span>A</span></a>
          <a href="/A/status/1" role="link">5h</a>
          <div data-testid="tweetText" lang="en" dir="ltr">a</div>
        </article>
        <article role="article" data-testid="tweet">
          <a href="/B" role="link"><span>B</span></a>
          <a href="/B/status/2" role="link">5h</a>
          <div data-testid="tweetText" lang="en" dir="ltr">b</div>
        </article>
      </div>
    `);
    const posts = new TwitterAdapter().extractPosts(root.childNodes);
    expect(posts).toHaveLength(2);
    for (const p of posts) {
      expect(p.kind).toBe('post');
      expect(p.depth).toBe(0);
      expect(p.parent_id).toBeUndefined();
    }
  });
});

// ─── Integration: extractPosts produces fully-populated PostContent ─────

describe('TwitterAdapter §CT-26f — extractPosts integration', () => {
  it('extracted post carries platform_specific.{surfaceKind,verified,metrics,communityNotesPresent,isQuoteTweet}', () => {
    setLocation('https://x.com/U/status/123');
    const root = mount(`
      <article role="article" data-testid="tweet" tabindex="-1">
        <a href="/U" role="link"><span>U</span></a>
        <a href="/U/status/123" role="link">12:00</a>
        <svg data-testid="icon-verified"></svg>
        <div data-testid="tweetText" lang="en" dir="ltr">hi</div>
        <div data-testid="reply">
          <div data-testid="app-text-transition-container">5</div>
        </div>
        <div data-testid="like">
          <div data-testid="app-text-transition-container">100</div>
        </div>
      </article>
    `);
    const posts = new TwitterAdapter().extractPosts(root.childNodes);
    expect(posts).toHaveLength(1);
    const meta = posts[0].platform_specific as TwitterMeta;
    expect(meta.platform).toBe('twitter');
    expect(meta.surfaceKind).toBe('twitter-permalink');
    expect(meta.verified).toBe(true);
    expect(meta.metrics?.likes).toBe(100);
    expect(meta.metrics?.replies).toBe(5);
    expect(meta.communityNotesPresent).toBe(false);
    expect(meta.isQuoteTweet).toBe(false);
  });

  it('extracted post on permalink with focused: kind/depth/parent_id reflect tabindex anchor', () => {
    setLocation('https://x.com/U/status/123');
    const root = mount(`
      <div>
        <article role="article" data-testid="tweet">
          <a href="/Origin" role="link"><span>Origin</span></a>
          <a href="/Origin/status/100" role="link">5h</a>
          <div data-testid="tweetText" lang="en" dir="ltr">origin post</div>
        </article>
        <article role="article" data-testid="tweet" tabindex="-1">
          <a href="/U" role="link"><span>U</span></a>
          <a href="/U/status/123" role="link">12:00</a>
          <div data-testid="tweetText" lang="en" dir="ltr">focused reply</div>
        </article>
      </div>
    `);
    const posts = new TwitterAdapter().extractPosts(root.childNodes);
    const focused = posts.find(p => p.id === '123');
    expect(focused?.kind).toBe('top-comment');
    expect(focused?.depth).toBe(1);
    expect(focused?.parent_id).toBe('100');
  });
});

// ─── anchorUrl: per-comment deep-link (reuses the node's own status URL) ──
//
// On X every node is a status with its own `/status/<id>` permalink. For a
// reply (depth ≥ 1) that URL lands the recipient ON the exact reply, so the
// adapter sets `anchorUrl` to it. The post (depth 0) leaves anchorUrl
// undefined — its `sourceUrl` already IS the address (the export falls back
// to postUrl). No new selector: anchorUrl reuses the per-node sourceUrl.

describe('TwitterAdapter — anchorUrl per-comment deep-link', () => {
  beforeEach(() => {
    setLocation('https://x.com/synthetic_focus/status/8100000000000000003');
  });

  it('replies (depth ≥ 1) carry their own status URL as anchorUrl; the post (depth 0) does not', () => {
    const root = mount(`
      <div>
        <article role="article" data-testid="tweet">
          <a href="/synthetic_root" role="link"><span>synthetic_root</span></a>
          <a href="/synthetic_root/status/8100000000000000001" role="link">5h</a>
          <div data-testid="tweetText" lang="en" dir="ltr">root post</div>
        </article>
        <article role="article" data-testid="tweet" tabindex="-1">
          <a href="/synthetic_focus" role="link"><span>synthetic_focus</span></a>
          <a href="/synthetic_focus/status/8100000000000000003" role="link">3h</a>
          <div data-testid="tweetText" lang="en" dir="ltr">focused reply</div>
        </article>
        <article role="article" data-testid="tweet">
          <a href="/synthetic_child_a" role="link"><span>synthetic_child_a</span></a>
          <a href="/synthetic_child_a/status/3001" role="link">2h</a>
          <div data-testid="tweetText" lang="en" dir="ltr">child reply</div>
        </article>
      </div>
    `);
    const posts = new TwitterAdapter().extractPosts(root.childNodes);
    const byId = new Map(posts.map(p => [p.id, p]));

    const post = byId.get('8100000000000000001');
    expect(post?.depth).toBe(0);
    expect(post?.anchorUrl).toBeUndefined();

    const focused = byId.get('8100000000000000003');
    expect(focused?.depth).toBeGreaterThanOrEqual(1);
    expect(focused?.anchorUrl).toBe('https://x.com/synthetic_focus/status/8100000000000000003');

    const child = byId.get('3001');
    expect(child?.depth).toBeGreaterThanOrEqual(1);
    expect(child?.anchorUrl).toBe('https://x.com/synthetic_child_a/status/3001');
  });

  it('home-feed posts (depth 0) leave anchorUrl undefined', () => {
    setLocation('https://x.com/home');
    const root = mount(`
      <article role="article" data-testid="tweet">
        <a href="/A" role="link"><span>A</span></a>
        <a href="/A/status/1" role="link">5h</a>
        <div data-testid="tweetText" lang="en" dir="ltr">a</div>
      </article>
    `);
    const posts = new TwitterAdapter().extractPosts(root.childNodes);
    expect(posts[0]?.depth).toBe(0);
    expect(posts[0]?.anchorUrl).toBeUndefined();
  });
});

// ─── M1: no dead /status/<uuid> sourceUrl for synthetic-id tweets ─────────

describe('TwitterAdapter M1 — synthetic-UUID tweet id yields no /status URL', () => {
  const UUID_RE = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i;

  it('a tweet with no status link (UUID-id fallback) emits no /status/<uuid> sourceUrl', () => {
    setLocation('https://x.com/home');
    const root = mount(`
      <article role="article" data-testid="tweet">
        <a href="/SomeUser" role="link"><span>SomeUser</span></a>
        <div data-testid="tweetText" lang="en" dir="ltr">a post with no permalink anchor yet</div>
      </article>
    `);
    const posts = new TwitterAdapter().extractPosts(root.childNodes);
    expect(posts).toHaveLength(1);
    // id stays the synthetic UUID (record id unchanged)…
    expect(posts[0]?.id).toMatch(UUID_RE);
    // …but the sourceUrl must NOT embed it in a guaranteed-dead /status/ URL.
    expect(posts[0]?.sourceUrl ?? '').not.toContain('/status/');
    expect(posts[0]?.sourceUrl ?? '').toBe('');
  });

  it('a tweet with a real numeric status id still gets a /status/<id> sourceUrl', () => {
    setLocation('https://x.com/home');
    const root = mount(`
      <article role="article" data-testid="tweet">
        <a href="/RealUser" role="link"><span>RealUser</span></a>
        <a href="/RealUser/status/1234567890" role="link">5h</a>
        <div data-testid="tweetText" lang="en" dir="ltr">real post</div>
      </article>
    `);
    const posts = new TwitterAdapter().extractPosts(root.childNodes);
    expect(posts[0]?.id).toBe('1234567890');
    expect(posts[0]?.sourceUrl).toBe('https://x.com/RealUser/status/1234567890');
  });
});
