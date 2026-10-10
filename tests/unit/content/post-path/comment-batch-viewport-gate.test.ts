/** @vitest-environment jsdom */
//
// §CT-43 (2026-05-06) — Phase 1 viewport-gate + per-parent cooldown tests for
// the comment-batch path. The viewport tracker module owns:
//   • observePostForViewport — begin observing a post's domRef element
//   • hasBeenViewed / filterToViewed — query the sticky viewedElements WeakMap
//   • setParentCooldown / isParentInCooldown — gate enqueue after fail-closed
//
// Tests run under jsdom because the production code reads
// `typeof IntersectionObserver`. jsdom doesn't ship a working IO by default
// (it leaves the global undefined), so the `_markElementViewedForTesting`
// hook is the way to simulate "the IO callback fired and marked this
// element viewed" without depending on jsdom's IO.
//
// Coverage matrix:
//   1. Bucket with all posts unviewed → filterToViewed returns []
//   2. Bucket with subset viewed → filterToViewed returns only viewed
//   3. Dead domRef.deref() → fail-open (hasBeenViewed === true)
//   4. IO undefined in this realm → observePostForViewport eagerly marks viewed
//   5. Cooldown set + queried within window → isParentInCooldown true
//   6. Cooldown expired → isParentInCooldown false (and Map cleaned)
//   7. Sticky once viewed: clearing element does not auto-re-observe

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  observePostForViewport,
  hasBeenViewed,
  filterToViewed,
  setParentCooldown,
  isParentInCooldown,
  _resetViewportTrackerForTesting,
  _markElementViewedForTesting,
  _clearElementViewedForTesting,
} from '../../../../src/content/post-path/viewport-tracker';
import type { PostContent } from '../../../../src/types/post';

// ─── Test fixture builder ──────────────────────────────────────────────────

function makePostWithElement(text: string): { post: PostContent; el: HTMLElement } {
  const el = document.createElement('div');
  el.textContent = text;
  document.body.appendChild(el);
  const post: PostContent = {
    id: `post-${text}`,
    text,
    author: 'tester',
    timestamp: '2026-05-06T00:00:00Z',
    platform: 'facebook',
    domRef: new WeakRef(el),
    kind: 'top-comment',
    parentVideoId: 'parent-1',
  };
  return { post, el };
}

function makePostWithDeadDomRef(text: string): PostContent {
  // Build a real element, take a WeakRef, then drop the strong reference.
  // Dropping just the variable doesn't actually GC in jsdom — but we can
  // simulate "dead" by calling the WeakRef's .deref override below. Simplest:
  // wrap a fake WeakRef whose deref returns undefined.
  const fakeWeakRef = {
    deref: () => undefined,
  } as unknown as WeakRef<HTMLElement>;
  return {
    id: `post-dead-${text}`,
    text,
    author: 'tester',
    timestamp: '2026-05-06T00:00:00Z',
    platform: 'facebook',
    domRef: fakeWeakRef,
    kind: 'top-comment',
    parentVideoId: 'parent-1',
  };
}

// ─── beforeEach / afterEach ────────────────────────────────────────────────

beforeEach(() => {
  _resetViewportTrackerForTesting();
});

afterEach(() => {
  // Tidy up any DOM nodes the fixture created.
  document.body.innerHTML = '';
});

// ─── Test 1 — bucket with 0 viewed posts → filter returns [] ─────────────

