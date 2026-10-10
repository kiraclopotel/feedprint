// FeelingWise — Processing queue with 3-tier priority + adaptive cancel-on-stale.
//
// Speculative streaming pipeline with anchor invalidation: posts queue at
// enqueue-time priority + anchor-key, drain in viewport-aware order, get
// cancelled when scroll velocity has carried the user past them.
//
// Priority tiers (replaces pre-Day-2 binary isVisible):
//   - 'visible-soon' (100): below viewport, pre-emptive load
//   - 'visible' (50): currently rendered in viewport (with one reserved lane)
//   - 'scrolled-past' (1): out of viewport, lowest priority, cancel candidate
//
// Adaptive stale threshold per ARCH §4:
//   - browsing (<100 px/s): 60s — spend more compute, user engaged
//   - scanning (100-500 px/s): 20s — moderate compute
//   - skimming (>500 px/s): 8s — cancel aggressively, user won't return
//
// Anchor key per ARCH §3: stable content fingerprint captured at enqueue
// for DOM-recycle defense. The verdict-render gate (Day 4) revalidates the
// live DOM against the anchor key before applying the verdict.
//
// AbortController per QueueItem. The
// controller's signal threads through processFn → pipeline.ts →
// combinedDetectAndNeutralize → callAI so an in-flight HTTP request is
// cancelled when the queue drops a stale item. Per ARCH §4 cancel-as-chain-event:
// abort fires BEFORE the stale item is removed from the queue, so any
// callAI listener wakes via AbortError and the pipeline's cancel-stale /
// cancel-mid-flight branches stamp the chain.

import { PostContent } from '../../types/post';
import { PipelineResult } from '../../analysis/pipeline';
import { reportProcessingError, isContextError, safeSendMessage } from '../../storage/context-guard';
import { isFeatureEnabled } from '../../storage/feature-flags';
import type { CapturedBehavior } from '../../forensics/capture-behavior';
import { computeAnchorKey, isAnchorDegenerate } from '../../core/anchor-key';

// capture-routing fix. Send capture messages to the SW
// instead of writing IDB directly from this content-script context. Content
// scripts run at the host page's origin (tiktok.com etc.), so direct IDB
// writes landed in the wrong origin and were unreadable from the extension's
// dashboard / popup / dev-console. SW handler in service-worker.ts:CAPTURE_BEHAVIOR
// performs the actual write at the extension origin.
function sendCaptureBehavior(payload: Omit<CapturedBehavior, 'id'>): void {
  // route through safeSendMessage so the extension-context-invalidated state
  // is honored (no further retries after first failure; cleaner Errors panel
  // for parents). The raw chrome.runtime.sendMessage call would keep firing
  // per scroll event after an extension reload until the orphaned content
  // script was unloaded.
  void safeSendMessage({ type: 'CAPTURE_BEHAVIOR', payload });
}

/**
 * Categorical viewport state.
 * Maps to a numeric priority via `priorityForState`.
 */
export type ViewportState = 'visible-soon' | 'visible' | 'scrolled-past';

/**
 * Rich viewport info captured at enqueue time. The caller (content script
 * scroll handler) tracks scroll-velocity EMA and viewport position; the queue
 * uses the snapshot to compute priority and adaptive stale threshold.
 */
export interface ViewportInfo {
  state: ViewportState;
  /** Scroll velocity in px/sec (EMA over last ~2s). Used for adaptive stale. */
  velocityPxPerSec: number;
  /**
   * Post's top Y-coordinate at enqueue time, in pixels relative to the
   * viewport. 0 = top edge of viewport, ~window.innerHeight = bottom. Used as
   * a tiebreaker WITHIN a viewport-state tier so top-of-viewport posts drain
   * before bottom-of-viewport posts (matches reading order: top of subtree /
   * parent post first, replies after).
   * The boolean-isVisible form never surfaced Y. The Y-bonus is bounded (0..5)
   * so it tiebreaks within state without ever flipping the cross-state ordering
   * (state delta is 49 between tiers).
   * Optional — callers without DOM-ref access (tests, batch path) omit.
   */
  viewportY?: number;
}

