// FeelingWise - Video Pipeline Orchestrator
// Handles comment CONTENT only: detection → extraction → AI rewriting → overlay injection
// for video-first platforms (YouTube, TikTok, Instagram).
// All engagement hiding/blocking is handled by the engagement controller.

import type { Platform } from '../../types/post';
import type { Mode } from '../../types/mode';
import { getSettings, isFeatureEnabled, isCommentRewriteEnabled, getFeatureValue } from '../../storage/settings';
import { safeSendMessage } from '../../storage/context-guard';
import { sendHighStakesForensicLog } from '../record/forensic-retry';
import { forensicPayloadBase } from '../../forensics/payload-base';
// An audit's tree view showed duplicate comment
// records (same text appearing twice within a room). Root cause: this file's
// FORENSIC_LOG / PASS_LOG emissions were missing the `shouldLogForensic`
// content-hash dedup gate that content/index.ts comment-batch path uses.
// When BOTH paths fire on the same comment (comment-batch scoring +
// comment-rewriter), two records land in the chain. Importing the gate
// here unifies the dedup contract.
import { forensicDedupKey, shouldLogForensic } from '../record/forensic-gate';
import { extractComments } from '../platforms/comment-extractors';
import { isInPrivateChatSubtree } from '../platforms/adapter';
import { resetTikTokVideoDedup } from '../platforms/tiktok';
import { scoreAndRankComments } from '../../analysis/comment-scorer';
import {
  findCommentEntries,
  hideCommentTerminal,
  type CommentHideNotice,
  recordedCommentHideAction,
  type CommentEntry,
} from '../protection/comment-overlay';
import { preRewriteHarmFloorGate, type HideEntry } from '../protection/pre-rewrite-harm-floor-gate';
import { commentHideNoticeFor } from '../markers/comment-hide-notice';
import { decisionForLegacy, READER_DEFAULT } from '../record/decision';
import { currentPageAddress } from '../record/post-url';
import { resolveUiLanguage, type ResolvedUiLanguage } from '../../i18n';
import { createRafBodyObserver } from './raf-observer';
import { receiptsRuns } from '../../storage/switch-scope';

// previous dev-helper `window.__fwDebugComments()` didn't work —
// content scripts run in an isolated world, their `window` is separate from
// the page's world where the DevTools Console runs by default. The helper
// was never reachable. Replaced by automatic diagnostic dump in
// `findCommentEntries` (comment-overlay.ts) — logs the first failing node's
// outerHTML whenever the DOM-selector heuristics reject candidates. No need
// to call anything manually; dumps appear in the console on every scan.

// ─── parentVideoId helper for forensic chain logging ───
//
// Per-platform URL → opaque video-ID extraction. The forensic-chain `parentVideoId`
// field groups records sharing the same parent video (per existing TikTok adapter
// convention `tk-vid-${videoId}` at platforms/tiktok.ts:226). The comment-rewrite
// path needs the same ID so dashboard can group rewrites under their video.
//
// Returns undefined when the URL doesn't match the platform's video pattern
// (e.g., on /foruyou before navigation to a specific video, or on a platform
// where the URL doesn't carry a video ID). Forensic logging tolerates undefined
// parentVideoId (caller passes it through to logForensicEvent which marks the
// field optional).
//
// `urlOverride` parameter is optional (testability — jsdom blocks cross-origin
// `history.replaceState` so unit tests pass URL strings directly).
function derivePlatformVideoId(platform: Platform, urlOverride?: string): string | undefined {
  let pathname: string;
  let search: string;
  if (urlOverride) {
    try {
      const u = new URL(urlOverride);
      pathname = u.pathname;
      search = u.search;
    } catch {
      return undefined;
    }
  } else if (typeof location !== 'undefined') {
    pathname = location.pathname;
    search = location.search;
  } else {
    return undefined;
  }
  if (platform === 'tiktok') {
    // URL pattern: /@username/video/<numeric-id>. Returns BARE digits to
    // match the parentVideoId the TikTok adapter (platforms/tiktok.ts) and
    // forensic-join.ts (parentVideoIdFromPostUrl) stamp on caption + comment
    // records. A `tk-vid-` prefix here split pre-rewrite-hidden TikTok
    // comments into their own dashboard group (grouping is by parentVideoId).
    const m = pathname.match(/\/video\/(\d+)/);
    return m ? m[1] : undefined;
  }
  if (platform === 'youtube') {
    const v = new URLSearchParams(search).get('v');
    return v ? `yt-vid-${v}` : undefined;
  }
  if (platform === 'instagram') {
    // URL pattern: /p/<id> or /reel/<id>
    const m = pathname.match(/\/(p|reel)\/([^/?]+)/);
    return m ? `ig-${m[1]}-${m[2]}` : undefined;
  }
  return undefined;
}