describe('§CT-43 viewport gate', () => {
  it('returns empty filter when no post has been viewed', () => {
    const a = makePostWithElement('a');
    const b = makePostWithElement('b');
    const c = makePostWithElement('c');
    observePostForViewport(a.post);
    observePostForViewport(b.post);
    observePostForViewport(c.post);
    // jsdom has no IO; observePostForViewport's IO-undefined branch eagerly
    // marks viewed. Clear the eager marks so we can simulate "unviewed."
    _clearElementViewedForTesting(a.el);
    _clearElementViewedForTesting(b.el);
    _clearElementViewedForTesting(c.el);
    const out = filterToViewed([a.post, b.post, c.post]);
    expect(out).toEqual([]);
  });

  // ─── Test 2 — bucket with subset viewed → filter returns only viewed ─

  it('returns only the viewed subset when some posts have crossed viewport', () => {
    const a = makePostWithElement('a');
    const b = makePostWithElement('b');
    const c = makePostWithElement('c');
    observePostForViewport(a.post);
    observePostForViewport(b.post);
    observePostForViewport(c.post);
    _clearElementViewedForTesting(a.el);
    _clearElementViewedForTesting(b.el);
    _clearElementViewedForTesting(c.el);
    // Simulate the IO callback firing for a + c only.
    _markElementViewedForTesting(a.el);
    _markElementViewedForTesting(c.el);
    const out = filterToViewed([a.post, b.post, c.post]);
    expect(out.map((p) => p.text)).toEqual(['a', 'c']);
  });

  // ─── Test 3 — dead domRef → fail-open ────────────────────────────────

  it('treats a dead domRef as viewed (fail-open back-compat)', () => {
    const dead = makePostWithDeadDomRef('dead');
    expect(hasBeenViewed(dead)).toBe(true);
    const out = filterToViewed([dead]);
    expect(out).toEqual([dead]);
  });

  // ─── Test 4 — IO undefined → eagerly marks viewed ────────────────────

  it('eagerly marks viewed when IntersectionObserver is unavailable in this realm', () => {
    // jsdom doesn't ship IO, so this is the realm the production fallback
    // is designed for. observePostForViewport should mark viewed eagerly.
    const a = makePostWithElement('a-fallback');
    expect(typeof IntersectionObserver === 'undefined').toBe(true);
    observePostForViewport(a.post);
    expect(hasBeenViewed(a.post)).toBe(true);
  });

  // ─── Test 5 — observePostForViewport with dead domRef does not throw ─

  it('observePostForViewport with dead domRef does not throw', () => {
    const dead = makePostWithDeadDomRef('dead-observe');
    expect(() => observePostForViewport(dead)).not.toThrow();
  });
});

// ─── Test 6, 7, 8 — cooldown semantics ────────────────────────────────────

describe('§CT-43 per-parent cooldown', () => {
  it('reports cooldown active immediately after setParentCooldown', () => {
    setParentCooldown('parent-1', 30_000);
    expect(isParentInCooldown('parent-1')).toBe(true);
  });

  it('reports cooldown inactive after expiry and cleans the Map entry', async () => {
    setParentCooldown('parent-2', 5); // 5ms — short for the test
    await new Promise((r) => setTimeout(r, 15));
    expect(isParentInCooldown('parent-2')).toBe(false);
    // Second call should still be false (entry was cleaned by the first
    // false-returning call).
    expect(isParentInCooldown('parent-2')).toBe(false);
  });

  it('parents are independent — setting cooldown on one does not affect another', () => {
    setParentCooldown('parent-A', 30_000);
    expect(isParentInCooldown('parent-A')).toBe(true);
    expect(isParentInCooldown('parent-B')).toBe(false);
  });
});

// ─── Test 9 — sticky once viewed ──────────────────────────────────────────

describe('§CT-43 sticky-viewed semantics', () => {
  it('once marked viewed, hasBeenViewed stays true across repeated reads', () => {
    const a = makePostWithElement('sticky');
    _clearElementViewedForTesting(a.el);
    expect(hasBeenViewed(a.post)).toBe(false);
    _markElementViewedForTesting(a.el);
    expect(hasBeenViewed(a.post)).toBe(true);
    expect(hasBeenViewed(a.post)).toBe(true);
    expect(hasBeenViewed(a.post)).toBe(true);
  });
});

// Synchronous backstop. Catches the IO-async-vs-flush-debounce
// race surfaced during V1 ship-prep diagnosis (FB modal: 0/10 first-flush
// coverage). When IO has not yet fired but the element IS currently in the
// viewport, hasBeenViewed promotes it to viewed via getBoundingClientRect
// so flushBatch survives the gate.

