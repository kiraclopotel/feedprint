// A rule hides a comment at the door (11 Oct 2026, the fourth pass on a real YouTube page). The household's own list
// and the free catcher for threats and shaming used to run only inside the batch flush, and a batch is not a given:
// the free tier's failed batch leaves the video in a 30 s cooldown that drops every comment arriving meanwhile, a
// budget hold defers the flush, and a throw returns before the check. On a page with 80 comments, 2 of the 34 that
// held a listed word were hidden. A rule needs no reading, so it runs the moment the extractor hands a comment over,
// and what it hides it records, as the flush does.

import type { PostContent } from '../../types/post';
import type { FWMessage } from '../../types/messages';
import type { FWSettings } from '../../storage/settings';
import { activeParentBlocklist, isParentBlocklistEmpty, matchParentBlocklist } from '../../core/parent-blocklist';
import { detectCodedHarm, codedHarmVerdictFields } from '../../core/coded-harm-catcher';
import { mediaUrlsNow } from '../record/media-urls';
import { sendHighStakesForensicLog } from '../record/forensic-retry';
import { postPayloadBase } from '../record/forensic-emit';
import { hasLoggedForensic, shouldLogForensic, forensicDedupKey } from '../record/forensic-gate';
import { rememberResolvedComment } from '../post-path/late-verdict-cache';
import { recordedCommentHideAction, type CommentHideNotice } from '../protection/comment-overlay';
import { commentHideNoticeFor } from '../markers/comment-hide-notice';
import { decisionForLegacy, decisionForMask, READER_DEFAULT } from '../record/decision';
import { blanketProfanitySoften } from '../../analysis/pipeline';
import { computeHarmFloor } from '../../core/harm-floor';
import { filterProfanity, maskProfanity } from '../../core/profanity-filter';
import { readingAllowed } from '../../ai/client';
import { postShowsDoorStar } from '../../core/door-star';
import { getLicense } from '../../storage/license';
import { resolveUiLanguage } from '../../i18n';
import { commentRecordRoomFields, roomFieldsForComment } from './queue';

/** What a rule found, in the shape the comment's record carries. */
export interface DoorHit {
  /** The rule engine's name, so a record never names a model that read nothing. */
  aiModel: string;
  /** Set when the household's list found it: the same `blocklist:<kind>:<rule>` the post pipeline writes. */
  detectionMode?: string;
  analysis: Record<string, unknown>;
}

/**
 * The first rule that hides this comment, or null. The household's list first (a word or an account the person
 * chose), then the catcher's hide-tier structures (a threat, a shaming order, doxxing, narrated violence). A catch
 * that only marks is left to the batch.
 */
export function ruleHitAtTheDoor(post: PostContent, settings: FWSettings): DoorHit | null {
  const list = activeParentBlocklist(settings.features);
  if (!isParentBlocklistEmpty(list)) {
    const hit = matchParentBlocklist(list, post.text, post.author, post.card);
    if (hit) {
      return {
        aiModel: 'fw-household-list-v1',
        detectionMode: `blocklist:${hit.kind}:${hit.rule}`,
        analysis: { techniques: [], overallScore: 0, overallConfidence: 1, isManipulative: true },
      };
    }
  }
  const coded = detectCodedHarm(post.text);
  if (coded) {
    const fields = codedHarmVerdictFields(coded);
    if (fields.hideTier) {
      return {
        aiModel: 'fw-harm-floor-regex-v1',
        analysis: {
          techniques: [{ technique: fields.technique, present: true, severity: fields.severity, confidence: 0.85 }],
          overallScore: fields.severity,
          overallConfidence: 0.85,
          isManipulative: true,
        },
      };
    }
  }
  return null;
}

/**
 * Hide one comment and write the record of it. The one body behind the flush's hide outcome and the door's, so the
 * notice, the decision block and the cache of proven hides are the same on both.
 */