// Exported for unit testing.
export { derivePlatformVideoId };

// ─── Canonical post URL builder for forensic-chain logging ───
//
// Builds a deterministic post URL from a parentVideoId (and optional
// commentId for deep-linking). Used instead of `location.href` at log
// time to avoid the stale-URL race: the comment pipeline's AI step is
// async, so `location.href` can change mid-flight if the user
// SPA-navigates away from the video. parentVideoId is captured
// synchronously at pipeline-start and is deterministic.
//
// Falls back to `location.href` (with the known stale risk) when the
// platform's parentVideoId pattern doesn't match — e.g., legacy records
// or platforms without a `derivePlatformVideoId` mapping.
function buildCanonicalPostUrl(
  platform: Platform,
  parentVideoId: string | undefined,
  commentId: string | undefined,
): string {
  const fallback = currentPageAddress();
  if (!parentVideoId) return fallback;
  if (platform === 'youtube' && parentVideoId.startsWith('yt-vid-')) {
    const vid = parentVideoId.slice('yt-vid-'.length);
    const base = `https://www.youtube.com/watch?v=${vid}`;
    return commentId ? `${base}&lc=${commentId}` : base;
  }
  if (platform === 'tiktok' && /^\d+$/.test(parentVideoId)) {
    // parentVideoId is bare digits (matches the adapter + forensic-join id
    // format). The `@/video/<id>` form lacks a creator handle and does not
    // resolve on TikTok; the dashboard FeedCard rebuilds a handled URL from
    // the record author at display time, so this canonical fallback is only
    // used when that path is unavailable.
    return `https://www.tiktok.com/@/video/${parentVideoId}`;
  }
  if (platform === 'instagram') {
    if (parentVideoId.startsWith('ig-p-')) {
      return `https://www.instagram.com/p/${parentVideoId.slice('ig-p-'.length)}/`;
    }
    if (parentVideoId.startsWith('ig-reel-')) {
      return `https://www.instagram.com/reel/${parentVideoId.slice('ig-reel-'.length)}/`;
    }
  }
  return fallback;
}

// ─── Comments container discovery (per-platform) ───

// Exported for unit testing (META-1 DM-gate coverage).
export function getCommentsContainer(platform: Platform): HTMLElement | null {
  switch (platform) {
    case 'youtube':
      return document.querySelector<HTMLElement>('ytd-comments#comments');
    case 'tiktok': {
      // (post-G1.7) — TikTok 2026 build switched to a virtualized
      // div-tree: [class*="DivCommentListContainer"] → DivVirtualItemContainer
      // → … → [data-e2e="comment-username-N"] items. No <ul>, no
      // [data-e2e="comment-list"]. MCP DOM probe confirmed all
      // three legacy branches returned null on this build. The class-suffix
      // selector survives TikTok's CSS-in-JS hash rotation (the readable
      // suffix after the `--` separator persists across rotations).
      const virtualized = document.querySelector<HTMLElement>(
        '[class*="DivCommentListContainer"]'
      );
      if (virtualized && virtualized.children.length >= 1) return virtualized;

      const primary = document.querySelector<HTMLElement>('[data-e2e="comment-list"]');
      if (primary && primary.children.length >= 1) return primary;

      const commentPanel = document.querySelector<HTMLElement>(
        '[data-e2e="comment-panel"], [data-e2e="browse-comment"], [class*="CommentPanel"]'
      );
      if (commentPanel) {
        const ul = commentPanel.querySelector<HTMLElement>('ul');
        if (ul && ul.children.length >= 1) return ul;
      }

      const allULs = document.querySelectorAll<HTMLElement>('ul');
      for (const ul of allULs) {
        if (ul.children.length < 2) continue;
        if (ul.dataset.fwProcessed === 'true') continue;
        let commentLike = 0;
        for (const child of Array.from(ul.children).slice(0, 5)) {
          if (child instanceof HTMLElement && child.querySelector('a[href*="/@"]')) {
            commentLike++;
          }
        }
        if (commentLike >= 2) return ul;
      }

      return null;
    }
    case 'instagram': {
      // META-1 DM gate: return a comment <ul> only from an <article> that is
      // NOT inside a private conversation subtree (role="log" / chat overlay),
      // so a DM bubble's list can't be wired into the rewrite pipeline.
      const articles = document.querySelectorAll<HTMLElement>('article');
      for (const article of articles) {
        if (isInPrivateChatSubtree(article)) continue;
        const ul = article.querySelector<HTMLElement>('ul[class]');
        if (ul) return ul;
      }
      return null;
    }
    case 'facebook': {
      // Facebook comments are inside UL elements within article containers
      const articles = document.querySelectorAll<HTMLElement>('div[role="article"]');
      for (const article of articles) {
        // META-1 DM gate: skip Messenger chat bubbles (role="article" nested
        // in role="log" / a chat-overlay dialog).
        if (isInPrivateChatSubtree(article)) continue;
        const lists = article.querySelectorAll<HTMLElement>('ul');
        for (const ul of lists) {
          if (ul.children.length < 2) continue;
          // Check if children look like comments (have author links and text)
          let commentLike = 0;
          for (const child of Array.from(ul.children).slice(0, 5)) {
            if (child instanceof HTMLElement && child.querySelector('a[role="link"]')) {
              commentLike++;
            }
          }
          if (commentLike >= 2) return ul;
        }
      }
      return null;
    }
    default:
      return null;
  }
}

