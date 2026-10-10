// F-5 — pre-rewrite harm-floor gate unit tests.
//
// Verifies the legacy-path port of the BATCH-path F-3 hide-tier dispatch:
// identity-slur and sexual/violence/drug profanity-tier matches route to
// hidesToApply; everything else passes through to commentsToRewrite.

import { describe, it, expect } from 'vitest';
import { preRewriteHarmFloorGate } from '../../../src/content/protection/pre-rewrite-harm-floor-gate';
import type { ScoredComment, RawComment } from '../../../src/analysis/comment-scorer';

function makeRaw(text: string): RawComment {
  return {
    text,
    likes: 0,
    replies: 0,
    isPinned: false,
    isCreatorReply: false,
    isHighlighted: false,
    authorHandle: '@user',
    timestamp: '2026-05-08T00:00:00Z',
  };
}

function makeScored(text: string): ScoredComment {
  return {
    raw: makeRaw(text),
    scores: {
      relevance: 0.5,
      popularity: 0.5,
      creatorSignal: 0,
      consensus: 0,
      noise: 0,
      sarcasm: 0,
    },
    composite: 0.5,
    flags: [],
  };
}

describe('preRewriteHarmFloorGate — F-5 legacy-path port', () => {
  it('routes identity-slur RawComment to hidesToApply', () => {
    // 'faggot' is in ENGLISH_SLURS per src/core/profanity-filter.ts; the
    // tier='slurs' filter matches and the gate routes to hide.
    const sc = makeScored('you are a faggot');
    const result = preRewriteHarmFloorGate([sc], 'teen');
    expect(result.hidesToApply).toHaveLength(1);
    expect(result.hidesToApply[0].reason).toBe('identity-slur');
    expect(result.hidesToApply[0].matches.length).toBeGreaterThan(0);
    expect(result.commentsToRewrite).toHaveLength(0);
  });

  it('routes profanity-tier sexual RawComment to hidesToApply', () => {
    // 'cock' is in ENGLISH_PROFANITY (sexual subset) per ADR-003 §4 F-3
    // extension; tier='profanity' filter matches and gate routes to hide.
    const sc = makeScored('my cock gets homesick');
    const result = preRewriteHarmFloorGate([sc], 'teen');
    expect(result.hidesToApply).toHaveLength(1);
    expect(result.hidesToApply[0].reason).toBe('profanity-tier');
    expect(result.commentsToRewrite).toHaveLength(0);
  });

  it('does NOT hide profanity-tier in adult mode — swearing is not a technique', () => {
    const sc = makeScored('my cock gets homesick');
    const result = preRewriteHarmFloorGate([sc], 'adult');
    expect(result.hidesToApply).toHaveLength(0);
    expect(result.commentsToRewrite).toHaveLength(1);
  });

  it('still hides an identity slur in adult mode', () => {
    const sc = makeScored('you are a faggot');
    const result = preRewriteHarmFloorGate([sc], 'adult');
    expect(result.hidesToApply).toHaveLength(1);
    expect(result.hidesToApply[0].reason).toBe('identity-slur');
  });

  it('passes a non-slur ad-hominem comment to commentsToRewrite', () => {
    // 'you are an idiot' has ad-hominem signal (harm-floor scores it) but
    // does NOT trip the slur tier or the profanity tier → goes to rewrite
    // path, where the existing 8b rewrite handles it as before.
    const sc = makeScored('you are an idiot');
    const result = preRewriteHarmFloorGate([sc], 'teen');
    expect(result.hidesToApply).toHaveLength(0);
    expect(result.commentsToRewrite).toHaveLength(1);
    expect(result.commentsToRewrite[0]).toBe(sc);
  });

  it('passes a clean comment to commentsToRewrite', () => {
    const sc = makeScored('thanks for the video, very helpful');
    const result = preRewriteHarmFloorGate([sc], 'teen');
    expect(result.hidesToApply).toHaveLength(0);
    expect(result.commentsToRewrite).toHaveLength(1);
  });

  it('handles a malformed empty-text RawComment without crashing', () => {
    const sc = makeScored('');
    const result = preRewriteHarmFloorGate([sc], 'teen');
    expect(result.hidesToApply).toHaveLength(0);
    expect(result.commentsToRewrite).toHaveLength(1);
  });

  it('routes a profane comment to hidesToApply (profanity dict drives the gate)', () => {
    // Word is incidental — uses an unambiguous profane term. Bare 'cum' was
    // removed from the dict (collided with Romanian "how" / English words),
    // so the test now uses a genuine sexual-profanity term.
    const sc = makeScored('he wants to jizz on her');
    const result = preRewriteHarmFloorGate([sc], 'teen');
    expect(result.hidesToApply).toHaveLength(1);
    expect(result.hidesToApply[0].reason).toBe('profanity-tier');
  });

  it('partitions a mixed batch into hides and rewrites correctly', () => {
    const slurComment = makeScored('damn faggot loser');
    const cleanComment = makeScored('great video');
    const adHominemComment = makeScored('you are stupid');
    const result = preRewriteHarmFloorGate(
      [slurComment, cleanComment, adHominemComment],
      'teen',
    );
    expect(result.hidesToApply).toHaveLength(1);
    expect(result.hidesToApply[0].reason).toBe('identity-slur');
    expect(result.commentsToRewrite).toHaveLength(2);
  });
});
