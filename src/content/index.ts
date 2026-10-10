// FeelingWise - Content script entry point
// Detects the current platform, loads the appropriate adapter,
// and starts the MutationObserver to intercept posts.

import { shouldLogCancelForensic, forensicDedupKey } from './record/forensic-gate';
import { deriveAccountType } from './record/account-type';
import { createImpressionMemo, currentSurfaceSessionId, stampImpressionOrder } from './record/impression-order';
import { stampTextFold } from './record/text-fold';
import { stampMediaUrls } from './record/media-urls';
import { fwDebug } from './fw-log';
import { detectCurrentPlatform, isPrivateMessageSurface } from './platforms/adapter';
import { emitCancelLog } from './record/forensic-emit';
import {
  type PendingBatch,
  rememberCaptionPost,
  seedRoomContextFromPost,
  deferConsumedBatchForBudgetHold,
  enqueueCommentForBatch,
  clearPendingCommentBatchState,
} from './comment-batch/queue';
// The debouncer lives in ./comment-batch/queue; re-exported for the existing
// import-from-index call sites in tests.
export {
  computeMinFlushWaitMs,
  _resetCommentBatchRateLimitForTesting,
  _seedPendingBatchForTesting,
  _peekPendingBatchKeysForTesting,
  _peekPendingBatchPostIdsForTesting,
  _resetPendingBatchesForTesting,
  _seedRoomContextFromPostForTesting,
  _takePendingBatchForFlushForTesting,
  _peekPendingBatchRoomForTesting,
} from './comment-batch/queue';
import { flushBatch as runFlushBatch, type FlushDeps } from './comment-batch/flush';
import { createResultApplier } from './post-path/result-apply';
import { createProtectionTerminals } from './protection/protection-terminals';
// URL helpers live in ./post-url; re-exported for the existing import-from-index tests.
export { isSyntheticUuid, buildPostUrl, truncateRoomCaption, roomFromPermalink } from './record/post-url';
import { TwitterAdapter } from './platforms/twitter';
import { FacebookAdapter } from './platforms/facebook';
import { YoutubeAdapter } from './platforms/youtube';
import { TiktokAdapter } from './platforms/tiktok';
import { InstagramAdapter } from './platforms/instagram';
import { ContentInterceptor, type SurfaceChangeReason } from './post-path/dom-interceptor';
import { startDiagnostics, bumpCounter } from '../diagnostics/diagnostics';
import {
  type ResolvedCommentVerdict,
  sessionVerdictByPostId,
  sessionPassPostIds,
  sessionHideCollapseByPostId,
  sessionLateVerdictByPostId,
  sessionCommentResolutionByKey,
  sessionCommentResolutionByText,
  sessionVerdictKey,
  shouldBypassResolvedBatchedComment,
  noteStaleCancelled,
  noteReencounterIfStaleCancelled,
  clearSessionVerdictCachesOnModeChange,
} from './post-path/late-verdict-cache';
// The session verdict caches live in ./late-verdict-cache; re-exported here
// so existing import-from-index call sites in tests keep working.
export {
  type LateVerdict,
  lateVerdictFromCancelledAnalysis,
  _storeLateVerdictForTesting,
  _peekLateVerdictForTesting,
  _resetLateVerdictsForTesting,
  _storeLateVerdictRealForTesting,
  _noteStaleCancelledForTesting,
  _noteReencounterIfStaleCancelledForTesting,
  _seedSessionVerdictCachesForTesting,
  _sessionVerdictCacheSizesForTesting,
  _hasSessionPassForTesting,
  _clearSessionVerdictCachesOnModeChangeForTesting,
  _sessionVerdictKeyForTesting,
  _shouldBypassResolvedBatchedCommentForTesting,
  _rememberResolvedCommentForTesting,
  _peekResolvedCommentForTesting,
  _isAuthoritativeSessionPassReasonForTesting,
} from './post-path/late-verdict-cache';
import { installPageWorldRelay } from './page-world/relay';
import { clearWireStore, enrichPostFromWire } from './page-world/wire-store';
import { releaseHeldRoomVerdicts } from './post-path/room-verdict';
import { ChildProtectionManager } from './protection/child-first-protection';
import { signalContentShieldReady, waitForDocumentBody } from './protection/document-start-shield';
import { PostContent } from '../types/post';
import { PlatformAdapter } from './platforms/adapter';
import { process as processPipeline } from '../analysis/pipeline';
import { withDescriptorV1 } from './record/descriptor-step';
import { recordSpan } from '../diagnostics/perf-trace';
import { getSettings, isFeatureEnabled, type FWSettings } from '../storage/settings';
import { resolveUiLanguage } from '../i18n';
import { ProcessingQueue, type QueueDropReason } from './post-path/post-queue';
import { getCurrentVelocity, startScrollVelocityTracking } from './post-path/scroll-velocity';
// anchor-revalidation render-gate.
// Before any UI mutation lands, verify the live DOM still matches the post
// we classified. On mismatch (platform virtualizer recycled the node), suppress
import { initVideoPipeline } from './post-path/video-pipeline';
import { initYtWatchComments } from './platforms/yt-watch-comments';
import { initYtShorts } from './platforms/yt-shorts';
import { initEngagementControl } from './engagement/controller';
import { setBlockedRecorder } from './engagement/recorder-sink';
import { sendHighStakesForensicLog } from './record/forensic-retry';
import { startReadThis } from './markers/read-this';
import { initializeModeAwareProtection } from './protection/protection-runtime-startup';
import { getLicense } from '../storage/license';
import { onContextInvalidated } from '../storage/context-guard';
import { armUpdateNotice } from './markers/update-notice';
import { setFeatureFlag, isFlagExplicitlySet } from '../storage/feature-flags';
import { initInspectionMode } from './post-path/inspection-mode';
import { armMetricsProbe } from './probes/metrics-probe';
import { armInstagramBlankProbe } from './probes/instagram-blank-probe';
import { installForensicRetryUnloadFlush } from './record/forensic-retry';
import { installGapLedgerUnloadFlush, setGapLedgerPlatform } from './record/gap-ledger';
import { removeAllTeenMarkers } from './markers/teen-marker';
import { setGuardStandDownHandler } from './injector';
import { keepRecorderStamp } from './engagement/recorder-runs';

