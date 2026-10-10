// @vitest-environment jsdom
//
// LOOP-053 — Twitter adapter DOM-drift resilience.
//
// Locks the behavior that when X rotates the `data-testid="tweetText"`
// attribute (the single most-load-bearing selector in the entire codebase),
// the adapter degrades gracefully via the structural fallback chain
// (`article [lang][dir]` → `article div[lang]`) rather than going dark.
// NOTE: the tweetText DISCOVERY scan is deliberately UNLABELED for
// selector-health — it runs on every MutationObserver node, so most "misses"
// are non-tweet chrome, not drift (see the labeling rule in selector-health.ts).
// Total tweetText breakage is observed via the extraction-canary's
// 0-extractions signal, not a per-query miss counter.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TwitterAdapter } from '../../../src/content/platforms/twitter';
import {
  _resetSelectorHealthForTesting,
  _peekSelectorHealthForTesting,
} from '../../../src/diagnostics/selector-health';

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

beforeEach(() => {
  _resetSelectorHealthForTesting();
  document.body.innerHTML = '';
});

afterEach(() => {
  _resetSelectorHealthForTesting();
  document.body.innerHTML = '';
});

describe('TwitterAdapter — primary selector (data-testid="tweetText")', () => {
  it('extracts tweet text when the primary data-testid is present', () => {
    const root = mount(`
      <article>
        <a href="/TestUser" role="link"><span>Test User</span></a>
        <a href="/TestUser/status/12345" role="link">12:00</a>
        <div data-testid="tweetText" lang="en" dir="ltr">Hello world</div>
      </article>
    `);
    const posts = new TwitterAdapter().extractPosts(root.childNodes);
    expect(posts).toHaveLength(1);
    expect(posts[0].text).toBe('Hello world');
    expect(posts[0].author).toBe('TestUser');
    expect(posts[0].id).toBe('12345');
  });

  it('does NOT feed the tweetText discovery scan to selector-health', () => {
    // The discovery scan runs on every MutationObserver node; labeling it
    // inflated X's miss-rate to ~90% and tripped a false "looks broken"
    // verdict. It is intentionally unlabeled now — lock that so the label is
    // not re-added. Extraction still works (covered above); the per-query
    // counter simply must not exist.
    const root = mount(`
      <article>
        <a href="/TestUser" role="link"><span>Test User</span></a>
        <div data-testid="tweetText" lang="en" dir="ltr">Hello</div>
      </article>
    `);
    const posts = new TwitterAdapter().extractPosts(root.childNodes);
    expect(posts).toHaveLength(1);
    expect(_peekSelectorHealthForTesting()['twitter.post-text']).toBeUndefined();
  });
});

describe('TwitterAdapter — fallback 1 (article [lang][dir]) when primary rotates', () => {
  it('still extracts tweet text when X rotates the data-testid away', () => {
    // Simulate X renaming data-testid="tweetText" to something new.
    const root = mount(`
      <article>
        <a href="/TestUser" role="link"><span>Test User</span></a>
        <a href="/TestUser/status/12345" role="link">12:00</a>
        <div lang="en" dir="ltr">Body text surfaced via lang+dir fallback</div>
      </article>
    `);
    const posts = new TwitterAdapter().extractPosts(root.childNodes);
    expect(posts).toHaveLength(1);
    expect(posts[0].text).toBe('Body text surfaced via lang+dir fallback');
  });
});

describe('TwitterAdapter — fallback 2 (article div[lang]) for legacy variant', () => {
  it('extracts when only the lang attribute is present (no dir)', () => {
    const root = mount(`
      <article>
        <a href="/TestUser" role="link"><span>Test User</span></a>
        <div lang="en">Body text on legacy lang-only variant</div>
      </article>
    `);
    const posts = new TwitterAdapter().extractPosts(root.childNodes);
    expect(posts).toHaveLength(1);
    expect(posts[0].text).toContain('Body text on legacy lang-only variant');
  });
});