// ─── Module-level state ───

let currentPipelineId = '';

// Single-in-flight + debounce for tryDetectComments. YouTube's Polymer
// reconciler replaces `ytd-comments#comments` on tab/scroll changes, so the
// `container.dataset.fwProcessed === 'true'` dedup gate at
// `tryDetectComments` fails: each replacement is a fresh element with no
// stamp. The MutationObserver fires on every body-subtree change (thousands
// per second on /watch), and each fire that finds an unmarked container
// kicks off a fresh `runCommentPipeline` — multiple pipelines run
// concurrently, fight over the overlay, saturate CPU, and produce the
// "freezes / things appear and disappear" symptom reported from a live install.
//
// `inFlightPipelineCount` blocks a new pipeline while an earlier one is
// still running (the AI call takes 1-3s). `lastPipelineStartAt` adds a
// post-completion cooldown so the very next mutation tick after a finished
// pipeline doesn't immediately re-trigger.
let inFlightPipelineCount = 0;
let lastPipelineStartAt = 0;
const PIPELINE_DEBOUNCE_MS = 1500;

// `streamObserver` state + `attachStreamObserver` /
// `detachStreamObserver` removed alongside v3-pipeline purge. The observer
// was a v3-only singleton (only attached after v3 took ownership; v2 path
// uses the per-flush MutationObserver in interceptor.ts).

// --- Video metadata extraction ---

function getCurrentVideoTitle(platform: Platform): string {
  switch (platform) {
    case 'youtube': {
      const el = document.querySelector<HTMLElement>(
        'h1.ytd-watch-metadata yt-formatted-string, h1.title yt-formatted-string'
      );
      return el?.textContent?.trim() || document.title;
    }
    case 'tiktok': {
      const el = document.querySelector<HTMLElement>(
        '[data-e2e="browse-video-desc"], [data-e2e="video-desc"]'
      );
      return el?.textContent?.trim() || document.title;
    }
    case 'instagram':
      return document.title;
    default:
      return document.title;
  }
}

function getCurrentVideoDescription(platform: Platform): string {
  switch (platform) {
    case 'youtube': {
      const el = document.querySelector<HTMLElement>(
        'ytd-text-inline-expander #snippet-text, ytd-expander #description'
      );
      return el?.textContent?.trim().slice(0, 300) || '';
    }
    case 'tiktok':
    case 'instagram':
      return '';
    default:
      return '';
  }
}

// --- Forensic logging ---

function logScanEvent(
  platform: Platform,
  action: 'comments-hidden' | 'comments-educational' | 'comments-rewritten' | 'pass',
  videoTitle: string,
): void {
  void safeSendMessage({
    type: 'SCAN_LOG',
    payload: {
      platform,
      action,
      feedSource: 'video' as const,
      author: 'unknown',
      postId: videoTitle.slice(0, 80),
      timestamp: new Date().toISOString(),
    },
  });
}

