// @vitest-environment jsdom
//
// X-1 (audit swarm-2026-07-13 §04-platform-x) — permalink-tree temporal
// coherence.
//
// M66's `_coherentIdentityForArticle` gate guards ONLY the instance
// `extractPosts` own-id binding. The permalink-tree consumers
// (`walkPermalinkTree` / `buildPermalinkEncounterContext` / `articleToCommentNode`)
// resolve ancestor / parent / root / focused ids through the module-level
// `extractArticleTweetId` funnel, which did atomic-only resolution. A recycled
// slot caught mid-hydration — previous occupant's header + status link but the
// NEXT occupant's fully-rendered body — is internally consistent at the instant
// of parsing, so the atomic resolver returns the STALE id. That stale id then
// became a child record's `parent_id` and the classifier's Encounter parent.
//
// These tests lock: the recycled ancestor id must be REFUSED (degrade to the
// synthetic/uncertain fail path), never bound as a stale parent; and ordinary
// stable ancestors must still resolve (no regression).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildPermalinkEncounterContext,
  TwitterAdapter,
} from '../../../../src/content/platforms/twitter';

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

function setLocation(url: string): void {
  delete (window as unknown as { location?: unknown }).location;
  (window as unknown as { location: URL }).location = new URL(url);
}

beforeEach(() => {
  document.body.innerHTML = '';
  setLocation('https://x.com/focus_author/status/300');
});

afterEach(() => {
  document.body.innerHTML = '';
});

// A permalink tree: root post (slot A) → focused reply (tabindex=-1) → child.
// The root lives in its own recyclable `cellInnerDiv` slot so we can simulate
// the virtualizer swapping its body while the header/status-link lag behind.
function mountRecyclableTree(rootBody: string): HTMLElement {
  return mount(`
    <div>
      <div data-testid="cellInnerDiv">
        <article role="article" data-testid="tweet">
          <a data-testid="User-Name" href="/root_author" role="link"><span>Root Author</span></a>
          <a href="/root_author/status/100" role="link">5h</a>
          <div data-testid="tweetText" lang="en" dir="ltr">${rootBody}</div>
        </article>
      </div>
      <article role="article" data-testid="tweet" tabindex="-1">
        <a data-testid="User-Name" href="/focus_author" role="link"><span>Focus Author</span></a>
        <a href="/focus_author/status/300" role="link">3h</a>
        <div data-testid="tweetText" lang="en" dir="ltr">focused reply body</div>
      </article>
    </div>
  `);
}

describe('X-1 — permalink-tree id resolution honors temporal coherence', () => {
  it('refuses a recycled root whose body changed while its stale status link stayed (no stale parent)', () => {
    const root = mountRecyclableTree('original root body');

    // First pass: fully-hydrated root — coherent, id resolves to 100.
    const first = buildPermalinkEncounterContext();
    expect(first).not.toBeNull();
    expect(first!.post.id).toBe('100');
    expect(first!.conversationId).toBe('100');

    // Recycle: the virtualizer swaps in the NEXT occupant's body but the
    // header + `/status/100` link still belong to the previous occupant
    // (mid-hydration). Atomic resolution would return the STALE 100.
    root.querySelector<HTMLElement>('[data-testid="cellInnerDiv"] [data-testid="tweetText"]')!.outerHTML =
      '<div data-testid="tweetText" lang="en" dir="ltr">a completely different next-occupant body</div>';

    const recycled = buildPermalinkEncounterContext();

    // The stale id must NOT be bound. Refusing the root id makes
    // buildPermalinkEncounterContext return null (fail-safe → legacy fallback),
    // rather than emitting an Encounter rooted on the wrong (stale) identity.
    expect(recycled).toBeNull();
  });

  it('still resolves ordinary stable ancestors across repeated passes (no regression)', () => {
    mountRecyclableTree('stable root body');

    const a = buildPermalinkEncounterContext();
    const b = buildPermalinkEncounterContext();

    for (const ctx of [a, b]) {
      expect(ctx).not.toBeNull();
      expect(ctx!.post.id).toBe('100');
      expect(ctx!.post.author.handle).toBe('root_author');
      expect(ctx!.conversationId).toBe('100');
      // focused reply's parent is the stable root id.
      expect('parent_id' in ctx!.focused ? ctx!.focused.parent_id : undefined).toBe('100');
    }
  });

  it('accepts a genuine full recycle (id AND body both change together)', () => {
    const root = mountRecyclableTree('first occupant body');
    expect(buildPermalinkEncounterContext()!.post.id).toBe('100');

    // Genuine recycle: BOTH the status link id and the body change together.
    const slot = root.querySelector<HTMLElement>('[data-testid="cellInnerDiv"]')!;
    slot.querySelector<HTMLAnchorElement>('a[href*="/status/"]')!.setAttribute('href', '/root_author/status/999');
    slot.querySelector<HTMLElement>('[data-testid="tweetText"]')!.outerHTML =
      '<div data-testid="tweetText" lang="en" dir="ltr">second occupant body</div>';

    const recycled = buildPermalinkEncounterContext();
    expect(recycled).not.toBeNull();
    expect(recycled!.post.id).toBe('999');
  });
});