export function hideAndRecordComment(args: {
  settings: FWSettings;
  post: PostContent;
  sharedFields: Record<string, unknown>;
  analysisLike: Record<string, unknown>;
  applyCommentHide: (post: PostContent, notice?: CommentHideNotice | null) => boolean;
  /** False for a comment whose words are already on the record this session: hidden again, not written twice. */
  record?: boolean;
}): boolean {
  const { settings, post, sharedFields, analysisLike, applyCommentHide } = args;
  // Teen and Adult see a sentence where the comment was, in the row's own
  // words when the legacy signal names one; Child gets the silent close
  // (docs/design/HIDE-NOTICE-2026-09-07.md). The record's fields are the
  // notice's only source, so the page and the chain say the same why.
  const techniques = Array.isArray(analysisLike.techniques)
    ? (analysisLike.techniques as Array<{ technique?: string; present?: boolean }>)
      .filter((t) => t.present !== false)
      .map((t) => String(t.technique ?? ''))
    : [];
  const detectionMode = typeof sharedFields.detectionMode === 'string' ? sharedFields.detectionMode : undefined;
  const severity = typeof analysisLike.overallScore === 'number' ? analysisLike.overallScore : undefined;
  const notice = commentHideNoticeFor(settings.mode, resolveUiLanguage(settings.uiLanguage), {
    detectionMode,
    techniques,
    severity,
  });
  const hideApplied = applyCommentHide(post, notice);
  // PROVEN hide -> cache so a fresh-node re-extraction is re-hidden before
  // any uncover cycle and never re-scored (CORE-1 / CORE-2). Only on the
  // applied branch: a miss keeps the cover but is NOT a resolved verdict.
  if (hideApplied) rememberResolvedComment(post, notice ? { kind: 'hide', notice } : { kind: 'hide' });
  if (args.record === false) return hideApplied;
  void sendHighStakesForensicLog({
    type: 'FORENSIC_LOG',
    payload: {
      ...sharedFields,
      neutralizedText: '',
      analysis: {
        ...analysisLike,
        action: recordedCommentHideAction(hideApplied),
      },
      // Why the product acted, in the policy table's words (Stage 2, 2026-09-07).
      decision: decisionForLegacy({
        mode: settings.mode,
        detectionMode,
        techniques,
        severity,
        applied: hideApplied ? 'hide' : 'mark',
        mask: blanketProfanitySoften(settings, post.platform),
      }),
      reader: READER_DEFAULT,
    },
  } as Extract<FWMessage, { type: 'FORENSIC_LOG' }>);
  return hideApplied;
}

/** The fields every record the door writes shares: what the extractor handed over, and a rule engine as the author. */
function doorRecordFields(post: PostContent, settings: FWSettings, aiModel: string, detectionMode?: string): Record<string, unknown> {
  const room = roomFieldsForComment(post);
  return {
    originalText: post.text,
    // The record names the rule engine, never a model: nothing was read.
    ...postPayloadBase(post, settings.mode, 'rules', room.postUrl),
    ...commentRecordRoomFields(room),
    anchorUrl: post.anchorUrl,
    accountType: post.accountType,
    sourceContainer: post.sourceContainer,
    observedSequence: post.observedSequence,
    viewportSeenAt: post.viewportSeenAt,
    surfaceSessionId: post.surfaceSessionId,
    textCapture: post.textCapture,
    authorCapture: post.authorCapture,
    mediaUrls: mediaUrlsNow(post),
    aiModel,
    aiProvider: 'fw-rules',
    kind: 'comment' as const,
    parentVideoId: post.parentVideoId ?? post.id,
    ...(detectionMode ? { detectionMode } : {}),
  };
}

/** Hide a comment a rule found and record it as the rule engine's act. Returns whether the hide landed on the page. */
export function hideAtTheDoor(
  post: PostContent,
  hit: DoorHit,
  settings: FWSettings,
  applyCommentHide: (post: PostContent, notice?: CommentHideNotice | null) => boolean,
): boolean {
  const key = forensicDedupKey(post);
  const alreadyRecorded = hasLoggedForensic(key);
  if (!alreadyRecorded) shouldLogForensic(key);
  const sharedFields = doorRecordFields(post, settings, hit.aiModel, hit.detectionMode);
  return hideAndRecordComment({
    settings,
    post,
    sharedFields,
    analysisLike: hit.analysis,
    applyCommentHide,
    record: !alreadyRecorded,
  });
}

