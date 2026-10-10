import { describe, it, expect } from 'vitest';
import { findDuplicateRewriteIndices } from '../../../src/core/neutralizer';

// Reproduces a 2026-06-03 X probe: three DISTINCT toxic comments were all
// rewritten by the 8b BATCH model into the identical bland phrase. The per-
// comment validator can't see the collision; this batch-level guard must.

describe('findDuplicateRewriteIndices', () => {
  it('rejects all rewrites when distinct comments share one bland rewrite (the live bug)', () => {
    const originals = [
      'lmao but if a black person was stealing',
      'no conversation can be had with you without race being involved huh?',
      'So go out and steal right bum mf? Trash like you needs to get taken out',
    ];
    const rewrites = [
      'I think this conversation is toxic',
      'I think this conversation is toxic',
      'I think this conversation is toxic',
    ];
    const reject = findDuplicateRewriteIndices(rewrites, originals);
    expect([...reject].sort()).toEqual([0, 1, 2]);
  });

  it('does NOT flag the same rewrite for the SAME (repeated) comment — that is legitimate', () => {
    const originals = ["you're trash", "you're trash"];
    const rewrites = ['I disagree with you', 'I disagree with you'];
    expect(findDuplicateRewriteIndices(rewrites, originals).size).toBe(0);
  });

  it('does not flag distinct comments with distinct rewrites', () => {
    const originals = ['you idiot', 'kill yourself loser'];
    const rewrites = ['I disagree', 'I am upset by this'];
    expect(findDuplicateRewriteIndices(rewrites, originals).size).toBe(0);
  });

  it('ignores empty rewrites (they already fall through to hide/mark)', () => {
    const originals = ['a', 'b', 'c'];
    const rewrites = ['', '', ''];
    expect(findDuplicateRewriteIndices(rewrites, originals).size).toBe(0);
  });

  it('flags only the colliding subset, leaving genuine rewrites intact', () => {
    const originals = ['comment one', 'comment two', 'comment three', 'comment four'];
    const rewrites = ['generic platitude', 'a real rewrite', 'generic platitude', 'another real one'];
    expect([...findDuplicateRewriteIndices(rewrites, originals).values()].sort()).toEqual([0, 2]);
  });

  it('normalizes case + whitespace so trivial differences do not defeat the match', () => {
    const originals = ['first nasty thing', 'second different nasty thing'];
    const rewrites = ['I think this is toxic', '  i think this   is toxic '];
    expect(findDuplicateRewriteIndices(rewrites, originals).size).toBe(2);
  });
});