let activeAdapter: PlatformAdapter | null = null;
let pageUiLanguage: ReturnType<typeof resolveUiLanguage> = 'en';
let updateNoticeArmed = false;
let queue: ProcessingQueue | null = null;
let activeInterceptor: ContentInterceptor | null = null;
let classificationGeneration = 0;
const classificationGenerationByPost = new WeakMap<PostContent, number>();
const recordProtectionTerminal = (post: PostContent, elapsedMs: number): void => {
  void recordSpan({ platform: post.platform, mode: 'child' }, 'protection_terminal', elapsedMs);
};
setGuardStandDownHandler((el) => activeInterceptor?.rearmElement(el));
const childProtection = new ChildProtectionManager<PostContent>((_post, anchor) => {
  activeInterceptor?.rearmElement(anchor);
}, recordProtectionTerminal);
// M68: the extension can be replaced under an open tab. This script keeps
// running, because extraction and cover mounting are pure DOM, while every
// call into the extension throws. Without this line the covers already up wait
// for a verdict that can never arrive and go on saying the post is being
// checked for as long as the tab stays open. They now keep covering and say
// what happened instead, and no new cover is mounted.
onContextInvalidated(() => childProtection.strandAll());
function isCurrentClassification(post: PostContent): boolean {
  const generation = classificationGenerationByPost.get(post);
  return generation === undefined || generation === classificationGeneration;
}

/** The Child cover terminals (protection-terminals.ts) bound to this module's
 *  cover manager, classification check and cancelled-stale writer. */
const {
  prepareCurrentPostMutation,
  resolveCommentRow,
  applyCommentHide,
  renderCommentMarkerForCurrentClassification,
  mountProtection,
  protectBeforeEnqueue,
  releaseProtection,
  settleProtection,
  commitProtection,
} = createProtectionTerminals({
  childProtection,
  isCurrentClassification,
  writeCancelledStaleRecord: post => writeCancelledStaleRecord(post),
});

/** The per-post verdict appliers (result-apply.ts) bound to this module's
 *  protection terminals and adapter singleton. */
const {
  applyNeutralizedRewriteTerminal,
  applyCommentRewriteTerminal,
  applyCachedVerdictDirect,
  applyLateVerdictDirect,
  applyCachedHideCollapseDirect,
  onProcessingResult,
} = createResultApplier({
  settleProtection,
  commitProtection,
  prepareCurrentPostMutation,
  isCurrentClassification,
  getActiveAdapter: () => activeAdapter,
});

/**
 * Impression / exposure order (see IMPRESSION_LAYER_V1.md). One surface session
 * = one content-script load; `SURFACE_SESSION_ID` scopes the monotonic observed
 * counter held in `impressionMemo`. Stamped on every post at `onPostDetected`,
 * the pre-AI chokepoint, so the record carries the order FeelingWise locally
 * observed the item — distinct from the chain's write order.
 */
const SURFACE_SESSION_ID = currentSurfaceSessionId();
const impressionMemo = createImpressionMemo();

function resolveRuntimeMode(value: unknown): FWSettings['mode'] {
  return value === 'child' || value === 'adult' || value === 'teen' ? value : 'teen';
}

function applyRuntimeModeChange(value: unknown): void {
  const mode = resolveRuntimeMode(value);
  classificationGeneration++;
  clearSessionVerdictCachesOnModeChange();
  clearPendingCommentBatchState();
  childProtection.setMode(mode);
  // After setMode: a switch out of Child has already released every cover,
  // so nothing is re-enqueued for a mode that no longer covers.
  invalidateStaleQueueEntries();
  activeInterceptor?.rescanCurrentSurfaceNow();
}

function applyRuntimeStrictLanguageChange(): void {
  classificationGeneration++;
  clearSessionVerdictCachesOnModeChange();
  clearPendingCommentBatchState();
  invalidateStaleQueueEntries();
  // Q72 (W64): honor a markers-off flip immediately. Existing dots used to
  // stay mounted and tappable after the parent turned show-reframe-markers
  // off, contradicting the setting until reload. Rewrites and their guards
  // stay: the marker is UI, the rewrite is protection.
  void (async () => {
    try {
      const settings = await getSettings();
      const platform = activeAdapter?.platform;
      if (platform && !isFeatureEnabled(settings, 'show-reframe-markers', platform)) {
        removeAllTeenMarkers();
      }
    } catch { /* best-effort; the next full rescan applies the setting anyway */ }
  })();
  activeInterceptor?.rescanCurrentSurfaceNow();
}

/**
 * A flush-loop skip at the text-only dedup gate: the chain already holds a
 * record for this text, so nothing is written, but the verdict that record
 * earned is re-applied to this node. reapplyResolvedComment owns the
 * terminal (hide, rewrite, or a retained Child cover), so the batch's
 * finally-release must leave the post alone either way.
 */