/** The record of a mask the door applied: once per comment, the rule engine as the author, nothing read. */
function recordDoorMask(post: PostContent, settings: FWSettings, masked: string): void {
  const key = forensicDedupKey(post);
  if (hasLoggedForensic(key)) return;
  shouldLogForensic(key);
  void sendHighStakesForensicLog({
    type: 'FORENSIC_LOG',
    payload: {
      ...doorRecordFields(post, settings, 'fw-profanity-mask-v1', 'profanity-mask'),
      neutralizedText: masked,
      analysis: {
        techniques: [{ name: 'profanity', severity: 4, confidence: 0.95 }],
        overallScore: 0,
        overallConfidence: 0.95,
        isManipulative: false,
      },
      decision: decisionForMask(settings.mode),
      reader: READER_DEFAULT,
    },
  } as unknown as Extract<FWMessage, { type: 'FORENSIC_LOG' }>);
}

/**
 * Star a swearing comment's words at the door (11 Oct 2026; for a comment a reading follows, 12 Oct 2026). The mask is a
 * rule, not a reading, so it runs the moment the comment is handed over. It used to be collected inside the batch after
 * scoring, so it never ran where the batch does not (no key, a level that sends nothing, a video in the failed batch's
 * cooldown), and with a key it waited for the reading: 6.7 s to 13.5 s, and not at all while the service answered 500.
 *
 * Returns 'final' when no reading follows: the stars landed, the comment is remembered for a fresh node and the record
 * is written. Returns 'provisional' when a reading is allowed: the stars are on the page and nothing else is written or
 * remembered, because the reading may rewrite or hide the comment and its record is then the batch's. The batch finds the
 * row by the words it scored (core/door-star.ts), and a reading that cannot finish records the mask through
 * `settleDoorStar`. Returns false for a comment the rules would escalate instead (an identity slur, a threat, strong
 * harm), whose hide or mark is not a mask, and when the stars did not land (the row moved or the page refused the text):
 * the comment is then left exactly as served and nothing says otherwise.
 */
export async function maskAtTheDoor(
  post: PostContent,
  settings: FWSettings,
  applyMask: (post: PostContent, masked: string) => boolean,
): Promise<'final' | 'provisional' | false> {
  if (!post.domRef || !blanketProfanitySoften(settings, post.platform)) return false;
  if (!filterProfanity(post.text, settings.mode, { tier: 'profanity' }).filtered) return false;
  const masked = maskProfanity(post.text).masked;
  if (masked === post.text) return false;
  const readingFollows = await readingAllowed(settings, await getLicense());
  if (detectCodedHarm(post.text)) return false;
  // The same two tests the batch's fallback escalates on: an identity slur, or a harm floor of 70.
  if (filterProfanity(post.text, 'teen', { tier: 'slurs' }).filtered || computeHarmFloor(post.text, []).score >= 70) return false;
  if (!applyMask(post, masked)) return false;
  if (readingFollows) return 'provisional';
  // A fresh node handed the same comment later is starred before it is shown, and never read again.
  rememberResolvedComment(post, { kind: 'rewrite', rewrite: masked });
  recordDoorMask(post, settings, masked);
  return 'final';
}

/**
 * A comment the door starred ('provisional') whose reading could not finish: the batch was abandoned, its call failed or
 * the flush threw. The stars stay on the page, so the comment is recorded as the mask the rules wrote, never as a cancel
 * that says nothing changed. Returns true when this comment shows the door's stars (and the caller writes nothing else
 * for it); false leaves it to the caller's own record.
 */
export function settleDoorStar(post: PostContent, settings: FWSettings): boolean {
  if (!postShowsDoorStar(post.domRef)) return false;
  recordDoorMask(post, settings, maskProfanity(post.text).masked);
  return true;
}
