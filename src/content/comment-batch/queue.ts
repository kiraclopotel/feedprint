// The comment-batch debouncer: per-parent pending buckets, the debounce /
// size-cap / rate-limit scheduling, the remembered room context and caption
// records, and the flush-time room snapshot. flushBatch itself stays in
// content/index.ts and is handed in as the BatchFlusher parameter, so this
// module never imports the content entry. Extracted per
// docs/audits/2026-08-23-objective-audit/wave4-architecture (Proposal A, step 4).

import type { PostContent, Platform } from '../../types/post';
import { isHolding as isFlushBudgetHolding, holdRemainingMs as flushBudgetHoldRemainingMs } from '../../ai/global-flush-budget';
import { recordRoomMutation } from '../../diagnostics/room-attribution-outcome';
import { bumpCounter } from '../../diagnostics/diagnostics';
import { buildPostUrl, roomFromPermalink, truncateRoomCaption } from '../record/post-url';
import {
  observePostForViewport,
  isParentInCooldown,
  unmarkPostsForReExtraction,
} from '../post-path/viewport-tracker';
import { getSettings, type FWSettings } from '../../storage/settings';
import { sendHighStakesForensicLog } from '../record/forensic-retry';
import { hasLoggedForensic, shouldLogCancelForensic, forensicDedupKey } from '../record/forensic-gate';
import { buildConfigSnapshot } from '../record/config-snapshot';
import { mediaUrlsNow } from '../record/media-urls';
import { MANIPULATION_SEVERITY_THRESHOLD } from '../../core/severity-floor';

// ─── Comment-batch debouncer ─────────────────────────────────────────────────
// Each comment record arrives one at a time as the adapter walks the DOM.
// We don't want to fire one LLM call per comment — we want ONE call per
// video's comment section. Bucket by parentVideoId; when no new comment
// arrives for COMMENT_BATCH_DEBOUNCE_MS, flush the bucket through scoreBatch.
//
// Caption record (kind='video' / 'post') still flows through the normal queue
// — captions get the per-post pipeline + flag/neutralize UX. Comments take the
// batch path because:
//   • short individual comments are too ambiguous to score well in isolation
//   • cost — N comments in 1 call ≈ N× cheaper than N calls
//   • the user-facing value is the AGGREGATE (the "room" label), not per-comment
const COMMENT_BATCH_DEBOUNCE_MS = 1500;
// Cap kept small to defeat lost-in-the-middle recall collapse on the
// classifier: a harm at the middle of a 25-comment batch is caught 3/41 vs
// 37/41 at batch size 5 (litm-probe sweep, docs/research/REQUEST_FLOW_AND_CONTEXT.md
// §4b). 5 is the measured-safe floor; sizes 12 and 25 collapse the middle.
// Tradeoff accepted: smaller batches mean more (cheaper) Groq calls on
// fast-scrolled threads — child-safety recall wins over call-count economy.
const COMMENT_BATCH_MAX_SIZE = 5;
// Universal post-flush rate limit per parent. Successive flushes for the
// same parent cannot fire faster than this interval, so a user rapidly
// scrolling past dozens of fresh comments can't trigger back-to-back LLM
// calls. The debounce delays the FLUSH; new comments still land in the
// bucket so the chain-mirror invariant (VISION §1.1) is preserved.
const COMMENT_BATCH_MIN_FLUSH_INTERVAL_MS = 800;
/** parent key → epoch-ms of last flush start. Read by enqueueCommentForBatch
 *  to gate the next flush; written by flushBatch at entry. */
const lastFlushAtByParent = new Map<string, number>();

/**
 * Compute the minimum wait (ms) before the next flush for a parent can fire,
 * given the rate-limit window. Returns 0 when the parent has never flushed
 * or the window has fully elapsed.
 *
 * Pure function — exported for unit testing the rate-limit semantics.
 */