describe('hasBeenViewed — synchronous getBoundingClientRect backstop', () => {
  function mockRect(el: HTMLElement, rect: Partial<DOMRect>): void {
    Object.defineProperty(el, 'getBoundingClientRect', {
      value: () => ({
        top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0,
        toJSON: () => ({}),
        ...rect,
      } as DOMRect),
      configurable: true,
    });
  }

  it('promotes a currently-visible element to viewed (sticky) without IO firing', () => {
    const a = makePostWithElement('in-viewport');
    _clearElementViewedForTesting(a.el);
    // Element is inside the viewport (jsdom default innerHeight ~768).
    mockRect(a.el, { top: 100, left: 100, right: 300, bottom: 200 });
    expect(hasBeenViewed(a.post)).toBe(true);
    // Sticky: subsequent calls return true even after the rect changes.
    mockRect(a.el, { top: -1000, left: -1000, right: -800, bottom: -800 });
    expect(hasBeenViewed(a.post)).toBe(true);
  });

  it('returns false when element is currently outside the viewport AND IO has not fired', () => {
    const a = makePostWithElement('off-viewport');
    _clearElementViewedForTesting(a.el);
    // Element entirely above the viewport (rect.bottom <= 0).
    mockRect(a.el, { top: -500, left: 100, right: 300, bottom: -100 });
    expect(hasBeenViewed(a.post)).toBe(false);
    // Element entirely below the viewport (rect.top >= window.innerHeight).
    mockRect(a.el, { top: 100000, left: 100, right: 300, bottom: 100200 });
    expect(hasBeenViewed(a.post)).toBe(false);
  });

  it('IO marker takes precedence over the backstop (no rect call needed)', () => {
    const a = makePostWithElement('io-precedence');
    _markElementViewedForTesting(a.el);
    // Even with a clearly off-viewport rect, IO mark is checked first.
    mockRect(a.el, { top: -1000, left: -1000, right: -800, bottom: -800 });
    expect(hasBeenViewed(a.post)).toBe(true);
  });
});

// ─── §CT-43.b — re-enqueue support: unmark adapter dedup-stamps ───────────
//
// When the viewport gate drops a bucket OR the cooldown short-circuits
// enqueue, the adapter has already stamped the element with one of:
//   • cmtEl.dataset.fwCommentSeen = 'true' (FB / IG / TikTok comment-level)
//   • el.dataset.fwProcessed = 'true' (interceptor's per-record stamp)
// Without un-stamping, the adapter's per-element dedup gate permanently
// blocks re-extraction → comment is silently un-classified for the session
// even when user later scrolls back to read it. This is a VISION §1.1
// chain-mirror violation in the OPPOSITE direction (excluding what the
// child experienced via back-scroll). `unmarkPostsForReExtraction` clears
// both datasets so the adapter re-extracts on the next scroll pass.

import { unmarkPostsForReExtraction } from '../../../../src/content/post-path/viewport-tracker';

describe('§CT-43.b unmarkPostsForReExtraction', () => {
  beforeEach(() => {
    _resetViewportTrackerForTesting();
    document.body.innerHTML = '';
  });

  it('deletes fwCommentSeen and fwProcessed datasets on a comment-kind post', () => {
    const a = makePostWithElement('drop-me');
    a.el.dataset.fwCommentSeen = 'true';
    a.el.dataset.fwProcessed = 'true';
    _markElementViewedForTesting(a.el); // simulate prior viewport entry
    expect(hasBeenViewed(a.post)).toBe(true);

    unmarkPostsForReExtraction([a.post]);

    expect(a.el.dataset.fwCommentSeen).toBeUndefined();
    expect(a.el.dataset.fwProcessed).toBeUndefined();
    // viewedElements WeakMap entry also cleared so re-observation reads fresh
    expect(hasBeenViewed(a.post)).toBe(false);
  });

  it('no-op on post-kind posts (preserves post-level dedup)', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const postKindPost: PostContent = {
      id: 'post-1',
      text: 'a post',
      author: 'tester',
      timestamp: '2026-05-06T00:00:00Z',
      platform: 'facebook',
      domRef: new WeakRef(el),
      kind: 'post', // NOT comment-kind
    };
    el.dataset.fwProcessed = 'true';

    unmarkPostsForReExtraction([postKindPost]);

    // Post-level fwProcessed must NOT be cleared — would cause duplicate
    // post-level chain records on re-extraction.
    expect(el.dataset.fwProcessed).toBe('true');
  });

  it('no-op on dead domRef (defensive)', () => {
    const post: PostContent = {
      id: 'dead-1',
      text: 'dead',
      author: 'tester',
      timestamp: '2026-05-06T00:00:00Z',
      platform: 'facebook',
      domRef: { deref: () => undefined } as WeakRef<HTMLElement>,
      kind: 'top-comment',
    };
    expect(() => unmarkPostsForReExtraction([post])).not.toThrow();
  });
});

