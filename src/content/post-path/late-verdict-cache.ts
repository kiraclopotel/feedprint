// Session-scoped verdict caches for the content script: the per-session
// memo of neutralize / pass / hide-collapse / late verdicts, the resolved
// batched-comment terminals, the reveal set and the first-encounter
// measurement ledger. Pure data plus the cache policy (key shape, cap,
// half-prune); every DOM or protection effect stays in content/index.ts,
// which imports the caches from here. Extracted per
// docs/audits/2026-08-23-objective-audit/wave4-architecture (Proposal A, step 1).

import type { PostContent } from '../../types/post';
import type { AnalysisResult } from '../../types/analysis';
import type { NeutralizedContent } from '../../types/neutralization';
import type { CommentHideNotice } from '../protection/comment-overlay';
import type { AiWriter } from '../markers/ai-mark';
import type { ResolvedUiLanguage } from '../../i18n';
import { bumpCounter } from '../../diagnostics/diagnostics';

/**
 * Session-scoped verdict cache by post.id. Closes the "marker lands after
 * DOM is gone" loss surface that surfaced live in an X session: with
 * comment-rich threads the queue depth grows to 19-20s, the cached pipeline
 * result returns instantly via processingCache (text-hash) but the QUEUE
 * wait between detection and processing means render-gate fires when the
 * DOM has recycled — `render-gate: suppressed neutralize UI for X (dom-gone)`
 * for nearly every late completion.
 *
 * Cache-miss flow:
 *   1. Adapter detects post → fresh post.domRef (WeakRef → live DOM)
 *   2. queue.enqueue → wait in queue (5-20s on heavy threads)
 *   3. processFn → pipeline.process → cache hit (text-hash, instant)
 *   4. onProcessingResult fires
 *   5. await getSettings + verifyAnchorMatch
 *   6. By step 5 the DOM has been recycled by Twitter virtualizer
 *   7. render-gate suppresses → no marker visible
 *
 * Cache-hit flow on re-detection of previously-classified post:
 *   1. Adapter detects post → fresh post.domRef (still live, just-detected)
 *   2. onPostDetected sees a session cache hit on post.id
 *   3. applyCachedVerdictDirect → injectIntoElement on the LIVE DOM
 *   4. Done (no queue, no LLM, no render-gate suppress)
 *
 * The bypass is justified: render-gate's anchor check protects against
 * MID-FLIGHT DOM recycling DURING the LLM round-trip (a real tamper-
 * adjacent concern). On cache-hit there's no LLM round-trip; the post
 * we're rendering against is the just-detected one.
 *
 * Bounded at 500 entries (matches typical Twitter session size). Oldest
 * evicted first via Map insertion-order traversal. Cleared on extension
 * reload (module re-init); not persisted to IDB (verdict-by-text-hash
 * persistence already lives in pipeline.ts:processingCache).
 */
export const sessionVerdictByPostId = new Map<string, NeutralizedContent>();
/**
 * PASS-verdict memoization. Without this, every re-detection of a post.id
 * that previously PASSed the pipeline (MutationObserver re-fire, periodic
 * 3s rescan, route-rescan stamp-strip, X scroll-trigger re-extract) re-pays
 * the Groq round-trip for the same content. The neutralize-verdict cache
 * (sessionVerdictByPostId) catches neutralize results; this Set catches
 * post-LLM PASS results. Bounded at MAX_SESSION_VERDICT_CACHE; oldest
 * half-pruned when at cap. Cleared on extension reload (module re-init).
 *
 * Per docs/audits/2026-05-23/latency-duplicate-diagnosis.md C1.
 */
export const sessionPassPostIds = new Set<string>();

/**
 * HIDE/COLLAPSE-verdict memoization. Mirrors sessionVerdictByPostId
 * (neutralize) and sessionPassPostIds (pass): without it, every re-detection
 * of a hidden/collapsed post.id re-pays the Groq round-trip AND re-renders
 * the placeholder + marker, replacing the live marker DOM node and resetting
  * any in-place toggle state the reader had open. A live walk showed two
  * different posts hidden 4× each in one session; every cycle needlessly
  * rebuilt the marker.
 */
export interface CachedHideCollapseVerdict {
  kind: 'hide' | 'collapse';
  analysis: AnalysisResult;
  originalText: string;
  /** Carried so the cache-replay applies the right visual: a sponsored ad
   *  (detectionMode 'sponsored-ad' / 'sponsored-ad:adult') is fully hidden or
   *  shown per the Block Ads setting, never folded with a placeholder. */
  detectionMode?: string;
}
export const sessionHideCollapseByPostId = new Map<string, CachedHideCollapseVerdict>();
export const MAX_SESSION_VERDICT_CACHE = 500;