export function computeMinFlushWaitMs(
  lastFlushAt: number | undefined,
  now: number,
  intervalMs: number = COMMENT_BATCH_MIN_FLUSH_INTERVAL_MS,
): number {
  if (lastFlushAt === undefined) return 0;
  return Math.max(0, lastFlushAt + intervalMs - now);
}

/** Test hook: clear the per-parent last-flush map. */
export function _resetCommentBatchRateLimitForTesting(): void {
  lastFlushAtByParent.clear();
}

export interface PendingBatch {
  posts: PostContent[];
  caption: string;
  timer: number | null;
  videoUrl: string;
  feedSource: PostContent['feedSource'];
  platform: Platform;
  // Denormalized parent author. Successful comment records carry it so a
  // recipient can understand the room without an external join. The bounded
  // identity cache may seed it; missing adapter data stays honestly unknown.
  videoAuthor: string;
  // Current page URL stamped when this comment batch forms. It is never
  // inherited from the identity cache. `buildEncounterForFlushBatch` uses it
  // for DOM-cohesion checks; the TikTok fallback also derives a room only when
  // this URL's item id equals the bucket parent id.
  permalinkUrl?: string;
}
export const pendingBatches = new Map<string, PendingBatch>();
type RememberedRoomContext = Pick<PendingBatch, 'caption' | 'videoUrl' | 'videoAuthor'>;
export type PendingBatchRoom = Omit<PendingBatch, 'posts' | 'timer'>;
const roomContextByParent = new Map<string, RememberedRoomContext>();
const MAX_REMEMBERED_ROOM_CONTEXTS = 500;

export function roomContextKey(platform: Platform, parentId: string): string {
  return `${platform}:${parentId}`;
}

function rememberRoomContext(platform: Platform, parentId: string, context: RememberedRoomContext): void {
  const key = roomContextKey(platform, parentId);
  roomContextByParent.delete(key);
  roomContextByParent.set(key, { ...context });
  if (roomContextByParent.size > MAX_REMEMBERED_ROOM_CONTEXTS) {
    const oldestKey = roomContextByParent.keys().next().value;
    if (oldestKey !== undefined) roomContextByParent.delete(oldestKey);
  }
}

// Q51 (W55): caption records never reach bucket.posts (only
// enqueueCommentForBatch fills it), so the encounter assemblers' caption
// lookup ALWAYS missed: is_sponsored never reached the batch prompt (ad
// copy judged as organic), the post author blanked, FB caption metrics
// dropped. Capture the caption PostContent at the chokepoint, keyed like
// the room context, and hand it to the assemblers at flush.
export const captionPostByParent = new Map<string, PostContent>();
const MAX_CAPTION_POSTS = 500;

export function rememberCaptionPost(post: PostContent): void {
  if (!post.parentVideoId) return;
  const key = roomContextKey(post.platform, post.parentVideoId);
  captionPostByParent.delete(key);
  captionPostByParent.set(key, post);
  if (captionPostByParent.size > MAX_CAPTION_POSTS) {
    const oldestKey = captionPostByParent.keys().next().value;
    if (oldestKey !== undefined) captionPostByParent.delete(oldestKey);
  }
}

function isKnownRoomAuthor(author: string): boolean {
  return author.length > 0 && author !== 'unknown';
}

function roomUrlTargetsParent(url: string, platform: Platform, parentId: string): boolean {
  if (!url || !parentId) return false;
  let parsed: URL;
  try {
    parsed = new URL(url, 'https://feelingwise.invalid/');
  } catch {
    return false;
  }

  const segments = parsed.pathname
    .split('/')
    .filter(Boolean)
    .map(segment => {
      try { return decodeURIComponent(segment); } catch { return segment; }
    });
  const after = (marker: string): string | undefined => {
    const index = segments.indexOf(marker);
    return index >= 0 ? segments[index + 1] : undefined;
  };

  if (platform === 'twitter') return after('status') === parentId;
  if (platform === 'tiktok') return after('video') === parentId;
  if (platform === 'instagram') {
    return after('p') === parentId || after('reel') === parentId;
  }
  if (platform === 'youtube') {
    return parsed.searchParams.get('v') === parentId || after('shorts') === parentId;
  }
  if (platform === 'facebook') {
    const queryId =
      parsed.searchParams.get('story_fbid') ??
      parsed.searchParams.get('fbid') ??
      parsed.searchParams.get('multi_permalinks');
    if (queryId === parentId) return true;
    if (
      after('posts') === parentId ||
      after('permalink') === parentId ||
      after('reel') === parentId ||
      after('videos') === parentId
    ) return true;
    const shareIndex = segments.indexOf('share');
    return shareIndex >= 0 &&
      (segments[shareIndex + 1] === 'p' || segments[shareIndex + 1] === 'v') &&
      segments[shareIndex + 2] === parentId;
  }
  return false;
}