describe('TwitterAdapter — graceful degradation when the whole chain fails', () => {
  it('returns no posts (no throw) when neither tweetText nor lang+dir is present', () => {
    const root = mount(`
      <article>
        <a href="/TestUser" role="link"><span>Test User</span></a>
        <div>No lang, no data-testid, nothing recognizable.</div>
      </article>
    `);
    const posts = new TwitterAdapter().extractPosts(root.childNodes);
    // No posts extracted — graceful degradation, no throw.
    expect(posts).toHaveLength(0);
    // The discovery scan is unlabeled by design: a whole-chain miss is NOT
    // recorded as twitter.post-text drift (that would be the artifact). Real
    // total breakage surfaces via the extraction-canary instead.
    expect(_peekSelectorHealthForTesting()['twitter.post-text']).toBeUndefined();
  });
});

describe('TwitterAdapter — author handle fallback', () => {
  it('still extracts the handle via the fallback profile-link chain', () => {
    // role="link" removed — simulate attribute drift. The fallback 2
    // selector `a[href^="/"]` catches any leading-slash anchor.
    const root = mount(`
      <article>
        <a href="/TestUser"><span>Test User</span></a>
        <div lang="en" dir="ltr">body</div>
      </article>
    `);
    const posts = new TwitterAdapter().extractPosts(root.childNodes);
    expect(posts).toHaveLength(1);
    expect(posts[0].author).toBe('TestUser');
    const health = _peekSelectorHealthForTesting();
    // fallback-2 or deeper got us the link
    const h = health['twitter.post-profile-link'];
    expect(h).toBeDefined();
    expect((h.fallback1 ?? 0) + (h.fallback2 ?? 0) + (h.fallbackDeep ?? 0)).toBeGreaterThanOrEqual(1);
  });
});

describe('TwitterAdapter — quote-tweet filter survives chain', () => {
  it('does not double-extract when a tweet contains a nested tweet body', () => {
    const root = mount(`
      <article>
        <a href="/OuterUser" role="link"><span>Outer</span></a>
        <div data-testid="tweetText" lang="en" dir="ltr">Outer body</div>
        <div data-testid="tweetText" lang="en" dir="ltr">Nested quoted body</div>
      </article>
    `);
    const posts = new TwitterAdapter().extractPosts(root.childNodes);
    // Both surfaced — they're SIBLINGS, not nested DOM. The filter only
    // drops tweetText that sits INSIDE another tweetText.
    expect(posts.length).toBeGreaterThanOrEqual(1);
  });

  it('filters nested tweetText when one is a descendant of another', () => {
    const root = mount(`
      <article>
        <a href="/OuterUser" role="link"><span>Outer</span></a>
        <div data-testid="tweetText" lang="en" dir="ltr">
          Outer body wraps
          <div data-testid="tweetText" lang="en" dir="ltr">Inner quoted body</div>
        </div>
      </article>
    `);
    const posts = new TwitterAdapter().extractPosts(root.childNodes);
    // Only the outer counts; inner is filtered out as a descendant.
    expect(posts).toHaveLength(1);
  });
});