/**
 * Queue-priority semantic. Layered on top of viewport state: within the same
 * state, `post` drains before `top_comment` before `reply` before `batch_rest`.
 *
 * Distinct from PostContent.kind (which is the extractor's tree position):
 * a single `comment` PostContent could be a `top_comment` here when it's
 * the highest-leverage comment in the thread, or a `reply` when nested,
 * or `batch_rest` for the long tail. The mapping is the caller's choice.
 */
export type QueueItemKind = 'post' | 'top_comment' | 'reply' | 'batch_rest';

/**
 * Optional richer signals on enqueue. Exact classification inputs always
 * participate in dedup; callers may additionally separate surface generations.
 * New callers pass for multi-surface FB feed-vs-group dedup and within-post
 * priority ordering.
 */
export interface EnqueueOptions {
  /** Surface identity (FB group name / hashtag / similar). Composes the dedup key. */
  surfaceIdentity?: string;
  /** Queue-priority semantic. Defaults to 'post'-tier weight. */
  kind?: QueueItemKind;
}

export interface QueueItem {
  post: PostContent;
  /** Numeric priority derived from viewport state + kind. Higher = drained first. */
  priority: number;
  /** Categorical viewport state at enqueue time (forensic log signal). */
  state: ViewportState;
  /**
   * Stable content fingerprint captured at enqueue. The render-gate
   * recomputes the live-DOM fingerprint and drops the verdict if it doesn't
   * match (DOM was recycled by the platform's virtualizer for a different post).
   */
  anchorKey: string;
  /**
   * True when the anchor key was built from the empty-caption fallback path.
   * Surfaced for downstream observability + future render-gate tightening (V1.5+).
   */
  isDegenerate: boolean;
  /**
   * Exact classification-input key including item/surface identity and queue kind.
   */
  dedupKey: string;
  /**
   * Queue-priority semantic captured for forensic log signal + drain ordering.
   */
  kind: QueueItemKind;
  /** Per-item adaptive stale threshold, computed from velocity at enqueue. */
  staleMs: number;
  addedAt: number;
  /**
   * Per-item AbortController. Created at enqueue; signal
   * threads through processFn → pipeline → callAI. The drain loop calls
   * `controller.abort()` BEFORE removing a stale item, so any in-flight
   * HTTP request is cancelled (AbortError surfaces in callAI as Err(aborted)).
   * Pipeline.ts checks signal.aborted at the cancel-stale / cancel-mid-flight
   * gates and stamps the chain accordingly.
   */
  controller: AbortController;
  /**
   * Set by `invalidate()` on an item that was already dispatched. Its result
   * is never delivered to onResult; the drop callback receives it as
   * 'invalidated' instead, so the stale verdict leaves a record and nothing
   * else.
   */
  invalidated?: boolean;
}

// Concurrency + queue depth. Keep admission aligned with ai/client.ts's five
// renderer-side proxy-fetch slots. Admitting ten merely created a hidden FIFO
// behind the priority queue, so a later visible/video verdict waited behind
// speculative work that could no longer be reordered.
// MAX_QUEUE_SIZE 30→60: capture observed 24% eviction rate on the 30-cap
// (37/154 enqueued posts dropped before dispatch); doubling cuts the eviction
// loss directly. Exported so tests + diagnostic UI can read without
// duplicating magic numbers.
export const MAX_CONCURRENT = 5;
export const MAX_QUEUE_SIZE = 60;
const MAX_BACKGROUND_CONCURRENT = MAX_CONCURRENT - 1;

const PRIORITY_VISIBLE_SOON = 100;
const PRIORITY_VISIBLE = 50;
const PRIORITY_SCROLLED_PAST = 1;

const STALE_MS_BROWSING = 60_000;
const STALE_MS_SCANNING = 20_000;
const STALE_MS_SKIMMING = 8_000;
const VELOCITY_THRESHOLD_BROWSING = 100;  // px/sec
const VELOCITY_THRESHOLD_SCANNING = 500;  // px/sec

/** ARCH §4 adaptive stale-threshold lookup. */
export function staleMsForVelocity(velocityPxPerSec: number): number {
  const v = Math.max(0, velocityPxPerSec);
  if (v < VELOCITY_THRESHOLD_BROWSING) return STALE_MS_BROWSING;
  if (v < VELOCITY_THRESHOLD_SCANNING) return STALE_MS_SCANNING;
  return STALE_MS_SKIMMING;
}