function mergeRoomContext(
  current: RememberedRoomContext | undefined,
  incoming: RememberedRoomContext,
  freezeKnownFields: boolean,
  platform: Platform,
  parentId: string,
): RememberedRoomContext {
  if (!current) return { ...incoming };

  const authorConflict =
    isKnownRoomAuthor(current.videoAuthor) &&
    isKnownRoomAuthor(incoming.videoAuthor) &&
    current.videoAuthor !== incoming.videoAuthor;
  const differingUrls =
    current.videoUrl.length > 0 &&
    incoming.videoUrl.length > 0 &&
    current.videoUrl !== incoming.videoUrl;
  const urlUpgrade = differingUrls &&
    !roomUrlTargetsParent(current.videoUrl, platform, parentId) &&
    roomUrlTargetsParent(incoming.videoUrl, platform, parentId);
  const urlConflict = differingUrls && !urlUpgrade;

  if (authorConflict || urlConflict) return { ...current };
  if (freezeKnownFields) {
    return {
      caption: current.caption || incoming.caption,
      videoUrl: urlUpgrade ? incoming.videoUrl : current.videoUrl || incoming.videoUrl,
      videoAuthor: isKnownRoomAuthor(current.videoAuthor)
        ? current.videoAuthor
        : incoming.videoAuthor,
    };
  }
  return {
    caption: incoming.caption || current.caption,
    videoUrl: incoming.videoUrl || current.videoUrl,
    videoAuthor: isKnownRoomAuthor(incoming.videoAuthor)
      ? incoming.videoAuthor
      : current.videoAuthor,
  };
}

function roomContextOf(batch: PendingBatch): RememberedRoomContext {
  return {
    caption: batch.caption,
    videoUrl: batch.videoUrl,
    videoAuthor: batch.videoAuthor,
  };
}

export function seedRoomContextFromPost(post: PostContent): void {
  const key = post.parentVideoId ?? post.id;
  const existing = pendingBatches.get(key);
  const incoming: RememberedRoomContext = {
    caption: post.text,
    videoUrl: buildPostUrl(post),
    videoAuthor: post.author ?? 'unknown',
  };

  if (existing) {
    const before = roomContextOf(existing);
    const merged = mergeRoomContext(
      before,
      incoming,
      existing.posts.length > 0,
      post.platform,
      key,
    );
    void recordRoomMutation(
      { author: before.videoAuthor, url: before.videoUrl, caption: before.caption },
      { author: merged.videoAuthor, url: merged.videoUrl, caption: merged.caption },
      existing.posts.length,
      key,
    );
    existing.caption = merged.caption;
    existing.videoUrl = merged.videoUrl;
    existing.videoAuthor = merged.videoAuthor;
    rememberRoomContext(post.platform, key, merged);
    return;
  }

  const remembered = roomContextByParent.get(roomContextKey(post.platform, key));
  rememberRoomContext(
    post.platform,
    key,
    mergeRoomContext(remembered, incoming, false, post.platform, key),
  );
}

