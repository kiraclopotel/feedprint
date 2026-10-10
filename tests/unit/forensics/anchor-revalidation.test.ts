// @vitest-environment jsdom
//
// Anchor revalidation gate (Week 2 Day 4 per ARCH_PRIORITY_CONCURRENCY_V1.md §3
// + ONTOLOGY.md §5 + VISION §1.1 forensic completeness).

import { describe, it, expect } from 'vitest';
import {
  recomputeAnchorFromDom,
  verifyAnchorMatch,
  cancelVerdictFor,
} from '../../../src/forensics/anchor-revalidation';
import { computeAnchorKey } from '../../../src/core/anchor-key';
import { PostContent } from '../../../src/types/post';

function makePost(id: string, text: string, attached = true): {
  post: PostContent;
  element: HTMLElement;
} {
  const el = document.createElement('div');
  el.textContent = text;
  if (attached) document.body.appendChild(el);
  return {
    post: {
      id,
      text,
      author: 'a',
      timestamp: new Date().toISOString(),
      platform: 'twitter',
      domRef: new WeakRef(el),
    },
    element: el,
  };
}

describe('recomputeAnchorFromDom', () => {
  it('reproduces the same fingerprint shape as computeAnchorKey when DOM matches', () => {
    const { post, element } = makePost('p1', 'hello world');
    const enqueueAnchor = computeAnchorKey(post);
    const liveAnchor = recomputeAnchorFromDom(post, element);
    expect(liveAnchor).toBe(enqueueAnchor);
  });

  it('returns null for detached element (virtualizer recycled-out)', () => {
    const { post, element } = makePost('p1', 'hello', false);
    expect(element.isConnected).toBe(false);
    expect(recomputeAnchorFromDom(post, element)).toBeNull();
  });

  it('reflects live DOM text when text drifts (recycled DOM node case)', () => {
    const { post, element } = makePost('p1', 'original text');
    const enqueueAnchor = computeAnchorKey(post);
    // Simulate platform virtualizer mutating the node for a different post
    element.textContent = 'totally different post body';
    const liveAnchor = recomputeAnchorFromDom(post, element);
    expect(liveAnchor).not.toBe(enqueueAnchor);
  });
});

describe('verifyAnchorMatch — three-way decision', () => {
  it("returns 'match' when live DOM matches enqueue-time anchor", () => {
    const { post } = makePost('p1', 'matching post');
    const enqueueAnchor = computeAnchorKey(post);
    expect(verifyAnchorMatch(enqueueAnchor, post, post.domRef)).toBe('match');
  });

  it("returns 'dom-recycled' when DOM exists but text mutated (virtualizer reused node)", () => {
    const { post, element } = makePost('p1', 'original');
    const enqueueAnchor = computeAnchorKey(post);
    element.textContent = 'recycled-out content';
    expect(verifyAnchorMatch(enqueueAnchor, post, post.domRef)).toBe('dom-recycled');
  });

  it("returns 'dom-gone' when DOM element is detached", () => {
    const { post, element } = makePost('p1', 'gone soon');
    const enqueueAnchor = computeAnchorKey(post);
    element.remove(); // detach
    expect(verifyAnchorMatch(enqueueAnchor, post, post.domRef)).toBe('dom-gone');
  });

  it("returns 'dom-gone' when WeakRef has been cleared (post.domRef.deref returns undefined)", () => {
    const { post } = makePost('p1', 'gone soon');
    const enqueueAnchor = computeAnchorKey(post);
    // Simulate WeakRef being cleared by passing a fresh WeakRef on a node we
    // immediately drop (can't directly force GC in vitest, so we use a
    // deref-mock pattern via a synthetic WeakRef-like object).
    const detachedDomRef = {
      deref: () => undefined,
    } as unknown as WeakRef<HTMLElement>;
    expect(verifyAnchorMatch(enqueueAnchor, post, detachedDomRef)).toBe('dom-gone');
  });
});

describe('cancelVerdictFor — maps verification to chain verdict label', () => {
  it("'dom-recycled' → 'cancelled-dom-recycled'", () => {
    expect(cancelVerdictFor('dom-recycled')).toBe('cancelled-dom-recycled');
  });
  it("'dom-gone' → 'cancelled-dom-gone'", () => {
    expect(cancelVerdictFor('dom-gone')).toBe('cancelled-dom-gone');
  });
  it("'match' → null (caller stamps the original verdict)", () => {
    expect(cancelVerdictFor('match')).toBeNull();
  });
});

// ─── Tier C (Q-foundational-1, 2026-05-02) — degenerate-fallback parity ─────