// the educational-rewrite scaffolding
// (logEducationalRewriteEvent, EDU_REWRITE_* constants, EduRewriteContext,
// the per-video rewrite cache, attachEducationalRewriteObserver,
// detachEducationalRewriteObserver, runEducationalRewriteDeltaPass,
// runEducationalRewritePass) was removed alongside the
// `replace-toxic-with-educational` feature deletion. ~330 lines removed.

// ─── hide-tier application + forensic chain (legacy path port) ───
//
// Find each hide-target's unique DOM row inside the comments container, prove
// the hidden terminal, and emit the applied outcome. The
// shouldLogForensic content-hash dedup gate () prevents double records
// when both paths fire on the same comment.

/**
 * Build the canonical FORENSIC_LOG shared-fields object for a pre-rewrite-
 * hide record. Pure function: no side effects, no DOM access. Exported so
 * the attribution surface can be unit-tested without standing up the full
 * pipeline. See tests/unit/content/post-path/pre-rewrite-hide-forensic-attribution.test.ts.
 *
 * The non-LLM attribution values (aiSource='rules', aiModel='fw-harm-floor-
 * regex-v1', aiProvider='fw-rules') are the audit-truth: this path is a
 * regex-based harm-floor gate, no network call happens. The chain payload
 * must reflect that — Promise 1 §"every flag carries a why" requires
 * honest verdict provenance.
 */
export function buildPreRewriteHideForensicFields(
  hide: HideEntry,
  platform: Platform,
  mode: Mode,
  parentVideoId: string | undefined,
  canonicalPostUrl: string,
) {
  return {
    originalText: hide.raw.text,
    ...forensicPayloadBase({
      mode,
      platform,
      aiSource: 'rules',
      author: hide.raw.authorHandle,
      postUrl: canonicalPostUrl,
      feedSource: 'video',
    }),
    aiModel: 'fw-harm-floor-regex-v1',
    aiProvider: 'fw-rules',
    detectionMode: `pre-rewrite-hide:${hide.reason}`,
    configSnapshot: undefined,
    kind: 'comment' as const,
    parentVideoId,
  };
}

export function applyUniquePreRewriteHide(
  hide: HideEntry,
  entries: CommentEntry[],
  notice: CommentHideNotice | null = null,
): boolean {
  const expectedText = hide.raw.text.trim();
  const textMatches = entries.filter((entry) => entry.text.trim() === expectedText);
  const extractedRow = hide.raw.domRef?.deref() ?? null;
  if (extractedRow?.isConnected) {
    const rowMatches = textMatches.filter((entry) =>
      entry.rootEl === extractedRow
      || entry.rootEl.contains(extractedRow)
      || extractedRow.contains(entry.rootEl),
    );
    if (rowMatches.length !== 1) return false;
    return hideCommentTerminal(rowMatches[0], notice);
  }

  const expectedAuthor = (hide.raw.authorHandle?.trim() ?? '')
    .replace(/^@/, '')
    .toLocaleLowerCase();
  if (expectedAuthor) {
    const authorMatches = textMatches.filter((entry) =>
      entry.author.trim().replace(/^@/, '').toLocaleLowerCase() === expectedAuthor,
    );
    if (authorMatches.length === 1) {
      return hideCommentTerminal(authorMatches[0], notice);
    }
    return false;
  }

  if (textMatches.length !== 1) return false;
  return hideCommentTerminal(textMatches[0], notice);
}

