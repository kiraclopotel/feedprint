// FeelingWise - a post with no text of its own is judged by its room.
//
// PLAN-2026-09-14 standing decision 3: "A post with no text is judged by its
// room: the first batch of comments is read and the verdict is applied to the
// post as a room verdict, marked as such in the record (new optional field,
// never backfilled). This is the cheapest way to see a video without media."
//
// WHAT WAS ALREADY THERE, AND WHAT WAS MISSING. The room read exists: the
// comment batch calls `scoreBatch` on the first comments under a post and then
// `scoreRoom` for the aggregate (src/analysis/comment-batch-scorer.ts). Its
// output was WRITE-ONLY (docs/audits/2026-09-07-xray/): every field went into
// the ENVIRONMENT_LOG record and nothing ever read it back to say anything
// about the post. This module is the read path, in the smallest shape that
// does not put two records in the chain for one item.
//
// HOW IT WORKS, and why it is a hold rather than a second write.
//   1. A text-less post reaches the pipeline first, well before its comments
//      are batched: the pipeline passes it deterministically at
//      `pre-llm-too-short` / `pre-llm-non-substantive` (src/analysis/pipeline.ts)
//      with no network call at all, while the comment bucket waits out its
//      1,500 ms debounce.
//   2. So the record for the post would be written before its room is read.
//      Amending a signed record afterwards is impossible by design, and
//      writing a second record for the same item is the thing every dedup gate
//      in this tree exists to stop.
//   3. Therefore the post's record is HELD, for at most
//      ROOM_VERDICT_WAIT_MS. If the room is read inside that window, the held
//      writer runs once with the room's verdict and the record carries
//      `verdictOrigin: 'room'`. If the window closes first, the held writer
//      runs once with null and writes exactly the record it would have written
//      before this module existed. Either way: one record, never two.
//
// WHAT IT COSTS IN JUDGE CALLS: nothing. The batch call and the room call are
// both already made for every comment section the recorder reads; this module
// reads their existing output. It adds no prompt, no model call and no token.
// The only new spend would be on a post whose comments the recorder would
// otherwise not have batched, and this module never asks for a batch.
//
// WHAT IT DOES NOT DO: it does not change what the page shows. The post stays
// as the pipeline left it. The room verdict is recorded, and marked as a room
// verdict, so a reader of the chain can see that FeelingWise judged a
// caption-less video by the room under it. Acting on a room verdict on the
// page needs the instrument measured first (the room read has never been
// measured for accuracy: xray-judgement-path.md, row J7), which is a later
// plan item, not this one.

import type { AnalysisResult, TechniqueName, TechniqueResult } from '../../types/analysis';
import type { PostContent } from '../../types/post';

/**
 * How long a text-less post's record waits for its room.
 *
 * The budget it has to clear: the comment bucket's debounce is 1,500 ms
 * (COMMENT_BATCH_DEBOUNCE_MS), the per-parent flush rate limit adds up to
 * 800 ms, and the batch call plus the room call take a few seconds more on a
 * slow provider. Twelve seconds clears that with room to spare.
 *
 * It is deliberately not longer. A held record is a record not yet delivered,
 * and the reader can close the tab at any moment: the release at page hide is
 * best effort, because the write itself is async (it reads settings and the
 * threshold before it can build the payload). Every second of wait is a second
 * of exposure to that loss, so the wait is the smallest one that still clears
 * the normal case.
 */
export const ROOM_VERDICT_WAIT_MS = 12_000;

/** Bounded so a long scroll cannot hold an unbounded number of writers. */
const MAX_HELD = 100;

/**
 * What the first batch of comments said about the room, reduced to the one
 * verdict that is applied to the post. `technique` and `severity` come from
 * the most severe comment the batch judged manipulative; `summary` is the
 * room's own sentence. A room with nothing manipulative in it is still a room
 * verdict, it is just a benign one.
 */
export interface RoomVerdict {
  manipulative: boolean;
  technique: string | null;
  severity: number;
  confidence: number;
  /** The room's summary line, as the batch or the room sensor wrote it. */
  summary: string;
  /** How many comments the verdict was read from. */
  batchSize: number;
  aiModel?: string;
  aiProvider?: string;
}

/** The deferred record write. Called EXACTLY once, with the room or with null. */
export type HeldRecordWriter = (room: RoomVerdict | null) => void;

interface HeldRecord {
  write: HeldRecordWriter;
  timer: ReturnType<typeof setTimeout> | null;
}

const held = new Map<string, HeldRecord>();

/**
 * The key a post and its comment bucket meet on. Mirrors
 * `seedRoomContextFromPost` (src/content/comment-batch/queue.ts): the bucket
 * key is `post.parentVideoId ?? post.id`, and the platform scopes it the way
 * `roomContextKey` does.
 */
function roomVerdictKey(platform: string, roomId: string): string {
  return platform + '\u0000' + roomId;
}

export function roomVerdictKeyForPost(post: Pick<PostContent, 'platform' | 'id' | 'parentVideoId'>): string {
  return roomVerdictKey(post.platform, post.parentVideoId ?? post.id);
}

/**
 * True when this post has no text of its own worth judging. The definition is
 * not invented here: it is the pipeline's own, the two pre-LLM gates that
 * already decide a post carries no prose to read
 * (`pre-llm-too-short` below MIN_TEXT_LENGTH, `pre-llm-non-substantive` below
 * three real words). A caption that is only a placeholder - a bare hashtag
 * run, "original sound", an empty string - falls through one of them.
 */
export function isTextlessPassReason(reason: string): boolean {
  return reason === 'pre-llm-too-short' || reason === 'pre-llm-non-substantive';
}

