// P0-3 forensic-attribution fix verification (2026-05-27).
//
// Pinned regression test: pre-rewrite-hide forensic records must NOT
// falsely attribute their verdict to a cloud LLM. Two records found in
// the 2026-05-26 chain export carried aiModel='llama-3.1-8b-instant' +
// aiProvider='groq' + aiSource='cloud' despite being produced by a
// regex-based harm-floor gate that never makes a network call. This test
// fails if those wrong values reappear.

import { describe, it, expect } from 'vitest';
import { buildPreRewriteHideForensicFields } from '../../../../src/content/post-path/video-pipeline';
import type { HideEntry } from '../../../../src/content/protection/pre-rewrite-harm-floor-gate';
import type { HarmFloorResult } from '../../../../src/core/harm-floor';

function makeHide(reason: 'identity-slur' | 'profanity-tier', text: string): HideEntry {
  const harmFloor: HarmFloorResult = {
    score: 0,
    signals: [],
    triggers: false,
    language: 'en',
    dampener: 1,
  };
  return {
    raw: {
      text,
      likes: 0,
      replies: 0,
      isPinned: false,
      isCreatorReply: false,
      isHighlighted: false,
      authorHandle: '@badactor',
      timestamp: '2026-05-27T00:00:00Z',
    },
    reason,
    matches: ['shit', 'fuck'],
    harmFloor,
  };
}

describe('buildPreRewriteHideForensicFields — P0-3 attribution fix', () => {
  it('stamps aiSource as "rules" — NOT "cloud"', () => {
    const fields = buildPreRewriteHideForensicFields(
      makeHide('profanity-tier', 'this is fucking ridiculous'),
      'youtube',
      'teen',
      'yt-vid-abc123',
      'https://youtube.com/watch?v=abc123',
    );
    expect(fields.aiSource).toBe('rules');
    expect(fields.aiSource).not.toBe('cloud');
    expect(fields.aiSource).not.toBe('local');
  });

  it('stamps aiModel as fw-harm-floor-regex-v1 — NOT a Groq model name', () => {
    const fields = buildPreRewriteHideForensicFields(
      makeHide('profanity-tier', 'shit example'),
      'tiktok',
      'teen',
      undefined,
      'https://www.tiktok.com/@x/video/1',
    );
    expect(fields.aiModel).toBe('fw-harm-floor-regex-v1');
    expect(fields.aiModel).not.toBe('llama-3.1-8b-instant');
    expect(fields.aiModel).not.toMatch(/llama|groq|gpt|claude/i);
  });

  it('stamps aiProvider as fw-rules — NOT groq', () => {
    const fields = buildPreRewriteHideForensicFields(
      makeHide('identity-slur', 'slur example'),
      'instagram',
      'child',
      'ig-post-1',
      'https://www.instagram.com/p/1/',
    );
    expect(fields.aiProvider).toBe('fw-rules');
    expect(fields.aiProvider).not.toBe('groq');
  });

  it('propagates detectionMode that names the rule class', () => {
    const profanity = buildPreRewriteHideForensicFields(
      makeHide('profanity-tier', 'x'),
      'youtube', 'teen', undefined, 'https://x',
    );
    expect(profanity.detectionMode).toBe('pre-rewrite-hide:profanity-tier');

    const slur = buildPreRewriteHideForensicFields(
      makeHide('identity-slur', 'x'),
      'youtube', 'teen', undefined, 'https://x',
    );
    expect(slur.detectionMode).toBe('pre-rewrite-hide:identity-slur');
  });

  it('passes through originalText, author, postUrl, parentVideoId, mode, platform, kind, feedSource', () => {
    const fields = buildPreRewriteHideForensicFields(
      makeHide('profanity-tier', 'sample text'),
      'tiktok',
      'teen',
      'tk-vid-xyz',
      'https://www.tiktok.com/@user/video/xyz',
    );
    expect(fields.originalText).toBe('sample text');
    expect(fields.author).toBe('@badactor');
    expect(fields.postUrl).toBe('https://www.tiktok.com/@user/video/xyz');
    expect(fields.parentVideoId).toBe('tk-vid-xyz');
    expect(fields.mode).toBe('teen');
    expect(fields.platform).toBe('tiktok');
    expect(fields.kind).toBe('comment');
    expect(fields.feedSource).toBe('video');
  });

  it('falls back author to "unknown" when missing', () => {
    const hide = makeHide('profanity-tier', 'x');
    Reflect.deleteProperty(hide.raw, 'authorHandle');
    const fields = buildPreRewriteHideForensicFields(
      hide, 'youtube', 'teen', undefined, 'https://x',
    );
    expect(fields.author).toBe('unknown');
  });
});