describe('Tier C — recomputeAnchorFromDom mirrors degenerate fallback (OSCAR-15 §11.1)', () => {
  it('still-degenerate live text matches degenerate enqueue-time anchor', () => {
    const { post, element } = makePost('tt-music', '');
    // Original post had empty caption; enqueue-time key uses author fallback
    const enqueueAnchor = computeAnchorKey(post);
    expect(enqueueAnchor).toContain('__nocaption__');
    // DOM still shows empty text (still the same degenerate post, not recycled)
    element.textContent = '';
    expect(verifyAnchorMatch(enqueueAnchor, post, post.domRef)).toBe('match');
  });

  it('degenerate enqueue → DOM now shows non-empty text → dom-recycled', () => {
    const { post, element } = makePost('tt-music', '');
    const enqueueAnchor = computeAnchorKey(post);
    // Virtualizer recycled the node for a different (non-degenerate) post
    element.textContent = 'someone else\'s caption';
    expect(verifyAnchorMatch(enqueueAnchor, post, post.domRef)).toBe('dom-recycled');
  });
});

// A TikTok video card holds its author, a play timer that changes every second and its counts
// besides the caption (read on tiktok.com, 26 Sep 2026: "Ana Exemplu00:04 / 00:19117.7K..."). The
// caption record's text is the caption alone, so the whole card never matched and every TikTok
// verdict was turned away, to land later on a re-encounter.
describe('a TikTok video card is the same post while its caption is', () => {
  function card(caption: string | null, timer = '00:04 / 00:19'): HTMLElement {
    const item = document.createElement('article');
    item.setAttribute('data-e2e', 'recommend-list-item-container');
    const author = document.createElement('p');
    author.textContent = 'Ana Exemplu';
    const time = document.createElement('span');
    time.textContent = timer;
    item.append(author, time);
    if (caption !== null) {
      const desc = document.createElement('div');
      desc.setAttribute('data-e2e', 'video-desc');
      desc.textContent = caption;
      item.appendChild(desc);
    }
    const counts = document.createElement('strong');
    counts.textContent = '117.7K';
    item.appendChild(counts);
    document.body.appendChild(item);
    return item;
  }
  function post(id: string, text: string, el: HTMLElement): PostContent {
    return { id, text, author: '@ana', timestamp: '2026-09-26T05:00:00Z', platform: 'tiktok', domRef: new WeakRef(el) };
  }

  it('matches while the timer runs and the counts change', () => {
    const el = card('#viral_video #fyp #tag');
    const p = post('tk-vid-1', '#viral_video #fyp #tag', el);
    const key = computeAnchorKey(p);
    expect(verifyAnchorMatch(key, p, p.domRef)).toBe('match');
    el.querySelector('span')!.textContent = '00:11 / 00:19';
    expect(verifyAnchorMatch(key, p, p.domRef)).toBe('match');
  });

  it('a card reused for another video is recycled', () => {
    const el = card('#viral_video #fyp #tag');
    const p = post('tk-vid-1', '#viral_video #fyp #tag', el);
    const key = computeAnchorKey(p);
    el.querySelector('[data-e2e="video-desc"]')!.textContent = 'a different video';
    expect(verifyAnchorMatch(key, p, p.domRef)).toBe('dom-recycled');
  });

  it('a music-only card with no caption matches its author-keyed record, timer and all', () => {
    const el = card(null);
    const p = post('tk-vid-2', '', el);
    expect(verifyAnchorMatch(computeAnchorKey(p), p, p.domRef)).toBe('match');
  });

  it('any other element is still read whole', () => {
    const el = document.createElement('div');
    el.textContent = 'plain post';
    document.body.appendChild(el);
    const p = post('x1', 'plain post', el);
    el.textContent = 'plain post, edited';
    expect(verifyAnchorMatch(computeAnchorKey(p), p, p.domRef)).toBe('dom-recycled');
  });
});

describe('the Child cover inside a box', () => {
  function withCover(element: HTMLElement): void {
    const cover = document.createElement('div');
    cover.className = 'fw-provisional-shield';
    cover.textContent = 'One moment, checking this one…';
    element.appendChild(cover);
  }

  it('is not read as part of the post, so the post still matches', () => {
    const { post, element } = makePost('c1', 'a post the cover stands over');
    const key = computeAnchorKey(post);
    withCover(element);
    expect(verifyAnchorMatch(key, post, post.domRef)).toBe('match');
  });

  it('does not hide a box that now holds another post', () => {
    const { post, element } = makePost('c2', 'a post the cover stands over');
    const key = computeAnchorKey(post);
    withCover(element);
    element.firstChild!.textContent = 'another post entirely';
    expect(verifyAnchorMatch(key, post, post.domRef)).toBe('dom-recycled');
  });
});
