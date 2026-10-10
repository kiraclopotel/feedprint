// of the event-driven batch design .
//
// PROBLEM. The pre-comment-batch path (`enqueueCommentForBatch` in
// content/index.ts) is an arrival-order debounce that flushes 1.5s after the
// last comment record arrived OR when the bucket hits 25, whichever comes
// first. Adapters surface comment records the moment the DOM walk extracts
// them — which can include comments rendered far below the viewport (e.g.
// FB's hidden lazy-loaded reply lists already in the DOM, TikTok comments
// virtualized off-screen). Those records get classified by the LLM even
// though the child never saw them. When the FW proxy rate-limits (per-
// license server-side cap), four batches in flight at once each get
// 429 → callAI returns Err(rate-limit) → scoreBatch fail-closed path →
// flushBatch emits cancelled-batch-llm-failure for every comment in the
// bucket → ~40 chain records of "FW could not classify this comment
// your child never saw."
//
// Two failures stack:
//   1. Trigger architecture: arrival-order, not visibility-driven. Violates
//      VISION §1.1 chain-mirror invariant ("rendered DOM the child observes").
//   2. When the LLM call fails, we waste a token-bucket cycle AND pollute
//      the chain with cancelled records.
//
// PHASE 1 SCOPE (this module). Universal viewport-presence gate at the
// flush boundary. When a comment-kind post is enqueued, observe its
// `domRef.deref()` via a shared IntersectionObserver. Mark `wasViewed=true`
// once it crosses viewport (sticky). At flush time, filter to viewed-only
// posts. If 0 viewed posts pass the filter, drop the bucket — NO LLM call,
// NO chain records. If N>0 pass, only the viewed subset reaches scoreBatch.
// Plus a per-parentVideoId cooldown after a fail-closed flush so we don't
// instantly retry while the pool's still rate-limited.
//
// PHASE 2 (deferred). Per-platform engagement events (TikTok side-panel-open,
// FB "Vezi N răspunsuri" click, X permalink-load) are CASES of viewport
// visibility transitions — the universal viewport primitive handles all of
// them via DOM rendering → IntersectionObserver fires. Per-platform-specific
// event hooks remain .
//
// FALLBACKS (strictly additive — never regress).
//   • `domRef.deref()` returns null at observe time → fail-open: hasBeenViewed
//     returns true so the comment continues through the legacy path.
//     Rationale: the only caller is the ENQUEUE path (post just landed); if
//     domRef is already gone, the platform virtualizer already reused the
//     slot — failing OPEN is the conservative choice (matches pre-//     semantics, doesn't downgrade).
//   • `typeof IntersectionObserver === 'undefined'` (jsdom test envs / SW
//     contexts) → every observed post is marked viewed eagerly. Pre-//     behavior preserved byte-for-byte.
//
// DESIGN CHOICES (all four explicit per the orchestrator brief):
//
//   1. IntersectionObserver options: { threshold: 0.1, rootMargin: '0px',
//      root: null }. Threshold 0.1 means "10% of the comment's bounding box
//      visible in the viewport" → catches comments that crossed the bottom
//      edge while the user is reading further up, but doesn't false-positive
//      on a 1px sliver. rootMargin 0 = strict viewport (no eager pre-load
//      window). root: null = the device viewport, not a scroll container.
//
//   2. Where the shared observer lives: this module. content/index.ts is
//      already 1494 LOC; isolating IO + WeakMap state in viewport-tracker.ts
//      gives a clean test seam (lazy-init, mockable observer, _resetForTesting
//      helper) without bloating index.ts further.
//
//   3. How wasViewed is tracked: WeakMap<HTMLElement, true>. Rejected
//      extending PostContent because (a) viewport state lives ONLY inside
//      `src/content/` — it does NOT need to traverse the LLM round-trip the
//      way 's domRef did, (b) PostContent is consumed by background
//      workers, encounter-builder, and neutralize-only — adding a
//      ContentScript-scope-only field there pollutes the contract,
//      (c) WeakMap auto-cleans when DOM nodes are released — no leak.
//
//   4. Cooldown after failed batch: per-parentVideoId 30s lock set at
//      flushBatch's failed-true return point. Same parentVideoId enqueue
//      within the cooldown window short-circuits before allocating a bucket.
//      Comments dropped by cooldown stay unclassified for the session
//      (acceptable per scope: better one un-classified comment
//      than 25 false-fail records).