function reapplyDuplicateTextVerdict(post: PostContent, protectionsToRetain: Set<PostContent>): void {
  const prior = sessionCommentResolutionByText.get(post.text);
  if (!prior) return;
  reapplyResolvedComment(post, prior, performance.now());
  protectionsToRetain.add(post);
}

/**
 * Re-apply a previously-proven comment disposition to a FRESH re-extracted node
 * BEFORE any provisional-cover/uncover cycle (CORE-1). Fail-closed: in Child a
 * cover is mounted first so the raw text is hidden while the terminal
 * re-applies, and the cover is KEPT if neither terminal can land (releasing
 * would uncover the raw harmful text — the exact regression). Mirrors the
 * post-path `sessionHideCollapse` replay (mountProtection → applyCached…Direct).
 */
function reapplyResolvedComment(
  post: PostContent,
  resolved: ResolvedCommentVerdict,
  detectedAt: number,
): void {
  mountProtection(post, detectedAt);
  if (resolved.kind === 'rewrite' && resolved.rewrite) {
    try {
      // The same two steps the hide terminal beside this one has always taken,
      // and this path took neither until 2026-09-19: recover the row when the
      // platform has moved it, then prove the row found is still THIS comment.
      // `deref()` alone is a handle to a node the platform may have refilled,
      // and replay is the path that runs when a node comes BACK after a scroll,
      // which is precisely when a node has been recycled. Without the check a
      // cached rewrite was written into whatever comment now occupied that
      // place, and settleProtection below then recorded it as re-applied to the
      // comment that was judged. Somebody else's words replaced, and a signed
      // record saying it was the right ones.
      const row = resolveCommentRow(post);
      if (row && prepareCurrentPostMutation(post, row.el)) {
        const terminal = applyCommentRewriteTerminal(
          row.entry,
          resolved.rewrite,
          childProtection.enabled ? 'child' : 'teen',
          true,
          resolved.writer,
        );
        if (terminal === 'rewritten') {
          settleProtection(post, { record: 'replay', reason: 'comment-rewrite-reapplied' });
          return;
        }
        if (terminal === 'hidden') { commitProtection(post, true); return; }
      }
    } catch {
      // fall through to the hide floor below
    }
  }
  // HIDE terminal (or a rewrite that could not re-land): re-hide the fresh node,
  // with the same notice the first row carried (null in Child).
  if (applyCommentHide(post, resolved.kind === 'hide' ? resolved.notice ?? null : null)) return;
  // Neither landed. In Child keep the provisional cover (fail-closed — the raw
  // text stays hidden, same discipline as flushBatch's protectionsToRetain).
  // In non-Child there is no cover to keep and nothing to shield.
  settleProtection(post, {
    record: 'replay',
    reason: 'comment-reapply-unresolved',
    disposition: 'retain-in-child',
  });
}

function routeBatchedComment(
  post: PostContent,
  enqueue: () => boolean,
  detectedAt: number,
): boolean {
  if (shouldBypassResolvedBatchedComment(post)) return false;
  // Resolution fast path (CORE-1 + CORE-2). A comment already hidden/rewritten
  // this session is re-applied synchronously to the fresh node and NOT
  // re-bucketed — so its raw text can never reappear via the finally-uncover,
  // and no `scoreBatch` call is paid for content that would be dropped at
  // `hasLoggedForensic`. Returning false (no enqueue) is the sole gate that
  // keeps it out of the bucket → flush → scoreBatch path.
  const resolved = sessionCommentResolutionByKey.get(sessionVerdictKey(post));
  if (resolved) {
    reapplyResolvedComment(post, resolved, detectedAt);
    return false;
  }
  protectBeforeEnqueue(post, enqueue, detectedAt);
  return true;
}

export { routeBatchedComment as _routeBatchedCommentForTesting };
export { reapplyDuplicateTextVerdict as _reapplyDuplicateTextVerdictForTesting };
export { resolveRuntimeMode as _resolveRuntimeModeForTesting };
export { applyRuntimeStrictLanguageChange as _applyRuntimeStrictLanguageChangeForTesting };
export { applyLateVerdictDirect as _applyLateVerdictDirectForTesting };
export { onProcessingResult as _onProcessingResultForTesting };
export { onQueueDrop as _onQueueDropForTesting };
export { onPostDetected as _onPostDetectedForTesting };
export { applyRuntimeModeChange as _applyRuntimeModeChangeForTesting };
export function _setQueueForTesting(next: ProcessingQueue | null): void {
  queue = next;
}
export function _setActiveAdapterForTesting(adapter: PlatformAdapter | null): void {
  activeAdapter = adapter;
}
export { applyNeutralizedRewriteTerminal as _applyNeutralizedRewriteTerminalForTesting };
export { applyCommentRewriteTerminal as _applyCommentRewriteTerminalForTesting };
export function _setChildProtectionModeForTesting(mode: FWSettings['mode']): void {
  childProtection.setMode(mode);
}
export { mountProtection as _mountProtectionForTesting };
export function _stampClassificationForTesting(post: PostContent): void {
  classificationGenerationByPost.set(post, classificationGeneration);
}
export { isCurrentClassification as _isCurrentClassificationForTesting };
export { releaseProtection as _releaseProtectionForTesting };
export { settleProtection as _settleProtectionForTesting };
export { renderCommentMarkerForCurrentClassification as _renderCommentMarkerForTesting };
export { applyCommentHide as _applyCommentHideForTesting };
export function _childProtectionActiveCountForTesting(): number {
  return childProtection.activeCount;
}

