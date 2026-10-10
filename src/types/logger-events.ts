// PassEventInput, EnvironmentLogInput, BlockedEventInput, CancelEventInput, SkippedEventInput: the shape, with no behavior attached.
//
// It was declared in src/forensics/logger.ts, and src/types/messages.ts imported it from there, which made the
// types layer depend on a layer above it (PLAN-2026-09-16 item 8.6). The module keeps its logic and
// re-exports these names, so nothing that imports them had to change.

import type { ForensicRecord, ConfigSnapshot } from './forensic';
import type { AnalysisResult } from './analysis';
import type { Mode } from './mode';
import type { Platform, FeedSource, NodeKind } from './post';

/**
 * Log a `pass` verdict. Called when the L1 detector ran and returned
 * non-flagged (overall not manipulative, OR confidence below threshold, OR
 * no usable neutralization produced). The record carries verdict='pass' so
 * the recall instrument can sample-re-judge it for false-negative detection.
 *
 * Pre-LLM passes (too-short, dedup, cap-exhausted) are NOT logged here —
 * they emit only to scan-log via the caller. Reason: the LLM never ran,
 * so there's no detector verdict to dispute, and the scan-log denominator
 * already captures the volume signal.
 *
 * Same chain as flagged records (single chain per install — capture-truth
 * is one append-only audit log). neutralizedText is empty for passes
 * because there was no rewrite; the originalText is the audit content.
 */
export interface PassEventInput {
  /**
   * Which build of the content script produced this record — stamped once at
   * the content-side send chokepoint (content/forensic-retry.ts). Undefined in
   * unbaked builds (vitest, node harnesses) and on every record written before
   * the field existed. See src/core/build-id.ts.
   */
  buildId?: ForensicRecord['buildId'];
  originalText: string;
  analysis: AnalysisResult;
  mode: Mode;
  platform: Platform;
  aiSource: 'local' | 'cloud' | 'rules';
  passReason: string;
  author?: string;
  /** Display name beside the handle, when the adapter read it separately. */
  authorName?: string;
  postUrl?: string;
  /** Per-comment deep-link, when captured (else undefined → falls back to postUrl in the export). */
  anchorUrl?: string;
  feedSource?: FeedSource;
  aiModel?: string;
  aiProvider?: string;
  detectionMode?: string;
  configSnapshot?: ConfigSnapshot;
  // Split-forensic. Same fields as logForensicEvent.
  kind?: 'post' | 'video' | 'comment' | 'reply' | 'image';
  parentVideoId?: string;
  // Tree-relationship + room-context fields. PASS records benefit from
  // the same self-contained-record property as FORENSIC records: a
  // recipient reading a pass record should see the room context inline
  // (which video this comment was on, who authored it).
  parentRecordId?: string;
  commentDepth?: number;
  roomAuthor?: string;
  roomCaption?: string;
  roomUrl?: string;
  // Per-comment harm-floor pre-classification stamp. Set by
  // content/index.ts comment-batch dispatch from
  // `BatchScoreResult.commentHarmFloors[i]`. Persists Layer-1 evidence
  // independent of LLM output (per VISION §1.1 forensic completeness).
  harmFloor?: ForensicRecord['harmFloor'];
  /** Per-item engagement metrics captured before the child saw them hidden. */
  metrics?: ForensicRecord['metrics'];
  /** Source labels — WHO posted (accountType) + named container (FB group name). */
  accountType?: ForensicRecord['accountType'];
  sourceContainer?: ForensicRecord['sourceContainer'];
  /** Impression / exposure order — local observed order captured pre-AI. */
  observedSequence?: ForensicRecord['observedSequence'];
  viewportSeenAt?: ForensicRecord['viewportSeenAt'];
  surfaceSessionId?: ForensicRecord['surfaceSessionId'];
  /**
   * Stamped by the service worker from `sender.origin`, not asserted by the
   * content script. See src/background/service-worker.ts.
   */
  surfaceOrigin?: ForensicRecord['surfaceOrigin'];
  /** What the page carried against what the screen showed (src/content/record/text-fold.ts). */
  textCapture?: ForensicRecord['textCapture'];
  /** 'withheld' when the recorder refused an author it could see (src/types/author-capture.ts). */
  authorCapture?: ForensicRecord['authorCapture'];
  /** Why the product let it stand, when a judge read it (docs/design/DECISION-BLOCK-2026-09-07.md). */
  decision?: ForensicRecord['decision'];
  reader?: ForensicRecord['reader'];
  mediaUrls?: ForensicRecord['mediaUrls'];
  /**
   * 'room' when this pass was read from the comments under a text-less item
   * rather than from the item's own words (src/content/post-path/room-verdict.ts). A
   * benign room is still a room verdict: the record says the comments were
   * read and found nothing, which is not the same claim as "the item's words
   * were read and found nothing". Omitted on every other path, never
   * backfilled.
   */
  verdictOrigin?: ForensicRecord['verdictOrigin'];
}