import type { PostContent } from '../../types/post';

// ─── Module state ──────────────────────────────────────────────────────────

/** Sticky once true — see block comment design choice 3. */
const viewedElements = new WeakMap<HTMLElement, true>();

/** parentVideoId → cooldown-expiry-epoch-ms. */
const cooldownByParent = new Map<string, number>();

/** Lazy-init shared observer; null when IO unavailable in this realm. */
let sharedObserver: IntersectionObserver | null = null;
let sharedObserverInitAttempted = false;

/** Default cooldown after a fail-closed flush. */
const FAIL_CLOSED_COOLDOWN_MS = 30_000;

// ─── Observer lifecycle ────────────────────────────────────────────────────

function getOrCreateObserver(): IntersectionObserver | null {
  if (sharedObserverInitAttempted) return sharedObserver;
  sharedObserverInitAttempted = true;
  if (typeof IntersectionObserver === 'undefined') return null;
  try {
    sharedObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            viewedElements.set(entry.target as HTMLElement, true);
            // Sticky: once viewed, stop tracking — frees observer slot.
            sharedObserver?.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.1, rootMargin: '0px', root: null },
    );
  } catch {
    sharedObserver = null;
  }
  return sharedObserver;
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Begin observing this post's DOM element for viewport entry. Idempotent —
 * IO de-dupes observations by target. Safe to call from
 * `enqueueCommentForBatch` for every comment record.
 *
 * Side effects:
 *   • If domRef is already dead at call time, no-op (hasBeenViewed will
 *     fail-open and return true on the same dead ref).
 *   • If IO is unavailable in this realm, marks the post as viewed eagerly
 *     so filterToViewed doesn't strip the comment (back-compat fallback).
 */
export function observePostForViewport(post: PostContent): void {
  const el = post.domRef?.deref();
  if (!el) return; // hasBeenViewed handles this case via fail-open path.
  const obs = getOrCreateObserver();
  if (!obs) {
    // IO unavailable → mark viewed eagerly so filter doesn't strip this post.
    viewedElements.set(el, true);
    return;
  }
  obs.observe(el);
}

/**
 * True when this post's element has been observed crossing the viewport
 * threshold at any point since enqueue. Sticky.
 *
 * Fail-open semantics:
 *   • domRef returns null (element gone) → return TRUE. Pre-the post
 *     would have been classified anyway; we don't downgrade behavior.
 *   • Element marked viewed (IO fired or sync-backstop promoted it) → TRUE.
 *   • Element exists, IO has not fired, AND element is currently NOT in
 *     viewport → return FALSE. This is the gate: the bucket-filter strips
 *     this post.
 *
 * Synchronous backstop (~30 LOC). The IntersectionObserver fires
 * asynchronously — typically next frame, but virtualizer / display-toggle /
 * transform-deferred layouts (FB modal scroll container, IG modal, TikTok
 * side panel) can postpone the first IO callback past the 1.5s flush
 * debounce. Without this backstop, comments rendered AND visible at flush
 * time get dropped because IO hadn't yet marked them viewed → measured at
 * 0/10 first-flush coverage on FB group-permalink modal during V1
 * ship-prep diagnosis. The synchronous getBoundingClientRect check
 * promotes currently-visible elements to viewed (sticky) at flush time so
 * they survive the gate, while still excluding genuinely off-viewport
 * comments the child never saw (chain-mirror invariant per VISION §1.1).
 */
