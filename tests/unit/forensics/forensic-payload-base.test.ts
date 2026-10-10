// Shared forensic payload head (ARCHITECTURE-6 item 5). The expected objects
// are the attribution fields the dispatch sites used to spell by hand, for a
// representative post, key order included.

import { describe, it, expect } from 'vitest';
import { forensicPayloadBase, forensicPayloadBaseVerbatimAuthor } from '../../../src/forensics/payload-base';

describe('forensicPayloadBase', () => {
  it('equals the former video-context literal for a representative post', () => {
    const literal = {
      mode: 'teen' as const,
      platform: 'tiktok' as const,
      aiSource: 'cloud' as const,
      author: '@creator',
      authorName: undefined,
      postUrl: 'https://www.tiktok.com/@creator/video/123',
      feedSource: 'video' as const,
    };
    const actual = forensicPayloadBase({
      mode: 'teen',
      platform: 'tiktok',
      aiSource: 'cloud',
      author: '@creator',
      postUrl: 'https://www.tiktok.com/@creator/video/123',
      feedSource: 'video',
    });
    expect(actual).toEqual(literal);
    expect(Object.keys(actual)).toEqual(Object.keys(literal));
    expect(JSON.stringify(actual)).toBe(JSON.stringify(literal));
  });

  it('falls back to "unknown" for a missing or empty author, as the sites did', () => {
    const base = { mode: 'child' as const, platform: 'instagram' as const, aiSource: 'rules' as const, postUrl: 'u', feedSource: 'unknown' as const };
    expect(forensicPayloadBase({ ...base, author: undefined }).author).toBe('unknown');
    expect(forensicPayloadBase({ ...base, author: '' }).author).toBe('unknown');
    expect(forensicPayloadBase({ ...base, author: '@kept' }).author).toBe('@kept');
  });

  it('spreads into a payload at the old key position without reordering', () => {
    const payload = {
      originalText: 't',
      neutralizedText: '',
      ...forensicPayloadBase({ mode: 'adult', platform: 'youtube', aiSource: 'rules', author: 'a', postUrl: 'p', feedSource: 'video' }),
      detectionMode: 'x',
    };
    expect(Object.keys(payload)).toEqual([
      'originalText', 'neutralizedText', 'mode', 'platform', 'aiSource', 'author', 'authorName', 'postUrl', 'feedSource', 'detectionMode',
    ]);
  });
});

// Record-completeness audit (2026-08-24 browse export), independent
// verification round: a first attempt made this shared head fall back to
// `location.href` when postUrl was empty. Reverted. Two independent reasons,
// both found by a second-round verifier:
//
// 1. Timing (known-issues M36). This function is called from
//    video-context/orchestrator.ts's onAnalysis/onEarlyText/onKnownVideo
//    builders AFTER awaiting real Gemini/Whisper network round trips.
//    `location.href` read there is a WRITE-time read, not a capture-time
//    one. M36 already diagnosed and fixed this exact pattern for Facebook
//    (buildPostUrl reading location.href at log time, after the SPA had
//    navigated, stamped the homepage onto 148/438 = 34% of records) by
//    capturing the URL at DOM MOUNT time instead. A fallback here would
//    reintroduce it on the video path.
// 2. Correctness, independent of timing. `identity.postUrl`
//    (video-context/identity.ts) is '' not only when resolution failed but
//    also when `resolveVideoIdentity`'s identity-conflict branch
//    deliberately withheld it, because the page URL at that exact moment
//    can name a DIFFERENT video than the one the frames were captured from
//    (tests/unit/video-context-identity.test.ts, "a conflicting URL author
//    never overrides the container author"). Falling back to location.href
//    there would misattribute a different post's permalink to this record
//    even if the read happened at the perfectly correct time.
//
// So this function carries postUrl exactly as given, always, for both
// variants. An empty postUrl reaching a signed record is the honest state:
// this record does not know its permalink.
describe('forensicPayloadBase / forensicPayloadBaseVerbatimAuthor - postUrl is never guessed', () => {
  it('forensicPayloadBase leaves postUrl empty rather than reading location.href', () => {
    const actual = forensicPayloadBase({
      mode: 'teen', platform: 'tiktok', aiSource: 'cloud', author: '@creator', postUrl: '', feedSource: 'video',
    });
    expect(actual.postUrl).toBe('');
  });

  it('forensicPayloadBaseVerbatimAuthor (the video-context path) also leaves postUrl empty on empty input', () => {
    const actual = forensicPayloadBaseVerbatimAuthor({
      mode: 'adult', platform: 'youtube', aiSource: 'rules', author: 'a', postUrl: '', feedSource: 'video',
    });
    expect(actual.postUrl).toBe('');
  });

  it('a real postUrl is carried through unchanged, not overwritten', () => {
    const actual = forensicPayloadBase({
      mode: 'teen', platform: 'tiktok', aiSource: 'cloud', author: '@creator',
      postUrl: 'https://www.tiktok.com/@creator/video/123', feedSource: 'video',
    });
    expect(actual.postUrl).toBe('https://www.tiktok.com/@creator/video/123');
  });
});