/**
 * Log an environment record for a video's comment section.
 *
 * One per video. Holds aggregate "room" verdict + sample math + raw metric
 * counts. Same chain as flagged + pass records (Chain A integrity preserved).
 * neutralizedText is empty — environment is a SUMMARY, not a rewrite.
 *
 * Why a separate logger: keeps the canonical-payload contract clean — every
 * field this writer sets matches the ForensicRecord shape directly, no
 * synthetic technique names. The dashboard knows to render this as a card,
 * not a row, by reading `kind === 'environment'`.
 */
export interface EnvironmentLogInput {
  /**
   * Which build of the content script produced this record — stamped once at
   * the content-side send chokepoint (content/forensic-retry.ts). Undefined in
   * unbaked builds (vitest, node harnesses) and on every record written before
   * the field existed. See src/core/build-id.ts.
   */
  buildId?: ForensicRecord['buildId'];
  platform: Platform;
  mode: Mode;
  parentVideoId: string;
  postUrl?: string;
  videoCaption: string;
  feedSource?: FeedSource;
  aiModel?: string;
  aiProvider?: string;
  /** The aggregate label + percentages from comment-batch-scorer. */
  environment: NonNullable<ForensicRecord['environment']>;
  /**
   * Surface session (content-script load) the comment section was observed
   * in. No observedSequence/viewportSeenAt — the record aggregates a whole
   * comment section, so no single observed order applies.
   */
  surfaceSessionId?: ForensicRecord['surfaceSessionId'];
  /**
   * Stamped by the service worker from `sender.origin`, not asserted by the
   * content script. See src/background/service-worker.ts.
   */
  surfaceOrigin?: ForensicRecord['surfaceOrigin'];
  /** What the page carried against what the screen showed (src/content/record/text-fold.ts). */
  textCapture?: ForensicRecord['textCapture'];
  /** 'withheld' when the recorder refused an author it could see (src/types/author-capture.ts). */
  authorCapture?: ForensicRecord['authorCapture'];
  mediaUrls?: ForensicRecord['mediaUrls'];
}

/**
 * Log a `blocked` verdict from the rule-based AI
 * content blocker (`engagement/ai-content-blocker.ts`). The blocker hides
 * a video container DOM-side because the caption matched a parent-blocklist
 * hashtag or a multi-language "AI-generated content" marker was present on
 * the page. The pipeline never runs on a blocked container (we mark
 * `dataset.fwProcessed = true` at hide time so the platform adapter skips).
 *
 * The forensic record exists so the parent dashboard can see WHICH videos
 * were pre-empted and from WHICH author / channel — an explicit product
 * requirement: "channel recorded". Same chain as detection records (single chain per
 * install — the audit log captures every action FW takes, not only
 * detector verdicts).
 *
 * `computeStats()` filters on `verdict === 'flagged'` only, so blocked records
 * do NOT inflate the historical "Posts neutralized" / technique / platform
 * counts. They appear in the recent-activity list directly via chain order.
 *
 * The media timeout writes one of these per platform per activation with an
 * empty caption and no kind: it is the account of the overlay going up, not
 * of an item. Readers that count items read `kind`.
 */