export function hasBeenViewed(post: PostContent): boolean {
  const el = post.domRef?.deref();
  if (!el) return true; // fail-open
  if (viewedElements.get(el) === true) return true;
  // Synchronous backstop: catches the IO-async-vs-flush-debounce race.
  if (typeof window !== 'undefined') {
    const rect = el.getBoundingClientRect();
    const winH = window.innerHeight;
    const winW = window.innerWidth;
    const intersectsWindow =
      rect.bottom > 0 && rect.top < winH && rect.right > 0 && rect.left < winW;
    if (!intersectsWindow) return false;
    // Scroll-container clipping check. FB group-permalink modal, IG modal,
    // TikTok side-panel all render comments inside a scrollable `<div
    // overflow:auto>`. getBoundingClientRect is viewport-relative to the
    // DEVICE viewport, so comments scrolled OUT of the container's visible
    // region still report positive rect.top — fail-positive without this
    // walk. VISION §1.1 chain-mirror: bucket must reflect what the kid
    // actually saw, not what the DOM holds.
    const scrollAncestor = findScrollableAncestor(el);
    if (scrollAncestor) {
      const ancRect = scrollAncestor.getBoundingClientRect();
      const intersectsAncestor =
        rect.bottom > ancRect.top &&
        rect.top < ancRect.bottom &&
        rect.right > ancRect.left &&
        rect.left < ancRect.right;
      if (!intersectsAncestor) return false;
    }
    // Promote to viewed (sticky) — matches IO's semantics so re-flushes
    // and post-flush IO callbacks see the same state.
    viewedElements.set(el, true);
    return true;
  }
  return false;
}

// WeakMap cache so repeated `hasBeenViewed` calls for the same element don't
// re-walk the DOM and re-run getComputedStyle on up to 20 ancestors. The
// scroll-container ancestor relationship is stable across the element's
// lifetime (modal opens, scrollable list mounts) — entries are GC-eligible
// once the element is no longer referenced (WeakMap semantics; eviction
// follows GC, not DOM removal). `null` is a valid cached value ("no
// scrollable ancestor"); we use a sentinel undefined to mean "not yet
// computed" via the `has` check.
const scrollableAncestorCache = new WeakMap<HTMLElement, HTMLElement | null>();

function findScrollableAncestor(el: HTMLElement): HTMLElement | null {
  const cached = scrollableAncestorCache.get(el);
  if (cached !== undefined || scrollableAncestorCache.has(el)) return cached ?? null;
  let cur: HTMLElement | null = el.parentElement;
  let hops = 0;
  while (cur && hops < 20) {
    const style = window.getComputedStyle(cur);
    const overflowY = style.overflowY;
    const overflowX = style.overflowX;
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      cur.scrollHeight > cur.clientHeight
    ) {
      scrollableAncestorCache.set(el, cur);
      return cur;
    }
    if (
      (overflowX === 'auto' || overflowX === 'scroll') &&
      cur.scrollWidth > cur.clientWidth
    ) {
      scrollableAncestorCache.set(el, cur);
      return cur;
    }
    cur = cur.parentElement;
    hops++;
  }
  scrollableAncestorCache.set(el, null);
  return null;
}

/**
 * Filter a bucket's PostContent[] to the viewed-only subset. Used by
 * `flushBatch` immediately before encounter construction. Returns a
 * NEW array — does not mutate input.
 */
export function filterToViewed(posts: PostContent[]): PostContent[] {
  return posts.filter((p) => hasBeenViewed(p));
}

// ─── Cooldown after fail-closed batch ──────────────────────────────────────

/**
 * Set a cooldown window after a fail-closed flush. Subsequent
 * `isParentInCooldown` calls within the window return true, gating
 * `enqueueCommentForBatch` so the bucket doesn't re-form until the pool
 * has had time to recover.
 */
export function setParentCooldown(parentVideoId: string, durationMs = FAIL_CLOSED_COOLDOWN_MS): void {
  cooldownByParent.set(parentVideoId, Date.now() + durationMs);
}

/**
 * True when the parent is within its post-fail-closed cooldown. Cleans up
 * expired entries on read so the Map doesn't grow unbounded across a long
 * session.
 */
export function isParentInCooldown(parentVideoId: string): boolean {
  const expiry = cooldownByParent.get(parentVideoId);
  if (expiry === undefined) return false;
  if (Date.now() >= expiry) {
    cooldownByParent.delete(parentVideoId);
    return false;
  }
  return true;
}

