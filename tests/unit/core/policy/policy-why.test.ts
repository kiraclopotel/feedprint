// core/policy/why.ts: the row a legacy hide corresponds to, or null.
// Honesty locks: the household's own blocklist word is the only match ever
// returned; a slur never is; a profanity-only hide names no row because the
// table has none; unknown signals name nothing rather than something invented.

import { describe, it, expect } from 'vitest';
import { whyFor } from '../../../../src/core/policy/why';

describe('whyFor', () => {
  it('the household blocklist is R1 with the rule quoted, even when the rule carries a colon', () => {
    expect(whyFor('blocklist:word:elon', [], 9)).toEqual({ row: 'R1', match: 'elon' });
    expect(whyFor('blocklist:phrase:ada brightwell', [], 9)).toEqual({ row: 'R1', match: 'ada brightwell' });
    expect(whyFor('blocklist:account:@x:y', [], 9)).toEqual({ row: 'R1', match: '@x:y' });
    expect(whyFor('blocklist:word', [], 9)).toEqual({ row: 'R1' });
  });

  it('the slur list is R2 with no match, on both slur paths', () => {
    expect(whyFor('slur:2', ['extreme-toxicity'], 8)).toEqual({ row: 'R2' });
    expect(whyFor('pre-rewrite-hide:identity-slur', ['profanity'], 9)).toEqual({ row: 'R2' });
  });

  it('coded harm is R3, the sponsored label is R4, dehumanisation is the group row', () => {
    expect(whyFor('coded-harm:antisemitic', [], 9)).toEqual({ row: 'R3' });
    expect(whyFor('sponsored-ad', ['consumer-rapid-frame'], 6)).toEqual({ row: 'R4' });
    expect(whyFor('sponsored-ad:adult', [], 6)).toEqual({ row: 'R4' });
    expect(whyFor('dehumanization:1', [], 8)).toEqual({ row: 'J4' });
  });

  // R4 is a rail row, so returning it from a TECHNIQUE name writes a sponsored
  // rail on a record no ad marker ever touched, and the export then counts that
  // post in its paid-placements column. The judge names consumer-rapid-frame on
  // ordinary commercial pressure, which is what J6 is for. (2026-09-18)
  it('a judged consumer-rapid-frame is commercial pressure, not an advertisement', () => {
    expect(whyFor('combined-detect-neutralize', ['consumer-rapid-frame'], 6)).toEqual({ row: 'J6' });
    expect(whyFor(undefined, ['consumer-rapid-frame'], 8)).toEqual({ row: 'J6' });
    // The ad marker still decides, ahead of the technique list, in both modes.
    expect(whyFor('sponsored-ad', ['consumer-rapid-frame'], 6)).toEqual({ row: 'R4' });
    expect(whyFor('sponsored-ad:adult', ['consumer-rapid-frame'], 6)).toEqual({ row: 'R4' });
  });

  it('protect categories come from the technique names', () => {
    expect(whyFor('combined-detect-neutralize', ['violence-graphic'], 8)).toEqual({ row: 'P5' });
    expect(whyFor(undefined, ['sexual'], 8)).toEqual({ row: 'P3' });
    expect(whyFor(undefined, ['self-harm'], 8)).toEqual({ row: 'P2' });
    expect(whyFor(undefined, ['drug-promotion'], 8)).toEqual({ row: 'P4' });
    expect(whyFor(undefined, ['scapegoating'], 7)).toEqual({ row: 'J4' });
    expect(whyFor('violence-narrating-video', [], 8)).toEqual({ row: 'P5' });
  });

  it('a hostility hide is banded by severity', () => {
    expect(whyFor('comment-batch:negative', ['extreme-toxicity'], 9)).toEqual({ row: 'J1' });
    expect(whyFor('comment-batch:negative', ['combined-stack'], 7)).toEqual({ row: 'J2' });
    expect(whyFor('comment-batch:negative', ['anger-trigger'], 8)).toEqual({ row: 'J2' });
    expect(whyFor('comment-batch:negative', ['anger-trigger'], 5)).toEqual({ row: 'J7' });
    expect(whyFor('harm-laundering', [], undefined)).toEqual({ row: 'J2' });
  });

  it('a profanity-only hide names no row, and so does an unknown signal', () => {
    expect(whyFor('pre-rewrite-hide:profanity-tier', ['profanity'], 9)).toBeNull();
    expect(whyFor('profanity:3', ['profanity'], 9)).toBeNull();
    expect(whyFor('something-new', [], 2)).toBeNull();
    expect(whyFor(undefined, [], undefined)).toBeNull();
  });
});