/**
 * Late-verdict memoization: completed verdicts whose UI could not land
 * because the DOM node was gone by the time they arrived (queue abort
 * mid-flight, or render-gate dom-gone/dom-recycled suppression). The chain
 * got a cancelled-* record; the SCREEN got nothing. When the same post.id
 * is re-detected this session, onPostDetected applies the stored verdict
 * directly to the fresh DOM node — no re-scoring; the record it writes says
 * the reading was late (NOTE_LATE_VERDICT) and the cancelled one stays.
 *
 * 'mark' is the floor shape: a confirmed concern whose rewrite is not in
 * hand (mid-flight cancels preserve only the AnalysisResult) renders at
 * least the severity dot on the original text — a confirmed verdict is
 * never un-actionable just because it arrived late.
 */
export type LateVerdict = (
  | { kind: 'neutralize'; neutralized: NeutralizedContent }
  | { kind: 'hide' | 'collapse'; analysis: AnalysisResult }
  | { kind: 'mark'; analysis: AnalysisResult }
) & {
  /** What answered and how, carried so the record written when the item comes back says the same as a live one. */
  detectionMode?: string;
  aiMeta?: { model: string; provider: string };
  /** For a mark: why the rewrite did not come back, so the record written on the re-encounter names it too. */
  rewriteWhy?: string;
};
export const sessionLateVerdictByPostId = new Map<string, LateVerdict>();

/**
 * Terminal comment-disposition memoization (CORE-1 / CORE-2). Mirrors the
 * VIDEO path's discipline (video-context/verdict-store.ts: `sessionVideoPasses`
 * + act-verdict store) for the BATCHED-COMMENT path.
 *
 * Batched comments never reach the post-path hide/late-verdict replay:
 * `onPostDetected` routes every `isBatchedComment` through `routeBatchedComment`
 * and RETURNS before the `sessionHideCollapseByPostId` / late-verdict fast
 * paths. Without this map, a hidden/rewritten comment re-extracted on a FRESH
 * virtualizer node (TikTok #column-list-container, IG/FB modals) has lost its
 * residual `display:none` / rewrite, is skipped at flushBatch's
 * `hasLoggedForensic` gate, and is UNCOVERED in the `finally` block — the raw
 * harmful text renders again in Child mode (SHIELD violation, CORE-1). It also
 * re-forms a bucket and re-pays a full `scoreBatch` round-trip whose every
 * member is then dropped at `hasLoggedForensic` (wasted paid spend, CORE-2).
 *
 * ONLY verified terminals populate it — a hide PROVEN on the live DOM
 * (`applyCommentHide` returned true) or a rewrite/soften swap PROVEN
 * (`applyCommentRewriteTerminal` returned 'rewritten'/'hidden'). Never a
 * failure / unresolved / cover-retained path, mirroring the video store's
 * "PASS/ACT only, never failure" rule. Bounded at MAX_SESSION_VERDICT_CACHE
 * with a half-prune; cleared on mode / strict-language change — which
 * mode-scopes it exactly like the sibling session caches (the key omits mode
 * because the whole map is wiped whenever mode changes).
 */
export interface ResolvedCommentVerdict {
  kind: 'hide' | 'rewrite';
  /** Present for kind 'rewrite': the PROVEN-applied safe rewrite text. Re-
   *  swapped on re-encounter; Child falls back to hide if the swap can't land. */
  rewrite?: string;
  /** Present when a model wrote `rewrite`, so the re-swapped text carries the
   *  same AI mark as the first swap. A swear mask has none. */
  writer?: AiWriter;
  /** Present for kind 'hide' in Teen and Adult: the notice that stood where the
   *  text was, replayed on re-encounter so the fresh row says the same why. */
  notice?: CommentHideNotice;
  /** Present for kind 'rewrite' on the Open level: the comment keeps the author's words behind a red dot and `rewrite` is
   *  the calm version a tap away, not on the page. What a fresh row needs to get its dot back. */
  offer?: { analysis: AnalysisResult; lang: ResolvedUiLanguage; mount: 'inside' | 'after' };
}
export const sessionCommentResolutionByKey = new Map<string, ResolvedCommentVerdict>();
/**
 * The same proven dispositions keyed by TEXT alone. The forensic dedup gate
 * (forensic-gate.ts) is text-only, so a second comment with identical text
 * from a different author skips the flush loop at hasLoggedForensic; this map
 * lets that skip re-apply the verdict the first sighting earned instead of
 * uncovering the duplicate raw (PROTECTION-PATH-3). Pruned with its sibling.
 */