function applyPreRewriteHides(
  hides: HideEntry[],
  container: HTMLElement,
  platform: Platform,
  mode: Mode,
  parentVideoId: string | undefined,
  lang: ResolvedUiLanguage,
): void {
  if (hides.length === 0) return;

  const entries = findCommentEntries(container, platform);
  let hidesApplied = 0;

  for (const hide of hides) {
    // Teen and Adult: the sentence where the comment was, naming the slur row
    // when the gate fired on the slur list, the plain sentence for a profanity
    // tier (the table has no hide row for swearing). Child: the silent close.
    const notice = commentHideNoticeFor(mode, lang, {
      detectionMode: `pre-rewrite-hide:${hide.reason}`,
      techniques: ['profanity'],
      severity: 9,
    });
    // The hide happens first and unconditionally. It used to sit behind the
    // forensic gate, and the `continue` skipped it along with the record, so a
    // SECOND comment carrying the same words as one already hidden this session
    // was left on the page for the reader to see. On a child install that is the
    // protection failing, not a missing row (found by an adversarial read of the
    // capture path, 2026-09-18). A logging gate must never decide whether the
    // product acts.
    const hideApplied = applyUniquePreRewriteHide(hide, entries, notice);
    if (hideApplied) hidesApplied++;

    // Now the record, deduplicated on the comment's own identity rather than on
    // its words. Every other caller of this gate passes forensicDedupKey; this
    // one passed the raw text, which also wrote text-only keys into the shared
    // set that no key-shaped lookup could ever match again.
    // The comment's own id when the extractor captured one; otherwise its
    // author and time, because the case this exists for is two DIFFERENT people
    // writing the same words, and those two differ in the author even when the
    // platform gave no id.
    const commentIdentity = hide.raw.commentId
      ?? `${hide.raw.authorHandle}@${hide.raw.timestamp}`;
    if (!shouldLogForensic(forensicDedupKey({
      platform,
      id: commentIdentity,
      text: hide.raw.text,
    }))) continue;

    const techniques = [{
      technique: 'profanity' as never,
      present: true,
      severity: 9,
      confidence: 0.95,
      evidence: hide.matches,
    }];
    const analysisLike = {
      techniques,
      // Severity 0-10 scale (matches techniques[].severity = 9 above and
      // dashboard SeverityBadge thresholds). overallConfidence is 0-1.
      overallScore: 9,
      overallConfidence: 0.95,
      isManipulative: true,
      action: recordedCommentHideAction(hideApplied),
    };
    // postUrl is derived from parentVideoId (deterministic, captured at
    // pipeline-start). Reading `location.href` here used to stamp the
    // record with the CURRENT URL — but the AI scoring step is async, so
    // if the user SPA-navigated to the homepage during the wait,
    // `location.href` returned the homepage URL and the record's
    // view-original landed on YouTube's homepage instead of the video
    // (reported from a live install, 2026-05-24). The dashboard FeedCard also derives
    // canonical URLs at display time as a safety net for OLD records.
    const canonicalPostUrl = buildCanonicalPostUrl(
      platform,
      parentVideoId,
      hide.raw.commentId,
    );
    const sharedFields = buildPreRewriteHideForensicFields(
      hide,
      platform,
      mode,
      parentVideoId,
      canonicalPostUrl,
    );
    void sendHighStakesForensicLog({
      type: 'FORENSIC_LOG',
      payload: {
        ...sharedFields,
        neutralizedText: '',
        analysis: analysisLike,
        // Why the product acted (Stage 2, 2026-09-07): the slur rail names its
        // row; a profanity-tier hide names none and writes no block.
        decision: decisionForLegacy({
          mode,
          detectionMode: `pre-rewrite-hide:${hide.reason}`,
          techniques: ['profanity'],
          severity: 9,
          applied: hideApplied ? 'hide' : 'mark',
          mask: false,
        }),
        reader: READER_DEFAULT,
      },
    });
  }

  if (hidesApplied > 0) {
    console.log(
      `[FeelingWise] runCommentPipeline ${platform}: pre-rewrite gate hid ${hidesApplied}/${hides.length} comments`,
    );
  }
}

// ─── Comment pipeline (runs when comment container appears) ───

