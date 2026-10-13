// FeelingWise — per-platform product rules that more than one call site must
// agree on. Each rule lives here as ONE named predicate rather than as a
// platform literal repeated at each site, because the sites drifting apart is
// the observed failure mode, not a hypothetical one.

import type { Platform, PostContent } from '../../types/post';
import type { PassReason } from '../../analysis/pipeline';
import { isRoomJudgeable } from './room-verdict';

/**
 * True when a `kind:'video'` record should still enter the chain as a benign
 * pass after the pipeline declined to classify its text.
 *
 * Without this, the video produces no chain record while its comments do, which
 * leaves the dashboard rendering an orphan thread whose own post is absent from
 * the chain, in violation of the chain-mirror rule (VISION §1.1: every observed
 * node produces a record). Writing the record costs nothing: no provider call
 * is made, and the record states `aiSource:'rules'` plus this exact reason, so
 * it claims only what actually ran.
 *
 * Read by the pre-LLM pass branch in `content/index.ts`.
 */
export function shouldRecordTextlessVideoPass(platform: Platform, reason: PassReason): boolean {
  // Genuinely text-less video: a music-only TikTok with no caption, or a very
  // short YouTube watch title. Nothing existed for the detector to judge, so
  // "passed" is the honest verdict.
  if (reason === 'pre-llm-too-short' || reason === 'pre-llm-non-substantive') {
    return platform === 'tiktok' || platform === 'youtube';
  }

  // Free tier runs no text AI at all, so EVERY video exits here, not only the
  // text-less ones — which is why this arm is scoped to YouTube alone. The
  // YouTube watch session is a deliberate exposure-unit record the product
  // keeps by design (owner decision 2026-08-02), and without this a free-tier
  // install shows YouTube comments hanging under a video absent from the chain.
  // TikTok is deliberately EXCLUDED here: admitting it would start recording
  // every free-tier TikTok video, which is a volume change nobody has asked
  // for, not a fix for an orphan.
  // A level that reads nothing (Strict) is the same: every video exits here, so the arm is scoped to YouTube alone.
  if (reason === 'pre-llm-free-tier-no-ai' || reason === 'pre-llm-level-reads-nothing') return platform === 'youtube';

  // Everything else deliberately writes nothing here. 'pre-llm-cap-exhausted' and
  // 'pre-llm-ai-call-failed' mean the content was never assessed, so a benign
  // pass record would claim more than happened; 'pre-llm-cache-pass' has its
  // own replay-record semantics; the post-llm-* reasons are handled by the
  // post-LLM pass path, which carries the real verdict.
  return false;
}

/** The platforms where a feed post (not only a video) is judged by its room. */
const ROOM_POST_PLATFORMS: ReadonlySet<Platform> = new Set<Platform>(['facebook', 'instagram', 'twitter']);

/**
 * True when this pass should be written by the text-less branch, which holds
 * the one record for the room verdict (src/content/post-path/room-verdict.ts), instead
 * of the ordinary not-judged record.
 *
 * TikTok and YouTube: the video rule above, unchanged. Facebook, Instagram and
 * X (PLAN-2026-09-15 item 6): a post or video that the room may judge, which
 * means a text-less pass reason, no words of its own once tags, handles, emoji
 * and placeholders are removed, and a real id; on X only on a permalink page,
 * the one surface where replies are batched under the post. A short real caption is not
 * held; it keeps the record it always had. Those three platforms already wrote
 * a record for every such pass, so this changes which branch writes it, not
 * how many records there are.
 */
export function writesTextlessRoomRecord(
  post: Pick<PostContent, 'platform' | 'kind' | 'text' | 'id' | 'parentVideoId' | 'platform_specific'>,
  reason: PassReason,
): boolean {
  if (post.kind === 'video' && shouldRecordTextlessVideoPass(post.platform, reason)) return true;
  if (!ROOM_POST_PLATFORMS.has(post.platform)) return false;
  // X batches replies only under the post a permalink page is focused on; a
  // feed post there never gets a room, so holding it would only delay its record.
  if (post.platform === 'twitter') {
    const ps = post.platform_specific as { surfaceKind?: string } | undefined;
    if (ps?.surfaceKind !== 'twitter-permalink') return false;
  }
  if (post.kind !== undefined && post.kind !== 'post' && post.kind !== 'video') return false;
  return isRoomJudgeable(post, reason);
}