// IntersectionObserver-gated re-entry un-stamping.
//
// Bug — when the viewport gate drops a bucket, eager un-stamping immediately
// clears fwProcessed/fwCommentSeen, so MutationObserver re-extracts on the
// next platform DOM mutation (X's reconciler is constantly active), the
// bucket re-forms, gate drops again, un-stamps again, loops. CPU drain on
// tabs left open with comments scrolled past viewport.
//
// Option A fix — when IntersectionObserver is available and the element is
// currently OUT of viewport, defer the stamp clearing. Attach a one-shot IO;
// only the actual viewport-re-entry callback clears stamps + the viewed
// WeakMap. The existing adapter dedup gate (`fwProcessed`/`fwCommentSeen`
// checks at twitter.ts:612 etc.) keeps the loop closed: stamps stay set,
// MO re-emissions are skipped, no re-extract until the user actually scrolls
// back.
//
// When the element is currently IN viewport at unmark time, IO would fire an
// immediate synchronous callback (per spec). To avoid the same loop, we
// no-op in that case — comment stays stamped until the DOM changes or the
// user scrolls. The line-501 viewport-gate-drop call site is automatically
// safe because the gate fired BECAUSE zero posts were in viewport; the in-
// viewport guard protects the line-375 cooldown and line-476 no-output-sink
// call sites where the element's viewport state isn't pre-known.

interface MockIORecord {
  callback: IntersectionObserverCallback;
  options: IntersectionObserverInit | undefined;
  observedTargets: Set<Element>;
  disconnected: boolean;
  fireIntersect: (target: Element, isIntersecting: boolean) => void;
}

let mockIORegistry: MockIORecord[] = [];

class MockIntersectionObserver {
  callback: IntersectionObserverCallback;
  options: IntersectionObserverInit | undefined;
  observedTargets: Set<Element> = new Set();
  disconnected = false;
  root: Element | Document | null = null;
  rootMargin: string = '0px';
  thresholds: ReadonlyArray<number> = [0];
  constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) {
    this.callback = cb;
    this.options = opts;
    const record: MockIORecord = {
      callback: cb,
      options: opts,
      observedTargets: this.observedTargets,
      disconnected: false,
      fireIntersect: (target, isIntersecting) => {
        if (record.disconnected) return;
        const entry = {
          isIntersecting,
          target,
          intersectionRatio: isIntersecting ? 1 : 0,
          boundingClientRect: target.getBoundingClientRect(),
          intersectionRect: target.getBoundingClientRect(),
          rootBounds: null,
          time: 0,
        } as unknown as IntersectionObserverEntry;
        cb([entry], this as unknown as IntersectionObserver);
      },
    };
    mockIORegistry.push(record);
  }
  observe(target: Element) { this.observedTargets.add(target); }
  unobserve(target: Element) { this.observedTargets.delete(target); }
  disconnect() {
    this.disconnected = true;
    const idx = mockIORegistry.findIndex((r) => r.callback === this.callback);
    if (idx >= 0) mockIORegistry[idx].disconnected = true;
  }
  takeRecords() { return []; }
}

function mockRect(el: HTMLElement, rect: Partial<DOMRect>): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: () => ({
      top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0,
      toJSON: () => ({}),
      ...rect,
    } as DOMRect),
    configurable: true,
  });
}