// The pass reasons above also fire on short real text: a 10-character title
// like "Trump lies" is below MIN_TEXT_LENGTH and still says something. Those
// posts are read on their own words, so the hold also asks whether anything is
// left once the decoration is taken off: links, #tags, @handles, emoji,
// digits, and the audio placeholder the platforms print in four languages,
// with the account name TikTok appends to it on the same line.
const AUDIO_PLACEHOLDER = /(?:original sound|original audio|sunet original|sonido original|audio original|som original|áudio original)[^\n]*/giu;

/** True when the post's own text is empty once links, tags, handles, emoji and placeholders are removed. */
export function hasNoOwnText(text: string | undefined): boolean {
  const left = (text ?? '')
    .replace(/https?:\/\/\S+/giu, ' ')
    .replace(/[#@][\p{L}\p{N}_.]+/gu, ' ')
    .replace(AUDIO_PLACEHOLDER, ' ')
    .replace(/[^\p{L}]+/gu, '');
  return left.length < 3;
}

/**
 * A post the room may judge: text-less by the pipeline's gate AND by its own
 * text, with a platform id that names one video. A synthetic TikTok id
 * (`tk-music-...`, minted per DOM container) is refused, because TikTok's
 * virtualizer reuses containers and one video's comments could settle
 * another video's record.
 */
export function isRoomJudgeable(
  post: Pick<PostContent, 'id' | 'parentVideoId' | 'text'>,
  passReason: string,
): boolean {
  if (!isTextlessPassReason(passReason)) return false;
  if (!hasNoOwnText(post.text)) return false;
  const roomId = post.parentVideoId ?? post.id;
  // A random id (crypto.randomUUID, the Facebook and Instagram adapters'
  // last fallback) names a DOM container, not a post, exactly like tk-music-.
  return !roomId.startsWith('tk-music-') && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roomId);
}

/**
 * Hold this post's record until its room is read, or until the wait expires.
 *
 * Returns true when the write was taken (the caller must not write), false
 * when it was refused (a hold for this room already exists, or the module is
 * at capacity) and the caller should write immediately.
 */
export function holdForRoomVerdict(
  post: Pick<PostContent, 'platform' | 'id' | 'parentVideoId'>,
  write: HeldRecordWriter,
): boolean {
  const key = roomVerdictKeyForPost(post);
  if (held.has(key) || held.size >= MAX_HELD) return false;

  const entry: HeldRecord = { write, timer: null };
  held.set(key, entry);
  entry.timer = setTimeout(() => {
    const current = held.get(key);
    if (current !== entry) return;
    held.delete(key);
    try {
      entry.write(null);
    } catch (err) {
      console.error('[FeelingWise] room-verdict timeout write failed:', err);
    }
  }, ROOM_VERDICT_WAIT_MS);
  return true;
}

/**
 * The room has been read. Run the held writer once with the verdict.
 * Returns true when a held record was settled, false when there was none
 * (the ordinary case: the post carried text and was never held).
 */
export function settleRoomVerdict(
  platform: string,
  roomId: string,
  verdict: RoomVerdict,
): boolean {
  const key = roomVerdictKey(platform, roomId);
  const entry = held.get(key);
  if (!entry) return false;
  held.delete(key);
  if (entry.timer !== null) clearTimeout(entry.timer);
  try {
    entry.write(verdict);
  } catch (err) {
    console.error('[FeelingWise] room-verdict write failed:', err);
  }
  return true;
}

/**
 * Release every held record without a room. Called on a route change and at
 * page hide: a record that is still waiting when the reader leaves must be
 * written, not dropped, or the chain loses the item entirely.
 */
export function releaseHeldRoomVerdicts(): void {
  const entries = Array.from(held.entries());
  held.clear();
  for (const [, entry] of entries) {
    if (entry.timer !== null) clearTimeout(entry.timer);
    try {
      entry.write(null);
    } catch (err) {
      console.error('[FeelingWise] room-verdict release write failed:', err);
    }
  }
}

export function _heldRoomVerdictCountForTesting(): number {
  return held.size;
}

/**
 * The technique list a room verdict puts on the post's record. Mirrors
 * `verdictTechniques` in src/content/comment-batch/flush.ts: the batch enum
 * string is the legally precise label and is persisted verbatim; a benign or
 * label-less room carries no technique, exactly as a pass record does.
 */
function roomVerdictTechniques(verdict: RoomVerdict): TechniqueResult[] {
  const t = verdict.technique;
  if (!verdict.manipulative || !t || t === 'none' || t === 'neutral') return [];
  return [{
    technique: t as TechniqueName,
    present: true,
    confidence: verdict.confidence,
    severity: verdict.severity,
    evidence: verdict.summary ? [verdict.summary] : [],
  }];
}

/**
 * The AnalysisResult a room verdict puts on the post's record. The score is
 * the room's severity, the explanation is the room's own sentence, and
 * `isManipulative` is the room's answer - all of it about the comments, which
 * is why the record is stamped `verdictOrigin: 'room'` and why nothing here
 * claims the post's own words said anything.
 */
export function roomVerdictAnalysis(postId: string, verdict: RoomVerdict): AnalysisResult {
  const techniques = roomVerdictTechniques(verdict);
  return {
    postId,
    techniques,
    overallScore: verdict.manipulative ? verdict.severity : 0,
    overallConfidence: verdict.confidence,
    isManipulative: verdict.manipulative,
    processingTimeMs: 0,
    explanation: verdict.summary || undefined,
    ...(techniques.length > 0 ? { primaryTechnique: techniques[0].technique } : {}),
  };
}