// shouldLogForensic + _resetForensicDedupForTesting live in
// ./forensic-gate (extracted to break the runtime cycle with
// video-pipeline.ts per Audit 1 R5). Re-exported here to preserve
// the existing import-from-index callsites in unit tests and other
// modules that already pull these names from content/index.
export { shouldLogForensic, hasLoggedForensic, shouldLogCancelForensic, forensicDedupKey, _resetForensicDedupForTesting } from './record/forensic-gate';

async function init(): Promise<void> {
  try {
    const platform = detectCurrentPlatform();
    if (!platform) {
      signalContentShieldReady();
      return; // not a supported platform
    }

    const adapter = resolveAdapter(platform);
    if (!adapter) {
      console.warn(`[FeelingWise] No adapter for platform: ${platform}`);
      signalContentShieldReady();
      return;
    }
    setGapLedgerPlatform(platform);
    installGapLedgerUnloadFlush();

    // Inspection pass resolves BEFORE the interceptor or any media owner can
    // fire an intervention. Fail-closed: any failure leaves full protection.
    armMetricsProbe(); // diagnostic probe flag, fire-and-forget
    if (platform === 'instagram') armInstagramBlankProbe(); // M95 probe, flag-gated, fire-and-forget
    const [settings] = await Promise.all([getSettings(), waitForDocumentBody(), initInspectionMode()]);
    if (isPrivateMessageSurface()) {
      signalContentShieldReady();
      return;
    }
    childProtection.setMode(settings.mode);
    // M80#1 / I18N-4: thread the resolved UI language into the "checking"
    // cover text. Set once per init() like setMode above — uiLanguage has no
    // runtime chrome.storage.onChanged listener (unlike mode/strictLanguage),
    // so a mid-session language change takes effect on next page load, not
    // retroactively. Acceptable: UI language changes are rare.
    const resolvedUiLanguage = resolveUiLanguage(settings.uiLanguage);
    childProtection.setLang(resolvedUiLanguage);
    // Once this tab is being checked, an update under it must not leave it looking checked.
    pageUiLanguage = resolvedUiLanguage;
    if (!updateNoticeArmed) {
      updateNoticeArmed = true;
      armUpdateNotice(document, () => pageUiLanguage);
    }
    activeAdapter = adapter;
    queue = new ProcessingQueue(
      withDescriptorV1(processPipeline),
      onProcessingResult,
      onQueueDrop,
    );
    // Runtime diagnostics: sample the JS heap over time + FW activity counters,
    // surfaced in the dashboard Debug section. Built to diagnose the YouTube OOM
    // by measurement rather than guesswork. Cheap (one sample / 30s).
    startDiagnostics();
    // Records whose durable enqueue the service worker did not confirm live in
    // a page-memory buffer on a 4s retry timer. Navigating inside that window
    // used to take them with it, silently. Best-effort resend at pagehide.
    // A text-less post whose room has not been read yet is holding its one
    // record. Released FIRST at page hide, before the retry buffer drains, so
    // whatever can still be sent is in the buffer when it goes. Best effort:
    // the held write reads settings before it can build its payload, so a page
    // that is already gone takes it. See ROOM_VERDICT_WAIT_MS on why the wait
    // is kept short.
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('pagehide', releaseHeldRoomVerdicts);
    }
    installForensicRetryUnloadFlush();
    //  wire scroll-velocity EMA so computeViewportInfo
    // reads live velocity instead of hardcoded 0. Idempotent across SPA
    // navigation re-init.
    startScrollVelocityTracking();
    // Bind mode changes before provider/license startup can yield, so the
    // Child lease is owned before the interceptor's synchronous initial
    // extraction pass emits any PostContent.
    const subscribeModeChanges = typeof chrome !== 'undefined'
      && chrome?.storage?.onChanged?.addListener
      ? (listener: Parameters<typeof chrome.storage.onChanged.addListener>[0]) => {
          chrome.storage.onChanged.addListener(listener);
        }
      : null;
    initializeModeAwareProtection(
      subscribeModeChanges,
      applyRuntimeModeChange,
      applyRuntimeStrictLanguageChange,
    );
    const interceptor = new ContentInterceptor(
      adapter,
      (post, detectedAt) => { void onPostDetected(post, detectedAt); },
      clearPendingBatchesForRouteChange,
      () => childProtection.enabled,
    );
    activeInterceptor = interceptor;
    interceptor.start();

    // The interceptor's initial protection pass is live.
    signalContentShieldReady();

    // The page-world wire path (PLAN-2026-09-14 item 4). All five platforms
    // are parsed now; none of them emits a record. What the platform's own
    // JSON said about an item is held in the wire store and filled onto the
    // DOM-captured item's record at the onPostDetected chokepoint below, so a
    // wire capture cannot produce a second record for an item the DOM already
    // captured. See src/content/page-world/wire-store.ts.
    installPageWorldRelay();

    // diagnostic survey. 5s after init, count how many post
    // containers exist on the page using the adapter's own selector. If
    // selector returns 0 even though the page is fully rendered, the
    // selector is stale vs current platform DOM. One-shot log.
    setTimeout(() => {
      try {
        const sel = adapter.getPostSelector();
        const found = document.querySelectorAll(sel).length;
        fwDebug(
          `[FW survey ${platform}] selector "${sel}" matches ${found} elements on page`,
        );
      } catch (err) {
        console.warn(`[FW survey ${platform}] selector probe failed:`, err);
      }
    }, 5000);

    // Engagement control: metric hiding, action rail/row suppression
    // The recorder's stamp on the page, with what it runs written first. Off
    // reads both and leaves exactly those switches to Receipts: both products
    // carry the same engagement code, same style-tag ids, same markers, and
    // two copies of one module on a page undo each other's hides
    // (engagement/recorder-runs.ts, products/off/stand-down.ts).
    keepRecorderStamp(platform, settings, getSettings, chrome?.runtime?.getManifest?.()?.version ?? '1');
    // Receipts installs the recorder's sink before the filter starts: from here on, a Reel, an ad
    // or an AI-labelled item the filter hides is also a record. Off installs nothing, so the same
    // filter code records nothing and never reaches the recorder (PLAN-2026-09-16 item 9.2).
    setBlockedRecorder((payload) => {
      void sendHighStakesForensicLog({ type: 'BLOCKED_LOG', payload });
    });
    initEngagementControl(platform).catch((e) => console.error(e));
    // Adult mode's "read this for me": armed from the popup, answers beside
    // the item the reader points at, records the reading. Silent otherwise.
    startReadThis(platform, settings);

    // Video platforms: start the video pipeline (comment hiding, overlays).
    //  + Facebook is text-first by default
    // (feed posts), but FB Reels (`/reel/<id>`) is video-first. Gate FB on
    // URL — Reels gets the video pipeline, feed stays on text-only. SPA
    // navigation between feed and reel is handled by `_routeChangeHandler`
    // re-init pattern; for now the initial route decides.
    const isFbReels = platform === 'facebook' && window.location.pathname.startsWith('/reel');
    if (platform === 'youtube' || platform === 'tiktok' || platform === 'instagram' || isFbReels) {
      initVideoPipeline(platform);
    }

    // YouTube /watch capture (docs/history/2026-08/YOUTUBE-E1-BRIEF.md). Behind the
    // `ytWatchComments` feature flag, DEFAULT ON since 2026-08-02 after the
    // memory A/B came back clean; an explicit stored `false` is the kill
    // switch. It emits the watch-session record plus comment PostContents
    // into the same onPostDetected chokepoint the adapters use, so the
    // comment-batch caps / dedup / mode gates are all inherited. The /watch
    // OOM mitigations in interceptor.ts and platforms/youtube.ts are
    // untouched by this path.
    if (platform === 'youtube') {
      initYtWatchComments({ emitPost: (post) => { void onPostDetected(post); } });
      initYtShorts({ emitPost: (post) => { void onPostDetected(post); } });
    }

    // Latency baseline (efficiency program e1): the dev tier auto-enables
    // per-stage perf capture so timings accumulate during normal browsing
    // and the dashboard "Pipeline performance (debug)" panel has real data.
    // Only when the flag was never explicitly set — an explicit false stays.
    void enablePerfCaptureForDevTier();

    console.log(`[FeelingWise] active on ${platform}`);
  } catch (err) {
    // This path deliberately does not tell the page the shield is ready. That
    // signal means "the interceptor's synchronous initial scan has run", which
    // is its own docblock's contract, and here nothing ran: no interceptor, no engagement
    // control, no childProtection.setMode, so the manager is still at its
    // 'adult' default too. Calling it dropped the document-start curtain at
    // once and left a child looking at the full uncovered feed, unmuted, for
    // the rest of that page load, with nothing on screen saying anything was
    // wrong.
    //
    // The shield's own read-error path already says what should happen to a
    // boot that did not finish: "The 5s safety timeout above remains the sole
    // release authority for a persistent read failure, so a flaky/erroring
    // boot never drops the curtain early." A fatal init is that case. Leaving
    // the signal off puts this path back under that rule (2026-09-19).
    console.error('[FeelingWise] INIT FATAL:', err);
  }
}