// X-2 — DM/chat overlay articles must not enter the Encounter. Parity with
// walkPermalinkTree, which already applies the findChatOverlayAncestor filter.
describe('X-2 — buildPermalinkEncounterContext excludes chat-overlay articles', () => {
  it('ignores articles mounted inside a [role="dialog"] chat overlay', () => {
    mount(`
      <div>
        <div role="dialog" aria-label="Messages">
          <article role="article" data-testid="tweet" tabindex="-1">
            <a data-testid="User-Name" href="/dm_partner" role="link"><span>DM Partner</span></a>
            <a href="/dm_partner/status/555" role="link">now</a>
            <div data-testid="tweetText" lang="en" dir="ltr">private DM-shaped article body</div>
          </article>
        </div>
        <article role="article" data-testid="tweet">
          <a data-testid="User-Name" href="/public_poster" role="link"><span>Public Poster</span></a>
          <a href="/public_poster/status/700" role="link">5h</a>
          <div data-testid="tweetText" lang="en" dir="ltr">public post body</div>
        </article>
        <article role="article" data-testid="tweet" tabindex="-1">
          <a data-testid="User-Name" href="/public_focus" role="link"><span>Public Focus</span></a>
          <a href="/public_focus/status/800" role="link">3h</a>
          <div data-testid="tweetText" lang="en" dir="ltr">public focused body</div>
        </article>
      </div>
    `);

    const ctx = buildPermalinkEncounterContext();
    expect(ctx).not.toBeNull();
    // The overlay article (555) must be filtered out; the public post (700)
    // is articles[0] → the Encounter root, not the DM article.
    expect(ctx!.post.id).toBe('700');
    expect(ctx!.conversationId).toBe('700');
    const ids = [ctx!.post.id, ...ctx!.ancestors.map((a) => a.id), ctx!.focused.id];
    expect(ids).not.toContain('555');
  });
});

describe('X-3 — the parent\'s text travels with the item (2026-09-07, X-ray C3)', () => {
  it('an ancestor reply carries the root\'s text, a child of the focused carries the focused text, the root carries none', () => {
    const root = mount(`
      <div>
        <article role="article" data-testid="tweet">
          <a data-testid="User-Name" href="/root_author" role="link"><span>Root Author</span></a>
          <a href="/root_author/status/100" role="link">5h</a>
          <div data-testid="tweetText" lang="en" dir="ltr">root post body</div>
        </article>
        <article role="article" data-testid="tweet" tabindex="-1">
          <a data-testid="User-Name" href="/focus_author" role="link"><span>Focus Author</span></a>
          <a href="/focus_author/status/300" role="link">3h</a>
          <div data-testid="tweetText" lang="en" dir="ltr">focused reply body</div>
        </article>
        <article role="article" data-testid="tweet">
          <a data-testid="User-Name" href="/child_author" role="link"><span>Child Author</span></a>
          <a href="/child_author/status/400" role="link">1h</a>
          <div data-testid="tweetText" lang="en" dir="ltr">child reply body</div>
        </article>
      </div>
    `);
    const posts = new TwitterAdapter().extractPosts(root.childNodes);
    const byText = new Map(posts.map((p) => [p.text, p]));
    expect(byText.get('root post body')?.parentText).toBeUndefined();
    expect(byText.get('focused reply body')?.parentText).toBe('root post body');
    expect(byText.get('child reply body')?.parentText).toBe('focused reply body');
  });
});
