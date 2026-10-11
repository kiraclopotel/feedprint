// The comment-batch drain: flushBatch scores one pending bucket, writes the
// per-comment and environment records, applies hides, markers and rewrite
// swaps, and settles the Child covers. Everything that touches the protection
// manager or the classification generation is handed in through FlushDeps by
// content/index.ts, so this module never imports the content entry. Moved
// whole from content/index.ts per
// docs/audits/2026-08-23-objective-audit/wave4-architecture (Proposal A, step 5);
// the internal phase split is still open (see comment-batch.md).

import type { PostContent } from '../../types/post';
import { mediaUrlsNow } from '../record/media-urls';
import type { AnalysisResult, TechniqueName, TechniqueResult } from '../../types/analysis';
import type { FWMessage } from '../../types/messages';
import { getSettings, isFeatureEnabled, isCommentRewriteEnabled, type FWSettings } from '../../storage/settings';
import { activeParentBlocklist, isParentBlocklistEmpty, matchParentBlocklist, type BlocklistMatch } from '../../core/parent-blocklist';
import { bumpCounter } from '../../diagnostics/diagnostics';
import { processingCache } from '../../storage/cache';
import { verdictCacheKeyInput } from '../../storage/cache-key';
import { sha256 } from '../../forensics/hasher';
import { isHolding as isFlushBudgetHolding, holdRemainingMs as flushBudgetHoldRemainingMs } from '../../ai/global-flush-budget';
import { scoreBatch, scoreRoom, isManipulative, shouldRenderNoRewriteMarker, MANIPULATION_SEVERITY_THRESHOLD, type BatchScoreResult, type RoomAnalysis } from '../../analysis/comment-batch-scorer';
import { GROQ_FAST_MODEL, getLastCallMeta, FALLBACK_AI_PROVIDER } from '../../ai/client';
import { callProvenanceFor, latestModelFor } from '../../ai/call-provenance';
import { hasLoggedForensic, shouldLogForensic, shouldLogCancelForensic, forensicDedupKey } from '../record/forensic-gate';
import { fwDebug, fwDebugDebug } from '../fw-log';
import { sendHighStakesForensicLog } from '../record/forensic-retry';
import { buildConfigSnapshot } from '../record/config-snapshot';
import { postPayloadBase } from '../record/forensic-emit';
import { settleRoomVerdict, type RoomVerdict } from '../post-path/room-verdict';
import { rememberResolvedComment, rememberSessionPass } from '../post-path/late-verdict-cache';
import { filterToViewed, setParentCooldown, unmarkPostsForReExtraction } from '../post-path/viewport-tracker';
import { chainCommentDepth } from '../record/chain-depth';
import { blanketProfanitySoften, hideOnRewriteUnavailable } from '../../analysis/pipeline';
import { resolveUiLanguage } from '../../i18n';
import { MARKER_TITLES } from '../../i18n/marker-strings';
import type { BatchCommentVerdict } from '../../types/batch-verdict';
import { isFeatureEnabled as isDevFlagEnabled } from '../../storage/feature-flags';
import { emitCancelLog } from '../record/forensic-emit';
import { computeAnchorKey } from '../../core/anchor-key';
import { verifyAnchorMatch, cancelVerdictFor } from '../../forensics/anchor-revalidation';
import { tryRecoverCommentAnchor } from '../post-path/dom-recycle-recovery';
import { hasStoredPaidLicenseKey } from '../../storage/license';
import { safeSendMessage } from '../../storage/context-guard';
import { isAbsentTargetInterventionExempt } from '../../analysis/present-target';
import { buildEncounterForFlushBatch } from '../record/encounter-builder';
import { recordMetricsFromPostContent } from '../record/record-metrics';
import { resolvePromptLanguage } from '../../core/lang-detect';
import { validateRewrite } from '../../analysis/comment-rewriter';
import { findDuplicateRewriteIndices } from '../../core/neutralizer';
import type { ChainDebugStatsResponse } from '../../types/messages';
import type { DecisionBlock } from '../../types/forensic';
import { neutralizeText } from '../../ai/neutralize-only';
import { buildCommentEntryForRoot, recordedCommentHideAction, type CommentEntry } from '../protection/comment-overlay';
import type { renderTeenMarker } from '../markers/teen-marker';
import { AI_TEXT_ATTR, type AiWriter } from '../markers/ai-mark';
import type { CommentHideNotice } from '../protection/comment-overlay';
import { commentHideNoticeFor } from '../markers/comment-hide-notice';
import { hideAndRecordComment } from './door';
import { decisionForLegacy, decisionForMask, NOTE_NOT_APPLIED, READER_DEFAULT, rewriteStage } from '../record/decision';
import { filterProfanity, maskProfanity } from '../../core/profanity-filter';
import { detectDehumanization } from '../../core/dehumanization-filter';
import { detectHarmLaundering } from '../../core/harm-laundering';
import {
  pendingBatches,
  captionPostByParent,
  roomContextKey,
  takePendingBatchForFlush,
  commentRecordRoomFields,
  flushBatchWhenBudgetReady,
  deferConsumedBatchForBudgetHold,
} from './queue';

/**
 * What flushBatch needs from the content entry: the protection and marker
 * terminals (they own the Child cover manager and the classification
 * generation), the bound flusher the queue re-arms with, and the surface
 * session id the environment record falls back to.
 */
export interface FlushDeps {
  flush: (key: string) => Promise<void>;
  settleProtection: (post: PostContent, outcome: { record: 'batch'; reason: string }) => void;
  commitProtection: (post: PostContent, preserveMedia?: boolean) => void;
  applyCommentHide: (post: PostContent, notice?: CommentHideNotice | null) => boolean;
  applyCommentRewriteTerminal: (
    entry: CommentEntry,
    rewrite: string,
    mode: FWSettings['mode'],
    /** False for a swear mask, which must never fall back to hiding. */
    hideFallback?: boolean,
    /** Present when a model wrote `rewrite`: the landed text carries the AI mark. */
    writer?: AiWriter,
  ) => 'rewritten' | 'hidden' | 'unresolved';
  renderCommentMarkerForCurrentClassification: (
    post: PostContent,
    options: Parameters<typeof renderTeenMarker>[0],
  ) => ReturnType<typeof renderTeenMarker>;
  isCurrentClassification: (post: PostContent) => boolean;
  prepareCurrentPostMutation: (post: PostContent, replacementAnchor?: HTMLElement) => boolean;
  reapplyDuplicateTextVerdict: (post: PostContent, protectionsToRetain: Set<PostContent>) => void;
  surfaceSessionId: string;
}

/**
 * Build the persisted technique list from a batch comment verdict. The batch
 * path historically wrote `techniques: []`, dropping the verdict's label, so
 * AI-classified comments appeared LABEL-LESS in the forensic chain (343/585
 * records empty on a real 2026-06-04 export). Carry the verdict's technique —
 * the canonical enum is the legally precise label — plus severity/confidence;
 * the model's reason rides on `AnalysisResult.explanation`. Neutral / 'none'
 * verdicts carry nothing: a PASS record legitimately has no technique. The
 * enum string is persisted as-is into the SIGNED record (forward-only; legacy
 * records unchanged; no canonical-payload schema change — `techniques[]`
 * already exists and is already signed).
 */
function verdictTechniques(
  technique: string | null | undefined,
  severity: number,
  reason: string | null | undefined,
  confidence?: number,
): TechniqueResult[] {
  if (!technique || technique === 'none' || technique === 'neutral') return [];
  const conf = typeof confidence === 'number' && confidence >= 0 && confidence <= 1 ? confidence : 0.5;
  return [{
    technique: technique as TechniqueName,
    present: true,
    confidence: conf,
    severity,
    evidence: reason ? [reason] : [],
  }];
}

/**
 * The technique the marker names on a caught comment: the verdict's own when the title table has an entry for it, so the
 * dot reads "Self-harm risk" or "Body comparison" and a pattern added to the table later gets its title here without
 * anyone remembering a second list. Batch-only labels ('pile-on', 'mockery') and anything the table does not hold stay
 * undefined and read the generic "Pattern detected". 'combined' stays generic too: it names two different things (the
 * judge's uncategorised residual and the meta-rule's co-occurrence) and waits for its own card.
 */
function titledTechnique(verdict: Pick<BatchCommentVerdict, 'technique'>): TechniqueName | undefined {
  const technique = verdict.technique;
  if (technique === 'combined') return undefined;
  // 'profanity' stays generic, as before G5: its fallback reason counts the evidence, and on a comment the evidence is the
  // judge's reason string (always 1), so the count line would say "one word from the filter list" of a verdict the judge made.
  // It gets its title when that line knows whether its evidence is terms or a reason.
  if (technique === 'profanity') return undefined;
  return Object.prototype.hasOwnProperty.call(MARKER_TITLES.en, technique) ? (technique as TechniqueName) : undefined;
}

/**
 * Reduce one scored batch to the single verdict a caption-less post under the
 * same parent is judged by (PLAN-2026-09-14 standing decision 3).
 *
 * WHICH INSTRUMENT. The verdict comes from the PER-COMMENT call (`scoreBatch`,
 * J6 in docs/audits/2026-09-07-xray/xray-judgement-path.md), not from the room
 * sensor (`scoreRoom`, J7), because decision 3 says the first batch of
 * comments is read and that verdict applied, and because J6 has at least been
 * measured while J7 never has. The room sensor's summary rides along as the
 * evidence line when it produced one; the batch's own environment summary is
 * the fallback.
 *
 * WHICH COMMENT. The most severe comment the batch judged manipulative, by the
 * same `isManipulative` gate every other consumer of this batch uses, so the
 * post's verdict can never be stricter than what was done to the comment it
 * came from.
 */
export function roomVerdictFromBatch(
  result: BatchScoreResult,
  room: RoomAnalysis | null,
  provider: string,
): RoomVerdict {
  let worst: BatchScoreResult['comments'][number] | null = null;
  for (const c of result.comments) {
    if (!isManipulative(c)) continue;
    if (worst === null || c.severity > worst.severity) worst = c;
  }
  const summary = room?.summary || result.environment.summary || '';
  return {
    manipulative: worst !== null,
    technique: worst?.technique ?? null,
    severity: worst?.severity ?? 0,
    confidence: worst?.confidence ?? 0.5,
    summary,
    batchSize: result.batchSize,
    aiModel: GROQ_FAST_MODEL,
    aiProvider: provider,
  };
}

/** Cap-exhausted (free tier / cap reached) is logged once per content-script
 *  lifetime, not per comment batch — see flushBatch fail-closed handling. */
let warnedCapExhaustedThisSession = false;
/** Worker entitlement rejection (401 auth-refusal) is its own once-per-session
 *  line so a Cloudflare/KV license mismatch is not buried in the generic
 *  provider-failure message. */
let warnedAuthRefusalThisSession = false;

/**
 * Persist a flagged comment's VALIDATED reframe into the shared content cache,
 * keyed IDENTICALLY to the per-post pipeline (sha256 of
 * platform|mode|locale|outputLanguage|text, plus the parent's text when the
 * comment carries one, as the focused tweet does). The comment path computes the
 * reframe in BATCH context, but opening that same comment on its OWN permalink
 * makes it a focused tweet that flows through the per-post pipeline — a
 * DIFFERENT prompt that re-analysed from scratch and showed the original,
 * un-rewritten text (live report, 2026-06-26). Priming the cache here makes
 * the post path reuse the reframe (and skip the LLM) — the same "rewrite once,
 * reuse across surfaces" contract the cache already serves for feed→profile→
 * detail. Best-effort: a cache miss just means the post path recomputes; never
 * blocks the rewrite. Keyed on the ORIGINAL comment text, which is what the
 * focused tweet also carries.
 */
async function primeReframeCache(
  platform: string,
  text: string,
  parentText: string | undefined,
  analysisLike: Record<string, unknown>,
  rewrite: string,
  settings: FWSettings,
  writerModel?: string,
): Promise<void> {
  try {
    const outputLanguage = settings.outputLanguage ?? 'auto';
    const textHash = await sha256(
      verdictCacheKeyInput(platform, settings.mode, settings.locale, outputLanguage, text, parentText),
    );
    processingCache.set(textHash, analysisLike as unknown as AnalysisResult, rewrite, undefined, writerModel);
  } catch {
    // best-effort cache priming — never let it break the rewrite path
  }
}

/**
 * Drain a single bucket: call scoreBatch, write per-comment forensic records
 * (with the batch's verdict embedded) + write the environment record for the
 * video. All records share parentVideoId so the dashboard groups them.
 */