export interface BlockedEventInput {
  /**
   * Which build of the content script produced this record — stamped once at
   * the content-side send chokepoint (content/forensic-retry.ts). Undefined in
   * unbaked builds (vitest, node harnesses) and on every record written before
   * the field existed. See src/core/build-id.ts.
   */
  buildId?: ForensicRecord['buildId'];
  platform: Platform;
  mode: Mode;
  /** Author / channel handle of the blocked video (e.g. "@somecreator"). */
  author: string;
  /** Permalink of the blocked video, when extractable. */
  postUrl: string;
  /** What triggered the block: 'hashtag:<token>' or 'ai-label:<lang-tag>'. */
  blockReason: string;
  /** The matched substring (a hashtag like `#aifruit` or a label fragment). */
  matchedToken: string;
  /** Caption text at the time of the block — kept for parent review. */
  caption: string;
  /**
   * The configuration in force when the block fired. Optional only for the
   * back-compat / undefined-omitted contract every other emit site follows
   * (canonical-payload.ts) — every current caller supplies it
   * (ai-content-blocker.ts). Before this field existed, EVERY blocked
   * record hard-coded `configSnapshot: undefined` below regardless of what
   * the caller could supply — not a media-understanding gate race, an
   * unwired field (record-completeness audit, 2026-08-24 browse export).
   */
  configSnapshot?: ConfigSnapshot;
  feedSource?: FeedSource;
  /**
   * Source labels + impression order, all optional because the DOM-side
   * blockers (reels, media-timeout, ai-content-blocker, media-only-ad) fire
   * without a PostContent in hand and can prove none of them.
   *
   * The sponsored-ad path in content/index.ts DOES have the post, and used to
   * drop every one of these on the floor while the FORENSIC_LOG call eight
   * lines below it passed them all. Measured on the 2026-08-22 export: 3,288
   * of 3,288 passed posts carried the impression fields and 0 of 64 blocked
   * ads did, so every ad fell back to chain position in the export's replay
   * reconstruction — the one place the "chain order is not exposure order"
   * caveat actually bites — and no blocked ad could ever show the advertiser
   * label the voices table renders from accountType.
   */
  accountType?: ForensicRecord['accountType'];
  sourceContainer?: ForensicRecord['sourceContainer'];
  observedSequence?: ForensicRecord['observedSequence'];
  viewportSeenAt?: ForensicRecord['viewportSeenAt'];
  surfaceSessionId?: ForensicRecord['surfaceSessionId'];
  /**
   * Stamped by the service worker from `sender.origin`, not asserted by the
   * content script. See src/background/service-worker.ts.
   */
  surfaceOrigin?: ForensicRecord['surfaceOrigin'];
  metrics?: ForensicRecord['metrics'];
  /** What the page carried against what the screen showed (src/content/record/text-fold.ts); the per-post path holds the post. */
  textCapture?: ForensicRecord['textCapture'];
  /** 'withheld' when the recorder refused an author it could see (src/types/author-capture.ts). */
  authorCapture?: ForensicRecord['authorCapture'];
  mediaUrls?: ForensicRecord['mediaUrls'];
  /**
   * The tree position of the blocked item, from the caller that knows it.
   * Absent when the caller does not (the media timeout covers a whole page,
   * not an item); the record then carries no kind, the same as a skipped
   * record without one. Until 2026-09-13 the logger stamped 'video' on every
   * caller that gave none (wiring audit C36).
   */
  kind?: NodeKind;
  /**
   * Why the product acted, in the policy table's words, when the block reason
   * names a rail (ads, hashtag, account); absent for the reel surface, the AI
   * label and the media timeout, which have no row. Built content-side by
   * decisionForBlock (src/content/record/decision.ts). Wiring audit 2026-09-13, C14.
   */
  decision?: ForensicRecord['decision'];
  reader?: ForensicRecord['reader'];
}

