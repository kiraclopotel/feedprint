// FeelingWise — Scroll-extraction trigger primitive.
//
// Per-platform comment adapters extract via a MutationObserver on
// document.body (`src/content/post-path/dom-interceptor.ts`). MO fires on lazy-load + tree
// mutations, but NOT on pure scroll inside already-mounted DOM. When the
// user scrolls a modal's inner scroll container or the YouTube comment
// list past comments already rendered, no re-extract pass runs — comments
// stamped on a prior pass as `data-fw-comment-seen='true'` stay un-classified
// for the rest of the session even after they enter the viewport.
//
// `setupScrollExtractionTrigger` wires a debounced passive scroll listener
// on a scroll target (window, document, or an element) that fires
// `onScroll` after the user pauses for `debounceMs`. The callback re-invokes
// the adapter's extraction entry-point; the adapter's per-element dedup gate
// makes the call idempotent — only previously un-stamped comments get
// pushed into the BATCH path.
//
// Coexists with the MutationObserver path. MO catches lazy-load + tree
// mutations; this catches user-scroll-in-mounted-DOM. Both paths feed the
// same per-platform extraction routine.

const DEFAULT_DEBOUNCE_MS = 250;

// ─── Re-extraction request channel ───
//
// The adapters used to make the interceptor re-walk an already-mounted
// article by detaching it and re-inserting it at the same position, so the
// body MutationObserver would see an addedNode. That move is not a visual
// no-op: a moved subtree loses focus without a `blur`, so the Instagram
// post modal's comment composer (which lives INSIDE the post article) lost
// focus 250 ms after every scroll pause, and the scrollTop restore that
// followed the move fired a fresh `scroll` event that re-armed the debounce,
// so the move repeated every ~258 ms for as long as the modal stayed open
// (measured live 2026-09-02: the article was removed and re-added with no
// page-world DOM call on the stack, and typing never reached the textarea).
//
// The interceptor now registers a sink at start(); adapters hand it the
// roots to re-walk and no DOM node moves. With no sink registered (adapter
// under test, interceptor stopped) the request is dropped: the periodic
// rescan re-walks the surface within 3 s anyway.

type ReExtractSink = (roots: HTMLElement[]) => void;

let reExtractSink: ReExtractSink | null = null;

/** Interceptor-side: register (or clear with null) the re-extraction sink. */
export function setReExtractSink(sink: ReExtractSink | null): void {
  reExtractSink = sink;
}

/**
 * Adapter-side: ask the interceptor to re-run extraction over `roots`
 * exactly as if they had just been added to the DOM. Returns false when no
 * sink is registered. Never touches the DOM.
 */
export function requestReExtract(roots: HTMLElement[]): boolean {
  if (!reExtractSink || roots.length === 0) return false;
  reExtractSink(roots);
  return true;
}

export interface ScrollExtractionTriggerOptions {
  /**
   * Coalesce scroll bursts. Default 250ms — long enough to absorb rapid-fire
   * scroll events, short enough to fire once the user pauses on a section.
   */
  debounceMs?: number;
  /**
   * Listener passive flag. Default true — keeps the host page's own scroll
   * handlers from being blocked. The handler does no preventDefault.
   */
  passive?: boolean;
}

/**
 * Wire a debounced passive scroll listener on `target` that invokes
 * `onScroll` after the user stops scrolling for `debounceMs`. Returns a
 * disposer that removes the listener and clears any pending timeout.
 *
 * `target` accepts any EventTarget that emits a `scroll` event — typical
 * call sites pass `window`, the inner scroll container of a modal
 * (`HTMLElement` with `overflowY: auto/scroll`), or a virtualized list root.
 *
 * `onScroll` MUST be idempotent — every adapter call site relies on the
 * adapter's own per-element dedup (`fwCommentSeen` / `fwProcessed`) to
 * avoid double extraction.
 */
export function setupScrollExtractionTrigger(
  target: EventTarget,
  onScroll: () => void,
  options?: ScrollExtractionTriggerOptions,
): () => void {
  const debounceMs = options?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const passive = options?.passive ?? true;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const handler = (): void => {
    if (timeoutId !== null) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      timeoutId = null;
      onScroll();
    }, debounceMs);
  };

  target.addEventListener('scroll', handler, { passive });

  return () => {
    target.removeEventListener('scroll', handler);
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };
}
