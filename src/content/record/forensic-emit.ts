// Forensic record emission for the post and comment paths of the content
// script: the CANCEL_LOG builder and the shared attribution head of every
// FORENSIC_LOG / PASS_LOG payload index.ts sends. The dedup guards stay in
// ./forensic-gate and the delivery buffer in ./forensic-retry; this module
// only shapes payloads. Extracted from content/index.ts per
// docs/audits/2026-08-23-objective-audit/wave4-architecture (Proposal A, step 3).

import type { PostContent } from '../../types/post';
import { mediaUrlsNow } from './media-urls';
import type { AnalysisResult } from '../../types/analysis';
import type { Mode } from '../../types/mode';
import type { CancelEventInput, ForensicEventInput } from '../../forensics/logger';
import { forensicPayloadBaseVerbatimAuthor, type ForensicPayloadBase } from '../../forensics/payload-base';
import { getSettings } from '../../storage/settings';
import { getEffectiveThreshold } from '../../core/calibration';
import { buildConfigSnapshot } from './config-snapshot';
import { sendHighStakesForensicLog, type ForensicSendDisposition } from './forensic-retry';
import { buildPostUrl } from './post-url';

/**
 * The parent id a record is grouped under (the dashboard and the export both
 * key on `parentVideoId`). Adapters stamp `parentVideoId` when they route a
 * comment into a batch under a known room; the X adapter withholds it when
 * the focused tweet's identity is not coherent, and those replies then take
 * the per-post path with the tree's `parent_id` still on them. Carrying that
 * id onto the record keeps a reply under its post instead of filing it as a
 * post of its own (the owner's 2026-09-05 export: 24 X replies at post level).
 * Record only: routing keeps reading `parentVideoId`.
 */
export function recordParentId(post: Pick<PostContent, 'kind' | 'parentVideoId' | 'parent_id'>): string | undefined {
  if (post.parentVideoId) return post.parentVideoId;
  const isComment = post.kind === 'comment' || post.kind === 'top-comment' || post.kind === 'reply' || post.kind === 'reply-to-reply';
  return isComment && post.parent_id ? post.parent_id : undefined;
}

/**
 * The six attribution fields (mode, platform, aiSource, author, postUrl,
 * feedSource) of a post-path or comment-path record, read off the post.
 * Author is carried verbatim and feedSource falls back to 'unknown', exactly
 * as the former literals did.
 */
export function postPayloadBase(
  post: PostContent,
  mode: Mode,
  aiSource: ForensicEventInput['aiSource'],
  postUrl: string,
): ForensicPayloadBase {
  return forensicPayloadBaseVerbatimAuthor({
    mode,
    platform: post.platform,
    aiSource,
    author: post.author,
    authorName: post.authorName,
    postUrl,
    feedSource: post.feedSource ?? 'unknown',
  });
}

/**
 * Emit a CANCEL_LOG message to the service worker. Builds the payload
 * from PostContent + verdict + optional analysis + aiMeta; the service
 * worker routes through `logCancelEvent`, which stamps a chain record
 * under the same write-lock as flagged + pass records.
 *
 * Called from:
 *   • the `result.action === 'cancelled'` branch in
 *     onProcessingResult.
 *   • the render-gate branches when verifyAnchorMatch returns
 *     'dom-recycled' or 'dom-gone'.
 *
 * Caller is responsible for:
 *   • Calling shouldLogCancelForensic(post.text) before invoking (cancel-side
 *     dedup — never consumes the main entry, so re-encounters stay eligible
 *     for full handling).
 *   • Catching errors via .catch() — this helper itself awaits
 *     getSettings + getEffectiveThreshold which can throw on context-
 *     loss boundaries.
 */
export async function emitCancelLog(
  post: PostContent,
  verdict: CancelEventInput['verdict'],
  analysis: AnalysisResult | undefined,
  aiMeta: { model: string; provider: string } | undefined,
): Promise<ForensicSendDisposition> {
  const settings = await getSettings();
  const postUrl = buildPostUrl(post);
  const threshold = await getEffectiveThreshold(settings.mode);
  return sendHighStakesForensicLog({
    type: 'CANCEL_LOG',
    payload: {
      originalText: post.text,
      verdict,
      analysis,
      mode: settings.mode,
      platform: post.platform,
      author: post.author,
      authorName: post.authorName,
      postUrl,
      feedSource: post.feedSource ?? 'unknown',
      accountType: post.accountType,
      sourceContainer: post.sourceContainer,
      observedSequence: post.observedSequence,
      viewportSeenAt: post.viewportSeenAt,
      surfaceSessionId: post.surfaceSessionId,
      textCapture: post.textCapture,
      authorCapture: post.authorCapture,
      mediaUrls: mediaUrlsNow(post),
      aiModel: aiMeta?.model,
      aiProvider: aiMeta?.provider,
      configSnapshot: buildConfigSnapshot(settings.mode, threshold, settings.dailyCap, settings.features, settings.readFailedFallback),
      kind: post.kind,
      parentVideoId: recordParentId(post),
    },
  });
}