/**
 * Log a cancelled-* verdict.
 *
 * Called when the queue's per-item AbortController fired before the
 * pipeline could deliver a verdict to the UI. Two cases:
 *   • verdict='cancelled-stale'      — pre-API cancel; no analysis
 *                                       available. Records "FW
 *                                       observed this post but didn't
 *                                       classify it before the user
 *                                       scrolled past" — VISION §1.1
 *                                       forensic completeness.
 *   • verdict='cancelled-mid-flight' — post-API cancel; the LLM
 *                                       returned a verdict but the
 *                                       abort signal fired before
 *                                       render. The analysis IS
 *                                       persisted so the parent could
 *                                       subpoena evidence of "FW saw +
 *                                       classified this, the user had
 *                                       already moved on".
 * Same chain as flagged + pass records (single chain per install).
 * neutralizedText is empty — cancellation is observation, not rewrite.
 *
 * Render-gate cancels (cancelled-dom-recycled / cancelled-dom-gone)
 * land here too — they're emitted from the render-gate when anchor
 * revalidation fails after a verdict has been computed but before
 * paint.
 */
export interface CancelEventInput {
  /**
   * Which build of the content script produced this record — stamped once at
   * the content-side send chokepoint (content/forensic-retry.ts). Undefined in
   * unbaked builds (vitest, node harnesses) and on every record written before
   * the field existed. See src/core/build-id.ts.
   */
  buildId?: ForensicRecord['buildId'];
  originalText: string;
  /** Verdict label; values typed at the union in types/forensic.ts. */
  verdict: 'cancelled-stale' | 'cancelled-mid-flight' | 'cancelled-dom-recycled' | 'cancelled-dom-gone'
        | 'cancelled-batch-truncated' | 'cancelled-batch-llm-failure' | 'cancelled-post-llm-failure'
        | 'cancelled-video-unjudged' | 'cancelled-image-unjudged';
  /**
   * AnalysisResult from the AI cascade, present iff the LLM produced a verdict
   * before abort fired (verdict='cancelled-mid-flight' OR a render-gate cancel
   * after classify completed). Absent on cancelled-stale (no LLM round-trip)
   * or cancelled-batch-truncated (LLM responded but the trailing batch slot
   * had no per-comment verdict).
   */
  analysis?: AnalysisResult;
  mode: Mode;
  platform: Platform;
  author?: string;
  /** Display name beside the handle, when the adapter read it separately. */
  authorName?: string;
  postUrl?: string;
  feedSource?: FeedSource;
  aiModel?: string;
  aiProvider?: string;
  configSnapshot?: ConfigSnapshot;
  kind?: 'post' | 'video' | 'comment';
  parentVideoId?: string;
  /** Denormalized parent-room context for self-contained comment records. */
  roomAuthor?: ForensicRecord['roomAuthor'];
  roomCaption?: ForensicRecord['roomCaption'];
  roomUrl?: ForensicRecord['roomUrl'];
  /**
   * Failure-kind discriminator stamped on cancelled-batch-llm-failure
   * records. Mirrors `AIFailure['kind']` from `src/ai/ai-error.ts`. The
   * Operational Events aggregator groups by this value; missing → defaults
   * to 'network' for back-compat with pre-N+1 records.
   */
  failureKind?: ForensicRecord['failureKind'];
  /** Retry hint surfaced by the LLM when available (rate-limit / 5xx). */
  retryAfterMs?: number;
  /**
   * Cap subtype when failureKind === 'cap-exhausted'. Mirrors
   * `AIFailure['cap']`. Lets the dashboard distinguish daily / monthly /
   * tier-free exhaustion in the Operational Events surface.
   */
  cap?: ForensicRecord['cap'];
  /** Source labels — WHO posted (accountType) + named container (FB group name). */
  accountType?: ForensicRecord['accountType'];
  sourceContainer?: ForensicRecord['sourceContainer'];
  /** Impression / exposure order — local observed order captured pre-AI. */
  observedSequence?: ForensicRecord['observedSequence'];
  viewportSeenAt?: ForensicRecord['viewportSeenAt'];
  surfaceSessionId?: ForensicRecord['surfaceSessionId'];
  /**
   * Stamped by the service worker from `sender.origin`, not asserted by the
   * content script. See src/background/service-worker.ts.
   */
  surfaceOrigin?: ForensicRecord['surfaceOrigin'];
  /** What the page carried against what the screen showed (src/content/record/text-fold.ts). */
  textCapture?: ForensicRecord['textCapture'];
  /** 'withheld' when the recorder refused an author it could see (src/types/author-capture.ts). */
  authorCapture?: ForensicRecord['authorCapture'];
  mediaUrls?: ForensicRecord['mediaUrls'];
}