/** ARCH §1 categorical→numeric priority. Higher = drained first. */
export function priorityForState(state: ViewportState): number {
  switch (state) {
    case 'visible-soon': return PRIORITY_VISIBLE_SOON;
    case 'visible': return PRIORITY_VISIBLE;
    case 'scrolled-past': return PRIORITY_SCROLLED_PAST;
  }
}

/**
 * Kind-weight. Composes with priorityForState as `state*10 + kindWeight` so
 * kind orders tiebreakers within the same viewport state without ever flipping
 * cross-state order (max kind delta = 3 < min state delta = 49 between
 * scrolled-past=1 and visible=50). Default 'post' weight when kind is absent —
 * back-compat with pre-Tier-C callers.
 */
export function kindWeight(kind: QueueItemKind | undefined): number {
  switch (kind) {
    case 'top_comment': return 3;
    case 'reply': return 2;
    case 'batch_rest': return 1;
    case 'post':
    default: return 4;
  }
}

/**
 * Y-position bonus within viewport-state tier. Higher priority for posts
 * CLOSER TO THE TOP of the viewport so the user's reading order is matched:
 * parent post / top-of-subtree drains before replies below. Without this,
 * all in-viewport posts had identical priority, so FIFO-on-DOM-mutation order
 * processed Twitter replies (mounted lower in the article tree) before the
 * parent post — a live test on a high-reply-volume X profile found "the sub
 * tree seems to load faster from the bottom/root up". The 0..5 range is
 * intentionally tighter than kindWeight's 1..4 range so cross-kind ordering
 * is preserved within the same state — Y is the finest-grain tiebreaker.
 *
 * Above-viewport (y < 0) and below-viewport (y > vh) get bonus 0 because the
 * state tier already differentiates them; mixing Y at the boundary would
 * confuse cross-state ordering.
 */
function viewportYBonus(viewportY: number | undefined): number {
  if (viewportY == null) return 0;
  const vh = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 1000;
  if (viewportY < 0 || viewportY > vh) return 0;
  return Math.max(0, Math.round(5 * (1 - viewportY / vh)));
}

/**
 * Per-item processor. Receives the per-item AbortSignal so the pipeline can
 * short-circuit on cancel-stale (signal.aborted at entry) or cancel-mid-flight
 * (signal.aborted after callAI returns).
 */
type ProcessFn = (post: PostContent, signal: AbortSignal) => Promise<PipelineResult>;
export type QueueDropReason =
  | 'evicted-size-cap'
  | 'cancelled-stale'
  | 'failed'
  | 'context-stop'
  | 'invalidated';
type QueueDropFn = (post: PostContent, reason: QueueDropReason) => void;

/** Normalize the legacy boolean `isVisible` form to the rich ViewportInfo. */
function normalizeViewport(viewport: boolean | ViewportInfo): ViewportInfo {
  if (typeof viewport === 'boolean') {
    return { state: viewport ? 'visible' : 'scrolled-past', velocityPxPerSec: 0 };
  }
  return viewport;
}

function classificationDedupKey(
  post: PostContent,
  surfaceIdentity: string,
  queueKind: QueueItemKind,
): string {
  return JSON.stringify([
    post.id,
    surfaceIdentity,
    post.platform,
    post.author.trim(),
    post.kind ?? 'post',
    post.parentVideoId ?? '',
    post.parent_id ?? '',
    post.depth ?? '',
    post.text,
    post.context ?? '',
    post.is_sponsored === true,
    queueKind,
  ]);
}

export class ProcessingQueue {
  private queue: QueueItem[] = [];
  private activeCount = 0;
  private stopped = false;
  /**
   * Dedup map for in-flight items. The queued check at enqueue()
   * (`this.queue.some(...)`) only catches duplicates while the item is
   * still queued. Once shifted off the queue and dispatched to processFn,
   * a re-enqueue of the same dedupKey would pass the queued-only check
   * and start a second Groq round-trip for the same content.
   *
   * Per docs/audits/2026-05-23/latency-duplicate-diagnosis.md C2: route-
   * rescan + 3s periodic rescan + X scroll-trigger can all re-extract a
   * tweet while its first classification is still mid-flight (500-1400ms
   * Groq window). The map closes that race and fans the result out to every
   * exact-input DOM remount.
   */
  private inFlight = new Map<string, QueueItem>();
  private coalesced = new Map<string, PostContent[]>();
  private processFn: ProcessFn;
  private onResult: (post: PostContent, result: PipelineResult) => void;
  private onDrop: QueueDropFn;