describe('TwitterAdapter — §CT-11 author handle attribution (BUG-CT-9.1 root cause)', () => {
  // The documented bug attributed a post to a body mention instead of its
  // author. When the body @-mention link out-orders the author
  // header link in DOM (timeline/hydration-race/virtualizer paths), the
  // pre-§CT-11 _extractHandle returns the body link instead of the header.

  it('returns the AUTHOR header handle when DOM order puts a body @-mention first', () => {
    // Adversarial DOM: body @-mention link appears BEFORE author header link.
    // This is the worst-case ordering that pre-§CT-11 code would mis-handle.
    const root = mount(`
      <article>
        <div data-testid="tweetText" lang="en" dir="ltr">
          Mention <a href="/synthetic_mentioned" role="link"><span>@synthetic_mentioned</span></a>
        </div>
        <a data-testid="User-Name" href="/synthetic_author" role="link"><span>Synthetic Author</span></a>
        <a href="/synthetic_author/status/12345" role="link">12:00</a>
      </article>
    `);
    const posts = new TwitterAdapter().extractPosts(root.childNodes);
    expect(posts).toHaveLength(1);
    // Without the fix this returns the body mention instead of the author.
    expect(posts[0].author).toBe('synthetic_author');
  });

  it('skips quote-tweet author links (nested <article>) in favor of outer author', () => {
    // X renders quote tweets as nested <article> blocks. The outer author
    // header should win over the quoted-author header.
    const root = mount(`
      <article>
        <a href="/OuterAuthor" role="link"><span>Outer</span></a>
        <div data-testid="tweetText" lang="en" dir="ltr">Look at this:</div>
        <a href="/OuterAuthor/status/100" role="link">12:00</a>
        <article>
          <a href="/QuotedAuthor" role="link"><span>Quoted</span></a>
          <div data-testid="tweetText" lang="en" dir="ltr">Quoted body</div>
        </article>
      </article>
    `);
    const posts = new TwitterAdapter().extractPosts(root.childNodes);
    // Outer author wins; the quoted-author link is in a nested <article>.
    const outerPost = posts.find(p => p.text === 'Look at this:');
    expect(outerPost).toBeDefined();
    expect(outerPost!.author).toBe('OuterAuthor');
  });

  it('still extracts handle correctly under normal DOM order (no regression)', () => {
    // Standard X article structure: header link first, body @-mention later.
    // Pre-§CT-11 behavior worked here; verify §CT-11 didn't break it.
    const root = mount(`
      <article>
        <a href="/NormalAuthor" role="link"><span>Normal Author</span></a>
        <a href="/NormalAuthor/status/200" role="link">10:00</a>
        <div data-testid="tweetText" lang="en" dir="ltr">
          Hi <a href="/SomeMention" role="link"><span>@SomeMention</span></a>
        </div>
      </article>
    `);
    const posts = new TwitterAdapter().extractPosts(root.childNodes);
    expect(posts).toHaveLength(1);
    expect(posts[0].author).toBe('NormalAuthor');
  });

  it('does not bind current text to a stale status link from a recycled article', () => {
    const root = mount(`
      <article>
        <a data-testid="User-Name" href="/CurrentAuthor" role="link"><span>Current Author</span></a>
        <a href="/StaleAuthor/status/8100000000000000077" role="link">12:00</a>
        <div data-testid="tweetText" lang="en" dir="ltr">Current occupant body</div>
      </article>
    `);

    const posts = new TwitterAdapter().extractPosts(root.childNodes);

    expect(posts).toHaveLength(1);
    expect(posts[0].author).toBe('unknown');
    expect(posts[0].id).not.toBe('8100000000000000077');
    expect(posts[0].sourceUrl).toBe('');
  });

  it('drops the old identity when a reused article changes only its body', () => {
    const root = mount(`
      <article>
        <a data-testid="User-Name" href="/robj3d3" role="link"><span>robj3d3</span></a>
        <a href="/robj3d3/status/8100000000000000077" role="link">12:00</a>
        <div data-testid="tweetText" lang="en" dir="ltr">Original occupant body</div>
      </article>
    `);
    const adapter = new TwitterAdapter();
    expect(adapter.extractPosts(root.childNodes)[0].id).toBe('8100000000000000077');

    const oldBody = root.querySelector<HTMLElement>('[data-testid="tweetText"]')!;
    oldBody.outerHTML = '<div data-testid="tweetText" lang="en" dir="ltr">New occupant body</div>';
    const newBody = root.querySelector<HTMLElement>('[data-testid="tweetText"]')!;

    const recycled = adapter.extractPosts(root.childNodes);

    expect(recycled).toHaveLength(1);
    expect(recycled[0].text).toBe('New occupant body');
    expect(recycled[0].domRef.deref()).toBe(newBody);
    expect(recycled[0].id).not.toBe('8100000000000000077');
    expect(recycled[0].author).toBe('unknown');
    expect(recycled[0].sourceUrl).toBe('');
    expect(recycled[0].anchorUrl).toBeUndefined();
    expect(recycled[0].parent_id).toBeUndefined();
    expect(recycled[0].parentVideoId).toBeUndefined();
  });

  it('selects the current author status link when a recycled article still contains the old one', () => {
    const root = mount(`
      <article>
        <a data-testid="User-Name" href="/CurrentAuthor" role="link"><span>Current Author</span></a>
        <a href="/StaleAuthor/status/111" role="link">old</a>
        <a href="/CurrentAuthor/status/222" role="link">now</a>
        <div data-testid="tweetText" lang="en" dir="ltr">Current occupant body</div>
      </article>
    `);

    const posts = new TwitterAdapter().extractPosts(root.childNodes);

    expect(posts).toHaveLength(1);
    expect(posts[0].id).toBe('222');
    expect(posts[0].sourceUrl).toBe('https://x.com/CurrentAuthor/status/222');
  });

  it('accepts an absolute X status permalink for an ordinary post', () => {
    const root = mount(`
      <article>
        <a data-testid="User-Name" href="/AbsoluteAuthor" role="link"><span>Absolute Author</span></a>
        <a href="https://x.com/AbsoluteAuthor/status/333" role="link">now</a>
        <div data-testid="tweetText" lang="en" dir="ltr">Absolute link body</div>
      </article>
    `);

    const post = new TwitterAdapter().extractPosts(root.childNodes)[0];

    expect(post.id).toBe('333');
    expect(post.author).toBe('AbsoluteAuthor');
    expect(post.sourceUrl).toBe('https://x.com/AbsoluteAuthor/status/333');
  });

  it('normalizes relative status permalinks with query and fragment suffixes', () => {
    const root = mount(`
      <article>
        <a data-testid="User-Name" href="/SuffixAuthor" role="link"><span>Suffix Author</span></a>
        <a href="/SuffixAuthor/status/334?s=20" role="link">query</a>
        <a href="/SuffixAuthor/status/334#thread" role="link">fragment</a>
        <div data-testid="tweetText" lang="en" dir="ltr">Relative suffix body</div>
      </article>
    `);

    const post = new TwitterAdapter().extractPosts(root.childNodes)[0];

    expect(post.id).toBe('334');
    expect(post.author).toBe('SuffixAuthor');
    expect(post.sourceUrl).toBe('https://x.com/SuffixAuthor/status/334');
  });

  it('keeps status-link fallback use visible in selector health', () => {
    const root = mount(`
      <article>
        <a data-testid="User-Name" href="/FallbackAuthor" role="link"><span>Fallback Author</span></a>
        <a href="/FallbackAuthor/status/444">now</a>
        <div data-testid="tweetText" lang="en" dir="ltr">Fallback status link body</div>
      </article>
    `);

    expect(new TwitterAdapter().extractPosts(root.childNodes)[0].id).toBe('444');
    const health = _peekSelectorHealthForTesting()['twitter.post-status-link'];
    expect(health).toBeDefined();
    expect((health.fallback1 ?? 0) + (health.fallback2 ?? 0) + (health.fallbackDeep ?? 0)).toBeGreaterThanOrEqual(1);
  });

  it('accepts a complete slot recycle when the new post has identical text', () => {
    const root = mount(`
      <div data-testid="cellInnerDiv">
        <article>
          <a data-testid="User-Name" href="/SameTextAuthor" role="link"><span>Same Text Author</span></a>
          <a href="/SameTextAuthor/status/500" role="link">old</a>
          <div data-testid="tweetText" lang="en" dir="ltr">Identical body</div>
        </article>
      </div>
    `);
    const adapter = new TwitterAdapter();
    expect(adapter.extractPosts(root.childNodes)[0].id).toBe('500');

    root.querySelector<HTMLAnchorElement>('a[href*="/status/"]')!.href = '/SameTextAuthor/status/501';
    root.querySelector<HTMLElement>('[data-testid="tweetText"]')!.outerHTML =
      '<div data-testid="tweetText" lang="en" dir="ltr">Identical body</div>';

    const recycled = adapter.extractPosts(root.childNodes)[0];
    expect(recycled.id).toBe('501');
    expect(recycled.author).toBe('SameTextAuthor');
  });

  it('rejects a replaced same-text body while the old identity remains', () => {
    const root = mount(`
      <div data-testid="cellInnerDiv">
        <article>
          <a data-testid="User-Name" href="/StaleSameText" role="link"><span>Stale Same Text</span></a>
          <a href="/StaleSameText/status/600" role="link">old</a>
          <div data-testid="tweetText" lang="en" dir="ltr">Identical body</div>
        </article>
      </div>
    `);
    const adapter = new TwitterAdapter();
    expect(adapter.extractPosts(root.childNodes)[0].id).toBe('600');

    root.querySelector<HTMLElement>('[data-testid="tweetText"]')!.outerHTML =
      '<div data-testid="tweetText" lang="en" dir="ltr">Identical body</div>';

    const recycled = adapter.extractPosts(root.childNodes)[0];
    expect(recycled.id).not.toBe('600');
    expect(recycled.author).toBe('unknown');
    expect(recycled.sourceUrl).toBe('');
  });

  it('falls back to display name when no header profile link exists (only body mentions)', () => {
    // Edge case: article with only body @-mentions (no author header link
    // visible — possibly during hydration). With body @-mentions filtered,
    // _extractHandle returns null and _extractAuthor display-name fallback
    // kicks in via the `??` chain in extractPosts.
    const root = mount(`
      <article>
        <span data-testid="User-Name"><span>Display Name Only</span></span>
        <div data-testid="tweetText" lang="en" dir="ltr">
          I love <a href="/SomeMention" role="link"><span>@SomeMention</span></a>
        </div>
      </article>
    `);
    const posts = new TwitterAdapter().extractPosts(root.childNodes);
    expect(posts).toHaveLength(1);
    // Falls back to display-name extraction (not the body @-mention).
    expect(posts[0].author).not.toBe('SomeMention');
  });
});