async function enablePerfCaptureForDevTier(): Promise<void> {
  try {
    const license = await getLicense();
    if (license.tier !== 'dev') return;
    if (await isFlagExplicitlySet('captureV2Metrics')) return;
    await setFeatureFlag('captureV2Metrics', true);
    console.log('[FeelingWise] perf capture auto-enabled (dev tier)');
  } catch {
    // Diagnostic only — never block init.
  }
}

/**
 * Surface-change entry called by the interceptor: rotates the classification
 * generation, settles or releases the covers, invalidates the queue, restarts
 * the media gates, then drops the comment buckets through
 * clearPendingCommentBatchState (comment-batch/queue.ts).
 */
export function clearPendingBatchesForRouteChange(
  reason: SurfaceChangeReason = 'route',
): void {
  if (reason === 'chat-open') return;
  if (reason === 'chat-close') return;
  if (reason === 'route-settled') {
    childProtection.pruneStale();
    return;
  }
  classificationGeneration++;
  const privateSurface = isPrivateMessageSurface();
  // Public SPA transitions often leave the old feed mounted while the next
  // surface suspends. Keep those item covers until the delayed rescan rotates
  // their owners. Private surfaces are out of scope and release immediately.
  if (privateSurface) childProtection.releaseAll();
  invalidateStaleQueueEntries();
  clearPendingCommentBatchState();
  // The comment buckets this route's held records were waiting on are gone
  // with the line above, so no room will ever arrive for them. Write them now,
  // without a room, rather than let the wait run out on a surface the reader
  // has left: a record that arrives without its room is still evidence, a
  // record that never arrives is not.
  releaseHeldRoomVerdicts();
  // What the platform said about the items on the previous surface is not
  // about the items on this one.
  clearWireStore();
}