  constructor(
    processFn: ProcessFn,
    onResult: (post: PostContent, result: PipelineResult) => void,
    onDrop: QueueDropFn = () => undefined,
  ) {
    this.processFn = processFn;
    this.onResult = onResult;
    this.onDrop = onDrop;
  }

  private notifyDropped(items: readonly QueueItem[], reason: QueueDropReason): void {
    for (const item of items) {
      const recipients = [item.post, ...this.takeCoalesced(item.dedupKey)];
      for (const post of recipients) this.notifyPostDropped(post, reason);
    }
  }

  private notifyPostDropped(post: PostContent, reason: QueueDropReason): void {
    try {
      this.onDrop(post, reason);
    } catch (error) {
      console.warn('[FeelingWise] Queue drop callback failed:', error);
    }
  }

  private coalesce(dedupKey: string, primary: PostContent, post: PostContent): void {
    if (primary === post) return;
    const recipients = this.coalesced.get(dedupKey) ?? [];
    if (!recipients.includes(post)) recipients.push(post);
    this.coalesced.set(dedupKey, recipients);
  }

  private takeCoalesced(dedupKey: string): PostContent[] {
    const recipients = this.coalesced.get(dedupKey) ?? [];
    this.coalesced.delete(dedupKey);
    return recipients;
  }

  /**
   * Add a post to the queue.
   *
   * Accepts either:
   *   - boolean — pre-Day-2 single-bit `isVisible` (true=visible, false=scrolled-past).
   *     Velocity defaults to 0 ⇒ 60s stale threshold (browsing-mode).
   *   - ViewportInfo — rich state with explicit velocity for adaptive stale.
   *
   * The third optional `options` param carries surfaceIdentity (composes
   * exact-input dedup key) + kind (composes priority).
   */
  enqueue(post: PostContent, viewport: boolean | ViewportInfo, options: EnqueueOptions = {}): boolean {
    if (this.stopped) return false;

    const info = normalizeViewport(viewport);
    const kind: QueueItemKind = options.kind ?? 'post';
    const incomingPriority = priorityForState(info.state) * 10
      + kindWeight(kind)
      + viewportYBonus(info.viewportY);
    const dedupKey = classificationDedupKey(post, options.surfaceIdentity ?? '', kind);
    // Coalesce only the same complete classification input. The same id with
    // changed text/author/context or a new surface generation stays independent.
    const queuedDuplicate = this.queue.find(item => item.dedupKey === dedupKey);
    if (queuedDuplicate) {
      this.coalesce(dedupKey, queuedDuplicate.post, post);
      const becameVisible = info.state === 'visible' && queuedDuplicate.state !== 'visible';
      if (incomingPriority >= queuedDuplicate.priority || becameVisible) {
        queuedDuplicate.priority = Math.max(queuedDuplicate.priority, incomingPriority);
        // Visibility is sticky for the lifetime of this exact-input job. A
        // below-viewport remount must not demote another connected recipient
        // that is already on screen.
        if (becameVisible || queuedDuplicate.state !== 'visible') {
          queuedDuplicate.state = info.state;
        }
        queuedDuplicate.staleMs = Math.max(
          queuedDuplicate.staleMs,
          staleMsForVelocity(info.velocityPxPerSec),
        );
        queuedDuplicate.addedAt = Date.now();
      }
      if (becameVisible) this._drain();
      return true;
    }
    // In-flight dedup. Catches re-enqueues that arrive while the original
    // item is in processFn (Groq round-trip ~500-1400ms window).
    const activeDuplicate = this.inFlight.get(dedupKey);
    if (activeDuplicate) {
      this.coalesce(dedupKey, activeDuplicate.post, post);
      if (info.state === 'visible' && activeDuplicate.state !== 'visible') {
        activeDuplicate.state = 'visible';
        this._drain();
      }
      return true;
    }

    const item: QueueItem = {
      post,
      // Three-tier composite priority: viewport state (cross-tier dominant) →
      // kindWeight (within-tier post-vs-reply order) → Y-position (finest-grain
      // tiebreaker so top-of-viewport drains first).
      priority: incomingPriority,
      state: info.state,
      anchorKey: computeAnchorKey(post),
      isDegenerate: isAnchorDegenerate(post),
      dedupKey,
      kind,
      staleMs: staleMsForVelocity(info.velocityPxPerSec),
      addedAt: Date.now(),
      controller: new AbortController(),
    };

    this.queue.push(item);
    // Emit enqueued event for behavior-capture. Emitted BEFORE size-cap
    // eviction so the capture data has the full picture: enqueued count =
    // (post-dedup arrivals); evicted count = (size-cap losses); dispatched count =
    // (drained survivors). The enqueue→dispatch latency = waiter-queue depth.
    void this._maybeCaptureEvents([item], 'enqueued');

    // Enforce max queue size — drop lowest-priority items first, ties by age desc
    // (drop oldest first when same priority). Items dropped by the size cap also
    // get their controller aborted so any speculative HTTP request they might
    // have spawned is cancelled (currently they were never dispatched — they
    // were only queued — but the abort is symmetric and forensically clean:
    // the post is observed but never classified).
    if (this.queue.length > MAX_QUEUE_SIZE) {
      this.queue.sort((a, b) => b.priority - a.priority || a.addedAt - b.addedAt);
      const dropped = this.queue.slice(MAX_QUEUE_SIZE);
      for (const d of dropped) d.controller.abort();
      this.notifyDropped(dropped, 'evicted-size-cap');
      // Emit eviction events for behavior-capture.
      void this._maybeCaptureEvents(dropped, 'evicted-size-cap');
      this.queue = this.queue.slice(0, MAX_QUEUE_SIZE);
    }

    this._drain();
    return true;
  }

