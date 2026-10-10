// FeelingWise - the shared attribution head of a FORENSIC_LOG / PASS_LOG
// payload (mode, platform, aiSource, author, postUrl, feedSource).
//
// Every forensic dispatch site restated these six fields by hand, each with
// its own `author || 'unknown'` fallback. This is the one copy. Spread it
// into the payload where the `mode` key used to sit; the key order matches
// the former literals.

import type { Mode } from '../types/mode';
import type { Platform, FeedSource } from '../types/post';
import type { ForensicEventInput } from './logger';

export interface ForensicPayloadBaseInput {
  mode: Mode;
  platform: Platform;
  aiSource: ForensicEventInput['aiSource'];
  /** Author handle as extracted; empty or missing becomes 'unknown'. */
  author: string | undefined;
  /** Display name beside the handle, when the adapter read it separately. */
  authorName?: string;
  postUrl: string;
  feedSource: FeedSource;
}

export interface ForensicPayloadBase {
  mode: Mode;
  platform: Platform;
  aiSource: ForensicEventInput['aiSource'];
  author: string;
  authorName?: string;
  postUrl: string;
  feedSource: FeedSource;
}

export function forensicPayloadBase(input: ForensicPayloadBaseInput): ForensicPayloadBase {
  return forensicPayloadBaseVerbatimAuthor({ ...input, author: input.author || 'unknown' });
}

/**
 * The same head with the author carried exactly as given. The post and
 * comment paths in content/index.ts never applied the 'unknown' fallback
 * (the logger stores an empty author as empty), so their records keep it
 * that way.
 *
 * postUrl is carried exactly as given too, on purpose, with no fallback of
 * any kind here. A first attempt (record-completeness audit 2026-08-24,
 * known-issues M121) added `postUrl || location.href` at this shared
 * function, on the theory that a fresh read here was equivalent to
 * capturing at resolution time. It was not: M36 (known-issues) already
 * diagnosed and fixed this exact pattern for Facebook (buildPostUrl reading
 * `location.href` at LOG time, after the SPA had navigated, stamped the
 * homepage onto 34% of records) by capturing the URL at DOM MOUNT time
 * instead and carrying it forward. This function is called from
 * video-context/orchestrator.ts's onAnalysis/onEarlyText/onKnownVideo
 * builders AFTER awaiting the media round trips, so a fresh read here reintroduced the identical
 * race on the video path. That path was removed from the product; the rule stands for any caller
 * that resolves after an await. Separately, and
 * independently of timing: video-context/identity.ts's `resolveVideoIdentity`
 * has a branch (the DOM/URL identity-conflict case) where an empty
 * `postUrl` is not a resolution GAP but a deliberate refusal to guess,
 * because the page URL at that exact moment can name a DIFFERENT video than
 * the one the frames were captured from (the #53/#55 cross-post desync;
 * locked by tests/unit/video-context-identity.test.ts, "a conflicting URL
 * author never overrides the container author"). A location.href fallback
 * here, even read at the correct time, would have silently reintroduced
 * that misattribution. The honest behavior, restored: an empty postUrl
 * reaching this function stays empty.
 */
export function forensicPayloadBaseVerbatimAuthor(
  input: ForensicPayloadBaseInput & { author: string },
): ForensicPayloadBase {
  return {
    mode: input.mode,
    platform: input.platform,
    aiSource: input.aiSource,
    author: input.author,
    authorName: input.authorName,
    postUrl: input.postUrl,
    feedSource: input.feedSource,
  };
}