async function runCommentPipeline(
  platform: Platform,
  videoTitle: string,
  videoDescription: string,
): Promise<void> {
  const pipelineId = `${platform}-${Date.now()}`;
  currentPipelineId = pipelineId;

  // YT /watch SPA-nav race guard. The entry gate (isYouTubeWatchPage in
  // tryDetectComments) is evaluated BEFORE this async pipeline launches;
  // YouTube can SPA-navigate (home/channel → /watch) mid-flight, landing the
  // pipeline on a watch page it must never run on (the comment-tree DOM walks
  // here are part of the /watch OOM surface). Re-check at call time so a
  // mid-flight hop aborts before any extraction or rewrite work.
  if (
    platform === 'youtube'
    && typeof window !== 'undefined'
    && window.location.pathname.startsWith('/watch')
  ) {
    return;
  }

  const settings = await getSettings();
  const mode = settings.mode;
  const language = 'English';
  // / comment-handling routes now driven by feature
  // toggles, not mode-branches. Mode is retained as a tag for forensic
  // logging only.
  // replaceWithEducational lookup removed.
  // YouTube is capture-only by product rule (decided 2026-06-07) — never rewrite
  // comments here. isCommentRewriteEnabled returns false for youtube regardless
  // of the user toggle, so this path reports/acts as no-rewrite on YouTube.
  const rewriteComments = isCommentRewriteEnabled(settings, platform);
  // Comment posting is Off's switch; Receipts never hides the section for it.
  const blockCommentSection = receiptsRuns('block-comment-posting') && isFeatureEnabled(
    settings, 'block-comment-posting', platform,
  );
  const commentsToAnalyze = getFeatureValue<number>(
    settings, 'comments-to-analyze-per-video', platform,
  ) ?? 25; // preset default; getSettings backfills the feature id, so this is a type-level fallback only

  // surface which comment-handling path the pipeline routes into.
  // Lets a live test diagnose whether the feature toggles expected ON
  // are actually being picked up by isFeatureEnabled (which reads the
  // features grid with per-platform overrides).
  console.log(
    `[FeelingWise] runCommentPipeline ${platform}: rewriteComments=${rewriteComments} blockCommentSection=${blockCommentSection} count=${commentsToAnalyze}`,
  );

  // v3 first-branch removed. v3-pipeline scaffolding
  // was purged; v2 runs unconditionally. The Faza 1 pre-attempted
  // `runV3OnCurrentVideo` first and short-circuited the v2 path when v3
  // took ownership. With v3 gone, control flows directly into
  // feature-gated comment routing below.

  // / feature-gated comment routing. Three exclusive
  // outcomes — (i) educational replacement (parent-opt-in stealth, VISION
  // `replaceWithEducational` branch removed alongside
  // the educational-replacement feature. The remaining decisions: hide
  // (block-comment-posting), rewrite (rewritten-comments-first), or pass.
  if (blockCommentSection && !rewriteComments) {
    logScanEvent(platform, 'comments-hidden', videoTitle);
    return;
  }

  if (!rewriteComments) {
    logScanEvent(platform, 'pass', videoTitle);
    return;
  }

  // Extract + score comments for the teen-rewrite path.
  const rawComments = extractComments(platform);
  const batch = scoreAndRankComments(rawComments, commentsToAnalyze);

  if (currentPipelineId !== pipelineId) return; // Stale check

  // Prefer container already discovered by engagement controller
  let container: HTMLElement | null =
    document.querySelector<HTMLElement>('[data-fw-comment-section]');
  if (!container) {
    container = getCommentsContainer(platform);
  }
  if (!container) {
    logScanEvent(platform, 'pass', videoTitle);
    return;
  }

  // — pre-rewrite harm-floor gate. Identity-slur and sexual/violence/drug
  // profanity-tier matches route to DOM-hide instead of the model rewrite path
  // (which is unreliable on slur-laden / sexual / violence / drug content —
  // empty output, synonym swap, validator rejection). Mirrors the BATCH-path
  // hide-tier dispatch at src/analysis/comment-batch-scorer.ts:716-748.
  const gateResult = preRewriteHarmFloorGate(batch.top, mode);
  const hidesToApply = gateResult.hidesToApply;
  const commentsToRewrite = gateResult.commentsToRewrite;

  if (hidesToApply.length > 0) {
    applyPreRewriteHides(
      hidesToApply,
      container,
      platform,
      mode,
      derivePlatformVideoId(platform),
      resolveUiLanguage(settings.uiLanguage),
    );
  }

  // Comment-rewrite for video-first platforms (TikTok, IG, YT, FB Reels) is
  // owned by the BATCH path at `src/content/index.ts:flushBatch`. The legacy
  // v2 rewrite block that lived here produced duplicate Groq round-trips,
  // DOM-swap conflicts, and admitted non-manipulation verdicts into the
  // rewriter; it has been removed. pre-rewrite harm-floor hides above
  // stay in place as defense-in-depth for identity-slur / profanity-tier
  // matches.
  logScanEvent(platform, 'pass', videoTitle);
}

// --- SPA navigation handling ---

