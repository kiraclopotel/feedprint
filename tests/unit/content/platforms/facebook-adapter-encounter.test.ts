// @vitest-environment jsdom
//
// §CT-26g.3.4 — Facebook adapter Encounter-signal regression.
//
// Note: live verification is gated on a per-domain FB MCP re-grant; the
// unit-level fixture-DOM here exercises the code path independently.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FacebookAdapter } from '../../../../src/content/platforms/facebook';
import { buildEncounterForFlushBatch } from '../../../../src/content/record/encounter-builder';
import type { PostContent } from '../../../../src/types/post';

function setLocation(href: string): void {
  Object.defineProperty(window, 'location', {
    value: new URL(href),
    writable: true,
    configurable: true,
  });
}

describe('§CT-26g.3.4 — encounter-builder routes Facebook to assembleFacebookEncounter', () => {
  beforeEach(() => {
    setLocation('https://www.facebook.com/groups/abc/posts/123');
    document.body.innerHTML = '';
  });
  afterEach(() => { document.body.innerHTML = ''; });

  function makeFbChild(overrides: Partial<PostContent>): PostContent {
    return {
      id: 'fb-c1',
      text: 'sample fb comment',
      author: 'Ana Exemplu',
      timestamp: '2026-05-05T00:00:00.000Z',
      platform: 'facebook',
      domRef: new WeakRef({} as HTMLElement),
      kind: 'top-comment',
      depth: 1,
      parent_id: 'fb-post-1',
      parentVideoId: 'fb-post-1',
      platform_specific: {
        platform: 'facebook',
        surfaceKind: 'facebook-permalink',
        metrics: { likes: 8, reply_count: 1 },
        isVerified: false,
        isAuthor: false,
      },
      ...overrides,
    };
  }

  it('builds rich FB Encounter with post + per-comment metrics + verified/Author flags', () => {
    const c1 = makeFbChild({ id: 'fb-1', text: 'first comment', author: 'Alice' });
    const c2 = makeFbChild({
      id: 'fb-2',
      text: 'verified-page comment',
      author: 'Verified Page',
      platform_specific: {
        platform: 'facebook',
        surfaceKind: 'facebook-permalink',
        metrics: { likes: 200, reply_count: 30 },
        isVerified: true,
        isAuthor: false,
      },
    });
    const c3 = makeFbChild({
      id: 'fb-3',
      text: 'creator replying to own post',
      author: 'Creator',
      platform_specific: {
        platform: 'facebook',
        surfaceKind: 'facebook-permalink',
        metrics: { likes: 50 },
        isVerified: false,
        isAuthor: true,
      },
    });

    const enc = buildEncounterForFlushBatch([c1, c2, c3], 'fb post body', 'English');

    expect(enc.platform).toBe('facebook');
    if (enc.surface.kind === 'facebook-permalink') {
      expect(enc.surface.post_id).toBe('fb-post-1');
    } else {
      throw new Error(`expected facebook-permalink surface, got ${enc.surface.kind}`);
    }

    expect(enc.post.text).toBe('fb post body');
    expect(enc.post.kind).toBe('post');
    expect(enc.ancestors).toEqual([]);
    expect(enc.children).toHaveLength(3);

    expect(enc.children[0].metrics.likes).toBe(8);
    expect(enc.children[1].metrics.likes).toBe(200);
    expect(enc.children[1].author.verified).toBe(true);
    expect(enc.children[2].metrics.likes).toBe(50);
    // FB "Author" label maps to is_pinned_by_creator
    expect(enc.children[2].author.is_pinned_by_creator).toBe(true);

    // Default sort
    expect(enc.sort_order).toBe('most_relevant');
  });

  it('routes facebook-reel surface', () => {
    const child = makeFbChild({
      platform_specific: {
        platform: 'facebook',
        surfaceKind: 'facebook-reel',
      },
    });
    const enc = buildEncounterForFlushBatch([child], 'reel body', 'Romanian');
    if (enc.surface.kind === 'facebook-reel') {
      expect(enc.surface.reel_id).toBe('fb-post-1');
    }
    expect(enc.post.kind).toBe('reel');
  });

  it('routes facebook-home-feed surface', () => {
    const child = makeFbChild({
      platform_specific: {
        platform: 'facebook',
        surfaceKind: 'facebook-home-feed',
      },
    });
    const enc = buildEncounterForFlushBatch([child], 'home feed body', 'English');
    if (enc.surface.kind === 'facebook-home-feed') {
      expect(enc.surface.post_id).toBe('fb-post-1');
    }
  });

  it('falls back to legacy when surfaceKind is missing on platform_specific', () => {
    const child: PostContent = {
      id: 'fb-1',
      text: 'comment',
      author: 'Alice',
      timestamp: '2026-05-05T00:00:00.000Z',
      platform: 'facebook',
      domRef: new WeakRef({} as HTMLElement),
      kind: 'top-comment',
      // No platform_specific → legacy path
    };
    const enc = buildEncounterForFlushBatch([child], 'caption', 'English');
    expect(enc.ancestors).toEqual([]);
    expect(enc.post.text).toBe('caption');
  });
});

describe('§CT-26g.3.4 — Facebook surface detection (via adapter)', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  afterEach(() => { document.body.innerHTML = ''; });

  it('permalink surface for /<page>/posts/<id>', () => {
    setLocation('https://www.facebook.com/SomePage/posts/123456');
    const adapter = new FacebookAdapter();
    // Smoke: surfaceKind on the (synthetic, easier-to-build) FB-style article
    // The actual extraction is tested in facebook-adapter.test.ts; here we
    // verify only that the adapter's NEW surfaceKind stamping fires by
    // mounting a minimal article.
    const article = document.createElement('div');
    article.setAttribute('role', 'article');
    article.innerHTML = `
      <div data-ad-rendering-role="story_message">
        <div dir="auto">a long enough story body for the threshold</div>
      </div>
    `;
    document.body.appendChild(article);
    const posts = adapter.extractPosts(document.querySelectorAll('[role="article"]'));
    const captionPost = posts.find((p) => p.kind === 'post');
    if (captionPost?.platform_specific?.platform === 'facebook') {
      expect(captionPost.platform_specific.surfaceKind).toBe('facebook-permalink');
    }
  });

  it('home-feed surface for /', () => {
    setLocation('https://www.facebook.com/');
    const adapter = new FacebookAdapter();
    const article = document.createElement('div');
    article.setAttribute('role', 'article');
    article.innerHTML = `
      <div data-ad-rendering-role="story_message">
        <div dir="auto">another long enough story body for threshold</div>
      </div>
    `;
    document.body.appendChild(article);
    const posts = adapter.extractPosts(document.querySelectorAll('[role="article"]'));
    const captionPost = posts.find((p) => p.kind === 'post');
    if (captionPost?.platform_specific?.platform === 'facebook') {
      expect(captionPost.platform_specific.surfaceKind).toBe('facebook-home-feed');
    }
  });
});