  /**
   * Process items from the queue respecting concurrency limits.
   */
  private _drain(): void {
    if (this.stopped) return;

    while (this.activeCount < MAX_CONCURRENT && this.queue.length > 0) {
      // Remove stale items per their per-item adaptive threshold.
      // Abort BEFORE remove. Calling abort() AFTER removing could leak the
      // controller into a fired fetch with no listener; the pre-remove abort
      // guarantees the in-flight fetch wakes via AbortError, callAI returns
      // Err(aborted), the pipeline sees signal.aborted, and pipeline.ts
      // emits a cancel-stale chain record per VISION §1.1.
      const now = Date.now();
      const stale: QueueItem[] = [];
      const fresh: QueueItem[] = [];
      for (const item of this.queue) {
        // A visible item is on screen under its cover; the age check exists
        // to stop paying for posts the reader scrolled past, and dropping a
        // visible one uncovered it raw with no verdict (PROTECTION-PATH-1).
        if (item.state !== 'visible' && now - item.addedAt >= item.staleMs) stale.push(item);
        else fresh.push(item);
      }
      for (const s of stale) s.controller.abort();
      this.notifyDropped(stale, 'cancelled-stale');
      // Emit cancelled-stale events for behavior-capture.
      void this._maybeCaptureEvents(stale, 'cancelled-stale');
      this.queue = fresh;

      if (this.queue.length === 0) break;

      // Sort by priority desc, then by age asc (oldest first among same priority).
      this.queue.sort((a, b) => b.priority - a.priority || a.addedAt - b.addedAt);

      // Preserve one local admission slot for work that is actually visible.
      // Matching the renderer fetch cap removes this queue's hidden five-job
      // network backlog; independent media calls still share that fetch gate.
      const backgroundActive = [...this.inFlight.values()]
        .filter(active => active.state !== 'visible').length;
      const nextIndex = backgroundActive >= MAX_BACKGROUND_CONCURRENT
        ? this.queue.findIndex(candidate => candidate.state === 'visible')
        : 0;
      if (nextIndex < 0) break;

      const [item] = this.queue.splice(nextIndex, 1);
      this.activeCount++;
      this.inFlight.set(item.dedupKey, item);
      // Emit dispatched event for behavior-capture.
      void this._maybeCaptureEvents([item], 'dispatched');

      this.processFn(item.post, item.controller.signal)
        .then(result => {
          if (item.invalidated) {
            this.notifyDropped([item], 'invalidated');
            return;
          }
          const recipients = [item.post, ...this.takeCoalesced(item.dedupKey)];
          for (const post of recipients) {
            try {
              this.onResult(post, result);
            } catch (error) {
              this.notifyPostDropped(post, 'failed');
              console.error('[FeelingWise] Queue result callback failed:', error);
            }
          }
          // Emit classified event for behavior-capture.
          void this._maybeCaptureEvents([item], 'classified', result);
        })
        .catch(err => {
          if (item.invalidated) {
            this.notifyDropped([item], 'invalidated');
            return;
          }
          this.notifyDropped([item], 'failed');
          // Context-invalidated errors are EXPECTED during extension reload
          // (this tab's content script was orphaned; runtime calls die).
          // Stay silent — `reportProcessingError` will warn once after the
          // threshold to tell the user "Queue stopped — extension context dead."
          // Other processing errors stay at console.error as before.
          if (!isContextError(err)) {
            console.error('[FeelingWise] Queue processing error:', err);
          }
          // Emit failed event for behavior-capture (skip context errors —
          // those are expected during extension reload, not failures).
          if (!isContextError(err)) {
            void this._maybeCaptureEvents([item], 'failed');
          }
          if (reportProcessingError(err)) {
            this.stopped = true;
            const abandoned = this.queue;
            for (const queued of abandoned) queued.controller.abort();
            this.notifyDropped(abandoned, 'context-stop');
            this.queue = [];
          }
        })
        .finally(() => {
          this.activeCount--;
          this.inFlight.delete(item.dedupKey);
          if (!this.stopped) {
            this._drain();
          }
        });
    }
  }