function newPendingBatch(post: PostContent, key: string): PendingBatch {
  const remembered = roomContextByParent.get(roomContextKey(post.platform, key));
  return {
    posts: [],
    caption: remembered?.caption ?? '',
    timer: null,
    videoUrl: remembered?.videoUrl ?? '',
    feedSource: post.feedSource,
    platform: post.platform,
    videoAuthor: remembered?.videoAuthor ?? 'unknown',
    permalinkUrl:
      typeof window !== 'undefined' && window.location ? window.location.href : undefined,
  };
}

function applyPendingRoomFallback(parentVideoId: string, bucket: PendingBatch): void {
  if (bucket.videoUrl) return;
  const derived = roomFromPermalink(bucket.permalinkUrl, parentVideoId);
  if (!derived) return;
  bucket.videoUrl = derived.url;
  if (!isKnownRoomAuthor(bucket.videoAuthor)) bucket.videoAuthor = derived.author;
  rememberRoomContext(bucket.platform, parentVideoId, roomContextOf(bucket));
}

export interface PreparedBatchRoomFields {
  postUrl: string;
  roomAuthor: string;
  roomCaption: string;
  roomUrl: string;
  videoCaption: string;
}

export interface PreparedFlushBatch {
  bucket: PendingBatch;
  roomFields: PreparedBatchRoomFields;
}

export function commentRecordRoomFields(roomFields: PreparedBatchRoomFields): Pick<
  PreparedBatchRoomFields,
  'postUrl' | 'roomAuthor' | 'roomCaption' | 'roomUrl'
> {
  const { postUrl, roomAuthor, roomCaption, roomUrl } = roomFields;
  return { postUrl, roomAuthor, roomCaption, roomUrl };
}

export function takePendingBatchForFlush(parentVideoId: string): PreparedFlushBatch | undefined {
  const bucket = pendingBatches.get(parentVideoId);
  if (!bucket) return undefined;
  pendingBatches.delete(parentVideoId);
  lastFlushAtByParent.set(parentVideoId, Date.now());

  // TikTok can expose the exact parent permalink only after the comment panel
  // opens. Resolve that id-gated fallback at the same boundary production uses,
  // then freeze one room snapshot for every comment record route and the
  // environment record.
  applyPendingRoomFallback(parentVideoId, bucket);
  return {
    bucket,
    roomFields: {
      postUrl: bucket.videoUrl,
      roomAuthor: bucket.videoAuthor,
      roomCaption: truncateRoomCaption(bucket.caption),
      roomUrl: bucket.videoUrl,
      videoCaption: bucket.caption,
    },
  };
}

export type BatchFlusher = (key: string) => Promise<void>;

export function flushBatchWhenBudgetReady(key: string, flush: BatchFlusher): void {
  const bucket = pendingBatches.get(key);
  if (!bucket) return;
  if (isFlushBudgetHolding()) {
    const deferMs = Math.max(1, flushBudgetHoldRemainingMs());
    bucket.timer = setTimeout(() => flushBatchWhenBudgetReady(key, flush), deferMs) as unknown as number;
    return;
  }
  bucket.timer = null;
  // Nobody waits for the flush; a rejection that gets past its own guard is counted, not left unhandled.
  void flush(key).catch((error: unknown) => {
    bumpCounter('commentFlushRejected');
    console.warn('[FW comment-batch] the flush rejected', error);
  });
}

export function deferConsumedBatchForBudgetHold(key: string, consumed: PendingBatch, flush: BatchFlusher): void {
  const queued = pendingBatches.get(key);
  const target = queued ?? consumed;
  if (queued && queued !== consumed) {
    if (queued.timer !== null) clearTimeout(queued.timer);
    const queuedPosts = new Set(queued.posts);
    queued.posts = [
      ...consumed.posts.filter((post) => !queuedPosts.has(post)),
      ...queued.posts,
    ];
  } else {
    pendingBatches.set(key, consumed);
  }
  const deferMs = Math.max(1, flushBudgetHoldRemainingMs());
  target.timer = setTimeout(() => flushBatchWhenBudgetReady(key, flush), deferMs) as unknown as number;
}