describe('unmarkPostsForReExtraction — IO-gated re-entry (Option A)', () => {
  const originalIO = (globalThis as typeof globalThis & { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;

  beforeEach(() => {
    mockIORegistry = [];
    (globalThis as typeof globalThis & { IntersectionObserver: unknown }).IntersectionObserver = MockIntersectionObserver;
    _resetViewportTrackerForTesting();
    document.body.replaceChildren();
  });

  afterEach(() => {
    if (originalIO === undefined) {
      delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    } else {
      (globalThis as typeof globalThis & { IntersectionObserver: unknown }).IntersectionObserver = originalIO;
    }
    document.body.replaceChildren();
  });

  it('keeps fwProcessed/fwCommentSeen set when element is out of viewport (prevents MO re-extract loop)', () => {
    const a = makePostWithElement('out-of-viewport');
    a.el.dataset.fwCommentSeen = 'true';
    a.el.dataset.fwProcessed = 'true';
    mockRect(a.el, { top: -500, left: 100, right: 300, bottom: -100 }); // above viewport

    unmarkPostsForReExtraction([a.post]);

    // The bug fix: stamps stay set so the adapter dedup gate keeps skipping
    // this element on subsequent MutationObserver ticks. Without this, the
    // gate-drop → un-stamp → re-extract → re-drop loop burns CPU.
    expect(a.el.dataset.fwProcessed).toBe('true');
    expect(a.el.dataset.fwCommentSeen).toBe('true');
  });

  it('attaches a one-shot IntersectionObserver to the dropped element', () => {
    const a = makePostWithElement('observed');
    a.el.dataset.fwCommentSeen = 'true';
    a.el.dataset.fwProcessed = 'true';
    mockRect(a.el, { top: -500, left: 100, right: 300, bottom: -100 });

    unmarkPostsForReExtraction([a.post]);

    // Exactly one re-entry observer attached, observing the dropped element.
    const reentry = mockIORegistry.find((r) => r.observedTargets.has(a.el));
    expect(reentry).toBeDefined();
    expect(reentry!.disconnected).toBe(false);
  });

  it('clears stamps and disconnects the observer when the element re-enters viewport', () => {
    const a = makePostWithElement('back-scroll');
    a.el.dataset.fwCommentSeen = 'true';
    a.el.dataset.fwProcessed = 'true';
    mockRect(a.el, { top: -500, left: 100, right: 300, bottom: -100 });

    unmarkPostsForReExtraction([a.post]);

    const reentry = mockIORegistry.find((r) => r.observedTargets.has(a.el))!;
    // Simulate the user scrolling back; element re-enters viewport.
    reentry.fireIntersect(a.el, true);

    expect(a.el.dataset.fwProcessed).toBeUndefined();
    expect(a.el.dataset.fwCommentSeen).toBeUndefined();
    expect(reentry.disconnected).toBe(true);
  });

  it('does NOT clear stamps if the IO callback fires with isIntersecting=false', () => {
    const a = makePostWithElement('not-intersecting');
    a.el.dataset.fwCommentSeen = 'true';
    a.el.dataset.fwProcessed = 'true';
    mockRect(a.el, { top: -500, left: 100, right: 300, bottom: -100 });

    unmarkPostsForReExtraction([a.post]);
    const reentry = mockIORegistry.find((r) => r.observedTargets.has(a.el))!;
    reentry.fireIntersect(a.el, false);

    // Only re-entry should clear stamps; a false-intersection callback (e.g.
    // initial-state callback that fires for not-yet-intersecting elements)
    // must not clear.
    expect(a.el.dataset.fwProcessed).toBe('true');
    expect(a.el.dataset.fwCommentSeen).toBe('true');
    expect(reentry.disconnected).toBe(false);
  });

  it('is a no-op when the element is currently in viewport (prevents re-entry-IO-fires-immediately loop)', () => {
    const a = makePostWithElement('in-viewport');
    a.el.dataset.fwCommentSeen = 'true';
    a.el.dataset.fwProcessed = 'true';
    mockRect(a.el, { top: 100, left: 100, right: 300, bottom: 200 }); // visible

    unmarkPostsForReExtraction([a.post]);

    // Stamps remain (no IO attached → no eventual clearing).
    expect(a.el.dataset.fwProcessed).toBe('true');
    expect(a.el.dataset.fwCommentSeen).toBe('true');
    // No re-entry observer was attached.
    const reentry = mockIORegistry.find((r) => r.observedTargets.has(a.el));
    expect(reentry).toBeUndefined();
  });

  it('is idempotent — repeated calls on the same post attach only one re-entry observer', () => {
    const a = makePostWithElement('idempotent');
    a.el.dataset.fwCommentSeen = 'true';
    a.el.dataset.fwProcessed = 'true';
    mockRect(a.el, { top: -500, left: 100, right: 300, bottom: -100 });

    unmarkPostsForReExtraction([a.post]);
    unmarkPostsForReExtraction([a.post]);
    unmarkPostsForReExtraction([a.post]);

    const observers = mockIORegistry.filter((r) => r.observedTargets.has(a.el));
    expect(observers.length).toBe(1);
  });

  it('clears stamps on the shell ancestor too when the IO callback fires', () => {
    const shell = document.createElement('li');
    shell.setAttribute('role', 'listitem');
    shell.dataset.fwCommentSeen = 'true';
    shell.dataset.fwProcessed = 'true';
    const inner = document.createElement('div');
    inner.dataset.fwCommentSeen = 'true';
    inner.dataset.fwProcessed = 'true';
    shell.appendChild(inner);
    document.body.appendChild(shell);
    mockRect(inner, { top: -500, left: 100, right: 300, bottom: -100 });
    mockRect(shell, { top: -500, left: 100, right: 300, bottom: -100 });

    const post: PostContent = {
      id: 'shell-test',
      text: 'has-shell',
      author: 'tester',
      timestamp: '2026-05-06T00:00:00Z',
      platform: 'instagram',
      domRef: new WeakRef(inner),
      kind: 'top-comment',
    };

    unmarkPostsForReExtraction([post]);

    // Before IO fires: both inner + shell stamps stay set.
    expect(inner.dataset.fwProcessed).toBe('true');
    expect(shell.dataset.fwProcessed).toBe('true');

    const reentry = mockIORegistry.find((r) => r.observedTargets.has(inner))!;
    reentry.fireIntersect(inner, true);

    // After re-entry: both clear.
    expect(inner.dataset.fwProcessed).toBeUndefined();
    expect(inner.dataset.fwCommentSeen).toBeUndefined();
    expect(shell.dataset.fwProcessed).toBeUndefined();
    expect(shell.dataset.fwCommentSeen).toBeUndefined();
  });
});

// ─── Universal post-flush rate limit ──────────────────────────────────────
//
// Every flush (success or fail) sets a per-parent timestamp. Subsequent
// flushes for the same parent cannot fire faster than
// COMMENT_BATCH_MIN_FLUSH_INTERVAL_MS. Comments arriving during the window
// stay in the bucket — only the flush is delayed — so the chain-mirror
// invariant (VISION §1.1) is preserved.
//
// `computeMinFlushWaitMs` is the pure helper that drives the rate limit;
// these tests pin its semantics so the integrated path in
// enqueueCommentForBatch behaves predictably.

import { computeMinFlushWaitMs } from '../../../../src/content/comment-batch/queue';

describe('comment-batch rate-limit (computeMinFlushWaitMs)', () => {
  it('returns 0 when the parent has never flushed (lastFlushAt undefined)', () => {
    expect(computeMinFlushWaitMs(undefined, 1_000_000)).toBe(0);
  });

  it('returns the full interval when called immediately after a flush', () => {
    const t = 1_000_000;
    expect(computeMinFlushWaitMs(t, t, 800)).toBe(800);
  });

  it('returns the remaining wait when called partway through the window', () => {
    const t = 1_000_000;
    expect(computeMinFlushWaitMs(t, t + 300, 800)).toBe(500);
  });

  it('returns 0 when the window has fully elapsed', () => {
    const t = 1_000_000;
    expect(computeMinFlushWaitMs(t, t + 800, 800)).toBe(0);
  });

  it('returns 0 when more than the interval has passed', () => {
    const t = 1_000_000;
    expect(computeMinFlushWaitMs(t, t + 2_000, 800)).toBe(0);
  });

  it('clamps to 0 instead of returning negative when now is far past expiry', () => {
    const t = 1_000_000;
    const result = computeMinFlushWaitMs(t, t + 10_000, 800);
    expect(result).toBe(0);
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it('respects a custom interval override', () => {
    const t = 1_000_000;
    expect(computeMinFlushWaitMs(t, t + 100, 1500)).toBe(1400);
  });
});
