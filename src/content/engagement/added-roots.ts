// FeelingWise — one body observer for every incremental engagement scan.
//
// Each engagement module used to own a body MutationObserver and answer every
// mutation with a full-document scan behind its own timer (250 ms, one frame,
// 750 ms, or only the 2 s poll). Measured on 2026-09-03 with
// scripts/verify/engagement-latency.mjs on a 28k-node Facebook-shaped page:
// the structural scan alone blocked the main thread for 2.4 s of every 14 s
// while posts arrived, and each module waited its own timer before hiding.
//
// This module replaces that shape. One observer hands the INSERTED subtrees
// to every registered handler, synchronously, inside the mutation callback:
// the work is bounded by what changed, and a hide applied here lands before
// the next paint, so the element is never seen. Each module keeps a
// low-frequency full pass as the safety net for text the platform swaps in
// place without inserting nodes.

export type AddedRootsHandler = (roots: Element[]) => void;

const handlers = new Set<AddedRootsHandler>();
let observer: MutationObserver | null = null;

// Past this many distinct inserted subtrees in one batch the page is being
// rebuilt wholesale; one full pass is cheaper than hundreds of scoped ones.
const MAX_ROOTS_PER_BATCH = 400;

function collectRoots(records: MutationRecord[]): Element[] {
  const seen = new Set<Element>();
  for (const r of records) {
    if (r.type !== 'childList') continue;
    for (const n of r.addedNodes) {
      const el = n instanceof Element ? n : n.parentElement;
      if (el && el.isConnected && !el.closest('[data-fw-essential]')) seen.add(el);
    }
  }
  if (seen.size === 0) return [];
  if (seen.size > MAX_ROOTS_PER_BATCH) return [document.body];
  // Drop a root whose ancestor is also in the batch: the ancestor's scan
  // covers it.
  const out: Element[] = [];
  for (const el of seen) {
    let p = el.parentElement;
    let nested = false;
    while (p) {
      if (seen.has(p)) { nested = true; break; }
      p = p.parentElement;
    }
    if (!nested) out.push(el);
  }
  return out;
}

function dispatch(records: MutationRecord[]): void {
  const roots = collectRoots(records);
  if (roots.length === 0) return;
  for (const h of handlers) {
    try {
      h(roots);
    } catch (err) {
      console.warn('[FeelingWise] added-roots handler threw:', err);
    }
  }
}

/**
 * Register a handler for inserted subtrees. The first registration starts
 * the observer; the returned function unregisters, and the last one stops it.
 */
export function observeAddedRoots(handler: AddedRootsHandler): () => void {
  handlers.add(handler);
  if (!observer && typeof document !== 'undefined' && document.body) {
    observer = new MutationObserver(dispatch);
    observer.observe(document.body, { childList: true, subtree: true });
  }
  return () => {
    handlers.delete(handler);
    if (handlers.size === 0 && observer) {
      observer.disconnect();
      observer = null;
    }
  };
}

/** Test hook: how many handlers are registered. */
export function __addedRootsHandlerCountForTest(): number {
  return handlers.size;
}