/** The bound comment-batch drain: flushBatch (comment-batch/flush.ts) with the
 *  protection and marker terminals this module owns handed in. */
function flushBatch(parentVideoId: string): Promise<void> {
  return runFlushBatch(parentVideoId, flushDeps);
}
const flushDeps: FlushDeps = {
  flush: flushBatch,
  settleProtection,
  commitProtection,
  applyCommentHide,
  applyCommentRewriteTerminal,
  renderCommentMarkerForCurrentClassification,
  isCurrentClassification,
  prepareCurrentPostMutation,
  reapplyDuplicateTextVerdict,
  surfaceSessionId: SURFACE_SESSION_ID,
};

/** Test seams that need the real flushBatch; the rest live in comment-batch/queue.ts. */
export function _enqueueCommentForBatchForTesting(post: Partial<PostContent>): boolean {
  return enqueueCommentForBatch(post as PostContent, flushBatch);
}
export function _deferConsumedBatchForBudgetHoldForTesting(key: string, consumed: PendingBatch): void {
  deferConsumedBatchForBudgetHold(key, consumed, flushBatch);
}

/**
 * The one door a detected post goes through. The interceptor stamps the element as processed and calls this without
 * waiting, so a throw in the preparation used to be an unhandled rejection with no trace, on an element that no later
 * pass would look at again (S3, P32): at Strict its raw text stayed uncovered. A throw now keeps the post covered,
 * removes the stamp so a later pass picks it up again, and moves one counter.
 */
async function onPostDetected(post: PostContent, detectedAt: number = performance.now()): Promise<void> {
  try {
    await prepareDetectedPost(post, detectedAt);
  } catch (error) {
    keepPostCoveredAndRetryable(post, detectedAt, error);
  }
}

function keepPostCoveredAndRetryable(post: PostContent, detectedAt: number, error: unknown, counter = 'postPrepareThrew'): void {
  bumpCounter(counter);
  console.warn('[FW onPostDetected] threw; the post keeps its cover and a later pass will read it again', post.platform, post.id, error);
  // A cover already up is shared, not doubled; one that a failed step released is put back (it lifts at its own deadline).
  try { mountProtection(post, detectedAt); } catch { /* the stamp below is still removed */ }
  try {
    const el = post.domRef.deref();
    if (el) delete el.dataset.fwProcessed;
  } catch { /* an element that is gone has nothing to unstamp */ }
}

