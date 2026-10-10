// @vitest-environment node
//
// Room sensor — the SEPARATE room-analysis call (buildRoomPrompt + the
// parseRoomAnalysis parser behind scoreRoom). Folding room reasoning into the
// per-comment BATCH prompt measurably regressed 8b detection (2026-06-15
// honest-en-v1, temp=0: recall OR precision lost every in-call variant), so the
// room read gets its own call. These lock the room prompt shape + the parser's
// null-safety. The per-comment detector (buildBatchPromptV3) is untouched and
// corpus-gated separately.

import { describe, it, expect } from 'vitest';
import { buildRoomPrompt } from '../../../src/ai/prompts-v2';
import {
  parseRoomAnalysis,
  encounterFromLegacyBatchInput,
} from '../../../src/analysis/comment-batch-scorer';

function enc(caption: string, comments: string[]) {
  return encounterFromLegacyBatchInput(
    {
      comments: comments.map((text, i) => ({ author: 'u' + i, text })),
      videoCaption: caption,
      language: 'English',
    },
    'tiktok',
  );
}

describe('buildRoomPrompt — the separate room-analysis prompt', () => {
  it('asks for the four structured fields + strict JSON, with the security wrap', () => {
    const { system, user } = buildRoomPrompt(
      enc('cute Kong with a sleeping tiger', ['its not funny', 'report all']),
    );
    expect(system).toMatch(/claim_vs_reaction/);
    expect(system).toMatch(/comment_manipulation/);
    expect(system).toMatch(/audience_distress/);
    expect(system).toMatch(/naming the specific signal/);
    expect(system).toMatch(/ONLY strict JSON/);
    expect(system).toMatch(/SECURITY/);
    // The caption + comments are the DATA, wrapped — never instructions.
    expect(user).toContain('<user-content>');
    expect(user).toContain('cute Kong with a sleeping tiger');
    expect(user).toContain('its not funny');
  });

  it('age framing differs child vs teen', () => {
    expect(buildRoomPrompt(enc('x', ['a']), 'child').system).toContain('8-12 year old child');
    expect(buildRoomPrompt(enc('x', ['a']), 'teen').system).toContain('13-17 year old teenager');
  });

  it('handles an empty caption (music-only)', () => {
    expect(buildRoomPrompt(enc('', ['nice'])).user).toContain('(no caption / music-only)');
  });
});

describe('parseRoomAnalysis — null-safe structured parse', () => {
  it('extracts a valid room analysis', () => {
    const r = parseRoomAnalysis(
      JSON.stringify({
        claim_vs_reaction: 'contradicts',
        comment_manipulation: 'pile-on',
        audience_distress: true,
        summary: 'The crowd disputes the post; several are upset.',
      }),
    );
    expect(r).toEqual({
      claimVsReaction: 'contradicts',
      commentManipulation: 'pile-on',
      audienceDistress: true,
      summary: 'The crowd disputes the post; several are upset.',
      topicLabels: [],
    });
  });

  it('defaults invalid enums to the safe values and a non-boolean distress to false', () => {
    const r = parseRoomAnalysis(
      JSON.stringify({
        claim_vs_reaction: 'whatever',
        comment_manipulation: 'bogus',
        audience_distress: 'yes',
        summary: 'x',
      }),
    );
    expect(r?.claimVsReaction).toBe('no-claim');
    expect(r?.commentManipulation).toBe('none');
    expect(r?.audienceDistress).toBe(false);
  });

  it('returns null on malformed JSON or a missing/blank summary', () => {
    expect(parseRoomAnalysis('not json at all')).toBeNull();
    expect(parseRoomAnalysis(JSON.stringify({ claim_vs_reaction: 'ignores' }))).toBeNull();
    expect(parseRoomAnalysis(JSON.stringify({ summary: '   ' }))).toBeNull();
  });
});

describe('topic labels — the "what the post IS" axis (closed list)', () => {
  it('the room prompt asks for topic_labels from the closed list', () => {
    const { system } = buildRoomPrompt(enc('goal compilation', ['what a strike']));
    expect(system).toMatch(/topic_labels/);
    expect(system).toMatch(/\bgaming\b/);
    expect(system).toMatch(/\bwar-conflict\b/);
    expect(system).toMatch(/"topic_labels":\[/);
  });

  it('parses valid labels, drops unknown + duplicate values, caps at 3', () => {
    const r = parseRoomAnalysis(
      JSON.stringify({
        claim_vs_reaction: 'no-claim',
        comment_manipulation: 'none',
        audience_distress: false,
        summary: 'Football highlight; fans celebrating.',
        topic_labels: ['sports', 'made-up-label', 'sports', 'comedy-memes', 'music', 'food'],
      }),
    );
    expect(r?.topicLabels).toEqual(['sports', 'comedy-memes', 'music']);
  });

  it('a non-array or absent topic_labels yields [] (back-compat with cached responses)', () => {
    const base = {
      claim_vs_reaction: 'no-claim',
      comment_manipulation: 'none',
      audience_distress: false,
      summary: 'x',
    };
    expect(parseRoomAnalysis(JSON.stringify(base))?.topicLabels).toEqual([]);
    expect(parseRoomAnalysis(JSON.stringify({ ...base, topic_labels: 'sports' }))?.topicLabels).toEqual([]);
  });
});
