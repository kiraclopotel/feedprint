// Verdict application for the per-post path: the rewrite terminals, the
// session-cache and late-verdict direct applies, the hide/collapse visual and
// onProcessingResult, the queue's completion callback. createResultApplier
// binds them once to what only content/index.ts owns (the protection
// terminals, the classification check, the active adapter); the function
// bodies inside are the ones that lived in index.ts. Extracted per
// docs/audits/2026-08-23-objective-audit/wave4-architecture (Proposal A, step 6).

import type { PostContent } from '../../types/post';
import { mediaUrlsNow } from '../record/media-urls';
import { whyFor } from '../../core/policy/why';
import { withWhy } from '../markers/hide-why';
import { appliedFor, decisionForBlock, decisionForJudge, decisionForLegacy, decisionForMask, READER_DEFAULT, rewriteStage } from '../record/decision';
import { blanketProfanitySoften } from '../../analysis/pipeline';
import type { PlatformAdapter } from '../platforms/adapter';
import type { AnalysisResult } from '../../types/analysis';
import type { NeutralizedContent } from '../../types/neutralization';
import type { PipelineResult } from '../../analysis/pipeline';
import type { FWSettings } from '../../storage/settings';
import type { CommentEntry } from '../protection/comment-overlay';
import type { LateVerdict } from './late-verdict-cache';
import type { SettleOutcome, SettleResult } from '../protection/settle-protection';
import type { ScanEvent } from '../../forensics/scan-log';
import type { BlockedEventInput } from '../../forensics/logger';
import { shouldLogForensic, shouldLogCancelForensic, forensicDedupKey } from '../record/forensic-gate';
import { fwDebug } from '../fw-log';
import { writesTextlessRoomRecord } from './platform-policy';
import { buildConfigSnapshot } from '../record/config-snapshot';
import {
  bumpCounter,
  beginPostIntervention,
  finishPostIntervention,
  notePostPassAfterIntervention,
  type PostInterventionReceipt,
} from '../../diagnostics/diagnostics';
import { getSettings, isFeatureEnabled } from '../../storage/settings';
import { resolveUiLanguage } from '../../i18n';
import { MARKER_STRINGS } from '../../i18n/marker-strings';
import { getEffectiveThreshold } from '../../core/calibration';
import { injectIntoElement, injectCollapseOrHide, injectAdHide, injectHardHide, markOnlyElement } from '../injector';
import { videoWordsOf, kindOnVideo, rewriteOnVideo, markCaptionYellow } from './video-feed-words';
import type { DecisionAction } from '../../types/forensic';
import { countHiddenFor } from '../engagement/mark-hidden';
import { ruleTallyKey } from '../../core/parent-blocklist';
import { computeAnchorKey } from '../../core/anchor-key';
import { verifyAnchorMatch, cancelVerdictFor } from '../../forensics/anchor-revalidation';
import { tryRecoverDomRecycledAnchor, tryRecoverExactPostInterventionAnchor } from './dom-recycle-recovery';
import { safeSendMessage } from '../../storage/context-guard';
import { sendHighStakesForensicLog } from '../record/forensic-retry';
import { GROQ_FAST_MODEL, FALLBACK_AI_PROVIDER } from '../../ai/client';
import { recordMetricsFromPostContent } from '../record/record-metrics';
import { swapCommentTextInPlace, hideCommentAsFallback } from '../protection/comment-overlay';
import { markAiText, rewriteChangesText, writerOfRewrite, type AiWriter } from '../markers/ai-mark';
import { buildPostUrl } from '../record/post-url';
import { creativeHash } from '../../forensics/author-store';
import { emitCancelLog, postPayloadBase, recordParentId } from '../record/forensic-emit';
import { descriptorV1Settled } from '../record/descriptor-step';
import {
  holdForRoomVerdict,
  isRoomJudgeable,
  roomVerdictAnalysis,
  type RoomVerdict,
} from './room-verdict';
import {
  type CachedHideCollapseVerdict,
  MAX_SESSION_VERDICT_CACHE,
  sessionVerdictByPostId,
  sessionHideCollapseByPostId,
  sessionRevealedPostKeys,
  sessionVerdictKey,
  rememberSessionPass,
  isAuthoritativeSessionPassReason,
  noteStaleCancelled,
  storeLateVerdict,
  lateVerdictFromCancelledAnalysis,
} from './late-verdict-cache';

export interface ResultApplyDeps {
  settleProtection: (post: PostContent, outcome: SettleOutcome) => SettleResult;
  commitProtection: (post: PostContent, preserveMedia?: boolean) => void;
  prepareCurrentPostMutation: (post: PostContent, replacementAnchor?: HTMLElement) => boolean;
  isCurrentClassification: (post: PostContent) => boolean;
  getActiveAdapter: () => PlatformAdapter | null;
}

/**
 * Pass reasons that mean "the feed served this and nothing judged it".
 * Each one writes a `verdict: 'skipped'` record naming itself. See the emit
 * site below for what is deliberately absent from this set.
 */
const SKIP_RECORD_REASONS: ReadonlySet<string> = new Set([
  'pre-llm-free-tier-no-ai',
  'pre-llm-too-short',
  'pre-llm-non-substantive',
  'pre-llm-cap-exhausted',
]);