async function prepareDetectedPost(post: PostContent, detectedAt: number): Promise<void> {
  const firstProtectionStartedAt = detectedAt;
  classificationGenerationByPost.set(post, classificationGeneration);
  if (!queue) {
    console.warn('[FW onPostDetected] queue not initialized — dropping', post.platform, post.id);
    return;
  }
  fwDebug(`[FW onPostDetected] ${post.platform} ${post.kind ?? 'post'} ${post.id} text-len=${post.text.length}`);

  // What the platform's own JSON said about this same item, filled into the
  // gaps the DOM left (PLAN-2026-09-14 item 4). Runs FIRST, before
  // deriveAccountType reads is_sponsored and before the pipeline reads
  // feedSource. Never overwrites a value the DOM already read, never supplies
  // the item's own text, and never creates a record of its own — the dedup
  // guarantee is that the wire path has no emit path at all
  // (src/content/page-world/wire-store.ts).
  const wireFilled = enrichPostFromWire(post);
  if (wireFilled.length > 0) {
    fwDebug(`[FW wire-fill] ${post.platform} ${post.id} filled ${wireFilled.join(',')}`);
  }

  // Source labels — stamp WHO posted (accountType) + the named container once,
  // here, the single chokepoint every caption + comment passes through. All
  // downstream send sites (per-post + comment-batch flush) read post.accountType
  // / post.sourceContainer. The adapter has already stamped the raw DOM signals
  // (is_sponsored, sourceContainer group name, platform_specific.isVerified);
  // deriveAccountType applies the honest precedence. Undefined-omit keeps the
  // record hash back-compatible.
  const derivedAccount = deriveAccountType(post);
  post.accountType = derivedAccount.accountType;
  if (derivedAccount.sourceContainer) post.sourceContainer = derivedAccount.sourceContainer;

  // Impression / exposure order — stamp the local observed order + time once
  // per post.id here, the same pre-AI chokepoint, before the comment-batch
  // split, the session caches, and the queue reorder everything. First-seen
  // wins (re-detections reuse the original sequence). Threads to the record
  // via the same emit sites as accountType. See IMPRESSION_LAYER_V1.md.
  stampImpressionOrder(post, SURFACE_SESSION_ID, impressionMemo);

  // What the page carried against what the screen showed: whole, folded by
  // style, or cut with the rest behind a control. Read from the adapter's
  // element here, once, before the text goes anywhere; never a press. Threads
  // to the record via the same emit sites as the two stamps above.
  stampTextFold(post);
  stampMediaUrls(post);

  const isCommentKind =
    post.kind === 'comment' ||
    post.kind === 'top-comment' ||
    post.kind === 'reply' ||
    post.kind === 'reply-to-reply';
  const isBatchedComment = isCommentKind && !!post.parentVideoId;

  // Preserve the parent room before any session-cache fast path returns. A
  // parent that is already classified still has to seed later comment batches
  // after route cleanup or an earlier batch flush. X focused replies have a
  // comment kind but no parentVideoId and act as the parent of visible replies.
  if (!isBatchedComment) seedRoomContextFromPost(post);
  // Q51 (W55): caption/post records with a parent container id feed the
  // encounter assemblers' caption slot (they go down the per-post queue and
  // never enter bucket.posts).
  if (!isCommentKind && post.parentVideoId) rememberCaptionPost(post);

  // comment records take the batch path. Caption records continue
  // through the normal per-post queue (they need flag/neutralize UX).
  //
  // The twitter.ts adapter stamps `'top-comment' | 'reply' |
  // 'reply-to-reply'` kind values on X-permalink children-of-focused.
  // The legacy `'comment'` value alone would not catch them, so
  // X-permalink replies would fall through to the per-post pipeline
  // — bypassing the Encounter / ancestry / pile-on-context detection-
  // accuracy fix path was DEAD in production for X-permalink. Extend the
  // check to recognize the new kind values; gate on `parentVideoId` presence
  // so the bucket key is well-defined (twitter.ts stamps
  // parentVideoId = focused-tweet-id on children-of-focused only).
  if (isBatchedComment) {
    routeBatchedComment(
      post,
      () => enqueueCommentForBatch(post, flushBatch),
      firstProtectionStartedAt,
    );
    return;
  }

  // Session-cache fast path. If this post.id was previously classified as
  // manipulative in this session, apply the cached verdict synchronously
  // to the just-detected DOM ref instead of
  // queueing. See sessionVerdictByPostId block-comment for the full
  // rationale. Skips queue + LLM cache + render-gate because the DOM
  // is fresh-from-this-detection (anchor invalidation can't have fired
  // yet — there's been no async wait).
  const verdictKey = sessionVerdictKey(post);
  const sessionVerdict = sessionVerdictByPostId.get(verdictKey);
  if (sessionVerdict) {
    mountProtection(post, firstProtectionStartedAt);
    // Started without waiting; its finally releases the cover, so a throw would leave the post bare and the rejection
    // unhandled. The cover is put back and the stamp removed, as for a failed preparation (S3, site 1c).
    void applyCachedVerdictDirect(post, sessionVerdict)
      .catch((error: unknown) => keepPostCoveredAndRetryable(post, firstProtectionStartedAt, error, 'cachedVerdictApplyThrew'));
    return;
  }
  // PASS-sentinel cache. Post was previously LLM-classified as benign;
  // no DOM mutation needed, just skip re-enqueueing. Stops the duplicate-
  // Groq-call pattern visible in a live walk (same postId appearing
  // 2-4 times in Pipeline L1 / Pipeline AI result lines). Per
  // docs/audits/2026-05-23/latency-duplicate-diagnosis.md C1.
  if (sessionPassPostIds.has(verdictKey)) {
    return;
  }
  // HIDE/COLLAPSE cache fast path. Same reason as the neutralize + PASS
  // caches above: stop re-paying the Groq round-trip for a post we've
  // already adjudicated. Replay applies the placeholder + marker on the
  // fresh DOM ref (Twitter's virtualizer re-mounts posts on scroll).
  const sessionHideCollapse = sessionHideCollapseByPostId.get(verdictKey);
  if (sessionHideCollapse) {
    mountProtection(post, firstProtectionStartedAt);
    // Same as the neutralize replay above (S3, site 1c).
    void applyCachedHideCollapseDirect(post, sessionHideCollapse)
      .catch((error: unknown) => keepPostCoveredAndRetryable(post, firstProtectionStartedAt, error, 'cachedHideCollapseApplyThrew'));
    return;
  }
  // Late-verdict fast path. This post's verdict completed earlier this
  // session but arrived after its DOM node scrolled away (cancelled-* chain
  // record, UI suppressed). The re-detected node is fresh — apply the stored
  // verdict directly, with no re-scoring. What the page then shows is a
  // record of its own, written by the same producers with the late sentence;
  // the cancelled record stays as written. The entry migrates into the
  // regular session caches inside the apply, so this map is consult-once.
  const lateVerdict = sessionLateVerdictByPostId.get(verdictKey);
  if (lateVerdict) {
    sessionLateVerdictByPostId.delete(verdictKey);
    mountProtection(post, firstProtectionStartedAt);
    // Started without waiting and with no catch of its own: a throw in it is caught here and handled like a failed
    // preparation, the cover kept and the stamp removed (S3, site 1b).
    void applyLateVerdictDirect(post, lateVerdict)
      .catch((error: unknown) => keepPostCoveredAndRetryable(post, firstProtectionStartedAt, error, 'lateVerdictApplyThrew'));
    return;
  }
  // First-encounter measurement: a stale-cancelled post is back on screen;
  // the normal fresh pipeline judges it from here. Count only.
  noteReencounterIfStaleCancelled(post);

  // The per-platform reframe gate replaces a legacy "child on video
  // platforms → skip" branch. Rationale: when reframing
  // is disabled for a platform (top-level OFF or perPlatform override),
  // the v2 caption-scan pipeline produces no visible output — skip it
  // to save API spend. The video pipeline still runs separately for
  // comment-handling features (educational replacement / rewrite). Both
  // `reframe-detected-manipulation` feature was removed; the
  // per-platform "is reframe enabled" gate that lived here is gone with it.
  // Video platforms always run through the pipeline now; the engagement
  // controller (separate concern) still gates count-hiding / action-blocking
  // / comment-rewriting per platform.

  const el = post.domRef.deref();
  // Promoted from boolean `isVisible` to rich ViewportInfo so the queue can
  // use viewport state + Y-position to drain top-of-viewport posts first.
  // Without this, all in-viewport posts shared priority 504 → FIFO on
  // DOM-mutation order → Twitter replies (mounted below the parent post in
  // article tree) drained before the parent post. Live evidence in an X
  // session: "the sub tree seems to load faster from the bottom/root up".
  // Now: parent post (closer to viewport top) gets a small Y-bonus,
  // drains first.
  protectBeforeEnqueue(
    post,
    () => queue!.enqueue(post, computeViewportInfo(el), {
      surfaceIdentity: `classification-generation:${classificationGeneration}`,
    }),
    firstProtectionStartedAt,
  );
}

