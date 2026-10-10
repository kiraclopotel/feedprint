// @vitest-environment jsdom
//
// §CT-26g.3.2 — Instagram adapter Encounter-signal regression.
//
// Locks the §CT-26f-equivalent gap closed for IG (was previously zero
// comment-extraction coverage). The IG modal puts the post caption as the
// FIRST `<li>` of a `<ul>` and subsequent `<li>` are L1 comments — the
// adapter now extracts both, stamps Encounter signals, and the encounter-
// builder routes IG to assembleInstagramEncounter.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InstagramAdapter } from '../../../../src/content/platforms/instagram';
import { buildEncounterForFlushBatch } from '../../../../src/content/record/encounter-builder';
import type { PostContent } from '../../../../src/types/post';

function setLocation(href: string): void {
  Object.defineProperty(window, 'location', {
    value: new URL(href),
    writable: true,
    configurable: true,
  });
}

function mount(html: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  document.body.appendChild(wrap);
  return wrap;
}

describe('§CT-26g.3.2 — Instagram surface detection (via adapter)', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  afterEach(() => { document.body.innerHTML = ''; });

  it('detects post surface for /p/<id>/', () => {
    setLocation('https://www.instagram.com/p/ABC123/');
    const root = mount(`
      <article>
        <a href="/photographer/" role="link">photographer</a>
        <span dir="auto">a long enough caption to clear the 20-char floor</span>
      </article>
    `);
    const posts = new InstagramAdapter().extractPosts(root.childNodes);
    const captionPost = posts.find((p) => p.kind === 'post');
    expect(captionPost?.platform_specific?.platform).toBe('instagram');
    if (captionPost?.platform_specific?.platform === 'instagram') {
      expect(captionPost.platform_specific.surfaceKind).toBe('instagram-post');
    }
  });

  it('detects reel surface for /reel/<id>/', () => {
    setLocation('https://www.instagram.com/reel/XYZ789/');
    const root = mount(`
      <article>
        <a href="/creator/" role="link">creator</a>
        <span dir="auto">a long enough reel caption to clear the floor</span>
      </article>
    `);
    const posts = new InstagramAdapter().extractPosts(root.childNodes);
    const captionPost = posts.find((p) => p.kind === 'video');
    expect(captionPost).toBeDefined();
    if (captionPost?.platform_specific?.platform === 'instagram') {
      expect(captionPost.platform_specific.surfaceKind).toBe('instagram-reel');
    }
  });
});

describe('§CT-26g.3.2 — Instagram comment extraction (NEW)', () => {
  beforeEach(() => {
    setLocation('https://www.instagram.com/p/ABC123/');
    document.body.innerHTML = '';
  });
  afterEach(() => { document.body.innerHTML = ''; });

  it('extracts L1 comments with kind=top-comment, depth=1, parentVideoId=postId', () => {
    const root = mount(`
      <article>
        <a href="/poster/" role="link">poster</a>
        <span dir="auto">caption text long enough to clear the 20-char floor</span>
        <ul>
          <li><span dir="auto">caption li (gets skipped — IG quirk)</span></li>
          <li>
            <a href="/alice/" role="link"><span>alice</span></a>
            <span>this is the first comment text</span>
            <button>Like</button>
            <span>5 likes</span>
          </li>
          <li>
            <a href="/bob/" role="link"><span>bob</span></a>
            <span>second commenter says hi</span>
            <button>Like</button>
            <span>12 likes</span>
          </li>
        </ul>
      </article>
    `);
    const posts = new InstagramAdapter().extractPosts(root.childNodes);
    const comments = posts.filter((p) => p.kind === 'top-comment');
    expect(comments.length).toBe(2);
    for (const c of comments) {
      expect(c.kind).toBe('top-comment');
      expect(c.depth).toBe(1);
      expect(c.parent_id).toBeDefined();
      expect(c.parentVideoId).toBeDefined();
      expect(c.platform).toBe('instagram');
    }
    expect(comments[0].text).toContain('first comment');
    expect(comments[1].text).toContain('second commenter');
  });

  it('parses likes count from "N likes" text', () => {
    const root = mount(`
      <article>
        <a href="/poster/" role="link">poster</a>
        <span dir="auto">caption text long enough for the threshold</span>
        <ul>
          <li><span dir="auto">caption skip</span></li>
          <li>
            <a href="/u/" role="link"><span>u</span></a>
            <span>some comment text</span>
            <span>42 likes</span>
          </li>
        </ul>
      </article>
    `);
    const posts = new InstagramAdapter().extractPosts(root.childNodes);
    const c = posts.find((p) => p.kind === 'top-comment');
    if (c?.platform_specific?.platform === 'instagram') {
      expect(c.platform_specific.metrics?.likes).toBe(42);
    }
  });

  it('parses RO "N de aprecieri"', () => {
    const root = mount(`
      <article>
        <a href="/poster/" role="link">poster</a>
        <span dir="auto">caption text long enough for the threshold</span>
        <ul>
          <li><span dir="auto">caption skip</span></li>
          <li>
            <a href="/u/" role="link"><span>u</span></a>
            <span>romanian comment</span>
            <span>123 de aprecieri</span>
          </li>
        </ul>
      </article>
    `);
    const posts = new InstagramAdapter().extractPosts(root.childNodes);
    const c = posts.find((p) => p.kind === 'top-comment');
    if (c?.platform_specific?.platform === 'instagram') {
      expect(c.platform_specific.metrics?.likes).toBe(123);
    }
  });

  it('detects verified badge', () => {
    const root = mount(`
      <article>
        <a href="/poster/" role="link">poster</a>
        <span dir="auto">caption text long enough for the threshold</span>
        <ul>
          <li><span dir="auto">caption skip</span></li>
          <li>
            <a href="/v/" role="link"><span>v</span></a>
            <svg aria-label="Verified"></svg>
            <span>verified-user comment</span>
          </li>
        </ul>
      </article>
    `);
    const posts = new InstagramAdapter().extractPosts(root.childNodes);
    const c = posts.find((p) => p.kind === 'top-comment');
    if (c?.platform_specific?.platform === 'instagram') {
      expect(c.platform_specific.isVerified).toBe(true);
    }
  });

  it('does NOT emit comments when there is no <ul> in the article (caption-only feed view)', () => {
    const root = mount(`
      <article>
        <a href="/poster/" role="link">poster</a>
        <span dir="auto">caption-only article without comment modal open</span>
      </article>
    `);
    const posts = new InstagramAdapter().extractPosts(root.childNodes);
    const comments = posts.filter((p) => p.kind === 'top-comment');
    expect(comments.length).toBe(0);
    // But the caption record IS emitted
    const captions = posts.filter((p) => p.kind === 'post');
    expect(captions.length).toBe(1);
  });
});