function onNavigate(platform: Platform): void {
  // Remove any injected overlays from previous video (both old and new class names)
  document.querySelectorAll('.fw-overlay, .fw-comment-overlay, .fw-comments-placeholder').forEach(el => el.remove());

  // Reset the post-completion debounce so the next tryDetectComments after
  // navigation isn't blocked by the prior video's cooldown. inFlightPipeline
  // Count self-resolves via .finally(); we don't reset it here because the
  // prior pipeline may still be running and must complete its cleanup.
  lastPipelineStartAt = 0;

  // TikTok keeps a session-scoped video-record dedup set keyed on the URL
  // video id. SPA back-nav re-mounts a previously-seen video on a fresh
  // container (no fwCaptionEmitted stamp), but the dedup set still held the
  // id and suppressed the caption — leaving a chain-mirror gap for the new
  // visit (VISION §1.1: record what the child saw). Clearing it here lets the
  // re-visited video re-record. The DOM-stamp clears below still guard
  // within-visit re-extraction.
  if (platform === 'tiktok') {
    resetTikTokVideoDedup();
  }

  // `clearV3Overlay()` and `detachStreamObserver()`
  // removed alongside v3-pipeline purge.

  // Reset processing flags on comment containers so MutationObserver re-detects.
  // (C-1) — TikTok's For You feed reuses comment-list elements across
  // videos OR keeps prior video's container in DOM. Clearing only the
  // getCommentsContainer-returned match was insufficient: the next
  // tryDetectComments call could re-pick a stale-but-marked sibling container
  // and silently skip the pipeline (return early at the fwProcessed === 'true'
  // gate). Diagnostic surfaced by a live TikTok scroll where comments
  // visually present on multiple videos never appeared in console as analyzed.
  // Fix: clear fwProcessed on ALL TikTok comment-list / Instagram / YouTube
  // candidate selectors so whichever container is active next gets a fresh run.
  document.querySelectorAll<HTMLElement>(
    '[data-e2e="comment-list"], [data-e2e="comment-panel"], [data-e2e="browse-comment"], [class*="DivCommentListContainer"], ytd-comments#comments, [data-fw-comment-section]',
  ).forEach((el) => {
    delete el.dataset.fwProcessed;
    delete el.dataset.fwHidden;
    el.removeAttribute('data-fw-comment-container');
    el.style.display = '';
    el.style.visibility = '';
    el.style.maxHeight = '';
    el.style.overflow = '';
  });
  const container = getCommentsContainer(platform);
  if (container) {
    delete container.dataset.fwProcessed;
    delete container.dataset.fwHidden;
    container.removeAttribute('data-fw-comment-container');
    container.style.display = '';
    container.style.visibility = '';
    container.style.maxHeight = '';
    container.style.overflow = '';
  }
}

// `onNav` is the single navigation handler the caller owns (it runs
// onNavigate + re-arms the comment fallback poll). Passing it in keeps ONE
// registration per event — a prior inline duplicate fired onNavigate twice
// per SPA navigation.
function setupNavigationListeners(platform: Platform, handleNav: () => void): () => void {
  const handlers: (() => void)[] = [];

  if (platform === 'youtube') {
    // YouTube fires a custom event on SPA navigation
    document.addEventListener('yt-navigate-finish', handleNav);
    handlers.push(() => document.removeEventListener('yt-navigate-finish', handleNav));
  }

  if (platform === 'tiktok' || platform === 'instagram') {
    // TikTok and Instagram: popstate + URL polling for swipe/tap navigation
    window.addEventListener('popstate', handleNav);
    handlers.push(() => window.removeEventListener('popstate', handleNav));

    let lastUrl = location.href;
    const urlPollTimer = setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        handleNav();
      }
    }, 1000);
    handlers.push(() => clearInterval(urlPollTimer));
  }

  return () => handlers.forEach(fn => fn());
}

// ─── Init (entry point) ───

const FALLBACK_POLL_INTERVAL_MS = 2000;
const FALLBACK_MAX_ATTEMPTS = 10;