export const sessionCommentResolutionByText = new Map<string, ResolvedCommentVerdict>();

/**
 * Posts the user explicitly revealed via the hard-hide notice (M33 follow-up,
 * found 2026-08-02: hidden posts could not be revisited — they got hidden
 * again).
 * Keyed like the sibling caches; consulted when a cached/replayed hide lands
 * on a FRESH platform remount so the reveal survives virtual-list recycling.
 * Teen/Adult only — Child mode never mounts the reveal affordance.
 */
export const sessionRevealedPostKeys = new Set<string>();

/**
 * First-encounter recovery measurement (owner-authorized `:decide` 2026-08-04;
 * the 2026-07-02 rule said "measure recovery via miss counter before deeper
 * fix" and no such counter existed). MEASUREMENT ONLY — the fenced deeper fix
 * stays untouched, no control flow changes on the race paths. The ledger,
 * read from Copy Diagnostics:
 *   firstEncounterCancelStale        exposure with NO analysis ever produced
 *   firstEncounterCancelMidFlight    verdict returned after the node left
 *   firstEncounterMidFlightUnconfirmed  ...and it was not actionable (benign)
 *   firstEncounterRecoverable        actionable late verdicts stored
 *   firstEncounterRecoverableEvicted ...dropped by the cache cap (unrecoverable)
 *   firstEncounterRecovered          late verdicts applied on re-encounter
 *   firstEncounterStaleReencountered stale-cancelled posts seen again (fresh
 *                                    re-analysis handles them from here)
 * Within-session recovery rate = Recovered / Recoverable; stale exposure that
 * never re-encounters is the residual the deeper fix would close.
 */
const sessionStaleCancelledKeys = new Set<string>();

export function noteStaleCancelled(post: PostContent): void {
  sessionStaleCancelledKeys.add(sessionVerdictKey(post));
  if (sessionStaleCancelledKeys.size > MAX_SESSION_VERDICT_CACHE) {
    const keys = Array.from(sessionStaleCancelledKeys);
    for (let i = 0; i < keys.length / 2; i++) sessionStaleCancelledKeys.delete(keys[i]);
  }
}

export function noteReencounterIfStaleCancelled(post: PostContent): void {
  if (sessionStaleCancelledKeys.delete(sessionVerdictKey(post))) {
    bumpCounter('firstEncounterStaleReencountered');
  }
}

export function clearSessionVerdictCachesOnModeChange(): void {
  sessionVerdictByPostId.clear();
  sessionPassPostIds.clear();
  sessionHideCollapseByPostId.clear();
  sessionLateVerdictByPostId.clear();
  sessionCommentResolutionByKey.clear();
  sessionCommentResolutionByText.clear();
  sessionRevealedPostKeys.clear();
  sessionStaleCancelledKeys.clear();
}

export function sessionVerdictKey(post: PostContent): string {
  return JSON.stringify([
    post.id,
    post.platform,
    post.author.trim(),
    post.kind ?? 'post',
    post.parentVideoId ?? '',
    post.parent_id ?? '',
    post.depth ?? '',
    post.text,
    post.context ?? '',
    post.is_sponsored === true,
  ]);
}

export function rememberSessionPass(post: PostContent): void {
  sessionPassPostIds.add(sessionVerdictKey(post));
  if (sessionPassPostIds.size > MAX_SESSION_VERDICT_CACHE) {
    const keys = Array.from(sessionPassPostIds.values());
    for (let i = 0; i < keys.length / 2; i++) sessionPassPostIds.delete(keys[i]);
  }
}

export function shouldBypassResolvedBatchedComment(post: PostContent): boolean {
  return sessionPassPostIds.has(sessionVerdictKey(post));
}

/** Record a PROVEN terminal comment disposition (CORE-1 / CORE-2). Callers
 *  must invoke this ONLY after the hide/rewrite actually landed on the DOM —
 *  never on a failure / unresolved / cover-retained path. Bounded + half-pruned
 *  like the sibling session caches. */
export function rememberResolvedComment(post: PostContent, verdict: ResolvedCommentVerdict): void {
  sessionCommentResolutionByKey.set(sessionVerdictKey(post), verdict);
  if (sessionCommentResolutionByKey.size > MAX_SESSION_VERDICT_CACHE) {
    const keys = Array.from(sessionCommentResolutionByKey.keys());
    for (let i = 0; i < keys.length / 2; i++) sessionCommentResolutionByKey.delete(keys[i]);
  }
  sessionCommentResolutionByText.set(post.text, verdict);
  if (sessionCommentResolutionByText.size > MAX_SESSION_VERDICT_CACHE) {
    const keys = Array.from(sessionCommentResolutionByText.keys());
    for (let i = 0; i < keys.length / 2; i++) sessionCommentResolutionByText.delete(keys[i]);
  }
}

