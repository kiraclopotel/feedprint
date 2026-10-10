// CapturedBehavior: the shape, with no behavior attached.
//
// It was declared in src/forensics/capture-behavior.ts, and src/types/messages.ts imported it from there, which made the
// types layer depend on a layer above it (PLAN-2026-09-16 item 8.6). The module keeps its logic and
// re-exports this name, so nothing that imports it had to change.

/**
 * One captured event in a queue item's lifecycle. PostId + ts compose the
 * event timeline for that post; ageMs is the offset from QueueItem.addedAt at
 * the time of capture (for per-stage latency math without needing to read
 * dispatch ts separately).
 */
export interface CapturedBehavior {
  /** Auto-assigned by IDB on insert. */
  id?: number;
  /** Wall-clock timestamp at capture (ordering across events). */
  ts: number;
  /** Post id the event is about (joins to the prompt-io capture by postId). */
  postId: string;
  /** Which lifecycle event fired. */
  eventKind:
    | 'enqueued'             // queue.enqueue accepted (dedup passed; pre-size-cap eviction)
    | 'dispatched'           // queue.shift() → processFn invoke
    | 'classified'           // processFn promise resolved (result available)
    | 'cancelled-stale'      // adaptive-stale threshold exceeded; controller.abort() fired
    | 'cancelled-mid-flight' // controller.abort() called after dispatch but before classify completion
    | 'evicted-size-cap'     // dropped when queue exceeded MAX_QUEUE_SIZE
    | 'failed';              // processFn rejected (non-context error)
  /** Time since QueueItem.addedAt at capture. ms. Useful for per-stage latency math. */
  ageMs?: number;
  /**
   * Optional context fields captured from the QueueItem at event time. All
   * optional because not every event has every field meaningfully populated
   * (e.g., pre-dispatch evictions have no classification result).
   */
  state?: 'visible-soon' | 'visible' | 'scrolled-past';
  kind?: 'post' | 'top_comment' | 'reply' | 'batch_rest';
  isDegenerate?: boolean;
  /** Verdict label when eventKind='classified' (verbatim from PipelineResult). */
  verdictLabel?: string;
}