describe('§CT-26g.3.2 — encounter-builder routes Instagram to assembleInstagramEncounter', () => {
  function makeIgChild(overrides: Partial<PostContent>): PostContent {
    return {
      id: 'ig-c1',
      text: 'sample comment',
      author: '@alice',
      timestamp: '2026-05-05T00:00:00.000Z',
      platform: 'instagram',
      domRef: new WeakRef({} as HTMLElement),
      kind: 'top-comment',
      depth: 1,
      parent_id: 'ig-post-1',
      parentVideoId: 'ig-post-1',
      platform_specific: {
        platform: 'instagram',
        surfaceKind: 'instagram-post',
        commentLevel: 1,
        metrics: { likes: 17, reply_count: 2 },
        isVerified: false,
      },
      ...overrides,
    };
  }

  it('builds rich IG Encounter with post likes_obscured + per-comment metrics', () => {
    const c1 = makeIgChild({ id: 'ig-1', text: 'first comment' });
    const c2 = makeIgChild({
      id: 'ig-2',
      text: 'verified user',
      author: '@verified',
      platform_specific: {
        platform: 'instagram',
        surfaceKind: 'instagram-post',
        commentLevel: 1,
        metrics: { likes: 999, reply_count: 14 },
        isVerified: true,
      },
    });

    const enc = buildEncounterForFlushBatch(
      [c1, c2],
      'this is the IG post caption',
      'English',
    );

    expect(enc.platform).toBe('instagram');
    if (enc.surface.kind === 'instagram-post') {
      expect(enc.surface.post_id).toBe('ig-post-1');
    } else {
      throw new Error(`expected instagram-post surface, got ${enc.surface.kind}`);
    }

    // Post: likes_obscured = true (IG product policy)
    expect(enc.post.metrics.likes_obscured).toBe(true);
    expect(enc.post.text).toBe('this is the IG post caption');
    expect(enc.post.kind).toBe('post');

    // No ancestors for IG
    expect(enc.ancestors).toEqual([]);

    // Children: 2 with metrics + verified flag carried over
    expect(enc.children).toHaveLength(2);
    expect(enc.children[0].metrics.likes).toBe(17);
    expect(enc.children[0].author.verified).toBe(false);
    expect(enc.children[1].metrics.likes).toBe(999);
    expect(enc.children[1].author.verified).toBe(true);
  });

  it('routes instagram-reel surface correctly with reel_id', () => {
    const child = makeIgChild({
      platform_specific: {
        platform: 'instagram',
        surfaceKind: 'instagram-reel',
        commentLevel: 1,
      },
    });
    const enc = buildEncounterForFlushBatch([child], 'reel caption', 'Romanian');
    if (enc.surface.kind === 'instagram-reel') {
      expect(enc.surface.reel_id).toBe('ig-post-1');
    } else {
      throw new Error(`expected instagram-reel surface, got ${enc.surface.kind}`);
    }
    expect(enc.post.kind).toBe('reel');
  });
});