  /**
   * Drop every item the predicate matches. Queued matches are aborted and
   * removed before any callback runs; in-flight matches are aborted and
   * flagged so their eventual result is discarded. Each matching owner (and
   * its coalesced remounts) is reported once as 'invalidated', which the
   * content script turns into a cancelled-stale record. Called from the
   * classification-generation bumps (route, mode, strict-language change),
   * so a surface the reader left no longer pays for or blocks the queue
   * (PROTECTION-PATH-2).
   */
  invalidate(predicate: (post: PostContent) => boolean): number {
    const dropped: QueueItem[] = [];
    const kept: QueueItem[] = [];
    for (const item of this.queue) {
      if (predicate(item.post)) dropped.push(item);
      else kept.push(item);
    }
    this.queue = kept;
    for (const item of dropped) item.controller.abort();
    let flagged = 0;
    for (const item of this.inFlight.values()) {
      if (item.invalidated || !predicate(item.post)) continue;
      item.invalidated = true;
      item.controller.abort();
      flagged++;
    }
    this.notifyDropped(dropped, 'invalidated');
    void this._maybeCaptureEvents(dropped, 'cancelled-stale');
    return dropped.length + flagged;
  }

  get pending(): number {
    return this.queue.length;
  }

  get active(): number {
    return this.activeCount;
  }

  /**
   * Behavioral capture. Fire-and-forget emit one event per item to the
   * `feelingwise-behavior-capture` IDB store when the `captureBehavior` flag
   * is on. Same dev-flag-gated + errors-swallowed contract as
   * `capture-prompt-io.ts`. Caller wraps in `void` and never awaits — this
   * method must NEVER block the queue's hot path.
   */
  private async _maybeCaptureEvents(
    items: QueueItem[],
    eventKind:
      | 'enqueued'
      | 'dispatched'
      | 'classified'
      | 'cancelled-stale'
      | 'cancelled-mid-flight'
      | 'evicted-size-cap'
      | 'failed',
    result?: PipelineResult,
  ): Promise<void> {
    if (items.length === 0) return;
    if (!(await isFeatureEnabled('captureBehavior'))) return;
    const ts = Date.now();
    for (const item of items) {
      sendCaptureBehavior({
        ts,
        postId: item.post.id,
        eventKind,
        ageMs: ts - item.addedAt,
        state: item.state,
        kind: item.kind,
        isDegenerate: item.isDegenerate,
        verdictLabel: result?.action,
      });
    }
  }
}