// ─── Re-enqueue support: unmark adapter dedup-stamps on dropped posts ────
//
// When the viewport gate drops a bucket OR the cooldown short-circuits
// enqueue, the comment was extracted by the adapter and stamped with one
// of the platform-specific "seen" datasets:
//   • facebook.ts:478 + :501 — `cmtEl.dataset.fwCommentSeen = 'true'`
//   • instagram.ts (_walkCommentsContainer) — `(li as HTMLElement).dataset.fwCommentSeen = 'true'`
//   • tiktok.ts (per the doc-comment) — `dataset.fwCommentSeen = 'true'`
//   • facebook.ts:232 — `article.dataset.fwProcessed` (post-level, not comment)
//
// Without un-stamping, the adapter's per-element dedup gate at
// `facebook.ts:416` / `instagram.ts:336` / `twitter.ts:612` PERMANENTLY
// skips these comments on subsequent scroll passes. A user who scrolls
// past quickly, dropping the comment via viewport gate, then scrolls back
// to read it would find FW silently un-classifies that comment forever —
// a VISION §1.1 chain-mirror violation in the OPPOSITE direction (excluding
// what the child experienced via back-scroll).
//
// Eager clearing was the original fix but it created an infinite re-extract
// loop: viewport gate drops bucket → eager clear → next MutationObserver
// tick re-extracts the un-stamped node → bucket re-forms → gate drops it
// again → clear again → loop. X's reconciler mutates DOM constantly so MO
// fires many times per second; CPU drain is severe on tabs left open with
// off-viewport comments.
//
// Option A — gate the clearing on actual viewport re-entry via a one-shot
// IntersectionObserver. Stamps stay set until the user scrolls the element
// back into view; the existing adapter dedup gate keeps MO re-emissions
// suppressed in the meantime. When the element finally re-enters viewport
// (only signal that matches the original "re-extract on back-scroll"
// intent) the IO callback fires, clears stamps + the viewed WeakMap, and
// the next MO tick picks up the un-stamped node correctly.
//
// In-viewport guard at attach time — IO.observe() fires a synchronous
// initial callback per spec, so attaching when the element is currently
// visible would resume the loop immediately. The fix no-ops in that case;
// the line-501 viewport-gate-drop call site is automatically safe (gate
// fired BECAUSE zero posts were in viewport) and the line-375 cooldown /
// line-476 no-output-sink call sites stay stamped until the element next
// transitions out of viewport.
//
// Strict scope: only unmark the COMMENT-level datasets, not the POST-level
// ones (`article.dataset.fwProcessed` at facebook.ts:232 stamps the whole
// post; un-stamping would re-process the post itself, causing duplicate
// post-level chain records). Comment elements per the audit are sub-elements
// (cmtEl / li / etc.) — distinguishable by checking the kind of the
// PostContent.

const SHELL_SELECTOR =
  'ytd-comment-view-model, ytd-backstage-post-renderer, [role="article"][aria-label], li[role="listitem"], [class*="DivCommentItemWrapper"], [data-fw-comment-row="true"]';

/** Element → its pending re-entry observer. Cleared on IO fire / element GC. */
const awaitingViewportElements = new WeakMap<HTMLElement, IntersectionObserver>();

function clearStampsAndViewedState(el: HTMLElement, shell: HTMLElement | null): void {
  delete el.dataset.fwCommentSeen;
  delete el.dataset.fwProcessed;
  viewedElements.delete(el);
  awaitingViewportElements.delete(el);
  if (shell && shell !== el) {
    delete shell.dataset.fwCommentSeen;
    delete shell.dataset.fwProcessed;
    viewedElements.delete(shell);
  }
}

function isCurrentlyInViewport(el: HTMLElement): boolean {
  if (typeof window === 'undefined') return false;
  const rect = el.getBoundingClientRect();
  const winH = window.innerHeight;
  const winW = window.innerWidth;
  return rect.bottom > 0 && rect.top < winH && rect.right > 0 && rect.left < winW;
}