export function initVideoPipeline(platform: Platform): () => void {
  let observerCleanup: (() => void) | null = null;
  let fallbackTimer: ReturnType<typeof setInterval> | null = null;
  let fallbackAttempts = 0;
  let modeReady = false;

  console.log(`[FeelingWise] Video pipeline initializing for ${platform}`);

  // Load settings once so tryDetectComments can gate on modeReady (it must
  // not run the pipeline before the parent's real mode is known). Per-run
  // mode gating reads fresh settings inside runCommentPipeline; the settings
  // module owns its own onChanged cache invalidation, so a mid-session mode
  // flip is reflected on the next pipeline run without a listener here.
  getSettings().then(() => {
    modeReady = true;
  }).catch((e) => console.error(e));

  // ═══ Comment detection (wait for container to appear) ═══
  //
  // YT /watch comment pipeline is OFF in V1. The gate is checked DYNAMICALLY
  // on each tryDetectComments invocation — caching it at setupVideoPipeline
  // time would miss the SPA-navigation case (page loads on / or /channel,
  // user clicks a video, URL becomes /watch). YoutubeAdapter.extractPosts
  // has a matching dynamic gate.
  function isYouTubeWatchPage(): boolean {
    return platform === 'youtube' &&
      typeof window !== 'undefined' &&
      window.location.pathname.startsWith('/watch');
  }

  function tryDetectComments(): void {
    if (!modeReady) return; // Wait until settings have loaded to avoid defaulting to child mode
    if (isYouTubeWatchPage()) return; // YT /watch gate (recomputed per call)

    // Single-in-flight: don't start a new pipeline while one is running.
    // See module-level comment at inFlightPipelineCount declaration.
    if (inFlightPipelineCount > 0) return;
    // Post-completion debounce: keep a freshly-replaced YT container from
    // immediately re-triggering the pipeline on the next mutation tick.
    if (Date.now() - lastPipelineStartAt < PIPELINE_DEBOUNCE_MS) return;

    // Prefer container already discovered by engagement controller
    let container: HTMLElement | null =
      document.querySelector<HTMLElement>('[data-fw-comment-section]');
    if (!container) {
      container = getCommentsContainer(platform);
    }
    if (!container) return;
    if (container.dataset.fwProcessed === 'true') return;

    container.dataset.fwProcessed = 'true';
    console.log(`[FeelingWise] Comments container detected on ${platform}`);

    // Run comment pipeline (engagement controller handles hiding/blocking)
    const title = getCurrentVideoTitle(platform);
    const desc = getCurrentVideoDescription(platform);
    inFlightPipelineCount++;
    lastPipelineStartAt = Date.now();
    runCommentPipeline(platform, title, desc)
      .catch(err => console.error('[FeelingWise] Comment pipeline error:', err))
      .finally(() => { inFlightPipelineCount--; });
  }

  // rAF-debounced body observer. Pre-Ship-#27.1 this MO fired
  // `tryDetectComments` per mutation; on a YouTube SPA navigation or a
  // dense comments-render burst the per-mutation gate checks + two
  // `document.querySelector` calls in `tryDetectComments` flooded the
  // event loop. See src/content/post-path/raf-observer.ts header for full history.
  ({ cleanup: observerCleanup } = createRafBodyObserver(tryDetectComments));

  // Check if comments already present on load
  tryDetectComments();

  // Fallback polling for late-loading comments
  fallbackTimer = setInterval(() => {
    fallbackAttempts++;
    tryDetectComments();
    if (fallbackAttempts >= FALLBACK_MAX_ATTEMPTS && fallbackTimer !== null) {
      clearInterval(fallbackTimer);
      fallbackTimer = null;
    }
  }, FALLBACK_POLL_INTERVAL_MS);

  // SPA navigation. `handleNav` runs onNavigate + re-arms the comment
  // fallback poll; setupNavigationListeners owns the single event registration
  // (yt-navigate-finish / popstate + URL polling) so it fires exactly once
  // per navigation.
  const handleNav = () => {
    onNavigate(platform);
    fallbackAttempts = 0;
    // Reset comment fallback polling. The dynamic gate inside
    // tryDetectComments handles the YT /watch no-op so we always (re-)arm
    // the timer; cheap no-op when on a gated URL.
    if (!fallbackTimer) {
      fallbackTimer = setInterval(() => {
        fallbackAttempts++;
        tryDetectComments();
        if (fallbackAttempts >= FALLBACK_MAX_ATTEMPTS && fallbackTimer !== null) {
          clearInterval(fallbackTimer);
          fallbackTimer = null;
        }
      }, FALLBACK_POLL_INTERVAL_MS);
    }
  };

  const cleanupNavigation = setupNavigationListeners(platform, handleNav);

  return () => {
    observerCleanup?.();
    observerCleanup = null;
    if (fallbackTimer !== null) {
      clearInterval(fallbackTimer);
      fallbackTimer = null;
    }
    cleanupNavigation();
  };
}