export function enqueueCommentForBatch(post: PostContent, flush: BatchFlusher): boolean {
  const key = post.parentVideoId ?? post.id;
  // per-parent cooldown short-circuit. After a fail-
  // closed flush we set a 30s lock so re-enqueue doesn't immediately re-flush
  // against a still-rate-limited Groq pool.
  //
  // .b — un-stamp adapter dedup datasets on the rejected post so the
  // adapter's per-element dedup gate (e.g. `facebook.ts:416`) re-extracts
  // this comment on the next scroll pass after cooldown expires. Without
  // this, the comment is permanently un-classified — VISION §1.1 chain-
  // mirror violation in the OPPOSITE direction (we exclude what the child
  // would experience on later scrolls).
  if (isParentInCooldown(key)) {
    unmarkPostsForReExtraction([post]);
    return false;
  }
  // begin observing this comment's element for viewport entry.
  // Idempotent: IO de-dupes by target so repeated calls on the same element
  // (lazy-load re-extraction) are harmless. Fail-open when domRef is dead
  // or IO is unavailable in this realm.
  observePostForViewport(post);
  let bucket = pendingBatches.get(key);
  if (!bucket) {
    bucket = newPendingBatch(post, key);
    pendingBatches.set(key, bucket);
    // A bucket now exists that a route change or a tab close could throw away,
    // and both of those paths are synchronous. Read the settings the record
    // will need while there is still time to, and arm the tab-close handler
    // here rather than at content-script start: it is installed exactly when
    // there is something for it to say, so no realm without buckets attaches
    // a listener. Both calls are idempotent.
    refreshObservedSettings();
    installCommentBatchUnloadStatement();
  }
  bucket.posts.push(post);

  // Universal post-flush debounce: a flush that just fired for this parent
  // imposes a minimum interval before the next flush. Comments arriving
  // during the window stay in the bucket; only the flush is delayed.
  // Prevents back-to-back LLM calls when a user rapidly scrolls past fresh
  // comment batches.
  const minWait = computeMinFlushWaitMs(lastFlushAtByParent.get(key), Date.now());

  // Cap the batch size — if we hit it, flush immediately (subject to the
  // post-flush rate limit) to avoid LLM token overruns. Continued scrolling
  // will form new batches.
  if (bucket.posts.length >= COMMENT_BATCH_MAX_SIZE) {
    if (bucket.timer !== null) clearTimeout(bucket.timer);
    if (minWait === 0) {
      bucket.timer = null;
      flushBatchWhenBudgetReady(key, flush);
    } else {
      bucket.timer = setTimeout(() => flushBatchWhenBudgetReady(key, flush), minWait) as unknown as number;
    }
    return true;
  }

  if (bucket.timer !== null) clearTimeout(bucket.timer);
  const wait = Math.max(COMMENT_BATCH_DEBOUNCE_MS, minWait);
  bucket.timer = setTimeout(() => flushBatchWhenBudgetReady(key, flush), wait) as unknown as number;
  return true;
}

/**
 * SPA route-change cleanup for the comment batcher. The interceptor strips
 * stale `data-fw-processed` stamps and re-walks the DOM on navigation, but the
 * comment buckets are keyed by the OLD url's parentVideoId / roomUrl. A bucket
 * left armed when the user navigates would flush its debounce timer after the
 * route change and write those comments under the NEW page's room context —
 * misattributing the prior page's comments (VISION §1.1 chain-mirror). Cancel
 * every pending bucket timer and drop the buckets + the per-parent flush-rate
 * map so the new route starts clean. Exported so the interceptor's route-change
 * detector can invoke it.
 */
/**
 * The settings this surface was last seen under, read once when a bucket opens.
 *
 * A record must name the mode the reader was actually in, and the two places
 * that give a bucket up (a route or mode change, and the tab closing) are both
 * synchronous: the pagehide one cannot await anything, because a service worker
 * round trip at pagehide never resolves (the finding that shaped
 * flushGapLedgerOnUnload in record/gap-ledger.ts). So the read happens early,
 * when the bucket is created, and what it found is what the statement uses.
 * Null means no read has completed yet, and then nothing is claimed: an
 * invented mode on a signed record is worse than the one missing case. The read
 * is TTL-cached in storage/settings.ts, so it costs one storage round trip per
 * cache window, not one per comment.
 */
