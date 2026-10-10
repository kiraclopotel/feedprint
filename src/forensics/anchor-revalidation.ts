// FeelingWise — DOM-recycle anchor revalidation gate.
//
// Purpose: defend against platform virtualizers (TikTok ForYou, X timeline,
// IG Reels) recycling a DOM node for a different post mid-flight. When the
// classifier emits a verdict, we revalidate the live DOM against the
// enqueue-time anchor key BEFORE applying the verdict. A mismatch means the
// platform reused the node for a different post; the verdict must NOT apply
// (it would target the wrong post — VISION §1.2 trust violation: parent sees
// a flag on the wrong content; VISION §1.1 chain integrity violation: the
// chain record would be linked to the wrong post identity).
//
// Three outcome states (mapped to chain `verdict`):
//   'match'            — live DOM matches enqueue-time anchor → safe to render
//   'dom-recycled'     — node exists but anchor mismatch → cancelled-dom-recycled
//   'dom-gone'         — WeakRef.deref() returned undefined → cancelled-dom-gone
//
// The queue (src/content/post-path/post-queue.ts) populates `QueueItem.anchorKey` at
// enqueue time using `computeAnchorKey(post)`. This module provides the
// recompute-from-live-DOM + compare logic the render gate calls
// before applying a verdict.
//
// Pure module: no DOM mutation, no chain writes. The render-gate caller
// observes the AnchorVerification result and decides whether to render +
// what chain verdict to stamp.

import { PostContent } from '../types/post';

/** Three-way outcome of the anchor revalidation gate per ARCH §3. */
export type AnchorVerification = 'match' | 'dom-recycled' | 'dom-gone';

/**
 * Re-extract a content fingerprint from a live DOM element. The extractor
 * uses the same `post.id::post.text.slice(0,200)` shape as `computeAnchorKey`
 * (queue.ts), but reads the live values rather than the enqueue-time snapshot.
 *
 * The post id stays stable (post.id is platform-assigned and doesn't change
 * during the lifetime of the DOM node — even when the platform recycles a
 * node, it gets a new post.id from the new post). What can drift is the text:
 * if the platform's virtualizer reuses a node, the text changes and our
 * recomputed fingerprint won't match the enqueue-time fingerprint.
 *
 * The caller passes the original PostContent (for the post.id) and a live
 * DOM element. This helper extracts the live text content and rebuilds the
 * fingerprint string.
 *
 * Returns null when the element is detached from the document (can happen
 * during virtualizer node-pool churn even before WeakRef GC).
 */
const TIKTOK_VIDEO_CARD = '[data-e2e="recommend-list-item-container"], [data-e2e="video-detail"]';
const TIKTOK_CAPTION = '[data-e2e="video-desc"], [data-e2e="browse-video-desc"]';
const OWN_COVER = '.fw-provisional-shield';

/**
 * The text the record was taken from. A TikTok video card holds its author, a play timer that
 * changes every second and its counts besides the caption (read on tiktok.com, 26 Sep 2026), so
 * its whole text never equals the caption record's text and every verdict was turned away. On a
 * card the caption is read the way the TikTok extractor reads it (tiktok-bundle.ts extractPost).
 */
function liveTextOf(el: HTMLElement): string {
  if (el.matches(TIKTOK_VIDEO_CARD)) {
    const caption = el.querySelector<HTMLElement>(TIKTOK_CAPTION);
    if (caption) return (caption.textContent ?? '').trim();
    // No caption (a music-only video): its record is keyed on the author, so the card reads empty.
    return Array.from(el.querySelectorAll<HTMLElement>('[data-e2e^="desc-span-"]'))
      .map((s) => s.textContent?.trim() ?? '').filter((t) => t.length > 0).join(' ');
  }
  // The Child cover is drawn inside its host, and a box no card selector claims is its own host, so the
  // cover's words would read as another post and lift the very cover that stands for this one.
  if (el.querySelector(OWN_COVER)) {
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(OWN_COVER).forEach((cover) => cover.remove());
    return (clone.textContent ?? '').trim();
  }
  return (el.textContent ?? '').trim();
}

export function recomputeAnchorFromDom(
  post: PostContent,
  liveElement: HTMLElement,
): string | null {
  // Detached element check: virtualizer may have orphaned the node.
  if (!liveElement.isConnected) return null;
  // Live text — strip leading/trailing whitespace per the same convention
  // computeAnchorKey uses indirectly (queue.ts uses raw post.text from
  // PostContent which the platform extractor populated; here we read the
  // live DOM textContent which may include surrounding whitespace).
  const liveText = liveTextOf(liveElement);
  // Mirror computeAnchorKey's shape: id + 200-char text slice when text is
  // present, else id::author::__nocaption__ degenerate fallback.
  // The mirrored shape ensures verifyAnchorMatch's string compare stays
  // valid when the original was degenerate (still-degenerate live text → match;
  // live text now non-empty → mismatch → cancel as expected).
  const id = post.id ?? '';
  const slice = liveText.slice(0, 200);
  if (slice) return `${id}::${slice}`;
  const author = (post.author ?? '').trim();
  return `${id}::${author}::__nocaption__`;
}

/**
 * Render-gate decision per ARCH §3. Compares the enqueue-time anchor key
 * (captured at queue.ts:computeAnchorKey) against a freshly-recomputed
 * live-DOM fingerprint.
 *
 * Caller contract:
 *   - `enqueueAnchor` is the QueueItem.anchorKey from the verdict's queue item
 *   - `domRef` is the WeakRef captured at enqueue (PostContent.domRef)
 *   - `post` is the original PostContent (for the post.id used in fingerprint)
 *
 * The caller maps the result to the chain verdict per VISION §1.1:
 *   'match'        → apply verdict + stamp original verdict (flagged/pass/etc)
 *   'dom-recycled' → DO NOT apply + stamp verdict='cancelled-dom-recycled'
 *   'dom-gone'     → DO NOT apply + stamp verdict='cancelled-dom-gone'
 *
 * Per the VISION §1.1 invariant, even cancelled outcomes get a chain record —
 * forensic completeness preserves the "FW observed this post" signal even
 * when no UI mutation lands.
 */
export function verifyAnchorMatch(
  enqueueAnchor: string,
  post: PostContent,
  domRef: WeakRef<HTMLElement>,
): AnchorVerification {
  const liveElement = domRef.deref();
  if (!liveElement) return 'dom-gone';

  const liveAnchor = recomputeAnchorFromDom(post, liveElement);
  if (liveAnchor === null) return 'dom-gone';
  if (liveAnchor !== enqueueAnchor) return 'dom-recycled';
  return 'match';
}

/**
 * Convenience: map an AnchorVerification to the chain `verdict` value the
 * forensic-store should stamp when the gate triggers a cancel. `match`
 * returns null because the original verdict (flagged/pass/etc) is what
 * stamps; this helper is only for cancel paths.
 */
export function cancelVerdictFor(verification: AnchorVerification):
  'cancelled-dom-recycled' | 'cancelled-dom-gone' | null {
  if (verification === 'dom-recycled') return 'cancelled-dom-recycled';
  if (verification === 'dom-gone') return 'cancelled-dom-gone';
  return null;
}