function unmarkExtractedComment(post: PostContent): void {
  const el = post.domRef?.deref();
  if (!el) return;
  // Only un-stamp for comment-kind posts so post-level dedup stays intact.
  // Caller is responsible for filtering — but defensive double-check here.
  if (post.kind !== 'top-comment' && post.kind !== 'reply' && post.kind !== 'reply-to-reply') {
    return;
  }
  const shell = el.closest<HTMLElement>(SHELL_SELECTOR);

  // IO-undefined fallback (jsdom test env without mocked IO, service-worker
  // realm, very old browsers): eager-clear preserves byte-compatible pre-
  // Option-A behavior. Without an IO signal there's no way to gate on
  // viewport re-entry, and the loop concern requires both IO AND a live
  // reconciler — neither is present in these realms.
  if (typeof IntersectionObserver === 'undefined') {
    clearStampsAndViewedState(el, shell);
    return;
  }

  // Idempotency — a re-entry observer is already pending for this element.
  // Re-attaching would create multiple IOs firing the same clear path.
  if (awaitingViewportElements.has(el)) return;

  // In-viewport guard: see block comment above.
  if (isCurrentlyInViewport(el)) return;

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          window.clearTimeout(ttl);
          clearStampsAndViewedState(el, shell);
          io.disconnect();
          awaitingViewportElements.delete(el);
          return;
        }
      }
    },
    { threshold: 0.01, rootMargin: '0px', root: null },
  );
  // Bounded lifetime (2026-07-22 memory-leak fix). An element virtualized away
  // before it ever re-enters the viewport would never fire the callback, and the
  // browser keeps an IntersectionObserver with a live target alive on its own
  // registry — so the callback closure would pin `el` + `shell` (a detached
  // subtree with its decoded bitmaps) for the entire session. Tear the observer
  // down after a fixed TTL regardless of re-entry; a genuine re-entry clears the
  // timer above. Worst case: a comment scrolled back after the TTL stays
  // unclassified — the same tradeoff this module already accepts for cooldown-
  // dropped comments (the element is never uncovered, so protection is unaffected).
  const ttl = window.setTimeout(() => {
    io.disconnect();
    awaitingViewportElements.delete(el);
  }, 30_000);
  awaitingViewportElements.set(el, io);
  io.observe(el);
}

/**
 * Public API: unmark adapter dedup-stamps for an array of dropped/skipped
 * posts so the adapter's per-element dedup re-extracts them on next scroll.
 *
 * Called by `flushBatch` after the viewport gate filters the bucket (for
 * the un-viewed subset) AND by `enqueueCommentForBatch` when the cooldown
 * short-circuits the enqueue (for the rejected post).
 *
 * Safe to call with non-comment posts (no-op via `unmarkExtractedComment`'s
 * kind guard).
 */
export function unmarkPostsForReExtraction(posts: PostContent[]): void {
  for (const p of posts) unmarkExtractedComment(p);
}

// ─── Test helpers ──────────────────────────────────────────────────────────

/**
 * Reset module state. Used by unit tests so each test runs against a clean
 * cooldown Map + observer-init flag. WeakMap entries can't be cleared
 * collectively; tests that need a clean WeakMap should use
 * `_clearElementViewedForTesting` per-element or rely on per-test fresh
 * elements (closure-released between tests → entries auto-die).
 */
export function _resetViewportTrackerForTesting(): void {
  cooldownByParent.clear();
  if (sharedObserver) {
    try {
      sharedObserver.disconnect();
    } catch {
      // ignore
    }
  }
  sharedObserver = null;
  sharedObserverInitAttempted = false;
}

/**
 * Test hook: directly mark an element as viewed without going through IO.
 * Used by unit tests where IO doesn't fire (jsdom/node env).
 */
export function _markElementViewedForTesting(el: HTMLElement): void {
  viewedElements.set(el, true);
}

/**
 * Test hook: force-clear the viewed flag on an element. Counterpart to
 * `_markElementViewedForTesting` — without it, sticky-true persists across
 * tests when the same element-reference is reused.
 */
export function _clearElementViewedForTesting(el: HTMLElement): void {
  viewedElements.delete(el);
}