let observedSettings: FWSettings | null = null;
function refreshObservedSettings(): void {
  void getSettings()
    .then((next) => { observedSettings = next; })
    .catch(() => { /* keep the last good snapshot */ });
}

/**
 * Say what the buckets held before they are dropped.
 *
 * These comments are further along than anything the interceptor drops under
 * backlog pressure: extracted, stamped, attributed to an author and a room. The
 * interceptor writes a signed gap marker for every backlog of raw DOM nodes it
 * lets go (dom-interceptor.ts, backlog-overflow / backlog-hidden); this larger
 * and more specific loss said nothing at all.
 *
 * It does not want a gap marker. A gap marker states a BOUND on what went, for
 * a loss whose items are no longer in hand; here every item IS in hand, so the
 * chain can name each one, and 'cancelled-stale' is the verdict it already
 * defines for exactly this: "FW observed this post but didn't classify it
 * before the user scrolled past" (types/forensic.ts).
 *
 * Cancel-side dedup only, so the same comment re-extracted on the next surface
 * still gets scored and rendered rather than skipped, and a second clear with
 * the buckets already gone writes nothing.
 *
 * Fire-and-forget on purpose: sendHighStakesForensicLog hands the message to
 * chrome.runtime before its first await, so a closing tab dispatches all of
 * them; awaiting between them would deliver the first and lose the rest.
 */
function statePendingCommentBatches(site: string): void {
  if (pendingBatches.size === 0) return;
  const settings = observedSettings;
  if (!settings) return;
  let stated = 0;
  for (const [parentVideoId, bucket] of pendingBatches) {
    for (const post of bucket.posts ?? []) {
      const key = forensicDedupKey(post);
      if (hasLoggedForensic(key) || !shouldLogCancelForensic(key)) continue;
      void sendHighStakesForensicLog({
        type: 'CANCEL_LOG',
        payload: {
          originalText: post.text,
          verdict: 'cancelled-stale',
          // Nothing was asked of the model, so there is no analysis to carry.
          analysis: undefined,
          mode: settings.mode,
          platform: post.platform,
          author: post.author,
          postUrl: bucket.videoUrl,
          roomAuthor: bucket.videoAuthor,
          roomCaption: truncateRoomCaption(bucket.caption),
          roomUrl: bucket.videoUrl,
          feedSource: post.feedSource ?? 'unknown',
          accountType: post.accountType,
          sourceContainer: post.sourceContainer,
          observedSequence: post.observedSequence,
          viewportSeenAt: post.viewportSeenAt,
          surfaceSessionId: post.surfaceSessionId,
          textCapture: post.textCapture,
          authorCapture: post.authorCapture,
          mediaUrls: mediaUrlsNow(post),
          configSnapshot: buildConfigSnapshot(settings.mode, MANIPULATION_SEVERITY_THRESHOLD, settings.dailyCap, settings.features, settings.readFailedFallback),
          kind: 'comment',
          parentVideoId,
        },
      });
      stated++;
    }
  }
  if (stated > 0) {
    console.log(`[FeelingWise] ${stated} comment(s) went unjudged when the surface changed (${site})`);
  }
}

/**
 * The statement must never be the reason the route change does not happen: a
 * throw here would leave the buckets armed and flushing the previous page's
 * comments under the new page's room, which is the misattribution this whole
 * clear exists to prevent. Recording is subordinate to acting, always. The
 * failure is loud so it is not mistaken for nothing to say.
 */
function statePendingCommentBatchesSafely(site: string): void {
  try {
    statePendingCommentBatches(site);
  } catch (err) {
    console.error('[FeelingWise] could not record the comments dropped at', site, err);
  }
}