function isInViewport(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  return rect.top < window.innerHeight && rect.bottom > 0;
}

/**
 * Derive rich ViewportInfo from the post's live DOM ref.
 * Maps the bounding rect to one of the three queue states +
 * captures the Y-position so within-tier ordering follows reading order.
 *
 *   above viewport  (rect.bottom < 0)        → 'scrolled-past' (cancel-cand)
 *   in   viewport  (any partial overlap)    → 'visible'       (drain priority)
 *   below viewport (rect.top    > vh)       → 'visible-soon'  (pre-emptive)
 *
 * Velocity is read from the scroll-velocity.ts EMA tracker (started in
 * init()). The legacy velocity:0 default forced 60s browsing-mode
 * stale and produced ~19% cancel-stale at the 60s tier — well above
 * the surface-D 5% floor. The tracker decays toward 0 on idle so a
 * paused user reports browsing-mode.
 */
function computeViewportInfo(el: HTMLElement | undefined): { state: 'scrolled-past' | 'visible' | 'visible-soon'; velocityPxPerSec: number; viewportY?: number } {
  const velocityPxPerSec = getCurrentVelocity();
  if (!el) return { state: 'scrolled-past', velocityPxPerSec };
  const rect = el.getBoundingClientRect();
  const vh = window.innerHeight;
  let state: 'scrolled-past' | 'visible' | 'visible-soon';
  if (rect.bottom < 0) state = 'scrolled-past';
  else if (rect.top > vh) state = 'visible-soon';
  else state = 'visible';
  return { state, velocityPxPerSec, viewportY: rect.top };
}

/**
 * A queued post the queue gives up on before any call (stale by age, or
 * evicted by the size cap) leaves the chain with a cancelled-stale record,
 * exactly like the pipeline's own stale cancel, so "FW saw this and did not
 * judge it" is on the record instead of nowhere. The cover is released as
 * before; the queue now keeps visible items, so this only reaches posts the
 * reader scrolled past.
 */
function onQueueDrop(post: PostContent, reason: QueueDropReason): void {
  if (reason === 'invalidated') {
    onQueueInvalidated(post);
    return;
  }
  if (
    (reason === 'cancelled-stale' || reason === 'evicted-size-cap')
    && isCurrentClassification(post)
  ) {
    settleProtection(post, { record: 'write-cancel', reason: `queue-drop:${reason}` });
    return;
  }
  settleProtection(post, { record: 'unrecorded-fail-open', reason: `queue-drop:${reason}` });
}

/**
 * The dedup-gated cancelled-stale CANCEL_LOG plus the first-encounter
 * bookkeeping that goes with it. Shared by every path that gives up on a
 * post before a verdict: the queue's age and size-cap drops, and the
 * generation invalidation below.
 */
function writeCancelledStaleRecord(post: PostContent): void {
  if (!shouldLogCancelForensic(forensicDedupKey(post))) return;
  bumpCounter('firstEncounterCancelStale');
  noteStaleCancelled(post);
  void emitCancelLog(post, 'cancelled-stale', undefined, undefined).catch(err => {
    console.error('[FeelingWise] queue-drop cancel-log failed:', err);
  });
}

/**
 * A route, mode or strict-language change invalidated this post's queue
 * entry (queued or in flight). The stale judgement leaves a cancelled-stale
 * record. In Child a post that is still on screen is re-enqueued at the top
 * of the visible tier under the new generation so its cover is never
 * released raw; everything else (off-screen, non-Child, or a private surface
 * whose covers were already dropped) is released as a stale owner, which
 * keeps a public-route cover until the rescan rotates it.
 */
function onQueueInvalidated(post: PostContent): void {
  writeCancelledStaleRecord(post);
  const el = post.domRef.deref();
  if (
    childProtection.enabled
    && queue
    && !isPrivateMessageSurface()
    && el?.isConnected
    && isInViewport(el)
  ) {
    classificationGenerationByPost.set(post, classificationGeneration);
    const accepted = queue.enqueue(
      post,
      { state: 'visible', velocityPxPerSec: 0, viewportY: 0 },
      { surfaceIdentity: `classification-generation:${classificationGeneration}` },
    );
    if (accepted) return;
  }
  settleProtection(post, { record: 'cancel', reason: 'queue-invalidated' });
}

function invalidateStaleQueueEntries(): void {
  queue?.invalidate(post => !isCurrentClassification(post));
}

function resolveAdapter(platform: ReturnType<typeof detectCurrentPlatform>) {
  switch (platform) {
    case 'twitter':
      return new TwitterAdapter();
    case 'facebook':
      return new FacebookAdapter();
    case 'instagram':
      return new InstagramAdapter();
    case 'youtube':
      return new YoutubeAdapter();
    case 'tiktok':
      return new TiktokAdapter();
    default:
      return null;
  }
}

init().catch(err => {
  console.error('[FeelingWise] init() top-level:', err);
});
