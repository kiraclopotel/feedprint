// FeelingWise — Impression / exposure order capture.
//
// The forensic chain records WRITE order (`chainPosition`, `timestamp`), which
// is downstream of the queue's priority reordering, AI latency, comment
// batching, and async video analysis. None of those reflect the order the user
// actually saw items scroll into view. This module assigns a local
// observed/exposure order at the single pre-AI chokepoint (`onPostDetected`),
// so the dashboard can distinguish "recorded order" from "observed order".
//
// Honest claim (see IMPRESSION_LAYER_V1.md §3): these fields say
//   "FeelingWise locally observed this item entering view at this order/time."
// They never claim the platform's algorithmic serve order.
//
// Design:
//   • `observedSequence` is a monotonic 1-based counter, scoped to one
//     surface session (one content-script load). Stamped at first detection.
//   • `viewportSeenAt` is the ISO timestamp of that first detection.
//   • First-seen wins: a re-detected post (scroll-back) reuses its original
//     sequence + timestamp so the order is stable, not last-seen.
//   • Pure + injectable memo so the "assigned before AI" and "stable first-seen"
//     guarantees are unit-testable without the DOM.

import type { PostContent } from '../../types/post';

/**
 * One surface-session id per content-script load. Module-scoped so every
 * content-side writer names the same session, and a record written during
 * this load belongs to it even when its observed order is unknown.
 */
const CURRENT_SURFACE_SESSION_ID = `ss-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function currentSurfaceSessionId(): string {
  return CURRENT_SURFACE_SESSION_ID;
}

export interface ImpressionMemo {
  /** Monotonic counter; last-assigned sequence. */
  counter: number;
  /** post.id → the order + time it was FIRST observed this session. */
  byPostId: Map<string, { seq: number; at: string }>;
}

/** Fresh memo for one surface session. */
export function createImpressionMemo(): ImpressionMemo {
  return { counter: 0, byPostId: new Map() };
}

/** Cap on distinct post ids retained for stable first-seen ordering
 *  (2026-07-22 memory-leak fix). A long session scans thousands of posts;
 *  without a bound byPostId grows for the whole content-script life. Insertion-
 *  ordered delete-oldest keeps it bounded; an evicted far-scrollback post simply
 *  gets a fresh (later) sequence, acceptable outside the retained window. These
 *  are non-canonical UI metadata fields — no chain/hash impact. */
const MAX_IMPRESSION_MEMO_ENTRIES = 5000;

/**
 * Stamp `surfaceSessionId` + `observedSequence` + `viewportSeenAt` on the post,
 * assigning a stable first-seen order. Idempotent per `post.id`: the first call
 * for an id allocates the sequence + timestamp; later calls (re-detection of the
 * same item) reuse them.
 *
 * Must be called at the earliest pre-AI observation point so the sequence
 * reflects view order, not processing order.
 */
export function stampImpressionOrder(
  post: PostContent,
  surfaceSessionId: string,
  memo: ImpressionMemo,
): void {
  let rec = memo.byPostId.get(post.id);
  if (!rec) {
    rec = { seq: ++memo.counter, at: new Date().toISOString() };
    memo.byPostId.set(post.id, rec);
    if (memo.byPostId.size > MAX_IMPRESSION_MEMO_ENTRIES) {
      const oldest = memo.byPostId.keys().next().value;
      if (oldest !== undefined) memo.byPostId.delete(oldest);
    }
  }
  post.surfaceSessionId = surfaceSessionId;
  post.observedSequence = rec.seq;
  post.viewportSeenAt = rec.at;
}