let unloadStatementInstalled = false;

/**
 * The tab-close half of the same loss. Nothing is cleared here, because the
 * page is going anyway, and nothing is retired: retiring needs an
 * acknowledgement, none can arrive on a closing tab, and the outbox dedupes on
 * the delivery id if the page turns out to be entering bfcache instead (the
 * same contract as installForensicRetryUnloadFlush).
 */
export function installCommentBatchUnloadStatement(): void {
  if (unloadStatementInstalled) return;
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  unloadStatementInstalled = true;
  window.addEventListener('pagehide', () => statePendingCommentBatchesSafely('tab-close'));
}

/** Test hook: run the pagehide path without dispatching a real event. */
export function _statePendingCommentBatchesOnUnloadForTesting(): void {
  statePendingCommentBatchesSafely('tab-close');
}

export function clearPendingCommentBatchState(): void {
  // Stated before the map is cleared (2026-09-18): a comment sitting in the
  // 1500 ms debounce when the reader navigated used to leave nothing behind.
  statePendingCommentBatchesSafely('surface-change');
  for (const bucket of pendingBatches.values()) {
    if (bucket.timer !== null) {
      clearTimeout(bucket.timer);
      bucket.timer = null;
    }
  }
  pendingBatches.clear();
  roomContextByParent.clear();
  lastFlushAtByParent.clear();
}

/**
 * Test hook: arm a minimal pending bucket whose timer fires `onFlush` after
 * `delayMs`. Mirrors the real bucket's timer field so
 * clearPendingBatchesForRouteChange can cancel it. Returns nothing; inspect via
 * _peekPendingBatchKeysForTesting.
 */
export function _seedPendingBatchForTesting(key: string, onFlush: () => void, delayMs: number): void {
  const timer = setTimeout(onFlush, delayMs) as unknown as number;
  // `posts` and the room fields are present and empty rather than absent: every
  // reader of a bucket walks its posts, and a hook that hands out a shape the
  // production type forbids tests the wrong object.
  pendingBatches.set(key, {
    posts: [],
    caption: '',
    timer,
    videoUrl: '',
    feedSource: undefined,
    platform: 'youtube',
    videoAuthor: 'unknown',
  } as unknown as PendingBatch);
  lastFlushAtByParent.set(key, Date.now());
}

/** Test hook: read the keys currently held in the comment-batch map. */
export function _peekPendingBatchKeysForTesting(): string[] {
  return Array.from(pendingBatches.keys());
}

export function _peekPendingBatchPostIdsForTesting(key: string): string[] {
  return pendingBatches.get(key)?.posts.map((post) => post.id) ?? [];
}

export function _resetPendingBatchesForTesting(): void {
  clearPendingCommentBatchState();
}

export function _seedRoomContextFromPostForTesting(post: Partial<PostContent>): void {
  seedRoomContextFromPost(post as PostContent);
}

export function _takePendingBatchForFlushForTesting(key: string): {
  batch: PendingBatchRoom;
  commentRecord: Pick<PreparedBatchRoomFields, 'postUrl' | 'roomAuthor' | 'roomCaption' | 'roomUrl'>;
  environmentRecord: Pick<PreparedBatchRoomFields, 'postUrl' | 'videoCaption'>;
} | undefined {
  const prepared = takePendingBatchForFlush(key);
  if (!prepared) return undefined;
  const { posts: _posts, timer: _timer, ...batch } = prepared.bucket;
  const { videoCaption } = prepared.roomFields;
  return {
    batch,
    commentRecord: commentRecordRoomFields(prepared.roomFields),
    environmentRecord: { postUrl: prepared.roomFields.postUrl, videoCaption },
  };
}

export function _peekPendingBatchRoomForTesting(key: string): PendingBatchRoom | undefined {
  const batch = pendingBatches.get(key);
  if (!batch) return undefined;
  const { posts: _posts, timer: _timer, ...context } = batch;
  return context;
}