export function createResultApplier(deps: ResultApplyDeps) {
  const {
    settleProtection,
    commitProtection,
    prepareCurrentPostMutation,
    isCurrentClassification,
    getActiveAdapter,
  } = deps;

  /**
   * 'released-unapplied' was added 2026-09-19 and is the reason this type has a
   * comment. The terminal computed whether the rewrite actually landed in the
   * page and then had no way to say so: outside child mode, "softened" and
   * "the injection returned false" both came back as 'released'. The record
   * written downstream hardcoded rewrite outcome 'applied' and never asked.
   *
   * injectIntoElement returns false for real reasons, including its own
   * postcondition check that the replacement is visible. So a reader could be
   * looking at the untouched post while the chain said it had been softened.
   * The collapse-and-hide path in this same file has always stamped
   * `visualApplied` from the real DOM outcome; the rewrite path did not.
   */
  // 'skipped' and 'marked' are the video item's outcomes (video-feed-words.ts): Child's video hidden
  // without a rewrite being tried, and Adult's caption marked in yellow with its words kept.
  /** The words a rule starred for a swear: rules wrote them, and the only finding is profanity. */
  function isSwearMask(neutralized: NeutralizedContent): boolean {
    const techniques = neutralized.analysis.techniques;
    return neutralized.aiSource === 'rules'
      && techniques.length > 0
      && techniques.every((t) => t.technique === 'profanity');
  }

  type RewriteProtectionTerminal =
    'released' | 'released-unapplied' | 'committed' | 'retained' | 'skipped' | 'marked';

  /**
   * Apply a verified rewrite, or convert a Child failure into a confirmed safe
   * hide. A failed fallback intentionally leaves the provisional shield leased.
   */
  function applyNeutralizedRewriteTerminal(
    post: PostContent,
    el: HTMLElement,
    neutralized: NeutralizedContent,
    settings: FWSettings,
  ): RewriteProtectionTerminal {
    const showMarkers = isFeatureEnabled(settings, 'show-reframe-markers', post.platform);
    const lang = resolveUiLanguage(settings.uiLanguage);
    // A swear is starred in place in every mode: its row is allow with a mask, never a hide. The video
    // rule's skip and yellow caption are for judged marks and the hide rails, not for profanity.
    const isMask = isSwearMask(neutralized);
    // On a video item only the caption is ever written to; the item itself holds the video.
    const video = videoWordsOf(el);
    const onVideo = video ? (isMask ? 'rewrite-caption' : rewriteOnVideo(settings.mode)) : null;
    if (video && onVideo === 'mark-caption-yellow') {
      if (video.caption) {
        markCaptionYellow(video.caption);
        markOnlyElement(video.caption, neutralized.analysis, showMarkers, post.text, lang);
      }
      settleProtection(post, { record: 'verdict', reason: 'video-caption-marked' });
      return video.caption ? 'marked' : 'released-unapplied';
    }
    const target = video ? video.caption : el;
    let rewriteApplied = false;
    if (onVideo !== 'skip' && target) {
      try {
        rewriteApplied = injectIntoElement(target, neutralized, settings.mode, showMarkers, post.text, lang);
      } catch {
        rewriteApplied = false;
      }
    }

    if (rewriteApplied || settings.mode !== 'child' || isMask) {
      settleProtection(post, {
        record: 'verdict',
        reason: rewriteApplied ? 'rewrite-applied' : isMask ? 'mask-unavailable' : 'rewrite-unavailable-non-child',
      });
      // Same release either way; the caller is told which one so the record can
      // say what the page shows rather than what was asked for.
      return rewriteApplied ? 'released' : 'released-unapplied';
    }

    let fallbackApplied = false;
    try {
      fallbackApplied = applyCollapseHideVisual(
        video ? video.skipTarget : el,
        neutralized.analysis,
        'hide',
        undefined,
        post,
        settings,
      );
    } catch {
      fallbackApplied = false;
    }
    if (fallbackApplied) {
      commitProtection(post, true);
      return onVideo === 'skip' ? 'skipped' : 'committed';
    }
    return 'retained';
  }

  type CommentRewriteTerminal = 'rewritten' | 'hidden' | 'unresolved';

  function normalizedVisibleText(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
  }

  /**
   * Apply one comment rewrite and prove a safe terminal before its cover ends.
   *
   * `hideFallback` says whether a Child-mode swap that does not land may fall
   * back to hiding the comment (2026-09-19). It is true for a manipulative
   * rewrite, where hiding is the whole point of the fallback: harm was found
   * and the softened version did not reach the page, so the item goes.
   *
   * It is false for a swear mask. flush.ts collects those into the same
   * pendingSwaps array with no discriminator, so they arrived here and took the
   * rewrite's fallback, and a Child could lose a comment whose only fault was a
   * word, on any DOM that refused the mutation. The policy that path cites says
   * the opposite in its own source: "No rewriter, so no empty rewrite and no
   * hide: a comment that only swears is never hidden
   * (docs/design/POLICY-TABLE-2026-09-07.md)."
   *
   * An older docblock in the same file, from the June collection point, still
   * describes the superseded rule, "if no clean rewrite → hide silently". The
   * newer one carries the design reference and is the one that holds.
   */
  function applyCommentRewriteTerminal(
    entry: CommentEntry,
    rewrite: string,
    mode: FWSettings['mode'],
    hideFallback = true,
    /** Present when a model wrote `rewrite`; a swear mask passes none and is never marked. */
    writer?: AiWriter,
  ): CommentRewriteTerminal {
    const savedMarker = entry.textEl.querySelector('.fw-teen-marker');
    const original = entry.text;
    try {
      swapCommentTextInPlace(entry, rewrite);
      const rewriteApplied = entry.rootEl.dataset.fwRewritten === 'true'
        && normalizedVisibleText(entry.textEl.textContent ?? '') === normalizedVisibleText(rewrite);
      if (rewriteApplied) {
        if (writer && rewriteChangesText(rewrite, original)) markAiText(entry.textEl, 'rewrite', writer);
        if (savedMarker) entry.textEl.appendChild(savedMarker);
        return 'rewritten';
      }
    } catch {
      // Child falls through to the safe hide below; older modes fail open.
    }

    if (mode !== 'child') return 'unresolved';
    // A mask that did not land leaves the comment exactly as the platform
    // served it, which is the outcome its own policy asks for. 'unresolved' is
    // the honest terminal: nothing was applied, and the record says so.
    if (!hideFallback) return 'unresolved';
    try {
      hideCommentAsFallback(entry);
      const hidden = entry.rootEl.dataset.fwRewritten === 'true'
        && entry.rootEl.dataset.fwHiddenFallback === 'true'
        && entry.rootEl.style.getPropertyValue('display') === 'none'
        && entry.rootEl.style.getPropertyPriority('display') === 'important';
      return hidden ? 'hidden' : 'unresolved';
    } catch {
      return 'unresolved';
    }
  }

  /** Whether the box still holds the post the verdict was made for, the way the live path asks it. */
  function boxStillHoldsPost(post: PostContent): boolean {
    return verifyAnchorMatch(computeAnchorKey(post), post, post.domRef) === 'match';
  }

  /**
   * Direct UI mutation from session-cache hit. Bypasses the processing queue +
   * LLM-cache + render-gate because the post was JUST detected (post.domRef is
   * the fresh adapter-extracted WeakRef). The render-gate's anchor revalidation
   * protects against mid-LLM-call DOM recycling; that's not a concern here
   * because there's no LLM call.
   *
   * Async only because getSettings is async; the await yields once before the
   * inject. A feed that reuses its boxes can refill this one with another post in that
   * yield and the handle stays alive, so the box is compared with the post again after it.
   */
  async function applyCachedVerdictDirect(
    post: PostContent,
    cached: NeutralizedContent,
  ): Promise<void> {
    let retainProtection = false;
    try {
      const el = post.domRef.deref();
      if (!el) return;
      const settings = await getSettings();
      const elPostAwait = post.domRef.deref();
      if (!elPostAwait || !boxStillHoldsPost(post) || !prepareCurrentPostMutation(post)) return;
      const terminal = applyNeutralizedRewriteTerminal(post, elPostAwait, cached, settings);
      retainProtection = terminal === 'retained';
    fwDebug(`[FW cache-hit render] ${post.platform} ${post.id} — marker applied directly (no queue, no LLM)`);
    } finally {
      settleProtection(post, {
        record: 'replay',
        reason: 'cached-rewrite-replay',
        disposition: retainProtection ? 'retain-in-child' : 'release',
      });
    }
  }

  /**
   * Apply a late-arrived verdict to a re-detected item: one that completed after its node was gone and
   * left a cancelled record. It goes through the same path a live verdict takes (the anchor check, the
   * visual, the memoization and the record), with `lateApply` set so the record carries the sentence that
   * says the reading was late; the cancelled record stays as it was written. 'mark' is the visible-output
   * floor for a confirmed concern with no rewrite in hand.
   */
  async function applyLateVerdictDirect(post: PostContent, late: LateVerdict): Promise<void> {
    // First-encounter measurement: a stored late verdict reached its
    // re-encounter — the recovery event the 2026-07-02 rule wants counted.
    bumpCounter('firstEncounterRecovered');
    const carried = { detectionMode: late.detectionMode, aiMeta: late.aiMeta };
    const result: PipelineResult = late.kind === 'neutralize'
      ? { action: 'neutralize', neutralized: late.neutralized, ...carried }
      : { action: late.kind, analysis: late.analysis, ...carried };
    processResult(post, result, true);
  }

  /**
   * True for any sponsored-ad verdict — 'sponsored-ad' (child/teen) and
   * 'sponsored-ad:adult' (adult, category-only record shape). One predicate so
   * the visual gate, the protection-retain flag and the suppressed-by-setting
   * ledger reason never drift apart on the adult variant.
   */
  function isSponsoredAdDetection(detectionMode: string | undefined): boolean {
    return !!detectionMode && detectionMode.startsWith('sponsored-ad');
  }

  /**
   * Apply the on-page visual for a hide/collapse verdict. A sponsored ad
   * (detectionMode 'sponsored-ad' / 'sponsored-ad:adult') is special-cased: the
   * Block Ads setting decides the VISUAL only, ON → fully remove the ad (no
   * placeholder, no gap), OFF → leave it visible. The record is written
   * separately by the live path: child/teen regardless of the toggle
   * (deterministic manipulation record, unchanged), adult only when the hide
   * lands and then as a blocked-category event (BLOCKED_LOG, reason 'ads') —
   * never a manipulation finding. Every other verdict folds/hides as before.
   * Shared by the live apply path and the cache-replay so a re-rendered ad
   * re-hides consistently.
   */
  /**
   * The rules editor shows a hit count per chip, read out of
   * `settings.hiddenByFeature` under `ruleTallyKey`. Only the free product's
   * word filter ever wrote those keys, so in the recorder every rule a parent
   * had typed showed no count at all, however many posts it had hidden, and a
   * blank chip reads as a rule that has never fired (found 2026-09-19).
   *
   * The recorder hides by the parent's rules in the pipeline, which cannot
   * reach this counter: `analysis/` does not import `content/`, on purpose. It
   * carries the fact in `detectionMode` instead, in the documented
   * `blocklist:<kind>:<rule>` form that consumers prefix-match. This is where
   * that fact meets the page, and it is counted only when the hide really
   * landed, never when it was merely intended.
   */
  function noteBlocklistRuleFired(detectionMode: string | undefined): void {
    if (!detectionMode || !detectionMode.startsWith('blocklist:')) return;
    // `blocklist:<kind>:<rule>`, and a phrase rule may itself contain a colon,
    // so only the first two segments are structure.
    const rest = detectionMode.slice('blocklist:'.length);
    const sep = rest.indexOf(':');
    if (sep <= 0) return;
    const kind = rest.slice(0, sep) as Parameters<typeof ruleTallyKey>[0];
    const rule = rest.slice(sep + 1);
    if (!rule) return;
    countHiddenFor(ruleTallyKey(kind, rule), 1, false);
  }

  /**
   * A mark with no rewrite. On a video item it lands on the caption, in yellow for Adult, and Child
   * skips the video instead (video-feed-words.ts). Returns what the page shows, for the record.
   */
  function applyMarkVisual(
    post: PostContent,
    el: HTMLElement,
    analysis: AnalysisResult,
    settings: FWSettings,
  ): 'mark' | 'hide' | 'allow' {
    const showMarkers = isFeatureEnabled(settings, 'show-reframe-markers', post.platform);
    const lang = resolveUiLanguage(settings.uiLanguage);
    const video = videoWordsOf(el);
    if (!video) {
      markOnlyElement(el, analysis, showMarkers, post.text, lang);
      return 'mark';
    }
    if (settings.mode === 'child') {
      return applyCollapseHideVisual(video.skipTarget, analysis, 'hide', undefined, post, settings) ? 'hide' : 'allow';
    }
    if (!video.caption) return 'allow';
    if (settings.mode === 'adult') markCaptionYellow(video.caption);
    markOnlyElement(video.caption, analysis, showMarkers, post.text, lang);
    return 'mark';
  }

  /** The visual apply, plus the one tally the recorder could not write itself. */
  function applyCollapseHideVisual(
    el: HTMLElement,
    analysis: AnalysisResult,
    kind: 'hide' | 'collapse',
    detectionMode: string | undefined,
    post: PostContent,
    settings: FWSettings,
  ): boolean {
    const applied = applyCollapseHideVisualInner(el, analysis, kind, detectionMode, post, settings);
    if (applied) noteBlocklistRuleFired(detectionMode);
    return applied;
  }

  function applyCollapseHideVisualInner(
    el: HTMLElement,
    analysis: AnalysisResult,
    kind: 'hide' | 'collapse',
    detectionMode: string | undefined,
    post: PostContent,
    settings: FWSettings,
  ): boolean {
    const lang = resolveUiLanguage(settings.uiLanguage);
    if (isSponsoredAdDetection(detectionMode)) {
      if (!isFeatureEnabled(settings, 'block-ads', post.platform)) return false; // ad shown
      if (injectAdHide(el, post.platform, lang)) return true;                    // ad fully gone
      // No ad container resolved → degrade to the fold rather than leave the ad
      // fully visible.
    }
    // Hard hide (direct threat / harassment / doxxing — the un-reframeable severe
    // case): remove the whole post from the feed. In Child mode the removal is
    // fully silent, no placeholder, no leftover gap (a standing rule, 2026-06-19:
    // hide entirely including the space, show the user nothing). Teen/Adult
    // get a one-line notice with a reveal toggle (decided 2026-08-02: hidden posts
    // must be revisitable) — the reveal is per-post, survives remounts via
    // sessionRevealedPostKeys, and comes back muted. The forensic record still
    // emits separately, so the dashboard keeps the evidence + the original.
    // Degrade to the placeholder if no feed container resolves (never leave a
    // threat post fully visible).
    // The why, in the policy row's words, when the legacy signal names one; the household's own blocklist
    // word is quoted, a slur never is. When the measured reader read this item its family is the true why on
    // a band row (the same words the record's card will show, src/i18n/why-words.ts).
    const why = whyFor(
      detectionMode,
      analysis.techniques.filter((t) => t.present).map((t) => t.technique),
      analysis.overallScore,
    );
    const family = analysis.judge?.charged ? analysis.judge.family : undefined;
    const whyWithFamily = why && family ? { ...why, family } : why;
    if (kind === 'hide') {
      const revealKey = sessionVerdictKey(post);
      // Name WHOSE post was hidden.
      //
      // A hidden container has zero height, so the notice — mounted immediately
      // before it — renders flush against the NEXT visible post and reads as a
      // header for that post. Found live on an X permalink: the focal post
      // was hidden correctly, and the notice appeared to accuse the visible
      // reply underneath it. The counters proved the hide itself was fine
      // (hardHideReasserted and hardHideNoticeWithdrawn both zero across a full
      // browsing day), so the defect is attribution, not protection.
      //
      // The handle is already on the screen the user is looking at; naming it
      // adds no data and removes the only ambiguity. Falls back to the plain
      // sentence when extraction produced no author.
      const handle = (post.author ?? '').trim();
      // Q61 (W58): these were the last on-page UI strings hardcoded outside
      // MARKER_STRINGS; parity is now compiler-guaranteed.
      const ms = MARKER_STRINGS[lang];
      // A teen reads where the post went; an adult the plain line (marker-strings.ts).
      const teen = settings.mode === 'teen';
      const notice = handle
        ? (teen ? ms.hideNoticeByTeen : ms.hideNoticeBy)(handle)
        : (teen ? ms.hideNoticePlainTeen : ms.hideNoticePlain);
      const noticeText = withWhy(notice, lang, whyWithFamily);
      const revealOpts = settings.mode === 'child' ? undefined : {
        noticeText,
        showLabel: ms.hideShowAnyway,
        hideLabel: ms.hideHideAgain,
        initiallyRevealed: sessionRevealedPostKeys.has(revealKey),
        onRevealChange: (revealed: boolean) => {
          if (revealed) sessionRevealedPostKeys.add(revealKey);
          else sessionRevealedPostKeys.delete(revealKey);
        },
      };
      if (injectHardHide(el, post.platform, revealOpts, lang)) return true;
    }
    const showMarkers = isFeatureEnabled(settings, 'show-reframe-markers', post.platform);
    return injectCollapseOrHide(el, analysis, kind, showMarkers, post.text, lang, settings.mode, whyWithFamily);
  }

  /**
   * Cache-hit replay for HIDE/COLLAPSE verdicts. Same shape as
   * applyCachedVerdictDirect (neutralize) — re-applies the placeholder + marker
   * on the fresh DOM ref without re-paying the Groq round-trip. Forensic
   * re-write is gated by shouldLogForensic's per-session text-hash dedup
   * (already in effect), so no double-stamping the chain.
   */
  async function applyCachedHideCollapseDirect(
    post: PostContent,
    cached: CachedHideCollapseVerdict,
  ): Promise<void> {
    let applied = false;
    let visualAttempted = false;
    let kindOnPage = cached.kind;
    try {
      const el = post.domRef.deref();
      if (!el) return;
      const settings = await getSettings();
      const elPostAwait = post.domRef.deref();
      if (!elPostAwait || !boxStillHoldsPost(post) || !prepareCurrentPostMutation(post)) return;
      visualAttempted = true;
      kindOnPage = kindOnVideo(elPostAwait, cached.kind);
      applied = applyCollapseHideVisual(elPostAwait, cached.analysis, kindOnPage, cached.detectionMode, post, settings);
    fwDebug(`[FW cache-hit ${kindOnPage}] ${post.platform} ${post.id} — applied directly (no queue, no LLM)`);
    } finally {
      if (applied) commitProtection(
        post,
        kindOnPage === 'hide' || isSponsoredAdDetection(cached.detectionMode),
      );
      // Same rule as the live terminal: in Child a hide that was tried and did
      // not land keeps the cover. A post with no DOM left is released as before.
      else settleProtection(post, {
        record: 'replay',
        reason: visualAttempted ? 'cached-hide-not-applied' : 'cached-hide-no-anchor',
        disposition: visualAttempted ? 'retain-in-child' : 'release',
      });
    }
  }

  async function recoverExactPostInterventionAnchor(post: PostContent): Promise<HTMLElement | null> {
    const immediate = tryRecoverExactPostInterventionAnchor(post);
    if (immediate) return immediate;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return tryRecoverExactPostInterventionAnchor(post);
  }

  /**
   * `lateApply` is a stored verdict being applied when its item came back: the same producers write the record, with
   * the sentence that says the reading was late, and the two counts the first (cancelled) result already made, the
   * scan and the author's, are not made twice.
   */
  function processResult(post: PostContent, result: PipelineResult, lateApply = false): void {
    if (!isCurrentClassification(post)) {
      settleProtection(post, { record: 'write-cancel', reason: 'stale-classification' });
      return;
    }
    const waitsForVisibleIntervention = !!getActiveAdapter() && (
      (result.action === 'neutralize' && !!result.neutralized)
      || (result.action === 'mark' && !!result.analysis)
      || ((result.action === 'collapse' || result.action === 'hide') && !!result.analysis)
    );

    // Log scan event for ALL processed posts (pass, neutralize, flag)
    // This gives the denominator for dashboard metrics
    if (!lateApply) void safeSendMessage({
      type: 'SCAN_LOG',
      payload: {
        timestamp: new Date().toISOString(),
        platform: post.platform,
        feedSource: post.feedSource ?? 'unknown',
        author: post.author ?? 'unknown',
        postId: post.id,
        action: result.action,
      } satisfies ScanEvent,
    });
    if (!waitsForVisibleIntervention) {
      settleProtection(post, { record: 'verdict', reason: `result:${result.action}` });
    }

    if (result.action === 'neutralize' && result.neutralized && getActiveAdapter()) {
      // Get settings for injection styling + forensic snapshot.
      // `mode` is read here as the userAgeCategory tag for the
      // forensic record — NOT as an enforcement gate. The injector dispatches
      // rendering by mode.
      // pickAction removed (feature gone); action is always
      // 'neutralize' on a confirmed detection.
      // narrow `result.neutralized` once at the top of the
      // async closure so we don't sprinkle non-null assertions throughout
      // (audit J: the `!` chain throws at runtime if the pipeline ever
      // emits action='neutralize' with null neutralized content).
      const neutralized = result.neutralized;
      if (!neutralized) {
        console.error('[FeelingWise] action=neutralize but neutralized payload missing — skipping inject + forensic write');
        settleProtection(post, { record: 'verdict', reason: 'neutralize-payload-missing' });
        return;
      }

      let retainChildProtection = false;

      (async () => {
        const settings = await getSettings();

        // anchor-revalidation render-gate.
        // Verify the live DOM still matches the post we classified BEFORE any UI
        // mutation. A 'dom-recycled' result means the platform's virtualizer
        // reused the node for a different post — applying the verdict would
        // mark the wrong post (VISION §1.2 trust violation). 'dom-gone' means
        // the WeakRef was cleared. Both suppress UI + emit a cancel chain
        // record per VISION §1.1 forensic completeness.
        const verification = verifyAnchorMatch(computeAnchorKey(post), post, post.domRef);
        let el: HTMLElement | null = verification === 'match' ? post.domRef.deref()! : null;
        // Recovery layer above the primitive: a 'dom-recycled' verification
        // means the deref'd node had its text mutated by the virtualizer, but
        // the original tweet text may still be mounted on a sibling article
        // under the same parent ancestor. The helper walks descendants matching
        // 'article' and returns the first whose content fingerprint matches the
        // enqueue-time text. 'dom-gone' verifications skip recovery — a fully
        // cleared WeakRef means the post was scrolled-out and a fingerprint
        // walk over document.body could false-positive onto an unrelated tweet.
        if (verification === 'dom-recycled') {
          el = tryRecoverDomRecycledAnchor(post.domRef, post.text, 'article');
        }
        if (!el) {
          // Completed verdict, node gone — store for act-on-re-encounter.
          storeLateVerdict(post, { kind: 'neutralize', neutralized, detectionMode: result.detectionMode, aiMeta: result.aiMeta });
          const cancelVerdict = cancelVerdictFor(verification);
          if (cancelVerdict !== null && shouldLogCancelForensic(forensicDedupKey(post))) {
            await emitCancelLog(post, cancelVerdict, neutralized.analysis, result.aiMeta);
          }
          console.log(`[FeelingWise] render-gate: suppressed neutralize UI for ${post.id} (${verification})`);
          settleProtection(post, { record: 'cancel', reason: 'neutralize-render-gate' });
          return;
        }

        // marker render gate — single source: the per-platform
        // `show-reframe-markers` toggle. Per a 2026-05-10 product directive, markers
        // now render in BOTH modes when the toggle is ON; the earlier
        // child-mode-always-silent rule has been superseded.
        if (!prepareCurrentPostMutation(post)) {
          settleProtection(post, { record: 'verdict', reason: 'neutralize-mutation-not-prepared' });
          return;
        }
        const terminal = applyNeutralizedRewriteTerminal(
          post,
          el,
          neutralized,
          settings,
        );
        retainChildProtection = terminal === 'retained';
        // Whether the softened text is actually on the page. Read by the record
        // below; 'released-unapplied' means the injection did not land and the
        // reader is looking at the original.
        // A Child hide ('committed', 'skipped') and Adult's yellow mark ('marked') show no rewrite
        // either, so only 'released' puts the softened text in the record.
        const rewriteLanded = terminal === 'released';
        // A Child cover that stays because no terminal landed is not the post shown as served: the reader sees
        // the cover, and the hide path records the same state as a mark that did not land.
        const heldByCover = terminal === 'retained';
        const appliedOnPage: DecisionAction = terminal === 'committed' || terminal === 'skipped'
          ? 'hide'
          : terminal === 'marked' || heldByCover ? 'mark' : rewriteLanded ? 'soften' : 'allow';
        // Skipped and marked are outcomes chosen for the video, not a rewrite that failed; and a skip that
        // did not land never tried a rewrite.
        const skipTried = !!videoWordsOf(el) && settings.mode === 'child';
        const rewriteOnPage = terminal === 'skipped' || terminal === 'marked' || (heldByCover && skipTried)
          ? { attempted: false, outcome: 'off' }
          : rewriteStage(rewriteLanded, writerOfRewrite(neutralized, post.text));

        // Store verdict in session cache so subsequent re-detections of this
        // post.id (Twitter virtualizer remount, SPA back-navigation re-mount)
        // apply the marker synchronously via applyCachedVerdictDirect, bypassing
        // the queue+LLM-cache+render-gate path. Bounded at
        // MAX_SESSION_VERDICT_CACHE; oldest entries evicted first when at cap.
        sessionVerdictByPostId.set(sessionVerdictKey(post), neutralized);
        if (sessionVerdictByPostId.size > MAX_SESSION_VERDICT_CACHE) {
          const keys = Array.from(sessionVerdictByPostId.keys());
          for (let i = 0; i < keys.length / 2; i++) sessionVerdictByPostId.delete(keys[i]);
        }

        // Send forensic data to service worker for storage in extension-origin IndexedDB.
        // Content scripts run in the webpage's origin, so writing IndexedDB here would
        // be invisible to the dashboard (which runs in the extension origin).
        const postUrl = buildPostUrl(post);
        // snapshot the calibrated threshold the pipeline actually
        // used (no longer a hardcoded mode-branch literal). Mode below is the
        // userAgeCategory forensic tag.
        const threshold = await getEffectiveThreshold(settings.mode);
        // The record carries DESCRIPTOR-V1's reading when it arrives in time.
        await descriptorV1Settled(neutralized.analysis);

        // skip duplicate FORENSIC_LOG when the same post text has
        // already been logged this session. Injection above still ran — UX is
        // per-DOM-element and correct. This gates only the evidence-write side.
        if (shouldLogForensic(forensicDedupKey(post))) {
          void sendHighStakesForensicLog({
            type: 'FORENSIC_LOG',
            payload: {
              originalText: post.text,
              // What the reader was shown instead. Empty when the injection
              // did not land, because then they were shown the original and
              // this field is the one the export prints as the replacement
              // (2026-09-19).
              neutralizedText: rewriteLanded ? neutralized.rewrittenText : '',
              analysis: neutralized.analysis,
              ...postPayloadBase(post, settings.mode, neutralized.aiSource, postUrl),
              // A swear mask is nothing charged, applied as a mask (2026-09-07);
              // the measured judge's reading names its instrument and says the
              // rewrite was applied.
              ...(result.detectionMode?.startsWith('profanity-mask')
                ? {
                    decision: decisionForMask(settings.mode, undefined, {
                      // What the page did with the words, not what the mask asked for: a video item is
                      // skipped or its caption marked by the video rule, and a mask whose stars did
                      // not land leaves the words as served (or, in Child, hides the item).
                      applied: appliedOnPage === 'soften' ? 'mask' : appliedOnPage,
                      rewrite: rewriteLanded ? null : rewriteOnPage,
                      videoRule: terminal === 'skipped' ? 'skipped' : terminal === 'marked' ? 'marked' : undefined,
                    }, lateApply),
                    reader: READER_DEFAULT,
                  }
                : neutralized.analysis.judge
                  ? {
                      decision: decisionForJudge({
                        mode: settings.mode,
                        judge: neutralized.analysis.judge,
                        descriptorV1: neutralized.analysis.descriptorV1,
                        provider: result.aiMeta?.provider ?? FALLBACK_AI_PROVIDER,
                        // What the page shows, not what was asked for
                        // (2026-09-19). Both of these were hardcoded to the
                        // success case and never consulted the terminal.
                        // 'allow' plus a failed rewrite makes decisionForJudge
                        // set NOTE_NOT_APPLIED, the sentence written for
                        // exactly this. (This comment said so from 2026-09-19 and
                        // named decisionForLegacy; the call is decisionForJudge,
                        // which could not write that sentence until 2026-09-20.)
                        applied: appliedOnPage,
                        landed: heldByCover ? false : undefined,
                        mask: blanketProfanitySoften(settings, post.platform),
                        rewrite: rewriteOnPage,
                        videoRule: terminal === 'skipped' ? 'skipped' : terminal === 'marked' ? 'marked' : undefined,
                        late: lateApply,
                      }),
                      reader: READER_DEFAULT,
                    }
                  : {}),
              anchorUrl: post.anchorUrl,
              accountType: post.accountType,
              sourceContainer: post.sourceContainer,
              observedSequence: post.observedSequence,
              viewportSeenAt: post.viewportSeenAt,
              surfaceSessionId: post.surfaceSessionId,
              textCapture: post.textCapture,
              authorCapture: post.authorCapture,
              mediaUrls: mediaUrlsNow(post),
              aiModel: result.aiMeta?.model,
              aiProvider: result.aiMeta?.provider,
              detectionMode: result.detectionMode,
              configSnapshot: buildConfigSnapshot(settings.mode, threshold, settings.dailyCap, settings.features, settings.readFailedFallback),
              // Omitted unless the Child cover stayed because no terminal landed, as on the hide path.
              visualApplied: heldByCover ? false : undefined,
              // split-forensic. Adapter (e.g., TikTok) sets these
              // when it splits a video into N+1 records — each comment + the
              // caption share parentVideoId so dashboard can group them.
              kind: post.kind,
              parentVideoId: recordParentId(post),
              // per-item engagement metrics captured from the post/caption DOM
              // (likes / views / shares / comments). Undefined → omitted.
              metrics: recordMetricsFromPostContent(post),
            },
          });
        }
      })().catch(err => {
        if (!retainChildProtection) {
          settleProtection(post, { record: 'verdict', reason: 'neutralize-path-threw' });
        }
        console.error('[FeelingWise] forensic log failed:', err);
      });

      // Notify service worker for stats tracking
      const confirmedTechniques = neutralized.analysis.techniques
        .filter(t => t.present)
        .map(t => t.technique);

      void safeSendMessage({
        type: 'NEUTRALIZATION_COMPLETE',
        payload: {
          postId: post.id,
          techniques: confirmedTechniques,
          confidence: neutralized.analysis.overallConfidence,
        },
        timestamp: new Date().toISOString(),
      });

      console.log(`[FeelingWise] Neutralized post ${post.id}`);
    }

    // mark-only path. The detector confirmed a flag (above threshold) but the
    // rewrite failed validation / came back empty and the AI named no
    // hide/collapse. Render the severity dot on the ORIGINAL text (no swap) so
    // the flag is still visible and carries its "why" (VISION Promise 2)
    // instead of silently passing the post unmarked. High-severity hostile
    // failed-rewrites were promoted to hide upstream (neutralizer D-5); this is
    // the lighter-touch tier for the rest, mirroring the comment path's
    // mark-only fallback.
    if (result.action === 'mark' && result.analysis && getActiveAdapter()) {
      const analysis = result.analysis;

      (async () => {
        const settings = await getSettings();

        const verification = verifyAnchorMatch(computeAnchorKey(post), post, post.domRef);
        if (verification !== 'match') {
          // Confirmed flag, node gone — store for act-on-re-encounter.
          storeLateVerdict(post, { kind: 'mark', analysis, detectionMode: result.detectionMode, aiMeta: result.aiMeta });
          const cancelVerdict = cancelVerdictFor(verification);
          if (cancelVerdict !== null && shouldLogCancelForensic(forensicDedupKey(post))) {
            await emitCancelLog(post, cancelVerdict, analysis, result.aiMeta);
          }
          console.log(`[FeelingWise] render-gate: suppressed mark UI for ${post.id} (${verification})`);
          settleProtection(post, { record: 'cancel', reason: 'mark-render-gate' });
          return;
        }
        const el = post.domRef.deref()!;
        if (!prepareCurrentPostMutation(post)) {
          settleProtection(post, { record: 'verdict', reason: 'mark-mutation-not-prepared' });
          return;
        }
        const shownOnPage = applyMarkVisual(post, el, analysis, settings);
        // In Child a mark comes back as allow only when the video skip did not land. The cover stays, as it
        // does when a hide or a rewrite does not land, and the record says the same thing it says there.
        const skipNotLanded = shownOnPage === 'allow' && settings.mode === 'child';
        settleProtection(post, {
          record: 'verdict',
          reason: skipNotLanded ? 'mark-skip-not-applied' : 'mark-applied',
          disposition: skipNotLanded ? 'retain-in-child' : 'release',
        });

        const postUrl = buildPostUrl(post);
        const threshold = await getEffectiveThreshold(settings.mode);
        await descriptorV1Settled(analysis);

        if (shouldLogForensic(forensicDedupKey(post))) {
          void sendHighStakesForensicLog({
            type: 'FORENSIC_LOG',
            payload: {
              originalText: post.text,
              // Mark-only: the original stays on the page; no rewrite produced.
              neutralizedText: '',
              analysis,
              ...postPayloadBase(post, settings.mode, result.aiMeta ? 'cloud' : 'rules', postUrl),
              anchorUrl: post.anchorUrl,
              accountType: post.accountType,
              sourceContainer: post.sourceContainer,
              observedSequence: post.observedSequence,
              viewportSeenAt: post.viewportSeenAt,
              surfaceSessionId: post.surfaceSessionId,
              textCapture: post.textCapture,
              authorCapture: post.authorCapture,
              mediaUrls: mediaUrlsNow(post),
              aiModel: result.aiMeta?.model,
              aiProvider: result.aiMeta?.provider,
              detectionMode: result.detectionMode,
              configSnapshot: buildConfigSnapshot(settings.mode, threshold, settings.dailyCap, settings.features, settings.readFailedFallback),
              // Omitted unless the Child cover stayed because the video skip did not land.
              visualApplied: skipNotLanded ? false : undefined,
              kind: post.kind,
              parentVideoId: recordParentId(post),
              // Per-item engagement metrics — marked posts need them too (was
              // only on the rewrite path). Undefined → omitted.
              metrics: recordMetricsFromPostContent(post),
              // The measured judge's reading, when it produced this mark: the
              // rewrite was asked for and did not land, or was off.
              ...(analysis.judge
                ? {
                    decision: decisionForJudge({
                      mode: settings.mode,
                      judge: analysis.judge,
                      descriptorV1: analysis.descriptorV1,
                      provider: result.aiMeta?.provider ?? FALLBACK_AI_PROVIDER,
                      applied: skipNotLanded ? 'mark' : shownOnPage,
                      landed: skipNotLanded ? false : undefined,
                      mask: blanketProfanitySoften(settings, post.platform),
                      rewrite: result.detectionMode === 'combined-detect-neutralize'
                        ? { attempted: true, outcome: 'failed' }
                        : { attempted: false, outcome: 'off' },
                      // A Child video skipped in place of a mark is the video rule's choice, not a failure.
                      videoRule: shownOnPage === 'hide' ? 'skipped' : undefined,
                      late: lateApply,
                    }),
                    reader: READER_DEFAULT,
                  }
                : {}),
            },
          });
        }
      })().catch(err => {
        settleProtection(post, { record: 'verdict', reason: 'mark-path-threw' });
        console.error('[FeelingWise] forensic log failed (mark):', err);
      });

      const confirmedTechniques = analysis.techniques
        .filter(t => t.present)
        .map(t => t.technique);

      void safeSendMessage({
        type: 'NEUTRALIZATION_COMPLETE',
        payload: {
          postId: post.id,
          techniques: confirmedTechniques,
          confidence: analysis.overallConfidence,
        },
        timestamp: new Date().toISOString(),
      });

      console.log(`[FeelingWise] Marked post ${post.id}`);
    }

    // collapse / hide path. The detector returned
    // action='collapse' (generic-group claim, hyperreal-trauma-bait, shame-
    // attack at private body anchor) or action='hide' (direct threat / doxxing
    // / coordinated harassment). No NeutralizedContent — the rewrite branch was
    // gated server-side because softening these patterns launders them or
    // re-delivers harm. We replace the post body with a one-line placeholder
    // and still log to the forensic chain so the parent dashboard sees what
    // FW intervened on.
    if ((result.action === 'collapse' || result.action === 'hide') && result.analysis && getActiveAdapter()) {
      const analysis = result.analysis;
      let kind = result.action;
      const interventionKey = `${post.platform}:${post.id}`;
      const interventionLabel = `${post.platform} ${post.id}`;
      const interventionAttempt = beginPostIntervention(interventionKey, kind, interventionLabel);

      (async () => {
        const settings = await getSettings();

        // render-gate before collapse / hide
        // mutation. Same shape as the neutralize branch above: verify live DOM
        // matches the classified post; on mismatch, suppress UI + chain-record.
        const verification = verifyAnchorMatch(computeAnchorKey(post), post, post.domRef);
        const recovered = verification === 'match'
          ? post.domRef.deref() ?? null
          : await recoverExactPostInterventionAnchor(post);
        if (!recovered) {
          // Completed hide/collapse verdict, node gone — store for
          // act-on-re-encounter.
          storeLateVerdict(post, { kind, analysis, detectionMode: result.detectionMode, aiMeta: result.aiMeta });
          const cancelVerdict = cancelVerdictFor(verification);
          let receipt: PostInterventionReceipt = 'not-sent';
          if (cancelVerdict !== null) {
            receipt = shouldLogCancelForensic(forensicDedupKey(post))
              ? await emitCancelLog(post, cancelVerdict, analysis, result.aiMeta)
              : 'deduplicated';
          }
          finishPostIntervention(interventionAttempt, 'suppressed', verification, receipt);
          settleProtection(post, { record: 'cancel', reason: 'hide-render-gate' });
          return;
        }
        const el = recovered;
        if (post.domRef.deref() !== el) post.domRef = new WeakRef(el);
        if (!prepareCurrentPostMutation(post, el)) {
          finishPostIntervention(
            interventionAttempt,
            'suppressed',
            'stale-classification',
            'not-sent',
          );
          settleProtection(post, { record: 'verdict', reason: 'hide-mutation-not-prepared' });
          return;
        }
        // Read before the visual and the record, so both say the same kind.
        const askedKind = kind;
        kind = kindOnVideo(el, kind);
        const foldBecameHide = askedKind === 'collapse' && kind === 'hide';
        const visualApplied = applyCollapseHideVisual(el, analysis, kind, result.detectionMode, post, settings);
        // A sponsored ad left on the page because the household switched Block Ads off: nothing failed.
        const adSwitchedOff = !visualApplied
          && isSponsoredAdDetection(result.detectionMode)
          && !isFeatureEnabled(settings, 'block-ads', post.platform);
        if (visualApplied) commitProtection(
          post,
          kind === 'hide' || isSponsoredAdDetection(result.detectionMode),
        );
        // A hide that could not be applied must not uncover the post in Child:
        // the provisional cover stays (same terminal as the rewrite path's
        // 'retained'), and the record below says visualApplied:false instead
        // of attesting a hide the child never got.
        else settleProtection(post, {
          record: 'verdict',
          reason: adSwitchedOff ? 'ad-block-switched-off' : 'hide-not-applied',
          // The household chose to see the ad; a cover that stays on would hide what it asked to be shown.
          disposition: adSwitchedOff ? 'release' : 'retain-in-child',
        });

        // Memoize the HIDE/COLLAPSE verdict so subsequent re-detections of the
        // same post.id (X virtualizer remount, route-rescan stamp-strip, MO
        // re-fire) short-circuit at onPostDetected entry. Mirrors
        // sessionVerdictByPostId + sessionPassPostIds eviction pattern. Stops
        // the duplicate-Groq + marker-destroy pattern that left open popovers
        // anchored on dead references (live walk 2026-05-23).
        sessionHideCollapseByPostId.set(sessionVerdictKey(post), {
          kind,
          analysis,
          originalText: post.text,
          detectionMode: result.detectionMode,
        });
        if (sessionHideCollapseByPostId.size > MAX_SESSION_VERDICT_CACHE) {
          const keys = Array.from(sessionHideCollapseByPostId.keys());
          for (let i = 0; i < keys.length / 2; i++) sessionHideCollapseByPostId.delete(keys[i]);
        }

        const postUrl = buildPostUrl(post);
        const threshold = await getEffectiveThreshold(settings.mode);

        let receipt: PostInterventionReceipt = 'deduplicated';
        if (result.detectionMode === 'sponsored-ad:adult') {
          // Adult sponsored ad: category event, never a manipulation finding
          // (the valid half of 2026-08-02 §3d: that measurement recorded 11
          // false alarms under sponsored-ad and 11 technique labels reading
          // consumer-rapid-frame, on a phone case with a discount code, a Twix
          // flavour launch, a bread slicer and a mortgage site. The 11/85 this
          // comment used to quote mixed that count with the 85 sampled text
          // passes section 2 uses to talk about recall). Routed through the
          // same BLOCKED_LOG path as the engagement blockers (reels-blocker /
          // ai-content-blocker), so the dashboard renders the blocked-category
          // chip ('Ads') instead of a technique. Block Ads OFF, or a hide that
          // did not land: the ad stayed visible and the record below says so,
          // a pass under the sponsored row with the note naming the switch
          // (wiring audit 2026-09-13, C7: until then nothing was written, so
          // the export's paid-placement count measured ads acted on, not ads
          // served).
          if (visualApplied && shouldLogForensic(forensicDedupKey(post))) {
            const payload: BlockedEventInput = {
              platform: post.platform,
              mode: settings.mode,
              author: post.author,
              postUrl,
              blockReason: 'ads',
              matchedToken: 'platform-ad-marker',
              caption: post.text,
              feedSource: post.feedSource ?? 'unknown',
              // Same source labels + impression order the FORENSIC_LOG call
              // below passes. This path has the post; omitting them wrote 64
              // ads into the 2026-08-22 chain with no accountType, no group
              // name and no impression order, so the export could only place
              // them by chain position (completion order) and never label them
              // as advertiser.
              accountType: post.accountType,
              sourceContainer: post.sourceContainer,
              observedSequence: post.observedSequence,
              viewportSeenAt: post.viewportSeenAt,
              surfaceSessionId: post.surfaceSessionId,
              textCapture: post.textCapture,
              authorCapture: post.authorCapture,
              mediaUrls: mediaUrlsNow(post),
              metrics: recordMetricsFromPostContent(post),
              // A Facebook text ad is a post, not a video (known-issues M114).
              kind: post.kind ?? 'post',
              // The same snapshot every other emit site in this file passes.
              // Without it, 181 of the 182 snapshot-less records in the
              // 2026-09-05 export were ad blocks from this one path.
              configSnapshot: buildConfigSnapshot(settings.mode, threshold, settings.dailyCap, settings.features, settings.readFailedFallback),
              // Why: the sponsored rail, in the table's words (C14).
              decision: decisionForBlock({
                mode: settings.mode,
                blockReason: 'ads',
                matchedToken: 'platform-ad-marker',
                applied: kind,
                mask: blanketProfanitySoften(settings, post.platform),
                // The same sentence the Child and Teen ad records carry for an ad folded on a video.
                videoRule: foldBecameHide ? 'folded' : undefined,
                late: lateApply,
              }),
              reader: READER_DEFAULT,
            };
            receipt = await sendHighStakesForensicLog({ type: 'BLOCKED_LOG', payload });
          } else if (!visualApplied && shouldLogForensic(forensicDedupKey(post))) {
            const settingOff = !isFeatureEnabled(settings, 'block-ads', post.platform);
            receipt = await sendHighStakesForensicLog({
              type: 'FORENSIC_LOG',
              payload: {
                originalText: post.text,
                neutralizedText: '',
                // The ad marker is a category, never a finding: no technique
                // and no score, whatever the pipeline's analysis object holds.
                analysis: { ...analysis, techniques: [], overallScore: 0, isManipulative: false },
                ...postPayloadBase(post, settings.mode, 'rules', postUrl),
                anchorUrl: post.anchorUrl,
                accountType: post.accountType,
                sourceContainer: post.sourceContainer,
                observedSequence: post.observedSequence,
                viewportSeenAt: post.viewportSeenAt,
                surfaceSessionId: post.surfaceSessionId,
                textCapture: post.textCapture,
                authorCapture: post.authorCapture,
                mediaUrls: mediaUrlsNow(post),
                detectionMode: result.detectionMode,
                configSnapshot: buildConfigSnapshot(settings.mode, threshold, settings.dailyCap, settings.features, settings.readFailedFallback),
                kind: post.kind,
                parentVideoId: recordParentId(post),
                metrics: recordMetricsFromPostContent(post),
                // The table said collapse; the page showed the ad. verdict
                // derives from applied, so this is a pass with its why.
                decision: decisionForLegacy({
                  mode: settings.mode,
                  detectionMode: result.detectionMode,
                  techniques: [],
                  applied: 'allow',
                  mask: blanketProfanitySoften(settings, post.platform),
                  settingOff,
                  // This branch is the one where the fold did not land (a late verdict says so).
                  landed: false,
                  late: lateApply,
                }),
                reader: READER_DEFAULT,
              },
            });
          } else if (!visualApplied) {
            receipt = 'deduplicated';
          }
        } else if (shouldLogForensic(forensicDedupKey(post))) {
          await descriptorV1Settled(analysis);
          receipt = await sendHighStakesForensicLog({
            type: 'FORENSIC_LOG',
            payload: {
              originalText: post.text,
              // No rewrite for collapse/hide — placeholder text is generated
              // client-side and not part of the canonical chain. The original
              // is preserved verbatim above.
              neutralizedText: '',
              analysis,
              // Honest provenance: a hide/collapse comes from the LLM (aiMeta
              // present) OR a pre-LLM rules gate — slur / profanity / harm-floor —
              // that short-circuits with NO cloud call (aiMeta absent; see
              // pipeline.ts:395/423/462). Derive aiSource from aiMeta so a slur
              // hidden by the rules layer records as 'rules', not as an AI
              // diagnosis. aiModel/aiProvider below already omit when aiMeta is
              // absent, so the whole record stays internally consistent.
              ...postPayloadBase(post, settings.mode, result.aiMeta ? 'cloud' : 'rules', postUrl),
              anchorUrl: post.anchorUrl,
              accountType: post.accountType,
              sourceContainer: post.sourceContainer,
              observedSequence: post.observedSequence,
              viewportSeenAt: post.viewportSeenAt,
              surfaceSessionId: post.surfaceSessionId,
              textCapture: post.textCapture,
              authorCapture: post.authorCapture,
              mediaUrls: mediaUrlsNow(post),
              aiModel: result.aiMeta?.model,
              aiProvider: result.aiMeta?.provider,
              detectionMode: result.detectionMode,
              configSnapshot: buildConfigSnapshot(settings.mode, threshold, settings.dailyCap, settings.features, settings.readFailedFallback),
              kind: post.kind,
              parentVideoId: recordParentId(post),
              // Per-item engagement metrics — hidden/collapsed posts need them
              // too (was only on the rewrite path). Undefined → omitted.
              metrics: recordMetricsFromPostContent(post),
              // Omitted when the hide landed; false when it did not. A switched-off ad shows the
              // page as served, which is a pass, not a hide that failed.
              visualApplied: visualApplied || adSwitchedOff ? undefined : false,
              // Why the product acted, in the policy table's words, when the
              // legacy signal names a row (Stage 2, 2026-09-07).
              decision: analysis.judge
                ? decisionForJudge({
                    mode: settings.mode,
                    judge: analysis.judge,
                    descriptorV1: analysis.descriptorV1,
                    provider: result.aiMeta?.provider ?? FALLBACK_AI_PROVIDER,
                    applied: appliedFor(kind, visualApplied),
                    landed: visualApplied,
                    mask: blanketProfanitySoften(settings, post.platform),
                    rewrite: { attempted: false, outcome: 'off' },
                    videoRule: foldBecameHide ? 'folded' : undefined,
                    late: lateApply,
                  })
                : decisionForLegacy({
                    mode: settings.mode,
                    detectionMode: result.detectionMode,
                    techniques: analysis.techniques.filter((t) => t.present).map((t) => t.technique),
                    severity: analysis.overallScore,
                    applied: adSwitchedOff ? 'allow' : appliedFor(kind, visualApplied),
                    mask: blanketProfanitySoften(settings, post.platform),
                    videoRule: foldBecameHide ? 'folded' : undefined,
                    settingOff: adSwitchedOff,
                    landed: visualApplied,
                    late: lateApply,
                  }),
              reader: READER_DEFAULT,
            },
          });
        }
        const suppressedBySetting = adSwitchedOff;
        finishPostIntervention(
          interventionAttempt,
          visualApplied ? 'applied' : suppressedBySetting ? 'suppressed' : 'failed',
          visualApplied ? 'visual-applied' : suppressedBySetting ? 'setting-disabled' : 'visual-not-applied',
          receipt,
        );
      })().catch(err => {
        finishPostIntervention(interventionAttempt, 'failed', 'exception', 'not-sent');
        settleProtection(post, { record: 'verdict', reason: 'hide-path-threw' });
        console.error('[FeelingWise] forensic log failed (collapse/hide):', err);
      });

      // A sponsored ad is a category block, not a neutralization: it must not
      // bump the badge's neutralized counter (NEUTRALIZATION_COMPLETE →
      // incrementNeutralized), which is the popup's "actions today" hero and
      // the number on the toolbar badge. The adult variant was already out;
      // every mode is out since 2026-09-14 (rebuild plan, standing decision 1:
      // ads leave every acted number). On a real teen install this was
      // half the hero figure, and the frozen adult reader fired on none of the
      // 75 ads in the 300-item blind read. Nothing about the record changes:
      // the forensic write above is untouched, ads are counted as paid
      // placement and hidden by the user's own Block Ads rule.
      if (!isSponsoredAdDetection(result.detectionMode)) {
        const confirmedTechniques = analysis.techniques
          .filter(t => t.present)
          .map(t => t.technique);

        void safeSendMessage({
          type: 'NEUTRALIZATION_COMPLETE',
          payload: {
            postId: post.id,
            techniques: confirmedTechniques,
            confidence: analysis.overallConfidence,
          },
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Cancelled records.
    //
    // The pipeline returned action='cancelled' because the queue's per-item
    // AbortController fired before the verdict could be rendered. Two sub-kinds
    // (per ARCH §4 + types/forensic.ts:131):
    //   • cancelKind='stale'      → no analysis (signal aborted pre/during API)
    //   • cancelKind='mid-flight' → analysis preserved (LLM verdict came back
    //                               but user already moved on)
    //
    // VISION §1.1 forensic completeness: every observed post produces a chain
    // record. The CANCEL_LOG message routes through the service worker to
    // logCancelEvent which writes verdict='cancelled-*' under the same
    // chain-write-lock as flagged + pass records. Dedup gate via
    // shouldLogCancelForensic — scrolled-back same-text post doesn't
    // double-stamp the chain, but the entry is NOT consumed: a cancelled item
    // is not-yet-handled, so a re-encounter still gets the full treatment.
    //
    // No UI mutation runs here — the user already scrolled past the post. A
    // mid-flight cancel with a confirmed verdict is stored so the NEXT
    // detection of this post.id applies it directly (act-on-re-encounter).
    if (result.action === 'cancelled' && result.cancelKind) {
      // First-encounter measurement (owner-authorized 2026-08-04): counts
      // only, no behavior change on this fenced path.
      bumpCounter(result.cancelKind === 'stale' ? 'firstEncounterCancelStale' : 'firstEncounterCancelMidFlight');
      if (result.cancelKind === 'stale') noteStaleCancelled(post);
      if (result.cancelKind === 'mid-flight') {
        const late = lateVerdictFromCancelledAnalysis(result.analysis);
        if (late) storeLateVerdict(post, { ...late, detectionMode: result.detectionMode, aiMeta: result.aiMeta });
        else bumpCounter('firstEncounterMidFlightUnconfirmed');
      }
      if (shouldLogCancelForensic(forensicDedupKey(post))) {
        const verdict = result.cancelKind === 'stale' ? 'cancelled-stale' : 'cancelled-mid-flight';
        void emitCancelLog(post, verdict, result.analysis, result.aiMeta).catch(err => {
          console.error('[FeelingWise] cancel-log failed:', err);
        });
      }
    }

    // A post the pipeline could not judge says so in the chain.
    //
    // The comment path has always done this: `cancelled-batch-llm-failure`
    // exists precisely because routing a failed batch to PASS would make the
    // chain claim "FW analyzed these and they are innocent" when the truth is
    // "FW could not analyze them". The posts path did the thing that entry
    // forbids, one surface over — it returned a PASS on a genuine vendor or
    // network failure and wrote no record at all, so the chain could not even be
    // asked. A diagnostic run on 2026-08-02 showed 44 such failures in a
    // day, 36 of them inside one hour.
    //
    // The record carries no analysis, because none exists, and it is never
    // evidence of innocence. `failureKind` separates the three states that used
    // to share one pass reason: the circuit breaker declining to place a call,
    // a real vendor failure, and a fault in FeelingWise's own code.
    //
    // Cap exhaustion is deliberately NOT routed here. A reached cap is the
    // tier's defined behavior, the dashboard already surfaces it, and the
    // comment path learned the hard way that recording it per item floods the
    // chain with misleading "couldn't analyze" rows.
    if (
      result.action === 'pass'
      && result.passContext?.reason === 'pre-llm-ai-call-failed'
      && shouldLogCancelForensic(forensicDedupKey(post))
    ) {
      const failureKind = result.passContext.failureKind;
      // What answered the judge's calls, when anything did; a provider that never answered is not named.
      const answered = result.passContext.aiMeta;
      (async () => {
        const settings = await getSettings();
        const threshold = await getEffectiveThreshold(settings.mode);
        void sendHighStakesForensicLog({
          type: 'CANCEL_LOG',
          payload: {
            originalText: post.text,
            verdict: 'cancelled-post-llm-failure',
            // No analysis — no verdict was ever produced for this post.
            analysis: undefined,
            mode: settings.mode,
            platform: post.platform,
            author: post.author,
            authorName: post.authorName,
            postUrl: buildPostUrl(post),
            anchorUrl: post.anchorUrl,
            feedSource: post.feedSource ?? 'unknown',
            accountType: post.accountType,
            sourceContainer: post.sourceContainer,
            observedSequence: post.observedSequence,
            viewportSeenAt: post.viewportSeenAt,
            surfaceSessionId: post.surfaceSessionId,
            textCapture: post.textCapture,
            authorCapture: post.authorCapture,
            mediaUrls: mediaUrlsNow(post),
            aiModel: answered?.model ?? GROQ_FAST_MODEL,
            aiProvider: answered?.provider,
            configSnapshot: buildConfigSnapshot(settings.mode, threshold, settings.dailyCap, settings.features, settings.readFailedFallback),
            kind: post.kind,
            parentVideoId: recordParentId(post),
            failureKind,
          },
        });
      })().catch(err => {
        console.error('[FeelingWise] unjudged-post record failed:', err);
      });
    }

    // Text-less video record. Music-only TikToks ("original sound", no caption)
    // and other captionless videos carry no text for the detector
    // to classify, so the pipeline pre-LLM-passes them (reason
    // 'pre-llm-too-short' / 'pre-llm-non-substantive') and the post-LLM pass
    // branch below — gated on `post-llm-` — never fires. Without this branch the
    // video produces NO chain record even though its comments do, leaving the
    // chain with orphan comments under a video that was never recorded (VISION
    // §1.1 chain-mirror: every observed node produces a record). Emit one
    // benign pass record per distinct video. Dedup on `post.id`
    // (`tk-vid-<videoId>` / `yt-vid-<v>`) — the video IDENTITY, not the (empty)
    // caption text — so two different text-less videos don't collapse into one
    // and the same video re-detected on scroll doesn't spam the chain.
    //
    // YouTube joined this carve-out 2026-08-02, including the free-tier exit —
    // measured, not assumed: an instrumented /watch run on an unlicensed profile
    // logged `Pipeline L1 {postId: yt-vid-…}` followed by `PASS (free tier —
    // free)`, so the watch session reached the pipeline and left it by the
    // free-tier door, writing nothing and rendering in the dashboard as an
    // orphan thread whose own post was absent from the chain. Which reasons
    // qualify, and why the free-tier arm is YouTube-only, live in
    // `platform-policy.ts` — a pass record for content that was never assessed
    // would claim more than happened, so those reasons stay excluded.
    if (
      result.action === 'pass'
      && result.passContext
      && writesTextlessRoomRecord(post, result.passContext.reason)
      && shouldLogForensic(forensicDedupKey(post))
    ) {
      const passReason = result.passContext.reason;
      // The one record this item gets, written once, with the room's verdict
      // when the room was read in time and without it when it was not. See
      // src/content/post-path/room-verdict.ts for why it is a hold and not a second
      // write: the pipeline passes a text-less video deterministically, long
      // before its comment bucket has flushed, so there is no other way to put
      // the room's answer inside this item's only record.
      const writeTextlessVideoRecord = (room: RoomVerdict | null): void => {
        (async () => {
          const settings = await getSettings();
          const postUrl = buildPostUrl(post);
          const threshold = await getEffectiveThreshold(settings.mode);
          const configSnapshot = buildConfigSnapshot(
            settings.mode, threshold, settings.dailyCap, settings.features, settings.readFailedFallback,
          );
          const shared = {
            originalText: post.text,
            anchorUrl: post.anchorUrl,
            accountType: post.accountType,
            sourceContainer: post.sourceContainer,
            observedSequence: post.observedSequence,
            viewportSeenAt: post.viewportSeenAt,
            surfaceSessionId: post.surfaceSessionId,
            textCapture: post.textCapture,
            authorCapture: post.authorCapture,
            mediaUrls: mediaUrlsNow(post),
            configSnapshot,
            kind: post.kind,
            parentVideoId: recordParentId(post),
            metrics: recordMetricsFromPostContent(post),
          };

          if (room && room.manipulative) {
            // The comments under this caption-less video carried harm, so the
            // item is flagged on their evidence and the record says exactly
            // that. `verdictOrigin: 'room'` is the whole claim: nothing here
            // asserts the video's own words said anything, because it had
            // none. The page is not changed: the room read has never been
            // measured for accuracy (docs/audits/2026-09-07-xray/
            // xray-judgement-path.md, row J7), so it goes on the record and
            // not on the screen until it is.
            void sendHighStakesForensicLog({
              type: 'FORENSIC_LOG',
              payload: {
                ...shared,
                neutralizedText: '',
                analysis: roomVerdictAnalysis(post.id, room),
                ...postPayloadBase(post, settings.mode, 'cloud', postUrl),
                aiModel: room.aiModel,
                aiProvider: room.aiProvider,
                detectionMode: `room-verdict:${room.batchSize}`,
                verdictOrigin: 'room',
              },
            });
            return;
          }

          const benignAnalysis: AnalysisResult = room
            ? roomVerdictAnalysis(post.id, room)
            : {
                postId: post.id,
                techniques: [],
                overallScore: 0,
                overallConfidence: 0,
                isManipulative: false,
                processingTimeMs: 0,
              };
          void sendHighStakesForensicLog({
            type: 'PASS_LOG',
            payload: {
              ...shared,
              analysis: benignAnalysis,
              ...postPayloadBase(post, settings.mode, room ? 'cloud' : 'rules', postUrl),
              passReason,
              ...(room ? { aiModel: room.aiModel, aiProvider: room.aiProvider } : {}),
              detectionMode: room ? `room-verdict:${room.batchSize}` : 'combined-detect-neutralize',
              // A benign room is still a room verdict: the record says the
              // comments were read and found nothing, which is a different
              // claim from "the item's own words were read and found nothing".
              ...(room ? { verdictOrigin: 'room' as const } : {}),
            },
          });
        })().catch(err => {
          console.error('[FeelingWise] empty-caption video pass-log failed:', err);
        });
      };

      if (!isRoomJudgeable(post, passReason) || !holdForRoomVerdict(post, writeTextlessVideoRecord)) {
        writeTextlessVideoRecord(null);
      }
    }

    // The feed served this and nothing judged it: record that, and say so.
    //
    // Found on a fresh free install, 2026-09-04: twenty to thirty
    // posts of scrolling on X produced three chain records, all of them
    // deterministic-rule hits. Everything the product says about the free tier
    // ("writes down what your feed served", "free is the RECORD, paid is the
    // READING") was false, because a free install leaves the pipeline at
    // `pre-llm-free-tier-no-ai` and only `post-llm-*` passes wrote a record.
    //
    // These records claim nothing about safety. `verdict: 'skipped'` with a
    // named `skipReason`, no analysis, no techniques, no score. They are
    // excluded from every rate by construction, not by a filter someone has to
    // remember: the denominators are passed+flagged+blocked.
    //
    // NOT included, deliberately:
    //   'pre-llm-cache-pass'    — a re-sighting of an item already in the chain.
    //   'pre-llm-ai-call-failed' — already writes its own cancelled record
    //                              above, which carries the failure kind.
    // The text-less video branch above already wrote a record for the videos it
    // covers, so those are skipped here to avoid two records for one item.
    if (
      result.action === 'pass'
      && result.passContext
      && SKIP_RECORD_REASONS.has(result.passContext.reason)
      && !writesTextlessRoomRecord(post, result.passContext.reason)
      // Dedup on platform, id and text, so a caption-less video and a
      // re-scrolled post each write once.
      && shouldLogForensic(forensicDedupKey(post))
    ) {
      (async () => {
        const settings = await getSettings();
        // The mode the pipeline declined under, not the mode now. This block
        // runs after the verdict, and a mode switch in between would otherwise
        // sign the record under a mode the pipeline never saw.
        const mode = result.judgedMode ?? settings.mode;
        const postUrl = buildPostUrl(post);
        const threshold = await getEffectiveThreshold(mode);
        void sendHighStakesForensicLog({
          type: 'SKIPPED_LOG',
          payload: {
            originalText: post.text,
            mode,
            platform: post.platform,
            author: post.author ?? '',
            authorName: post.authorName,
            postUrl,
            // The record names the gate, not the tier, so a reader can tell
            // "you have no licence" from "there was nothing to read".
            skipReason: result.passContext!.reason.replace(/^pre-llm-/, ''),
            kind: post.kind,
            parentVideoId: recordParentId(post),
            feedSource: post.feedSource ?? 'unknown',
            configSnapshot: buildConfigSnapshot(mode, threshold, settings.dailyCap, settings.features, settings.readFailedFallback),
            // Read from the DOM at extraction, before the engagement hider
            // covered them. This is what makes "how much engagement was hidden
            // from you" answerable at all.
            metrics: recordMetricsFromPostContent(post),
            accountType: post.accountType,
            sourceContainer: post.sourceContainer,
            observedSequence: post.observedSequence,
            viewportSeenAt: post.viewportSeenAt,
            surfaceSessionId: post.surfaceSessionId,
            textCapture: post.textCapture,
            authorCapture: post.authorCapture,
            mediaUrls: mediaUrlsNow(post),
          },
        });
      })().catch(err => {
        console.error('[FeelingWise] skipped-record log failed:', err);
      });
    }

    // Post-LLM pass records. When the pipeline returned `action='pass'` AND
    // `passContext.reason` starts with 'post-llm-' (the LLM ran and decided
    // no), emit a forensic record with verdict='pass' so the recall
    // instrument can sample these for false-negative detection. The forensic
    // chain becomes a recall instrument, not just a precision instrument.
    //
    // Pre-LLM passes do not route to the forensic PASS block below. The one
    // exception for session continuity is `pre-llm-cache-pass`: it reuses an
    // earlier authoritative detector PASS and is memoized without a new record.
    // Too-short/cap/gate/provider exits remain retryable and are captured only
    // by the SCAN_LOG denominator above.
    //
    // Dedup gate via shouldLogForensic: same content hash within session
    // skips re-logging — matches the flagged-record dedup contract so a
    // scrolled-back same-text post doesn't spam the chain.
    if (
      result.action === 'pass'
      && isAuthoritativeSessionPassReason(result.passContext?.reason)
    ) {
      // Memoize an authoritative fresh or persistent-cache PASS so subsequent
      // re-detections short-circuit at onPostDetected (sessionPassPostIds
      // lookup). Bounded at MAX_SESSION_VERDICT_CACHE; oldest half pruned when
      // at cap. Mirrors sessionVerdictByPostId's eviction pattern.
      rememberSessionPass(post);
    }
    if (
      result.action === 'pass'
      && result.passContext?.reason.startsWith('post-llm-')
    ) {
      notePostPassAfterIntervention(`${post.platform}:${post.id}`, `${post.platform} ${post.id}`);
    }
    if (
      result.action === 'pass'
      && result.passContext
      && result.passContext.reason.startsWith('post-llm-')
      && result.passContext.analysis
      && shouldLogForensic(forensicDedupKey(post))
    ) {
      (async () => {
        const settings = await getSettings();
        const postUrl = buildPostUrl(post);
        const threshold = await getEffectiveThreshold(settings.mode);
        void sendHighStakesForensicLog({
          type: 'PASS_LOG',
          payload: {
            originalText: post.text,
            analysis: result.passContext!.analysis,
            ...postPayloadBase(post, settings.mode, 'cloud', postUrl),
            passReason: result.passContext!.reason,
            // A pass the measured judge read carries its reading: the row is
            // D1 or J8, the action allow, and the record can say who read it.
            ...(result.passContext!.analysis?.judge
              ? {
                  decision: decisionForJudge({
                    mode: settings.mode,
                    judge: result.passContext!.analysis!.judge,
                    provider: result.passContext!.aiMeta?.provider ?? FALLBACK_AI_PROVIDER,
                    applied: 'allow',
                    mask: blanketProfanitySoften(settings, post.platform),
                    rewrite: null,
                  }),
                  reader: READER_DEFAULT,
                }
              : {}),
            anchorUrl: post.anchorUrl,
            accountType: post.accountType,
            sourceContainer: post.sourceContainer,
            observedSequence: post.observedSequence,
            viewportSeenAt: post.viewportSeenAt,
            surfaceSessionId: post.surfaceSessionId,
            textCapture: post.textCapture,
            authorCapture: post.authorCapture,
            mediaUrls: mediaUrlsNow(post),
            aiModel: result.passContext!.aiMeta?.model,
            aiProvider: result.passContext!.aiMeta?.provider,
            // W45: the pipeline stamps which judge variant adjudicated
            // (combined-detect-neutralize vs combined-detect-only, W44); the
            // fallback covers older result shapes with no stamp.
            detectionMode: result.detectionMode ?? 'combined-detect-neutralize',
            configSnapshot: buildConfigSnapshot(settings.mode, threshold, settings.dailyCap, settings.features, settings.readFailedFallback),
            // split-forensic. Pass records on a comment also need
            // the parent video link so dashboard groups N comments + the
            // caption together regardless of verdict mix.
            kind: post.kind,
            parentVideoId: recordParentId(post),
            // Per-item engagement metrics (likes/views/shares/comments). PASSED
            // posts are the BULK of the feed, so without this the dashboard metric
            // row + popularity-over-time were empty for almost every post — only
            // the rewrite path carried metrics before (measured on a fresh chain,
            // 2026-06-15: 0/14 passed twitter posts had metrics). Undefined → omitted.
            metrics: recordMetricsFromPostContent(post),
          },
        });
      })().catch(err => {
        console.error('[FeelingWise] pass-log failed:', err);
      });
    }

    // Author intelligence: update profile for every processed post (flagged or not); a late apply is the same
    // post the cancelled result already counted.
    if (post.author && !lateApply) {
      // An advertiser is still SEEN on every placement, and never flagged by
      // one: the ad marker is a category, not a reading of the item (rebuild
      // plan 2026-09-14, standing decision 1). Without this the frequent-
      // flaggers panel and the per-author flag rate read a brand's ad budget
      // as a record of harm.
      const flagged = result.action !== 'pass' && !isSponsoredAdDetection(result.detectionMode);
      const techniques = flagged && result.neutralized
        ? result.neutralized.analysis.techniques.filter(t => t.present).map(t => t.technique)
        : [];
      void safeSendMessage({
        type: 'AUTHOR_UPDATE',
        payload: {
          author: post.author,
          platform: post.platform,
          flagged,
          techniques,
          // Exposure counters: which day this source reached the reader, and
          // which piece of copy. Stamped here rather than in the pipeline
          // because this runs once per processed post including cache hits,
          // so a re-served advert still counts.
          day: new Date().toISOString().slice(0, 10),
          textHash: post.text ? creativeHash(post.text) : undefined,
        },
      });
    }
  }

  function onProcessingResult(post: PostContent, result: PipelineResult): void {
    processResult(post, result, false);
  }

  return {
    applyNeutralizedRewriteTerminal,
    applyCommentRewriteTerminal,
    applyCachedVerdictDirect,
    applyLateVerdictDirect,
    applyCachedHideCollapseDirect,
    onProcessingResult,
  };
}