export function isAuthoritativeSessionPassReason(reason: string | undefined): boolean {
  return reason === 'pre-llm-cache-pass' || reason?.startsWith('post-llm-') === true;
}

/** Test-only accessors for the late-verdict map (pattern: _*ForTesting). */
export function _storeLateVerdictForTesting(postId: string, v: LateVerdict): void {
  sessionLateVerdictByPostId.set(postId, v);
}
export function _peekLateVerdictForTesting(postId: string): LateVerdict | undefined {
  return sessionLateVerdictByPostId.get(postId);
}
export function _resetLateVerdictsForTesting(): void {
  sessionLateVerdictByPostId.clear();
}
/** Route through the REAL storeLateVerdict (counters + cap), unlike the
 *  key-direct seeder above. First-encounter measurement tests use this. */
export function _storeLateVerdictRealForTesting(post: PostContent, v: LateVerdict): void {
  storeLateVerdict(post, v);
}
export function _noteStaleCancelledForTesting(post: PostContent): void {
  noteStaleCancelled(post);
}
export function _noteReencounterIfStaleCancelledForTesting(post: PostContent): void {
  noteReencounterIfStaleCancelled(post);
}
export function _seedSessionVerdictCachesForTesting(
  post: PostContent,
  neutralized: NeutralizedContent,
  analysis: AnalysisResult,
): void {
  const key = sessionVerdictKey(post);
  sessionVerdictByPostId.set(key, neutralized);
  sessionPassPostIds.add(key);
  sessionHideCollapseByPostId.set(key, { kind: 'hide', analysis, originalText: post.text });
  sessionLateVerdictByPostId.set(key, { kind: 'hide', analysis });
}
export function _sessionVerdictCacheSizesForTesting(): number[] {
  return [
    sessionVerdictByPostId.size,
    sessionPassPostIds.size,
    sessionHideCollapseByPostId.size,
    sessionLateVerdictByPostId.size,
  ];
}
export function _hasSessionPassForTesting(post: PostContent): boolean {
  return sessionPassPostIds.has(sessionVerdictKey(post));
}
export { clearSessionVerdictCachesOnModeChange as _clearSessionVerdictCachesOnModeChangeForTesting };
export { sessionVerdictKey as _sessionVerdictKeyForTesting };
export { shouldBypassResolvedBatchedComment as _shouldBypassResolvedBatchedCommentForTesting };

/** Populate the resolved-comment cache via the SAME production write path the
 *  flushBatch terminals use, so re-encounter tests exercise the real
 *  routeBatchedComment consult rather than a hand-built map insert. */
export { rememberResolvedComment as _rememberResolvedCommentForTesting };

export function _peekResolvedCommentForTesting(post: PostContent): ResolvedCommentVerdict | undefined {
  return sessionCommentResolutionByKey.get(sessionVerdictKey(post));
}
export { isAuthoritativeSessionPassReason as _isAuthoritativeSessionPassReasonForTesting };

export function storeLateVerdict(post: PostContent, verdict: LateVerdict): void {
  bumpCounter('firstEncounterRecoverable');
  sessionLateVerdictByPostId.set(sessionVerdictKey(post), verdict);
  if (sessionLateVerdictByPostId.size > MAX_SESSION_VERDICT_CACHE) {
    const keys = Array.from(sessionLateVerdictByPostId.keys());
    for (let i = 0; i < keys.length / 2; i++) {
      sessionLateVerdictByPostId.delete(keys[i]);
      // An evicted late verdict can never be recovered — the honest
      // denominator subtracts these (first-encounter measurement).
      bumpCounter('firstEncounterRecoverableEvicted');
    }
  }
}

/** Shape a mid-flight cancel's preserved AnalysisResult into a LateVerdict.
 *  Returns null for unconfirmed analyses (nothing to act on later). */
export function lateVerdictFromCancelledAnalysis(
  analysis: AnalysisResult | undefined,
): LateVerdict | null {
  if (!analysis || !analysis.isManipulative) return null;
  if (analysis.action === 'hide' || analysis.action === 'collapse') {
    return { kind: analysis.action, analysis };
  }
  // action 'rewrite'/undefined: the rewrite text was never produced (the
  // cancel fired before neutralization) — MARK floor, never nothing.
  return { kind: 'mark', analysis };
}