export async function flushBatch(parentVideoId: string, deps: FlushDeps): Promise<void> {
  if (isFlushBudgetHolding()) {
    const bucket = pendingBatches.get(parentVideoId);
    if (!bucket) return;
    const deferMs = Math.max(1, flushBudgetHoldRemainingMs());
    bucket.timer = setTimeout(
      () => flushBatchWhenBudgetReady(parentVideoId, deps.flush),
      deferMs,
    ) as unknown as number;
    return;
  }
  const prepared = takePendingBatchForFlush(parentVideoId);
  if (!prepared) return;
  const {
    settleProtection,
    commitProtection,
    applyCommentHide,
    applyCommentRewriteTerminal,
    renderCommentMarkerForCurrentClassification,
    isCurrentClassification,
    prepareCurrentPostMutation,
    reapplyDuplicateTextVerdict,
    surfaceSessionId,
  } = deps;
  const { bucket, roomFields } = prepared;
  const postsToSettle = [...bucket.posts];
  const protectionsToRetain = new Set<PostContent>();
  const batchIsCurrent = (): boolean => bucket.posts.every(isCurrentClassification);
  let commentHideAttempts = 0;
  let commentHidesApplied = 0;
  let commentHideMisses = 0;
  // Read inside the try below. The outer catch writes the chain record of the comments it could not judge only when the
  // settings were read, because the record names the mode and carries a config snapshot.
  let settingsRead: FWSettings | undefined;

  try {

  const settings = await getSettings();
  settingsRead = settings;
  /**
   * Give this bucket up, and say so.
   *
   * takePendingBatchForFlush removed the bucket from pendingBatches before the
   * first await, so from here the bucket exists only in this call's locals.
   * Every `if (!batchIsCurrent()) return;` below used to be a bare return, and
   * a route change or a mode change inside the model's 500 to 1400 ms window
   * destroyed up to a full bucket of comments: no record, no un-marking, and a
   * finally block that settled every post as `{ record: 'batch' }` — which
   * settle-protection.ts defines as "the comment flush wrote this comment's
   * record before reaching here". Nothing had been written.
   *
   * The three things a give-up owes, in the order the encounter-builder throw
   * branch below already did them (that branch is what established the shape):
   * the elements go back into the extraction pool, a Child cover stays up
   * because no terminal landed, and the chain says each comment went unjudged
   * and why.
   *
   * The verdict is the vocabulary the chain already has for this
   * (types/forensic.ts): 'cancelled-stale' for a bucket given up before the
   * model was asked, 'cancelled-mid-flight' for one given up after it answered
   * — "the LLM returned a verdict but the abort signal fired before render".
   * Cancel-side dedup only, so a re-encounter of the same comment on the new
   * surface still gets scored and rendered rather than skipped.
   */
  const abandonStaleBatch = (
    verdict: 'cancelled-stale' | 'cancelled-mid-flight',
    site: string,
  ): void => {
    unmarkPostsForReExtraction(bucket.posts);
    if (settings.mode === 'child') {
      for (const post of bucket.posts) protectionsToRetain.add(post);
    }
    for (const post of bucket.posts) {
      if (hasLoggedForensic(forensicDedupKey(post)) || !shouldLogCancelForensic(forensicDedupKey(post))) continue;
      void sendHighStakesForensicLog({
        type: 'CANCEL_LOG',
        payload: {
          originalText: post.text,
          verdict,
          // No analysis: a give-up before the call has none, and a give-up
          // after it has a batch verdict that was never routed to this
          // comment's slot. Naming one here would claim a per-comment
          // determination the record cannot show was made.
          analysis: undefined,
          mode: settings.mode,
          platform: post.platform,
          author: post.author,
          authorName: post.authorName,
          ...commentRecordRoomFields(roomFields),
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
    }
    fwDebug(
      `[FW comment-batch] gave up a stale bucket at ${site}: ${bucket.posts.length} comment(s) ` +
      `recorded ${verdict} parentVideoId=${parentVideoId}`,
    );
  };
  if (!batchIsCurrent()) { abandonStaleBatch('cancelled-stale', 'settings-read'); return; }
  const recordCommentHideOutcome = (
    post: PostContent,
    sharedFields: Record<string, unknown>,
    analysisLike: Record<string, unknown>,
  ): void => {
    const hideApplied = hideAndRecordComment({ settings, post, sharedFields, analysisLike, applyCommentHide });
    commentHideAttempts++;
    if (hideApplied) {
      commentHidesApplied++;
    } else {
      commentHideMisses++;
      if (settings.mode === 'child') protectionsToRetain.add(post);
    }
  };
  /**
   * The decision block for a comment the legacy batch path acted on
   * (docs/design/DECISION-BLOCK-2026-09-07.md): the row from the legacy
   * signal when one can be named honestly, what the page showed, and what the
   * rewrite stage did. Undefined when no row can be named, and then nothing
   * is written rather than something invented.
   */
  const commentDecision = (
    sharedFields: Record<string, unknown>,
    analysisLike: Record<string, unknown>,
    applied: 'allow' | 'mark' | 'soften' | 'hide',
    rewrite: DecisionBlock['rewrite'],
    platform: PostContent['platform'],
  ) => {
    const techs = Array.isArray(analysisLike.techniques)
      ? (analysisLike.techniques as Array<{ technique?: string; name?: string; present?: boolean }>)
        .filter((t) => t.present !== false)
        .map((t) => String(t.technique ?? t.name ?? ''))
      : [];
    const d = decisionForLegacy({
      mode: settings.mode,
      detectionMode: typeof sharedFields.detectionMode === 'string' ? sharedFields.detectionMode : undefined,
      techniques: techs,
      severity: typeof analysisLike.overallScore === 'number' ? analysisLike.overallScore : undefined,
      applied,
      mask: blanketProfanitySoften(settings, platform),
    });
    // A legacy row keeps its own action, so a comment left as served after a failed rewrite has no
    // difference to mark; without the note the card reads "shown" as if the judge had cleared it.
    return d
      ? { ...d, rewrite, note: d.note ?? (applied === 'allow' && rewrite?.outcome === 'failed' ? NOTE_NOT_APPLIED : null) }
      : undefined;
  };
  // Resolve the language for FW outputs. Parent override (settings.
  // outputLanguage, set via popup) wins unconditionally when not 'auto';
  // otherwise routes through chrome.i18n.detectLanguage (CLD3, 100+
  // languages) + Intl.DisplayNames for automatic same-language behavior.
  // Returns the English language NAME ("Romanian", "Italian", "Japanese")
  // for direct substitution into the BATCH prompt's ${lang} slot.
  const language = await resolvePromptLanguage(
    settings.outputLanguage,
    bucket.caption ?? '',
    bucket.posts.map((p) => p.text),
  );
  if (!batchIsCurrent()) { abandonStaleBatch('cancelled-stale', 'language-resolve'); return; }

  // VISION §1.1 chain-mirror gate. Skip scoreBatch + chain writes when no
  // user-visible BATCH-path feature is on for this platform. The two BATCH
  // output sinks are the comment rewrite and the marker dot; if both are
  // off, the kid saw raw content and the chain stays silent (no "FW
  // analyzed but did nothing" record). Un-stamp the bucket so re-extraction
  // fires correctly when the user toggles features back on.
  const sinkPlatform = bucket.posts[0]?.platform;
  if (sinkPlatform) {
    const rewriteOn = isCommentRewriteEnabled(settings, sinkPlatform);
    const markersOn = isFeatureEnabled(settings, 'show-reframe-markers', sinkPlatform);
    if (!rewriteOn && !markersOn) {
      unmarkPostsForReExtraction(bucket.posts);
      fwDebug(
        `[FW comment-batch] no-visible-output-sink gate dropped bucket ` +
        `(rewrite=${rewriteOn} markers=${markersOn}) parentVideoId=${parentVideoId}`,
      );
      return;
    }
  }

  // viewport gate. Filter the bucket to comments whose
  // DOM element has crossed the viewport since enqueue. fail-open semantics
  // for dead domRefs (legacy back-compat) and IO-unavailable realms (jsdom).
  // If 0 comments pass, drop the bucket entirely — NO LLM call, NO chain
  // records. VISION §1.1 chain-mirror invariant: "rendered DOM the child
  // observes" — if no comment in this bucket was ever in the viewport, the
  // child never observed any; the chain stays silent. Pre-fired the
  // LLM call on every bucket regardless of visibility, polluting the chain
  // when the pool was rate-limited (4× cancelled-batch-llm-failure × 10
  // comments seen on a live FB permalink screenshot).
  const viewedPosts = filterToViewed(bucket.posts);
  if (viewedPosts.length === 0) {
    // .b — un-stamp ALL dropped posts so the adapter re-extracts them
    // when the user later scrolls into view. Without this, `fwCommentSeen` /
    // `fwProcessed` permanently blocks re-classification → VISION §1.1
    // chain-mirror violation on back-scroll.
    unmarkPostsForReExtraction(bucket.posts);
    fwDebug(
      `[FW comment-batch] viewport-gate dropped bucket (0/${bucket.posts.length} viewed) ` +
      `parentVideoId=${parentVideoId}`,
    );
    return;
  }
  if (viewedPosts.length < bucket.posts.length) {
    // .b — un-stamp ONLY the unviewed subset (viewed comments stay
    // dedup-locked, correct: they're going through scoreBatch now).
    const unviewedPosts = bucket.posts.filter((p) => !viewedPosts.includes(p));
    unmarkPostsForReExtraction(unviewedPosts);
    fwDebug(
      `[FW comment-batch] viewport-gate filtered ${bucket.posts.length - viewedPosts.length} ` +
      `unviewed of ${bucket.posts.length} for parentVideoId=${parentVideoId}`,
    );
  }
  // Mutate bucket.posts in place so all downstream consumers (encounter-
  // builder, per-comment loop, marker render, pendingSwaps) see the filtered
  // subset. The bucket has already been removed from pendingBatches above so
  // no other caller can race on this mutation.
  bucket.posts = viewedPosts;

  // Visible (non-fwDebug) scan line so the comment-scanner's activity shows in
  // dev-tools on every platform. The legacy video pipeline logs via console.log
  // but this BATCH path only logged via the gated fwDebug — so on TikTok's
  // recycling comment list the scanner looked "stuck" in the console while it
  // was in fact still scanning. Cadence is per-flush (debounced), not noisy.
  console.log(`[FeelingWise] scanning ${bucket.posts.length} comment(s) on ${bucket.platform}`);

  fwDebug(`[FW comment-batch] flushing ${bucket.posts.length} comments for parentVideoId=${parentVideoId}`);

  let result: BatchScoreResult;
  // Who answered the batch, as the proxy named it on the reply, or its second
  // rung when that answered (docs/design/JUDGE-AVAILABILITY-2026-09-07.md).
  // Read right after the call; this is only the value before one is read.
  let batchProvider: string = FALLBACK_AI_PROVIDER;
  // The batch's calls run under a signal of their own, so a record of a failed batch can name
  // what answered them, and nothing when nothing did.
  const batchCalls = new AbortController();
  // Room sensor (the SEPARATE 2nd call) runs in parallel with the per-comment
  // record routing below; its result is merged into the ENVIRONMENT_LOG only.
  // Default null = no room read (degrades to scoreBatch's basic environment).
  let roomPromise: Promise<RoomAnalysis | null> = Promise.resolve(null);
  try {
    // `buildEncounterForFlushBatch` walks the DOM for X-permalink ancestry.
    // TikTok, Instagram, YouTube, and Facebook use their dedicated extract-
    // time platform signals; incomplete/unrecognized observations degrade to
    // the legacy Encounter rather than inventing context.
    //
    // pass `bucket.permalinkUrl` so the rich path is gated on
    // URL cohesion: if user navigated between fill and flush, the DOM walk
    // would tie children-from-permalink-A to post+ancestors-from-permalink-B
    // (chain-mirror invariant violation). Mismatch → legacy fallback.
    const encounter = buildEncounterForFlushBatch(
      bucket.posts,
      bucket.caption,
      language,
      bucket.permalinkUrl,
      // Q51 (W55): the caption record captured at the chokepoint plus the
      // bucket's denormalized author, so the assemblers stop finding
      // nothing in the comments-only posts array.
      {
        post: captionPostByParent.get(roomContextKey(bucket.platform, parentVideoId)),
        author: bucket.videoAuthor,
      },
    );
    result = await scoreBatch(encounter, settings.mode, batchCalls.signal);
    batchProvider = getLastCallMeta()?.provider ?? FALLBACK_AI_PROVIDER;
    // The model answered and the surface moved: the bucket is gone from
    // pendingBatches and this is the last hand that holds it.
    if (!batchIsCurrent()) { abandonStaleBatch('cancelled-mid-flight', 'post-score'); return; }
    if (result.failureKind === 'pre-llm-circuit-breaker') {
      deferConsumedBatchForBudgetHold(parentVideoId, bucket, deps.flush);
      for (const post of bucket.posts) protectionsToRetain.add(post);
      return;
    }
    // Kick off the room sensor now (parallel with per-comment routing). Only
    // on a successful per-comment call — a failed batch returns before the
    // ENVIRONMENT_LOG emit, so the room read would have no consumer.
    // Gated on the comments-to-analyze-per-video toggle (wiring Q3): the
    // room read is a SECOND paid Groq call whose only output is the
    // ENVIRONMENT_LOG chain field, and before this gate no parent-visible
    // switch stopped it. The toggle is on in every preset, so defaults are
    // unchanged; turning the "Analysis Context" feature off now stops the
    // auxiliary room spend along with it.
    const roomSensorOn = sinkPlatform
      ? isFeatureEnabled(settings, 'comments-to-analyze-per-video', sinkPlatform)
      : true;
    if (!result.failed && roomSensorOn) {
      roomPromise = scoreRoom(encounter, settings.mode).catch(() => null);
    }
  } catch (err) {
    console.error('[FW comment-batch] encounter constructor or scoreBatch threw:', err);
    // A throw here is FeelingWise's own fault, not the vendor's. Before this
    // branch unmarked nothing, recorded nothing and let the finally-release
    // uncover the whole Child bucket, with the posts still stamped so the
    // route never re-scored them (PROTECTION-PATH-4). Mirror the failed-batch
    // branch below: Child covers stay, the posts are re-extractable, and the
    // chain says each comment went unjudged and why.
    //
    // 2026-09-18: a `if (!batchIsCurrent()) return;` used to stand here and
    // skipped all three of those when the surface changed during the throw's
    // own window, so the worst case (FeelingWise's own fault AND a route
    // change) was the one case that recorded nothing. Nothing below this line
    // touches the DOM, so a stale bucket runs it exactly as a current one does.
    unmarkPostsForReExtraction(bucket.posts);
    if (settings.mode === 'child') {
      for (const post of bucket.posts) protectionsToRetain.add(post);
    }
    for (const post of bucket.posts) {
      if (hasLoggedForensic(forensicDedupKey(post)) || !shouldLogCancelForensic(forensicDedupKey(post))) continue;
      void sendHighStakesForensicLog({
        type: 'CANCEL_LOG',
        payload: {
          originalText: post.text,
          verdict: 'cancelled-batch-llm-failure',
          analysis: undefined,
          mode: settings.mode,
          platform: post.platform,
          author: post.author,
          authorName: post.authorName,
          ...commentRecordRoomFields(roomFields),
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
          failureKind: 'internal-error',
        },
      });
    }
    return;
  }

  // The household's own list, on comments (11 Oct 2026). On a post it is the first step of the pipeline; a batched
  // comment (every YouTube comment, TikTok's, X permalink replies) never reaches that pipeline, so a word on the
  // list swapped a YouTube title for "Hidden: on this household's block list" and left every comment holding the
  // word on screen. A match is a rule, not a reading: whatever the batch said (or failed to say), the comment is
  // hidden and the record names the rule, as the pipeline's record does, with no claim that anything was judged.
  // Each hit is also read by the comment's own words, so the batch call is not changed.
  const blockedByHousehold = new Map<number, BlocklistMatch>();
  {
    const list = activeParentBlocklist(settings.features);
    if (!isParentBlocklistEmpty(list)) {
      if (!Array.isArray(result.comments)) result.comments = [];
      for (let i = 0; i < bucket.posts.length; i++) {
        const post = bucket.posts[i];
        const hit = matchParentBlocklist(list, post.text, post.author, post.card);
        if (!hit) continue;
        blockedByHousehold.set(i, hit);
        result.comments[i] = {
          index: i + 1, technique: 'none', sentiment: 'neutral', severity: 0, confidence: 1,
          reason: `household list: ${hit.kind}`, action: 'hide',
        };
      }
    }
  }
  // What a record of a comment says about who acted: the rule engine when the household's list did, the batch otherwise.
  const householdFields = (i: number): Record<string, unknown> => {
    const hit = blockedByHousehold.get(i);
    return hit
      ? { aiSource: 'rules', detectionMode: `blocklist:${hit.kind}:${hit.rule}`, aiModel: 'fw-household-list-v1', aiProvider: 'fw-rules' }
      : {};
  };

  // // fail-closed batch handling. When `scoreBatch` returns a fail-closed
  // result (LLM threw / empty raw / unparseable JSON / shape mismatch) every
  // comment is stamped technique='none' / sev=0 with `failed: true`. Pre-
  // the for-loop below routed those defaults through the
  // isManipulative=false branch → PASS_LOG with passReason='comment-batch-
  // neutral'. The chain then claimed "FW analyzed and these are innocent"
  // when the truth is "FW could not analyze them." VISION §1.2 protection-
  // honesty bar mandates the latter framing. Mirror the truncatedIndices
  // pattern: emit CANCEL_LOG with verdict='cancelled-batch-llm-failure'
  // for every comment in the bucket, then return early (skip PASS/FORENSIC
  // routing for this batch).
  if (result.failed) {
    // failClosed escalates per-comment verdicts via harm-floor when Groq is
    // down — identity-slur match → sev=8 action='hide' shame-attack, HF≥70
    // non-slur → sev=7-9 shame-attack. Pre-fix this branch routed EVERY
    // comment to CANCEL_LOG regardless of the escalation, defeating
    // CYCLE N+27 Bug 12's intent: a Groq failure on a slur-laden room
    // produced "cancelled" chain records and the kid saw the slur. Split
    // the routing: escalated verdicts → FORENSIC_LOG + inline hide; the
    // remaining sev=0/none defaults → existing CANCEL_LOG so the dashboard
    // Operational Events panel still tracks the Groq-failure signal.
    // cap-exhausted (free tier OR daily/monthly cap reached) is the tier's
    // DEFINED no-AI behavior, not a transient failure. The deterministic
    // harm-floor below still protects against real harms, but the remaining
    // non-harm comments must NOT each write a 'cancelled-batch-llm-failure'
    // chain record — on a comment-heavy free-tier page that floods the chain
    // with misleading "couldn't analyze" junk AND spams the error log on every
    // batch (the exact symptom in a real 2026-06-06 error log). Genuine
    // transient failures (rate-limit / network / json-refusal) still record
    // honestly below.
    const capExhausted = result.failureKind === 'cap-exhausted';
    // A model and a provider are named only when one answered, with the name it gave. A record of a call nobody
    // answered names neither: a file handed on must not say a model read what none did (11 Oct 2026).
    const answered = callProvenanceFor(batchCalls.signal);
    let escalatedCount = 0;
    let cancelledCount = 0;
    for (let i = 0; i < bucket.posts.length; i++) {
      const post = bucket.posts[i];
      // Peek, don't consume: only the escalated (actually handled) branch
      // consumes the dedup entry below. A cancelled / cap-exhausted comment
      // is not-yet-handled — consuming here locked the miss in until page
      // reload (re-encounter skipped at this gate).
      if (hasLoggedForensic(forensicDedupKey(post))) {
        reapplyDuplicateTextVerdict(post, protectionsToRetain);
        continue;
      }
      const verdict = result.comments?.[i];
      const isEscalated = !!verdict && (verdict.severity >= 7 || verdict.action === 'hide');
      if (isEscalated) {
        shouldLogForensic(forensicDedupKey(post));
        const escalatedAnalysis = {
          techniques: verdict.technique !== 'none'
            ? [{ technique: verdict.technique, present: true, severity: verdict.severity, confidence: verdict.confidence ?? 0.5 }]
            : [],
          overallScore: verdict.severity,
          overallConfidence: verdict.confidence ?? 0.5,
          isManipulative: true,
        };
        const sharedFields = {
            originalText: post.text,
            // Groq FAILED on this batch (we are inside the `result.failed`
            // branch) — this verdict came from the harm-floor regex fallback in
            // `failClosed`, NOT a cloud call. Stamp honest rules provenance
            // (per `forensic.ts` aiSource doc: rules records name the rule
            // engine) so the chain never claims the AI diagnosed a comment it
            // never actually scored.
            ...postPayloadBase(post, settings.mode, 'rules', roomFields.postUrl),
            ...commentRecordRoomFields(roomFields),
            anchorUrl: post.anchorUrl,
            accountType: post.accountType,
            sourceContainer: post.sourceContainer,
            observedSequence: post.observedSequence,
            viewportSeenAt: post.viewportSeenAt,
            surfaceSessionId: post.surfaceSessionId,
            textCapture: post.textCapture,
            authorCapture: post.authorCapture,
            mediaUrls: mediaUrlsNow(post),
            aiModel: 'fw-harm-floor-regex-v1',
            aiProvider: 'fw-rules',
            kind: 'comment' as const,
            parentVideoId,
            ...householdFields(i),
        };
        if (verdict.action === 'hide') {
          recordCommentHideOutcome(post, sharedFields, escalatedAnalysis);
        } else {
          void sendHighStakesForensicLog({
            type: 'FORENSIC_LOG',
            payload: {
              ...sharedFields,
              neutralizedText: '',
              analysis: escalatedAnalysis,
              decision: commentDecision(sharedFields, escalatedAnalysis, 'mark', { attempted: false, outcome: 'off' }, post.platform),
              reader: READER_DEFAULT,
            },
          });
        }
        escalatedCount++;
        continue;
      }
      // Free-tier / cap-reached: this non-harm comment is a silent DOM-only
      // pass (the tier does no AI by design) — do NOT write a 'cancelled'
      // record (and don't consume the dedup entry: if the cap resets or the
      // license read recovers mid-session, a re-encounter gets real analysis).
      // Only genuine LLM failures route to CANCEL_LOG.
      if (capExhausted) continue;
      // Cancel-side dedup only — the main entry stays free so a re-encounter
      // after Groq recovers gets scored + rendered instead of skipped.
      if (!shouldLogCancelForensic(forensicDedupKey(post))) continue;
      void sendHighStakesForensicLog({
        type: 'CANCEL_LOG',
        payload: {
          originalText: post.text,
          verdict: 'cancelled-batch-llm-failure',
          // No analysis — the LLM call itself did not produce any verdict.
          analysis: undefined,
          mode: settings.mode,
          platform: post.platform,
          author: post.author,
          authorName: post.authorName,
          ...commentRecordRoomFields(roomFields),
          feedSource: post.feedSource ?? 'unknown',
          accountType: post.accountType,
          sourceContainer: post.sourceContainer,
          observedSequence: post.observedSequence,
          viewportSeenAt: post.viewportSeenAt,
          surfaceSessionId: post.surfaceSessionId,
          textCapture: post.textCapture,
          authorCapture: post.authorCapture,
          mediaUrls: mediaUrlsNow(post),
          aiModel: answered?.model,
          aiProvider: answered?.provider,
          // Config at capture time (board #6a). The comment path's flag gate
          // is the fixed MANIPULATION_SEVERITY_THRESHOLD, not the per-post
          // settings.threshold — stamping the latter would misstate the gate
          // this record was actually judged against.
          configSnapshot: buildConfigSnapshot(settings.mode, MANIPULATION_SEVERITY_THRESHOLD, settings.dailyCap, settings.features, settings.readFailedFallback),
          kind: 'comment',
          parentVideoId,
          // Forensic fail-kind discriminator. Stamped from the typed
          // `AIFailure` returned by the LLM cascade; lets the dashboard's
          // Operational Events panel group system failures by class instead
          // of defaulting every record to 'network'.
          failureKind: result.failureKind,
          retryAfterMs: result.retryAfterMs,
          cap: result.cap,
        },
      });
      cancelledCount++;
    }
    if (capExhausted) {
      // Expected tier behavior — log ONCE per session so the operator knows AI
      // is off (free tier / cap reached) without flooding the error log on
      // every batch. The deterministic harm-floor still ran (escalations above).
      // Each line carries a stable `class=` tag so the seven failure modes are
      // greppable in chrome://extensions Errors (see docs/spec/known-issues M28):
      //   • cap=tier-free splits into a GENUINE free user (no key) vs a paid/dev
      //     license that momentarily resolved FREE (a read-collapse BUG) — the
      //     exact ambiguity that made the dev-license video pause hard to triage.
      if (!warnedCapExhaustedThisSession) {
        warnedCapExhaustedThisSession = true;
        const cap = result.cap ?? 'tier-free';
        if (cap === 'tier-free') {
          const paidKeyState = await hasStoredPaidLicenseKey();
          // 2026-09-18: a `if (!batchIsCurrent()) return;` used to stand here.
          // Every comment in this branch has already been routed by the loop
          // above, so it cost no record — it cost the per-parent cooldown at
          // the end of this branch, which is what stops the bucket re-forming
          // against the same exhausted cap. The pool does not care which
          // surface the reader is on.
          if (paidKeyState === 'present') {
            console.warn(
              `[FW comment-batch] AI comment analysis is OFF [class=license-read-collapse] — ` +
              `a paid/dev key IS stored but the license read resolved FREE this batch ` +
              `(transient client-side storage blip, not a real cap). AI is skipped for ` +
              `affected batches; the deterministic harm-floor still ran. (Logged once per session.)`,
            );
          } else if (paidKeyState === 'unreadable') {
            // Q50 (W52): the diagnostic read ALSO failed. Do not claim
            // "genuine free tier" — during a storage blip that is the wrong
            // line, and the one that ends triage.
            console.warn(
              `[FW comment-batch] AI comment analysis is OFF [class=license-read-unreadable] — ` +
              `the license read resolved FREE and the key-presence check could not read storage ` +
              `either (storage blip likely; cannot distinguish free tier from a collapse). ` +
              `The deterministic harm-floor still ran. (Logged once per session.)`,
            );
          } else {
            console.warn(
              `[FW comment-batch] AI comment analysis is OFF [class=tier-free] — genuine free tier ` +
              `(no paid key stored). Comments use the deterministic harm-floor only. (Logged once per session.)`,
            );
          }
        } else if (cap === 'master-off') {
          // The person's own choice, not a fault, so it is an info line and never reaches the extension's Errors list:
          // the AI switch is off, the level is Strict, or no level is chosen yet (client.ts, the master breaker).
          console.info(
            `[FW comment-batch] AI comment analysis is off [class=master-off]: the AI switch is off, the level is ` +
            `Strict, or no level is chosen yet. Comments use the deterministic harm-floor only. (Logged once per session.)`,
          );
        } else {
          // cap === 'daily' | 'monthly': a real per-license cap was reached.
          // Either may be client-side (license.ts) or worker-enforced (proxy 429).
          console.warn(
            `[FW comment-batch] AI comment analysis is OFF [class=cap-${cap}] — the ${cap} usage cap ` +
            `is reached. Comments use the deterministic harm-floor only until the window resets. ` +
            `(Logged once per session.)`,
          );
        }
      }
    } else if (result.failureKind === 'auth-refusal') {
      // 401 from the worker proxy: missing_auth / invalid_license_format /
      // license_not_found / license_revoked / license_expired / tier_mismatch — i.e. a Cloudflare/KV
      // ENTITLEMENT problem, NOT a provider hiccup and NOT a client-side cap.
      // Distinct once-per-session line so this class is unmistakable.
      if (!warnedAuthRefusalThisSession) {
        warnedAuthRefusalThisSession = true;
        console.warn(
          `[FW comment-batch] AI comment analysis is OFF [class=worker-entitlement] — the license ` +
          `proxy rejected the key (401: revoked / not found / tier mismatch / bad format). The stored ` +
          `key may not match an active server-side record. The deterministic harm-floor still ran. ` +
          `(Logged once per session.)`,
        );
      }
    } else {
      console.warn(
        `[FW comment-batch] scoreBatch failed [class=${result.failureKind ?? 'unclassified'}] ` +
        `${result.retryAfterMs ? ` retryAfterMs=${result.retryAfterMs}` : ''}` +
        `${result.cap ? ` cap=${result.cap}` : ''}. ` +
        `Routed ${escalatedCount} harm-floor-escalated verdicts to FORENSIC_LOG + ` +
        `${cancelledCount} default verdicts to CANCEL_LOG.`,
      );
    }
    // set per-parent cooldown after fail-closed flush
    // so re-enqueue within the next 30s short-circuits in
    // `enqueueCommentForBatch`. Prevents the bucket from immediately re-
    // forming and re-flushing against the same rate-limited Groq pool, which
    // is what produced the "4 batches × 10 cancelled comments = 40 chain
    // pollution records" pattern in a live FB permalink test.
    setParentCooldown(parentVideoId);
    return;
  }

  // per-comment verdict logging. A live FB modal test
  // showed markers landing on the wrong comments (analytical/factual flagged
  // as toxic, real sarcasm/conspiracy unflagged). Per-comment console output
  // exposes the LLM's verdict for each input so we can pattern-match
  // false-positives + false-negatives and tune the batch-scorer prompt.
  // Per-comment verdict trace lives at `console.debug` so it's hidden from
  // a parent's default DevTools view (Verbose level required to surface
  // it). On an active platform a 25-comment batch flushing every ~1.5s
  // can emit hundreds of lines per minute at log level — washes out real
  // diagnostics. Internal prompt-tuning sessions enable Verbose to read
  // these; production stays quiet.
  for (let i = 0; i < bucket.posts.length; i++) {
    const post = bucket.posts[i];
    const verdict = result.comments[i];
    if (!verdict) continue;
    const preview = post.text.replace(/\s+/g, ' ').slice(0, 100);
    fwDebugDebug(
      `[FW batch-verdict] #${i + 1} sev=${verdict.severity}/10 sent=${verdict.sentiment} tech=${verdict.technique} | "${preview}"`,
    );
  }
  fwDebug(
    `[FW batch-verdict] environment: ${result.environment.label} ` +
    `(neg=${result.environment.negativePct}%, pos=${result.environment.positivePct}%) ` +
    `tox=${result.environment.toxicityScore} ` +
    `slur=${result.environment.slurPrevalencePct}% ` +
    `recid=${result.environment.authorRecidivism} ` +
    `disc=${result.environment.discourseQuality} ` +
    `amp=${result.environment.algorithmicAmplification}`,
  );

  // 1. Per-comment forensic records — each comment is a record, with the
  //    batch's per-comment verdict attached as the synthetic technique.
  //
  // : route by isManipulative. Manipulative comments
  // (overallScore >= 0.5 — typically `comment-batch:negative` with sev 5+
  // techniques like shame-attack / mockery / scapegoating) take FORENSIC_LOG
  // (verdict=flagged). Non-manipulative comments (`comment-batch:positive`
  // with `supportive` technique, `comment-batch:neutral` with `genuine-opinion`
  // or no technique, low-severity negative below threshold) take PASS_LOG
  // (verdict=pass). Pre- all polarities took FORENSIC_LOG which forced
  // verdict=flagged at logger.ts:196 — producing false-positive entries in
  // forensic exports where the technique itself was 'supportive' /
  // 'genuine-opinion'. Routing per the batch-scorer's own isManipulative
  // determination preserves the "FORENSIC_LOG = always flagged" invariant
  // and improves V1 protection-precision per VISION §1.2 / §7.1.
  //
  // Caller-wiring of truncatedIndices: when the LLM response truncated
  // mid-array, the trailing comment slots arrive with the default-empty
  // verdict ('none' / sev 0). Stamping FORENSIC/PASS_LOG with those defaults
  // silently downgrades potentially-harmful comments. Branch
  // those slots to CANCEL_LOG with verdict='cancelled-batch-truncated' so
  // the chain honestly records "FW observed this comment but the LLM did
  // not return a per-comment verdict for it" instead of false-innocence.
  const truncatedSet = new Set(result.truncatedIndices);

  // Two-stage rewrite gate. `batchRewriteEnabled` is the dev emergency
  // kill-switch (default TRUE); `rewritten-comments-first` is the user
  // toggle from popup. Gate is both-AND: dev-flag stays as the team's
  // revert lever, user toggle is the parent control. Flag-off (either)
  // → empty neutralizedText branch at the per-comment loop below.
  const batchPlatform = bucket.posts[0]?.platform;
  // YouTube is capture-only (a standing product decision, 2026-06-07): isCommentRewriteEnabled forces
  // this false for youtube, so the per-comment loop takes the empty-rewrite
  // (capture + mark, no reframe) branch. Other platforms honor the user toggle.
  const userRewriteOn = batchPlatform
    ? isCommentRewriteEnabled(settings, batchPlatform)
    : false;
  const batchRewriteOn = (await isDevFlagEnabled('batchRewriteEnabled')) && userRewriteOn;
  // Still nothing written for this batch: the per-comment routing loop is below.
  if (!batchIsCurrent()) { abandonStaleBatch('cancelled-mid-flight', 'rewrite-gate'); return; }

  // Thread-level language detection across post caption + every comment in
  // the bucket. Short comments routinely fall below MIN_SIGNAL on the
  // per-text detector and silently fall back to settings.locale, which
  // Collect flagged-needs-rewrite entries; emit truncated + PASS immediately.
  // The flagged FORENSIC_LOG dispatch is deferred to a parallel-await pass
  // below so the per-comment 2nd LLM call can populate `neutralizedText`.
  const flaggedToRewrite: Array<{
    sharedFields: Record<string, unknown>;
    analysisLike: Record<string, unknown>;
    text: string;
    technique: string;
    // Inline rewrite from the BATCH classifier (Phase 2B, 2026-05-15).
    // V3 prompt produces neutralized_text in the same call as the
    // verdict; when present, the Promise.all rewrite-pass below uses it
    // directly and skips the per-comment neutralizeText round-trip. When
    // undefined, falls back to neutralizeText.
    inlineRewrite?: string;
    // carry domRef + platform into the parallel-await closure so the
    // rewrite text can be applied to the comment's DOM after Promise.all.
    domRef: WeakRef<HTMLElement>;
    platform: string;
    // post.id needed to key the marker render loop's rewrite lookup.
    postId: string;
    post: PostContent;
    // Harm-floor identity-slur signal lifted onto the item so the empty-
    // rewrite fallback below can promote slur-laden comments to HIDE
    // instead of leaving the original text visible behind a mark-only
    // marker. Defaults to false when the harm-floor pre-classifier didn't
    // run for this comment (legacy / non-supported language).
    identitySlurMatch: boolean;
    // Absent-target hide exemption (present-target.ts), computed at push
    // time where the full verdict (technique / action / overrideOrigin) is
    // in scope. True only for a shame-attack verdict with no deterministic
    // override whose text addresses nobody present (no second-person
    // token, no @-mention, not dehumanizing). Consumed by the empty-
    // rewrite HIDE promotion below: exempt → mark-only fallback, never
    // hide. The flag + forensic record are unaffected.
    absentTargetExempt: boolean;
  }> = [];
  // House-rule swear handling (a locked standing rule: no swearing in this house).
  // A teen/child comment carrying profanity must be acted on even when the AI
  // judged the OPINION benign (genuine-opinion PASS). Posts soften profanity
  // (pipeline.ts:464); comments had no equivalent, so casual swears in passing
  // comments slipped through untouched (found live 2026-06-04: "...the
  // fuckers" left intact). Collected here from the PASS branch and resolved below:
  // soften via the rewriter → silent in-place swap; if no clean rewrite →
  // hide silently. NO marker, and the AI verdict is NOT changed (so the
  // classifier's 0% over-block is preserved — this is a deterministic action
  // layer, not a manipulation flag).
  type PendingProfanitySoften = {
    domRef: WeakRef<HTMLElement>;
    platform: string;
    text: string;
    postId: string;
    post: PostContent;
    sharedFields: Record<string, unknown>;
    analysisLike: Record<string, unknown>;
  };
  const profanitySoften: PendingProfanitySoften[] = [];
  const softenedSilentIds = new Set<string>();

  for (let i = 0; i < bucket.posts.length; i++) {
    const post = bucket.posts[i];
    const verdict = result.comments[i] ?? null;
    // Peek, don't consume: the truncation-cancel branch below must not eat
    // the dedup entry (a cancelled comment re-encountered later this session
    // was skipped here entirely — miss locked in until page reload). The
    // consume happens after the cancel branch, once this iteration is
    // committed to real handling (record + UI).
    if (hasLoggedForensic(forensicDedupKey(post))) {
      reapplyDuplicateTextVerdict(post, protectionsToRetain);
      continue;
    }

    // truncation branch — emit CANCEL_LOG instead of FORENSIC/PASS,
    // BUT only when the Phase 1 deterministic override gate did not fire
    // on this slot. The override gate (comment-batch-scorer.ts lines ~821-
    // 891) iterates over the index-fill defaults (technique='none', sev=0)
    // and escalates when `commentHarmFloors[i]` signals identity-slur or
    // ad-hominem top-category — producing a real verdict (sev≥6 / shame-
    // attack / optional hide action) even on a slot the LLM omitted. If
    // that escalation happened, honoring CANCEL_LOG would silently throw
    // away the deterministic protection-record (chain record stamped
    // "cancelled" instead of "flagged"; DOM-hide skipped). Test the verdict
    // shape: default-after-fill is sev=0 + technique='none' + no action,
    // so any non-default shape means the gate fired. Fall through to the
    // FORENSIC_LOG path with that deterministic verdict.
    const verdictHasDeterministicEscalation =
      verdict !== null &&
      (verdict.severity > 0 || verdict.action === 'hide');
    if (truncatedSet.has(i + 1) && !verdictHasDeterministicEscalation) {
      // Cancel-side dedup only — the main entry stays free so a re-encounter
      // of this comment gets re-scored + rendered instead of skipped.
      if (!shouldLogCancelForensic(forensicDedupKey(post))) continue;
      void sendHighStakesForensicLog({
        type: 'CANCEL_LOG',
        payload: {
          originalText: post.text,
          verdict: 'cancelled-batch-truncated',
          // No analysis — the LLM did not return a verdict for this slot,
          // and the harm-floor gate found no signal to escalate from.
          analysis: undefined,
          mode: settings.mode,
          platform: post.platform,
          author: post.author,
          authorName: post.authorName,
          ...commentRecordRoomFields(roomFields),
          feedSource: post.feedSource ?? 'unknown',
          accountType: post.accountType,
          sourceContainer: post.sourceContainer,
          observedSequence: post.observedSequence,
          viewportSeenAt: post.viewportSeenAt,
          surfaceSessionId: post.surfaceSessionId,
          textCapture: post.textCapture,
          authorCapture: post.authorCapture,
          mediaUrls: mediaUrlsNow(post),
          aiModel: GROQ_FAST_MODEL,
          aiProvider: batchProvider,
          configSnapshot: buildConfigSnapshot(settings.mode, MANIPULATION_SEVERITY_THRESHOLD, settings.dailyCap, settings.features, settings.readFailedFallback),
          kind: 'comment',
          parentVideoId,
        },
      });
      continue;
    }

    // Past the cancel branch: this iteration handles the comment for real
    // (FORENSIC/PASS record + marker/rewrite/hide UI below, some deferred to
    // the rewrite pass) — consume the dedup entry now so re-encounters of a
    // handled comment don't double-record or double-render.
    shouldLogForensic(forensicDedupKey(post));

    const techniques = verdict && verdict.technique !== 'none' && verdict.technique !== 'neutral'
      ? [{ name: verdict.technique, severity: verdict.severity, confidence: verdict.confidence ?? 0.5, reason: verdict.reason }]
      : [];
    // overallScore is severity 0-10 across all chain writers (forensic.ts and
    // dashboard SeverityBadge expect this scale). Pre-this fix the value was
    // verdict.severity / 10 which produced 0-1 confidence-like values in the
    // chain — visually low-severity green badges on legitimately-flagged
    // records. overallConfidence carries the 0-1 form for callers that want it.
    const overallScore = verdict ? verdict.severity : 0;
    // isManipulative gates whether the comment routes to FORENSIC_LOG + the
    // Groq rewrite/hide branch (true) or PASS_LOG (false). The gate logic is
    // the single canonical `isManipulative` from comment-batch-scorer.ts —
    // shared verbatim with the corpus harnesses so the measured pass/flag
    // boundary cannot drift from the shipped one (severity ≥ THRESHOLD and a
    // manipulation technique, OR an `action:'hide'` override).
    const analysisLike = {
      techniques: techniques.map(t => ({
        technique: t.name as never,
        present: t.severity > 0,
        severity: t.severity,
        confidence: t.confidence,
        // Dropped until gem 77: the judge's reason (logger.ts's confirmedTechniques
        // reads this array into the record's `why`), so every batch comment technique
        // carried a name and a number with no explanation at all.
        evidence: t.reason ? [t.reason] : [],
      })),
      overallScore,
      overallConfidence: verdict ? (verdict.confidence ?? 0.5) : 0,
      isManipulative: verdict ? isManipulative(verdict) : false,
    };
    const sentiment = verdict?.sentiment ?? 'unknown';
    // per-comment harm-floor signal stamped on the
    // chain record. Pulled from the parallel array `result.commentHarmFloors`
    // (populated by `enrichWithHarmFloor` in scoreBatch). Recipient reads
    // "FW pre-classified this comment with HF=65 dominated by identity-
    // slur match" alongside the LLM verdict — Layer-1 evidence independent
    // of LLM output (per VISION §1.1 forensic completeness).
    const hf = result.commentHarmFloors?.[i];
    const harmFloorStamp = hf
      ? {
          score: hf.score,
          topCategory: hf.top_category,
          topEvidence: hf.top_evidence,
          identitySlurMatch: hf.identity_slur_match,
          language: hf.language,
        }
      : undefined;
    const sharedFields = {
      originalText: post.text,
      ...postPayloadBase(post, settings.mode, 'cloud', roomFields.postUrl),
      ...commentRecordRoomFields(roomFields),
      // Per-comment deep-link when the adapter captured one (X reply status
      // URL, IG /c/ link). Undefined on platforms with no per-comment URL
      // (TikTok) → export falls back to postUrl.
      anchorUrl: post.anchorUrl,
      accountType: post.accountType,
      sourceContainer: post.sourceContainer,
      observedSequence: post.observedSequence,
      viewportSeenAt: post.viewportSeenAt,
      surfaceSessionId: post.surfaceSessionId,
      textCapture: post.textCapture,
      authorCapture: post.authorCapture,
      mediaUrls: mediaUrlsNow(post),
      aiModel: GROQ_FAST_MODEL,
      aiProvider: batchProvider,
      detectionMode: `comment-batch:${sentiment}`,
      // Config at capture time (board #6a): the comment gate is the fixed
      // batch threshold, not settings.threshold (posts-path calibration).
      configSnapshot: buildConfigSnapshot(settings.mode, MANIPULATION_SEVERITY_THRESHOLD, settings.dailyCap, settings.features, settings.readFailedFallback),
      kind: 'comment' as const,
      parentVideoId,
      // Phase A — denormalized room context. Each comment record
      // carries the video's author + caption (truncated) + URL inline so
      // the recipient (judge / school counselor / parent) reads the record
      // as self-contained: "this comment by @userX is on a video by
      // @creatorY with caption 'Z' at URL ..." — no JOIN needed against
      // the video chain entry.
      // commentDepth is derived from the per-platform extractor's depth
      // walk (X permalink ancestry, FB ancestor stem walk, YT
      // [is-reply] attribute, IG/TT default 1). The schema is 0-indexed
      // (0=top-comment, 1=reply, 2=reply-to-reply); the extractor field is
      // 1-indexed, so chainCommentDepth subtracts 1. parentRecordId remains
      // undefined here — parent-id-by-DOM-anchor resolution is V1.5.
      commentDepth: chainCommentDepth(post.depth),
      // per-comment harm-floor pre-classification (undefined when
      // pre-filter found zero signal; canonical-payload omits → no hash
      // change for back-compat with pre-records).
      harmFloor: harmFloorStamp,
      // per-item engagement metrics captured from the comment DOM before
      // FW hid them (likes / reply_count / creator-heart). Undefined when
      // the adapter captured nothing; canonical-payload omits → no hash
      // change for metric-less records.
      metrics: recordMetricsFromPostContent(post),
      // Honest override provenance — set on the verdict by the post-LLM override
      // gate (identity-slur / coded-harm / ad-hominem / profanity-tier);
      // undefined for AI-origin verdicts. Carried into the chain so the record
      // distinguishes a deterministic rule-catch from an AI diagnosis (the
      // override relabels `technique`, so without this the record would imply
      // the AI judged what a regex caught). Flows to FORENSIC_LOG + the deferred
      // rewrite path + PASS_LOG via this shared base.
      overrideOrigin: verdict?.overrideOrigin,
      ...householdFields(i),
    };
    if (analysisLike.isManipulative) {
      if (verdict?.action === 'hide') {
        // hide-tier. Identity-slur sev≥8 content routes to DOM-hide instead
        // of rewrite. The forensic record says hide only after the terminal
        // DOM state is proven; an unresolved target stays an honest flag.
        // Skips the rewrite call entirely — slur-laden content does not rewrite
        // cleanly on small models (empty output / safety-refusal / synonym
        // swap) so the rewrite path is structurally unfit for this category.
        recordCommentHideOutcome(post, sharedFields, analysisLike);
      } else if (batchRewriteOn && verdict && verdict.technique !== 'none') {
        // defer FORENSIC_LOG dispatch until rewrite resolves (inline from
        // BATCH V3 when present, or per-comment neutralizeText fallback).
        flaggedToRewrite.push({
          sharedFields: sharedFields as unknown as Record<string, unknown>,
          analysisLike: analysisLike as unknown as Record<string, unknown>,
          text: post.text,
          technique: verdict.technique,
          inlineRewrite:
            typeof verdict.neutralizedText === 'string' && verdict.neutralizedText.trim().length > 0
              ? verdict.neutralizedText
              : undefined,
          domRef: post.domRef,
          platform: post.platform,
          postId: post.id,
          post,
          identitySlurMatch: hf?.identity_slur_match === true,
          absentTargetExempt: isAbsentTargetInterventionExempt(verdict, post.text),
        });
      } else {
        // Flag off, OR no technique to anchor a rewrite (defensive) → preserve
        // pre-behavior with empty neutralizedText.
        void sendHighStakesForensicLog({
          type: 'FORENSIC_LOG',
          payload: {
            ...sharedFields,
            neutralizedText: '',
            analysis: analysisLike,
            decision: commentDecision(sharedFields as unknown as Record<string, unknown>, analysisLike as unknown as Record<string, unknown>, 'mark', { attempted: false, outcome: 'off' }, post.platform),
            reader: READER_DEFAULT,
          },
        });
      }
    } else {
      // House-rule swear handling: a passing comment with profanity is
      // collected for a silent soften-or-hide pass (resolved after the
      // rewrite pass below). Detection is deterministic (regex match); mode is
      // irrelevant to .filtered. Defer the log until the action is known so the
      // chain record reflects what FW actually did.
      // Blanket softening = the soften-swearing toggle (child preset seeds
      // it ON; wiring Q4), or any mode when the parent enabled
      // `strictLanguage`. Slur tier + detected attacks are unaffected.
      const softenSwears = blanketProfanitySoften(settings, post.platform);
      if (
        softenSwears &&
        post.domRef &&
        filterProfanity(post.text, settings.mode, { tier: 'profanity' }).filtered
      ) {
        profanitySoften.push({
          domRef: post.domRef,
          platform: post.platform,
          text: post.text,
          postId: post.id,
          post,
          sharedFields: sharedFields as unknown as Record<string, unknown>,
          analysisLike: analysisLike as unknown as Record<string, unknown>,
        });
        softenedSilentIds.add(post.id);
      } else {
        rememberSessionPass(post);
        void sendHighStakesForensicLog({
          type: 'PASS_LOG',
          payload: {
            ...sharedFields,
            analysis: analysisLike,
            passReason: `comment-batch-${sentiment}`,
          },
        });
      }
    }
  }

  // parallel rewrite pass for flagged comments. Each call goes through
  // the FeelingWise proxy, which rate-limits per-license server-side, so
  // concurrency is throttled at the network layer; we don't need to
  // sequence here. Per-call failure → empty rewrite (graceful) so the
  // chain still gets a FORENSIC_LOG record with the original text +
  // technique label.
  //
  // defer the DOM-swap of the
  // rewrite into `pendingSwaps`. The original applied it inline
  // here, but the marker render loop below calls `verifyAnchorMatch`
  // which recomputes the anchor from `liveElement.textContent`. Once
  // we'd already swapped the text, the recomputed anchor became
  // `id::REWRITE_TEXT_SLICE` while the enqueueAnchor was still
  // `id::ORIGINAL_TEXT_SLICE` → mismatch → 'dom-recycled' verdict →
  // marker render skipped + CANCEL_LOG. Live verification on an X
  // profile with multiple flagged comments confirmed marker count
  // dropped 7→2 after the swap because the anchor-revalidation saw
  // post-swap text. Fix: collect swaps here, apply AFTER the marker
  // loop.
  // M61 (2026-09-06): the rewrite's chain record is written AFTER the swap
  // resolves, so a Child fallback hide is recorded as a hide and not as the
  // rewrite that never landed. `record` carries the fields the emit needs;
  // `flushDeferredSwapRecords` writes them as unresolved when the batch goes
  // stale before the swap loop runs (it wrote them as applied rewrites until
  // 2026-09-19, which said the page had been changed when it had not).
  type PendingCommentSwap = {
    domRef: WeakRef<HTMLElement>;
    platform: string;
    rewrite: string;
    post: PostContent;
    /**
     * Which policy asked for this swap (2026-09-19). Both kinds ride this one
     * array, and without a word for the difference they took the same Child
     * fallback: a mask that failed to land hid the comment, which the swear
     * policy forty lines down says never happens.
     */
    kind?: 'rewrite' | 'mask';
    /** Present when a model wrote `rewrite`; a mask has none. */
    writer?: AiWriter;
    record: { sharedFields: Record<string, unknown>; analysisLike: Record<string, unknown> };
  };
  const pendingSwaps: PendingCommentSwap[] = [];
  // Q69 (W66): the marker loop's anchor verification + recycle recovery,
  // resolved ONCE per post and shared with the swap loop below. Without
  // this the swap re-deref'd the RECYCLED node while the marker mounted on
  // the recovered one: a green dot on an untouched toxic comment, the
  // rewrite written into an unrelated one. null = verified-unusable (swap
  // must skip, not guess); absent = the marker pass never verified this
  // post (swap falls back to its own deref, the old behavior).
  const resolvedAnchorByPost = new Map<PostContent, HTMLElement | null>();
  /**
   * The same verification the marker pass does, for a post the marker pass
   * never reached (2026-09-19).
   *
   * The marker pass runs only when show-reframe-markers is on, so before this
   * existed a cosmetic toggle decided whether a swap checked that it was still
   * writing into the comment it had scored. Both calls are pure reads of the
   * DOM, so running them here costs nothing and cannot disturb the marker
   * pass's own answer, which is used unchanged whenever it exists.
   *
   * Returns null for verified-unusable, which the caller treats the same way it
   * treats the marker pass's null: skip, never guess.
   */
  const resolveSwapAnchor = (post: PostContent): HTMLElement | null => {
    const verification = verifyAnchorMatch(computeAnchorKey(post), post, post.domRef);
    if (verification === 'match') return post.domRef.deref() ?? null;
    if (verification === 'dom-recycled') {
      return tryRecoverCommentAnchor(post.domRef, post.text, post.platform);
    }
    // 'dom-gone': the WeakRef is cleared, and a fingerprint walk over the whole
    // document could land on an unrelated comment. The marker pass refuses
    // recovery here for the same reason.
    return null;
  };
  // comment-batch path needs the resolved rewrite text at marker
  // render time so the v3 toggle's GREEN state restores from the closure-
  // bound rewrite (not a post-swap DOM snapshot that could capture the
  // ORIGINAL when the rewrite was rejected). Built keyed by post.id;
  // marker loop below skips comments with no entry.
  const rewriteByPostId = new Map<string, string>();
  const writerByPostId = new Map<string, AiWriter>();

  const recordedSwaps = new Set<PendingCommentSwap>();
  /**
   * The record for one swap, from what the page ended up showing.
   *
   * 'unresolved' was added 2026-09-19 and it is the reason this comment exists.
   * The signature had two values, so every terminal that was not 'hidden' was
   * written as a rewrite that had been applied: a swap whose in-place text
   * change did not land, a swap abandoned because the batch went stale before
   * the loop ran, a swap whose element was gone, a swap that threw. None of
   * those touched the page. All of them signed a record saying the reader had
   * been shown softened text, while the original comment was still on screen.
   *
   * The line that called this already said the rule, M61: "the chain hears what
   * happened, not what was attempted." It could not keep it, because the
   * vocabulary it was given had no word for "nothing happened".
   *
   * The decision block has a sentence for it, NOTE_NOT_APPLIED: "the page could
   * not apply the action; the item stayed as the record says under applied". A
   * legacy row keeps its own action, so decisionForLegacy does not write it here;
   * commentDecision adds it for an allow with the rewrite marked failed.
   * neutralizedText is empty, because that field is what the reader was shown
   * and the reader was shown nothing of the sort.
   */
  /** The writer the page's AI mark names on a landed rewrite, read from the page; null when unmarked. */
  const markedWriter = (entry: CommentEntry, swap: PendingCommentSwap): AiWriter | null =>
    entry.textEl.getAttribute(AI_TEXT_ATTR) === 'rewrite' ? swap.writer ?? null : null;
  const sendSwapRecord = (
    swap: PendingCommentSwap,
    outcome: 'rewrite' | 'hidden' | 'unresolved',
    /** Read only for a landed rewrite: the writer its record names. */
    shownWriter: AiWriter | null = null,
  ): void => {
    if (recordedSwaps.has(swap)) return;
    recordedSwaps.add(swap);
    // A mask swap already carries its own block in sharedFields; a rewrite
    // swap gets the legacy row with the rewrite applied, and the Child
    // fallback hide gets the row with a hide applied and the rewrite failed.
    const hasOwnBlock = !!(swap.record.sharedFields as { decision?: unknown }).decision;
    const platform = swap.platform as PostContent['platform'];
    if (outcome === 'unresolved') {
      void sendHighStakesForensicLog({
        type: 'FORENSIC_LOG',
        payload: {
          ...swap.record.sharedFields,
          neutralizedText: '',
          analysis: swap.record.analysisLike,
          // A mask carries its own block, which says the stars were applied; when they did not land
          // the words stayed as served, and the block must say that.
          ...(swap.kind === 'mask'
            ? {
                decision: decisionForMask(settings.mode, undefined, { applied: 'allow', rewrite: { attempted: true, outcome: 'failed' } }),
                reader: READER_DEFAULT,
              }
            : hasOwnBlock ? {} : {
              decision: commentDecision(
                swap.record.sharedFields, swap.record.analysisLike, 'allow',
                { attempted: true, outcome: 'failed' }, platform,
              ),
              reader: READER_DEFAULT,
            }),
        },
      } as unknown as Extract<FWMessage, { type: 'FORENSIC_LOG' }>);
      return;
    }
    const payload: Record<string, unknown> = outcome === 'rewrite'
      ? {
          ...swap.record.sharedFields,
          neutralizedText: swap.rewrite,
          analysis: swap.record.analysisLike,
          ...(hasOwnBlock ? {} : { decision: commentDecision(swap.record.sharedFields, swap.record.analysisLike, 'soften', rewriteStage(true, shownWriter), platform), reader: READER_DEFAULT }),
        }
      : {
          ...swap.record.sharedFields,
          neutralizedText: '',
          analysis: { ...swap.record.analysisLike, action: recordedCommentHideAction(true) },
          ...(hasOwnBlock ? {} : { decision: commentDecision(swap.record.sharedFields, swap.record.analysisLike, 'hide', { attempted: true, outcome: 'failed' }, platform), reader: READER_DEFAULT }),
        };
    void sendHighStakesForensicLog({ type: 'FORENSIC_LOG', payload } as unknown as Extract<FWMessage, { type: 'FORENSIC_LOG' }>);
  };
  /**
   * Every swap still pending when the batch stops: the loop either never ran
   * (the batch went stale) or skipped this one (no element, a stale post, a
   * throw). None of them changed the page, so none of them is a rewrite.
   * They were written as applied rewrites until 2026-09-19.
   */
  const flushDeferredSwapRecords = (): void => {
    for (const swap of pendingSwaps) sendSwapRecord(swap, 'unresolved');
  };

  if (flaggedToRewrite.length > 0) {
    // Inline rewrites from BATCH V3 (Phase 2B): when the classifier
    // produced `neutralized_text` in the same call as the verdict, use
    // it directly and skip the per-comment neutralizeText round-trip.
    // Backwards-compat: items without an inline rewrite (V2-shaped
    // responses, or model shape drift that omitted the field) fall back to
    // neutralizeText. Both paths are multilingual since the 2026-05-21
    // i18n fix — the BATCH prompt + the per-comment rewriter both honor
    // FWSettings.outputLanguage (auto-detect or explicit). Prompt-side
    // language instructions are ~80% reliable; the post-resolve gate
    // below catches drift on both paths so a RO comment never lands as
    // an EN rewrite (and vice versa).
    // Per-batch diagnostic counters. Surface why rewrites land or drop —
    // before this logging the BATCH V3 inline-rewrite path silently
    // returned '' on validator rejection, leaving no trail in console
    // about WHY a flagged comment got mark-only instead of GREEN-state
    // rewrite. Single console.log per batch (no errors-page noise) so
    // operator can grep `[FW batch-rewrite]` in DevTools.
    const rewriteStats = {
      flagged: flaggedToRewrite.length,
      inlinePresent: 0,
      fallbackTried: 0,
      fallbackEmpty: 0,
      validated: 0,
      rejections: {} as Record<string, number>,
    };
    // Who wrote each rewrite, for the page's AI mark: the batch's own reply for
    // an inline rewrite, the rewrite call's reply for the rest. The inline
    // rewrites come from the last batch reply that returned text, which is the
    // retry's when a cut reply was asked again.
    const batchWriter = latestModelFor(batchCalls.signal) ?? undefined;
    const writers: AiWriter[] = flaggedToRewrite.map(item =>
      item.inlineRewrite && batchWriter ? { model: batchWriter } : {});
    const rewrites = await Promise.all(
      flaggedToRewrite.map(async (item, j) => {
        if (item.inlineRewrite) {
          rewriteStats.inlinePresent++;
        } else {
          rewriteStats.fallbackTried++;
        }
        const rewrite = item.inlineRewrite
          ? item.inlineRewrite
          : await neutralizeText({
              text: item.text,
              technique: item.technique,
              onWriter: (model) => { writers[j] = { model }; },
            }).catch(() => '');
        if (!rewrite) {
          if (!item.inlineRewrite) rewriteStats.fallbackEmpty++;
          return '';
        }
        // Full voice-rule validator stack. Same 8 guards the per-comment
        // fallback `neutralizeText` runs internally — running them here
        // closes the parity gap so the BATCH V3 inline-rewrite path
        // doesn't ship register-flattened / meta-talk / advisory-
        // injected / length-blown-up / language-drifted output. Rejection
        // returns '' which flows into the existing isUnrewritable HIDE
        // branch when severity + technique warrant, else into the
        // mark-only fallback.
        const validation = validateRewrite(rewrite, item.text);
        if (!validation.valid) {
          const reason = validation.reason ?? 'unknown';
          rewriteStats.rejections[reason] = (rewriteStats.rejections[reason] ?? 0) + 1;
          return '';
        }
        rewriteStats.validated++;
        return rewrite;
      }),
    );
    // 2026-09-18: a bare return used to stand here, and this is the one stale
    // check that dropped exactly the HARMFUL half of a bucket. Everything else
    // in the batch already has its record by now — the passes, the masks that
    // will be written with their swap, the truncations, the hides — because
    // only the FLAGGED comments have their record deferred until the reframe
    // resolves. Each of them has a verdict and consumed its dedup entry in the
    // routing loop above, so nothing else would ever write for them.
    //
    // What is honest here is not a cancel: the comment WAS judged, and the page
    // showed the original because no reframe landed. That is the record the
    // empty-rewrite branch below already writes, so write that one, with the
    // rewrite marked attempted and failed. Then stop: the swap loop, the marker
    // loop and the hide terminals below are DOM work on a surface the reader
    // has left.
    if (!batchIsCurrent()) {
      for (const item of flaggedToRewrite) {
        void sendHighStakesForensicLog({
          type: 'FORENSIC_LOG',
          payload: {
            ...item.sharedFields,
            neutralizedText: '',
            analysis: item.analysisLike,
            decision: commentDecision(item.sharedFields, item.analysisLike, 'mark', { attempted: true, outcome: 'failed' }, item.platform as PostContent['platform']),
            reader: READER_DEFAULT,
          },
        } as unknown as Extract<FWMessage, { type: 'FORENSIC_LOG' }>);
      }
      // The mask never reached the page either, so these comments are what the
      // routing loop already judged them: passes, with their swearing intact.
      for (const item of profanitySoften) {
        rememberSessionPass(item.post);
        void sendHighStakesForensicLog({
          type: 'PASS_LOG',
          payload: {
            ...item.sharedFields,
            analysis: item.analysisLike,
            passReason: typeof item.sharedFields.detectionMode === 'string'
              ? item.sharedFields.detectionMode
              : 'comment-batch-unknown',
          },
        } as unknown as Extract<FWMessage, { type: 'PASS_LOG' }>);
      }
      if (settings.mode === 'child') {
        // No terminal landed for any of them; a cover that comes off here
        // uncovers a comment this batch flagged.
        for (const post of bucket.posts) protectionsToRetain.add(post);
      }
      fwDebug(
        `[FW comment-batch] gave up a stale bucket at rewrite-resolve: ` +
        `${flaggedToRewrite.length} flag(s) and ${profanitySoften.length} mask(s) written unapplied ` +
        `parentVideoId=${parentVideoId}`,
      );
      return;
    }
    console.log(
      `[FW batch-rewrite] platform=${bucket.platform} flagged=${rewriteStats.flagged} ` +
        `inline=${rewriteStats.inlinePresent} fallback=${rewriteStats.fallbackTried} ` +
        `fallback-empty=${rewriteStats.fallbackEmpty} validated=${rewriteStats.validated} ` +
        `rejections=${JSON.stringify(rewriteStats.rejections)}`,
    );
    // Cross-comment duplicate-rewrite guard (neutralizer.ts). The per-comment
    // validateRewrite stack above can't see that ≥2 DISTINCT comments got the
    // SAME bland rewrite; blank those here so they fall through to the HIDE /
    // mark-only path below instead of shipping one generic sentence for all
    // (X probe, 2026-06-03: three distinct toxic comments → identical
    // "I think this conversation is toxic").
    const duplicateRewriteIdx = findDuplicateRewriteIndices(
      rewrites,
      flaggedToRewrite.map((it) => it.text),
    );
    if (duplicateRewriteIdx.size > 0) {
      for (const j of duplicateRewriteIdx) rewrites[j] = '';
      console.log(
        `[FW batch-rewrite] cross-comment duplicate guard blanked ${duplicateRewriteIdx.size} identical rewrites for distinct comments`,
      );
    }
    for (let j = 0; j < flaggedToRewrite.length; j++) {
      const item = flaggedToRewrite[j];
      const rewrite = rewrites[j];
      // Empty-rewrite + high-severity manipulation → promote to HIDE.
      // Mark-only (RED/YELLOW) was the original fallback for empty rewrites
      // so parents could see WHICH comments FW touched. But it leaves the
      // original toxic text visible to the child, defeating protection
      // when the LLM safety-refused (slur class), the validator rejected
      // the rewrite, or the rewrite text drifted empty for any reason.
      // Gate on the LLM's own severity + technique judgment rather than
      // regex stem matches — covers Romanian dehumanization, localized
      // epithets, and inflected variants the English slur dictionary
      // misses. Lower-severity empties keep the mark-only behavior so a
      // mid-tier shame-attack the LLM couldn't quite phrase isn't hidden
      // wholesale.
      const sev = typeof item.analysisLike.overallScore === 'number'
        ? item.analysisLike.overallScore
        : 0;
      const technique = item.technique;
      // The small-model rewriter LAUNDERS dehumanization: a calm first-person rewrite of
      // "exterminate the parasites" / "burn them with the residents inside"
      // reads as reasoned concern and shipped GREEN on a real 2026-06-04 chain
      // ("...burned down with the 'zoo residents' inside" -> "the house should
      // be held accountable"). The SURFACE validators (length/register/voice)
      // cannot catch semantic laundering. The dehumanization filter — already
      // run for POSTS at pipeline.ts Step 0c but NOT for comments — is the
      // proven, FP-guarded gate for this; when it fires, HIDE regardless of
      // whether the model produced a (laundered) rewrite. Mirrors the post path.
      const isDehumanizing = detectDehumanization(item.text).triggered;
      // Harm-laundering: the original carries explicit lethal/violent-harm
      // language and the model's rewrite scrubbed ALL of it ("you deserve death
      // by hanging" -> "deserves justice"). The surface validators pass the
      // sanitized version; this catches the semantic LOSS and routes to HIDE so
      // FW never ships a calm rewrite of violence. Verified against the real
      // laundered pairs on a real 2026-06-04 chain.
      const isHarmLaundered = !!rewrite && detectHarmLaundering(item.text, rewrite);
      // Absent-target hide exemption (shame-attack ONLY, present-target.ts):
      // an empty-rewrite shame-attack aimed at nobody present — public
      // figures, absent third parties — falls back to mark-only instead of
      // hide, so critical speech that never addressed the child stays
      // readable behind its marker. Scapegoating never exempts: group
      // victims are never "present", so a presence test would exempt
      // genuine group smears (docs/history/archive/MECH8-REPORT-2026-07-24.md diagnosis).
      // Dehumanization / harm-laundering / identity-slur hides are
      // untouched, as are the flag gate and the forensic record.
      const isUnrewritable = isDehumanizing || isHarmLaundered || (!rewrite && (
        item.identitySlurMatch ||
        (sev >= 7 && (
          (technique === 'shame-attack' && !item.absentTargetExempt) ||
          technique === 'scapegoating' ||
          technique === 'anger-trigger' ||
          technique === 'fear-appeal'
        )) ||
        // Child only (2026-09-07): a confirmed flag whose rewrite came back
        // empty or rejected stays a visible mark in Teen and Adult; a rewrite
        // failure never becomes a hide (invariant 2). Same predicate as the
        // posts path (core/pipeline.ts hideOnRewriteUnavailable).
        hideOnRewriteUnavailable(settings.mode)
      ));
      if (!isUnrewritable && !rewrite && sev >= 7 && technique === 'shame-attack' && item.absentTargetExempt) {
        // A gate that withholds protection must say so once, with the
        // reason (lesson 2026-06-12): this comment would have hidden but
        // for the absent-target exemption; it stays visible behind its
        // marker.
        console.log(
          `[FW absent-target] shame-attack sev=${sev} hide exempted (no present target) — mark-only fallback`,
        );
      }
      if (isUnrewritable) {
        recordCommentHideOutcome(item.post, item.sharedFields, item.analysisLike);
        continue;
      }
      if (!rewrite) {
        void sendHighStakesForensicLog({
          type: 'FORENSIC_LOG',
          payload: {
            ...item.sharedFields,
            neutralizedText: '',
            analysis: item.analysisLike,
            decision: commentDecision(item.sharedFields, item.analysisLike, 'mark', { attempted: true, outcome: 'failed' }, item.platform as PostContent['platform']),
            reader: READER_DEFAULT,
          },
        });
      }
      if (rewrite) {
        const writer = writers[j];
        pendingSwaps.push({
          domRef: item.domRef, platform: item.platform, rewrite, post: item.post, writer,
          record: { sharedFields: item.sharedFields, analysisLike: item.analysisLike },
        });
        rewriteByPostId.set(item.postId, rewrite);
        writerByPostId.set(item.postId, writer);
        // Reuse this reframe if the same comment is later opened on its own
        // permalink (where it flows through the per-post pipeline) or re-scrolled.
        void primeReframeCache(bucket.platform, item.text, item.post.parentText, item.analysisLike, rewrite, settings, writer.model);
      }
    }
  }

  // The swear mask (2026-09-07): the collected passing-but-profane comments
  // get their vulgar words starred in place by the filter that found them.
  // No rewriter, so no empty rewrite and no hide: a comment that only swears
  // is never hidden (docs/design/POLICY-TABLE-2026-09-07.md). NO marker (these
  // ids are skipped in the marker loop). The chain record carries the masked
  // text and a 'profanity' label appended to the AI's verdict so the parent
  // sees what FW did and why.
  if (profanitySoften.length > 0) {
    let masked = 0;
    for (const item of profanitySoften) {
      const mask = maskProfanity(item.text).masked;
      if (mask === item.text) continue;
      const existingTechs = Array.isArray(item.analysisLike.techniques)
        ? (item.analysisLike.techniques as unknown[])
        : [];
      const profTech = { name: 'profanity', severity: 4, confidence: 0.95 };
      const baseAnalysis = { ...item.analysisLike, techniques: [...existingTechs, profTech] };
      pendingSwaps.push({
        domRef: item.domRef, platform: item.platform, rewrite: mask, post: item.post,
        kind: 'mask',
        record: {
          sharedFields: {
            ...item.sharedFields,
            detectionMode: 'profanity-mask',
            aiSource: 'rules',
            decision: decisionForMask(settings.mode),
            reader: READER_DEFAULT,
          },
          analysisLike: baseAnalysis,
        },
      });
      masked++;
    }
    console.log(`[FW profanity-mask] platform=${bucket.platform} masked=${masked} (silent, verdict unchanged)`);
  }

  // 2. Environment record — one per video. Holds the aggregate "room" verdict.
  // Await the SEPARATE room-sensor call (started right after scoreBatch): its
  // named summary + structured fields enrich the record. null → scoreBatch's
  // basic environment is used unchanged (graceful degradation).
  const room = await roomPromise;
  if (!batchIsCurrent()) { flushDeferredSwapRecords(); return; }

  // The room read stops being write-only here (PLAN-2026-09-14 standing
  // decision 3; the write-only finding is docs/audits/2026-09-07-xray/). If a
  // caption-less post under this same parent is holding its one record and
  // waiting for its room, this batch is that room: hand it the verdict, which
  // is the most severe comment the batch judged manipulative, plus the room's
  // own summary line. Costs no model call: both calls were already made for
  // the comments themselves.
  settleRoomVerdict(
    bucket.platform,
    parentVideoId,
    roomVerdictFromBatch(result, room, batchProvider),
  );
  void sendHighStakesForensicLog({
    type: 'ENVIRONMENT_LOG',
    payload: {
      platform: bucket.platform,
      mode: settings.mode,
      parentVideoId,
      postUrl: roomFields.postUrl,
      videoCaption: roomFields.videoCaption,
      feedSource: bucket.feedSource,
      aiModel: GROQ_FAST_MODEL,
      aiProvider: batchProvider,
      // Surface session the comment section was observed in. Every bucketed
      // comment was stamped at the onPostDetected chokepoint, so the first
      // post's id IS this load's session id; the direct constant is the
      // fallback for the impossible empty read.
      surfaceSessionId: bucket.posts[0]?.surfaceSessionId ?? surfaceSessionId,
      environment: {
        label: result.environment.label,
        summary: room?.summary || result.environment.summary,
        dominantTechnique: result.environment.dominantTechnique,
        // Structured room analysis from the separate scoreRoom call (BETA);
        // omitted when the room call returned null so legacy records hash
        // unchanged.
        ...(room
          ? {
              claimVsReaction: room.claimVsReaction,
              commentManipulation: room.commentManipulation,
              audienceDistress: room.audienceDistress,
              // Content-topic labels (what the post IS about) — omitted when
              // the model gave none so the hashed struct stays minimal.
              ...(room.topicLabels.length ? { topicLabels: room.topicLabels } : {}),
            }
          : {}),
        negativePct: result.environment.negativePct,
        positivePct: result.environment.positivePct,
        neutralPct: result.environment.neutralPct,
        sampled: result.batchSize,
        // Layer-2 room-toxicity signals + algorithmic-
        // amplification proxy. Persisted with the environment record so the
        // parent dashboard can surface "your child saw a 67-toxicity pile-on
        // room with HIGH algorithmic amplification" without re-deriving from
        // per-comment records. Layer-1 (per-comment harm-floor) lives on
        // each comment record's `harmFloor` field; Layer-2 here is the
        // aggregate the room-summary card reads.
        toxicityScore: result.environment.toxicityScore,
        slurPrevalencePct: result.environment.slurPrevalencePct,
        authorRecidivism: result.environment.authorRecidivism,
        discourseQuality: result.environment.discourseQuality,
        algorithmicAmplification: result.environment.algorithmicAmplification,
        // totalVisible + metrics are added in a later wire — extracting raw
        // counts from the page DOM lives in the engagement controller and
        // hasn't been threaded through to here yet.
      },
    },
  });

  // 3. per-comment marker injection. Toxic comments get a tap-able
  // severity dot when the parent has the per-platform show-reframe-markers
  // toggle ON. Per a standing cycle directive, 2026-05-10 ("small dot on every
  // post FeelingWise rewrote or folded"), the marker now renders in BOTH
  // child and teen modes — the toggle is the single gate. Earlier
  // Foundation-Brief "child mode always silent" rule has been superseded.
  if (bucket.posts.length > 0) {
    const platform = bucket.posts[0].platform;
    const showMarkers = isFeatureEnabled(settings, 'show-reframe-markers', platform);
    if (showMarkers) {
      let markersRendered = 0;
      for (let i = 0; i < bucket.posts.length; i++) {
        const post = bucket.posts[i];
        const verdict = result.comments[i];
        if (!verdict) continue;
        // House-rule swear handling is SILENT: a comment that was softened/
        // hidden only because it carried profanity (not for manipulation) gets
        // no marker. Its DOM swap/hide is already queued in pendingSwaps/Hides.
        if (softenedSilentIds.has(post.id)) continue;
        // Marker visibility tracks FW intervention, not classifier taxonomy.
        // When a rewrite has been applied, the parent must see the marker
        // (VISION §1.2 explainability) regardless of whether the technique
        // is a manipulation class or a benign-but-rewritten class such as
        // genuine-opinion at high severity. The marker title falls back to
        // a generic "Pattern detected" string when `primaryTechnique` is
        // undefined (titledTechnique below).
        //
        // When NO rewrite is in hand — validator-rejected or upstream
        // skipped — the marker still renders for any confirmed flag
        // (technique class + severity floor, see shouldRenderNoRewriteMarker
        // in comment-batch-scorer.ts). The gate deliberately ignores
        // sentiment polarity: warm-toned confirmed concerns
        // (parasocial-coercion, toxic-positivity, fomo) must not be
        // invisible on screen.
        const commentRewrite = rewriteByPostId.get(post.id);
        if (!commentRewrite && !shouldRenderNoRewriteMarker(verdict)) continue;
        if (!isCurrentClassification(post)) continue;
        // anchor-revalidation render-gate
        // for per-comment markers. Comment DOM nodes get recycled by virtualizers
        // (TikTok/IG/X comment lists) just like post nodes; without this gate a
        // toxic-comment marker could land on the wrong comment after recycle.
        // The legacy `if (!el) continue` silently dropped dom-gone cases — 
        // closes that gap by stamping a chain record so VISION §1.1 "every
        // observed post produces a chain record" holds for comments too.
        const verification = verifyAnchorMatch(computeAnchorKey(post), post, post.domRef);
        let el: HTMLElement | null = verification === 'match' ? post.domRef.deref()! : null;
        // Recovery: when the platform virtualizer recycles the comment node
        // between enqueue and verdict-arrival (X home-feed scroll, IG/TT/YT
        // lazy-load shifts), look for a sibling comment whose live text
        // fingerprint matches the enqueue-time text. Returns the recovered
        // text-element (the marker host) or null when no sibling matches.
        // 'dom-gone' (WeakRef cleared) skips recovery — fingerprint walk over
        // document.body could false-positive onto an unrelated comment.
        if (!el && verification === 'dom-recycled') {
          el = tryRecoverCommentAnchor(post.domRef, post.text, post.platform);
        }
        // Q69 (W66): publish the verified/recovered anchor (or the verified
        // failure) so the pendingSwaps loop mutates the SAME element the
        // marker mounted on, never the recycled original.
        resolvedAnchorByPost.set(post, el);
        if (!el) {
          const cancelVerdict = cancelVerdictFor(verification);
          if (cancelVerdict !== null && shouldLogForensic(forensicDedupKey(post))) {
            const commentAnalysis: AnalysisResult = {
              postId: post.id,
              // Carry the batch verdict's real label into the SIGNED record.
              // Pre-fix this was `[]` — the verdict's technique + reason were
              // dropped, so AI-classified items appeared label-less in the
              // forensic chain (343/585 records empty on a real 2026-06-04
              // export). The technique enum is the legally precise label; the
              // reason rides in `explanation` (persisted separately).
              techniques: verdictTechniques(verdict.technique, verdict.severity, verdict.reason, verdict.confidence),
              overallScore: verdict.severity,
              overallConfidence: verdict.confidence ?? 0.5,
              isManipulative: true,
              processingTimeMs: 0,
              explanation: verdict.reason || undefined,
            };
            // Name the judge that produced the verdict being cancelled. The
            // batch model is in scope (it is stamped on every other record
            // this flush writes); passing undefined here wrote a cancel that
            // said a cloud verdict existed and could not say whose.
            void emitCancelLog(post, cancelVerdict, commentAnalysis, { model: GROQ_FAST_MODEL, provider: batchProvider }).catch(err => {
              console.error('[FeelingWise] comment cancel-log failed:', err);
            });
          }
          continue;
        }
        const primaryTechnique = titledTechnique(verdict);
        const analysis: AnalysisResult = {
          postId: post.id,
          // Carry the verdict's real technique label into the SIGNED record
          // (was `[]` — the label never reached the chain, leaving flagged
          // AI comments unlabeled). Canonical enum = legally precise label.
          techniques: verdictTechniques(verdict.technique, verdict.severity, verdict.reason, verdict.confidence),
          overallScore: verdict.severity,
          overallConfidence: verdict.confidence ?? 0.5,
          isManipulative: true,
          processingTimeMs: 0,
          primaryTechnique,
          explanation: verdict.reason || undefined,
        };
        // TikTok comment markers mount as a SIBLING of the body span, not
        // inside it: the body span is a styled-components line-clamp box
        // (-webkit-line-clamp + overflow:hidden), so an inline-flex button
        // appended inside is clipped out of view ("dot in the wall"). The
        // 'after' mount escapes the clamp while staying in the row. Other
        // platforms keep the default inline 'inside' mount (byte-identical).
        const marker = renderCommentMarkerForCurrentClassification(post, {
          el,
          analysis,
          originalText: post.text,
          kind: 'rewrite',
          rewriteText: commentRewrite,
          mount: post.platform === 'tiktok' ? 'after' : 'inside',
          lang: resolveUiLanguage(settings.uiLanguage),
          aiRewrite: writerByPostId.get(post.id),
        });
        if (marker) markersRendered++;
      }
      if (markersRendered > 0) {
        fwDebug(`[FW comment-batch] rendered ${markersRendered} teen markers across ${bucket.posts.length} comments`);
      }
    }
  }

  // apply pending DOM-swaps NOW, after the marker
  // render loop has finished its anchor-revalidation pass on original text.
  // Swap order matters: per `forensics/anchor-revalidation.ts:103`, the
  // gate recomputes `liveElement.textContent` and compares to the enqueue
  // anchor (computed from `post.text`, the ORIGINAL text). Swapping
  // before the gate inverts that compare → 'dom-recycled' false-positive.
  // Running swaps here is safe because every consumer that needs the
  // original is done: chain payload (FORENSIC_LOG `neutralizedText`)
  // captured the rewrite verbatim; marker (renderTeenMarker) captured
  // `originalText: post.text` for the toggle's EXPANDED state;
  // this swap only touches the visible DOM, not the toggle's
  // closed-over `originalText` snapshot.
  //
  // TikTok comments only enter this batch path when the bundle extractor
  // emits them with parentVideoId set; the swap is idempotent via
  // `data-fw-rewritten`.
  if (pendingSwaps.length > 0) {
    let swapsApplied = 0;
    let fallbackHidesApplied = 0;
    for (const swap of pendingSwaps) {
     const retainOnFailure = (): void => {
       if (settings.mode === 'child') protectionsToRetain.add(swap.post);
     };
     try {
       // Q69 (W66): prefer the marker pass's verified/recovered anchor.
       // null means verification failed and no sibling matched - skipping
       // is the honest move (writing into a recycled stranger is worse).
       //
       // 2026-09-19: "absent" used to mean "the old direct deref stands", and
       // absent was every post in the batch whenever the parent had the
       // show-reframe-markers toggle off. The whole marker pass, including
       // this verification, sits inside `if (showMarkers)`, so a cosmetic
       // switch was deciding whether the swap checked that it was still
       // writing into the comment it had scored. With it off, a virtualizer
       // that recycled the node between enqueue and flush got the rewrite
       // written into whatever comment now occupied that slot, while the
       // scored one stayed untouched and visible.
       //
       // Nothing about the marker pass moves. When it ran, its answer is
       // already in the map and is used unchanged. This only fills the gap it
       // left, with the same two calls, both of which are pure reads.
       const resolved = resolvedAnchorByPost.has(swap.post)
         ? resolvedAnchorByPost.get(swap.post)
         : resolveSwapAnchor(swap.post);
       const el = resolved !== undefined ? resolved : (swap.domRef.deref() ?? null);
       if (!el) { retainOnFailure(); continue; }
       if (!prepareCurrentPostMutation(swap.post)) { retainOnFailure(); continue; }
       const entry = buildCommentEntryForRoot(el, swap.platform);
      if (!entry) { retainOnFailure(); continue; }
      // preserve the marker across the swap.
      // For X/FB/YT, `textEl` IS the same element renderTeenMarker
      // appended its `<button class="fw-teen-marker">` child to (the
      // tweetText / #content-text / FB story_message div). The
      // `swapCommentTextInPlace` call sets `textEl.textContent = rewrite`
      // which destroys ALL children — including the just-rendered marker.
      // For IG (structural picker), textEl is a deeply-nested span and
      // the marker sits on the LI root (rootEl !== textEl), so the
      // querySelector here returns null and the re-append is a no-op.
      // Live verification on an X profile with mixed top-comments
      // confirmed post-swap markers count was 4 instead of 7+2 because
      // the swap nuked 5 comment markers as children of their tweetText
      // hosts.
      const terminal = applyCommentRewriteTerminal(entry, swap.rewrite, settings.mode, swap.kind !== 'mask', swap.writer);
      // M61: the chain hears what happened, not what was attempted. Three
      // terminals, three records, since 2026-09-19: before that 'unresolved'
      // shared the rewrite record and the chain said a soften had been shown
      // when the original was still on the page.
      sendSwapRecord(swap, terminal === 'hidden' ? 'hidden' : terminal === 'rewritten' ? 'rewrite' : 'unresolved', markedWriter(entry, swap));
      if (terminal === 'rewritten') {
        settleProtection(swap.post, { record: 'batch', reason: 'comment-rewrite-applied' });
        // PROVEN rewrite → cache the exact swap text so a fresh-node
        // re-extraction is re-rewritten (Child falls back to hide) before any
        // uncover cycle and never re-scored (CORE-1 / CORE-2).
        rememberResolvedComment(swap.post, {
          kind: 'rewrite',
          rewrite: swap.rewrite,
          ...(swap.writer ? { writer: swap.writer } : {}),
        });
        swapsApplied++;
      } else if (terminal === 'hidden') {
        commitProtection(swap.post, true);
        // PROVEN fallback hide → cache as a hide.
        rememberResolvedComment(swap.post, { kind: 'hide' });
        fallbackHidesApplied++;
      } else {
        retainOnFailure();
      }
      } catch {
       retainOnFailure();
       // Keep processing the batch; Child retains this item's cover.
     }
    }
    // Skipped swaps (no element, a stale post, a throw) never reached the
    // terminal, so their record says the rewrite was attempted and did not
    // land, not that it was shown.
    flushDeferredSwapRecords();
    if (swapsApplied > 0) {
      fwDebug(`[FW comment-batch] applied ${swapsApplied} comment rewrites to DOM`);
    }
    if (fallbackHidesApplied > 0) {
      fwDebug(`[FW comment-batch] safely hid ${fallbackHidesApplied} comments after rewrite failure`);
    }
  }

  // Verify-session diagnostic (gated). When `ff_chainDebugStats` is on, ask
  // the SW for a chain-shape snapshot and log it to the page console where
  // Chrome MCP `read_console_messages` can pick it up. Off in production —
  // zero cost when the flag is off (the `if` short-circuits before any
  // round-trip).
  if (await isDevFlagEnabled('chainDebugStats')) {
    const reqMsg: FWMessage = { type: 'GET_CHAIN_DEBUG_STATS' };
    const result = safeSendMessage(reqMsg);
    if (result) {
      result
        .then(response => {
          const r = response as ChainDebugStatsResponse | undefined;
          if (r?.ok) {
            fwDebug('[FW debug] chain stats:', JSON.stringify(r, null, 2));
          }
        })
        .catch(() => {/* swallow — diagnostic must not disrupt flush */});
    }
  }
  } catch (error) {
    // The two inner try blocks above guard the scoring call; anything else that throws lands here. The bucket left the
    // pending map before the first await, so it exists only in this call: without this clause the finally below settled
    // every comment as released (a Child cover off, the raw text on the page) and the rejection went unhandled. Keep
    // every cover, as the two throw branches above do, put the comments back in the extraction pool, and count.
    bumpCounter('commentFlushThrew');
    console.warn('[FW comment-batch] the flush threw; every cover it held stays and the comments are read again', error);
    unmarkPostsForReExtraction(bucket.posts);
    for (const post of bucket.posts) protectionsToRetain.add(post);
    // A comment that is read again writes its record then. One still on screen at the throw, or not scrolled back within 30 s,
    // is never read again and would have only the counter, so the chain says each went unjudged, as the failed-batch branch
    // does, and the video gets the same cooldown so the bucket does not re-form against the same fault at once (S5 notes).
    setParentCooldown(parentVideoId);
    if (settingsRead) {
      const read = settingsRead;
      try {
        for (const post of bucket.posts) {
          if (hasLoggedForensic(forensicDedupKey(post)) || !shouldLogCancelForensic(forensicDedupKey(post))) continue;
          void sendHighStakesForensicLog({
            type: 'CANCEL_LOG',
            payload: {
              originalText: post.text,
              verdict: 'cancelled-batch-llm-failure',
              analysis: undefined,
              mode: read.mode,
              platform: post.platform,
              author: post.author,
              authorName: post.authorName,
              ...commentRecordRoomFields(roomFields),
              feedSource: post.feedSource ?? 'unknown',
              accountType: post.accountType,
              sourceContainer: post.sourceContainer,
              observedSequence: post.observedSequence,
              viewportSeenAt: post.viewportSeenAt,
              surfaceSessionId: post.surfaceSessionId,
              textCapture: post.textCapture,
              authorCapture: post.authorCapture,
              mediaUrls: mediaUrlsNow(post),
              configSnapshot: buildConfigSnapshot(read.mode, MANIPULATION_SEVERITY_THRESHOLD, read.dailyCap, read.features, read.readFailedFallback),
              kind: 'comment',
              parentVideoId,
              failureKind: 'internal-error',
            },
          });
        }
      } catch {
        // The counter and the warning above are the trace if the records cannot be written either.
      }
    }
  } finally {
    if (commentHidesApplied > 0) {
      fwDebug(`[FW comment-batch] applied ${commentHidesApplied} comment hides to DOM`);
    }
    if (commentHideMisses > 0) {
      console.error(
        `[FW comment-hide MISS] ${commentHideMisses}/${commentHideAttempts} hide outcomes could not be applied ` +
          `(identity mismatch / dead ref / DOM throw) — harmful content may remain visible; record kept as flagged`,
      );
    }
    // Hidden/rewritten comments settle above. Benign and fail-open paths
    // release here; unresolved Child hides/rewrites keep their cover.
    for (const post of postsToSettle) {
      if (!protectionsToRetain.has(post)) {
        settleProtection(post, { record: 'batch', reason: 'comment-batch-settled' });
      }
    }
  }
}