describe('TwitterAdapter — the Community Note box is chrome, never the post (Stage 5, 2026-09-07)', () => {
  it('a media-only post whose only lang+dir block is the note header yields no post', () => {
    const root = mount(`
      <article role="article">
        <a href="/SomeUser" role="link"><span>Some</span></a>
        <div data-testid="videoPlayer"></div>
        <div data-testid="birdwatch-pivot">
          <div lang="en" dir="ltr">Readers added a Community Note to this Post:</div>
          <div lang="en" dir="ltr">The note body written by contributors.</div>
        </div>
      </article>
    `);
    const posts = new TwitterAdapter().extractPosts(root.childNodes);
    expect(posts).toHaveLength(0);
  });

  it('a post with a body and a note keeps the body and never the note text', () => {
    const root = mount(`
      <article role="article">
        <a href="/SomeUser" role="link"><span>Some</span></a>
        <div data-testid="tweetText" lang="en" dir="ltr">The author's own words</div>
        <a href="/i/birdwatch/n/123"><div lang="en" dir="ltr">Readers added a Community Note to this Post:</div></a>
      </article>
    `);
    const posts = new TwitterAdapter().extractPosts(root.childNodes);
    expect(posts).toHaveLength(1);
    expect(posts[0].text).toBe("The author's own words");
    expect(posts[0].text).not.toContain('Community Note');
  });
});