/**
 * Log a `skipped` verdict: the feed served this item, and FeelingWise did not
 * judge it.
 *
 * Why this exists: found 2026-09-04 on a fresh free install, after scrolling
 * X for a while, the dashboard showed only three records. The chain held
 * only what the deterministic rules had flagged, because a free install exits
 * the pipeline at `pre-llm-free-tier-no-ai` and only `post-llm-*` passes wrote a
 * record. Everything the product says about the free tier ("writes down what
 * your feed served", "free is the RECORD, paid is the READING") was false.
 *
 * The record claims exactly what happened and no more: the item was observed,
 * the reason no verdict was reached is named in `skipReason`, and there is no
 * analysis, no technique and no score to mistake for a judgement. That is the
 * distinction `verdict: 'skipped'` was introduced for and never wired to.
 *
 * It must stay OUT of every rate. A skipped record is not a pass: counting it as
 * one would inflate "checked and clean" with items nothing checked, which is the
 * opposite of what the chain is for. `StatisticsTab` divides by
 * passed+flagged+blocked, `computeStats` filters on 'flagged', and
 * `aggregateByActionFamily` gives skipped its own family, so no denominator
 * moves. `tests/unit/forensics/skipped-record-emission.test.ts` locks that.
 */
export interface SkippedEventInput {
  /**
   * Which build of the content script produced this record — stamped once at
   * the content-side send chokepoint (content/forensic-retry.ts). Undefined in
   * unbaked builds (vitest, node harnesses) and on every record written before
   * the field existed. See src/core/build-id.ts.
   */
  buildId?: ForensicRecord['buildId'];
  originalText: string;
  mode: Mode;
  platform: Platform;
  author: string;
  /** Display name beside the handle, when the adapter read it separately. */
  authorName?: string;
  postUrl: string;
  /** The pipeline gate that declined, without the 'pre-llm-' prefix. */
  skipReason: string;
  kind?: ForensicRecord['kind'];
  parentVideoId?: string;
  feedSource?: FeedSource;
  configSnapshot?: ConfigSnapshot;
  /** Engagement counts read from the DOM before they were hidden. */
  metrics?: ForensicRecord['metrics'];
  accountType?: ForensicRecord['accountType'];
  sourceContainer?: ForensicRecord['sourceContainer'];
  observedSequence?: ForensicRecord['observedSequence'];
  viewportSeenAt?: ForensicRecord['viewportSeenAt'];
  surfaceSessionId?: ForensicRecord['surfaceSessionId'];
  surfaceOrigin?: ForensicRecord['surfaceOrigin'];
  /** What the page carried against what the screen showed (src/content/record/text-fold.ts). */
  textCapture?: ForensicRecord['textCapture'];
  /** 'withheld' when the recorder refused an author it could see (src/types/author-capture.ts). */
  authorCapture?: ForensicRecord['authorCapture'];
  mediaUrls?: ForensicRecord['mediaUrls'];
}
