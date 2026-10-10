// FeelingWise — triviality filter unit tests (Faza 4)
//
// Locks the contract for the L0 triviality gate. The pipeline relies on this
// decision to (a) NOT send individual comment flags to L2 for emoji-only
// reactions, and (b) still count trivial comments toward cascade intensity.
// A regression here either (i) over-flags (chips on every "😂😂😂") or
// (ii) under-flags (a directed `@Maria mincinoaso!` attack gets swept into
// triviality). The fixtures below pin both failure modes.

import { describe, it, expect } from 'vitest';
// §CT-44 (2026-05-06) — `buildTrivialIndexSet` + `filterTrivialCommentFlags`
// removed alongside v3-pipeline purge. Only `isTrivial` survives (consumed
// by v2 tiktok-bundle extractor). L1Output type also removed.
import { isTrivial } from '../../../src/core/triviality';

// ─────────────────────────────────────────────────────────────────────────────
// isTrivial — positive triviality cases
// ─────────────────────────────────────────────────────────────────────────────

describe('isTrivial — trivial inputs', () => {
  it('empty string is trivial', () => {
    expect(isTrivial('').trivial).toBe(true);
    expect(isTrivial('   \n\t  ').trivial).toBe(true);
  });

  it('bare sticker placeholder is trivial', () => {
    const r = isTrivial('[Sticker]');
    expect(r.trivial).toBe(true);
    expect(r.reason).toBe('sticker');
  });

  it('sticker placeholder with tiny emoji residual is trivial', () => {
    const r = isTrivial('[GIF] 😂');
    expect(r.trivial).toBe(true);
    expect(r.reason).toBe('sticker');
  });

  it('Romanian sticker placeholder variants', () => {
    expect(isTrivial('[autocolant]').trivial).toBe(true);
    expect(isTrivial('[imagine]').trivial).toBe(true);
  });

  it('emoji-dominant reactions are trivial', () => {
    expect(isTrivial('😭😭😭').trivial).toBe(true);
    expect(isTrivial('🤣🤣🤣🤣🤣').trivial).toBe(true);
    // Emojis + whitespace only — whitespace is not counted, so ratio = 100%
    expect(isTrivial('  👀   👀  ').trivial).toBe(true);
  });

  it('emoji + one letter stays emoji-dominant when ratio > 60%', () => {
    // 4 emojis + 1 letter = 80% emoji → trivial
    const r = isTrivial('😂😂😂😂k');
    expect(r.trivial).toBe(true);
    expect(r.reason).toBe('emoji-dominant');
  });

  it('sub-threshold tokens with no named entity are trivial', () => {
    expect(isTrivial('ok').trivial).toBe(true);
    expect(isTrivial('nu').trivial).toBe(true);
    expect(isTrivial('lol').trivial).toBe(true);
    expect(isTrivial('haha da').trivial).toBe(true); // 2 tokens, no NE
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isTrivial — substantive (NOT trivial) cases
// ─────────────────────────────────────────────────────────────────────────────

describe('isTrivial — substantive inputs', () => {
  it('three or more tokens are substantive by default', () => {
    expect(isTrivial('asta e bun acum').trivial).toBe(false);
    expect(isTrivial('this is really interesting').trivial).toBe(false);
  });

  it('short comment with a named entity is substantive (directed intent)', () => {
    // "Maria!" — 1 token, but Maria is a named entity → not trivial
    // Our heuristic requires NE at index ≥ 1 OR an @-mention; bare "Maria!"
    // at index 0 is saved only via @-mention. Use @-mention form:
    expect(isTrivial('@Maria mincinoaso!').trivial).toBe(false);
    expect(isTrivial('asa John').trivial).toBe(false); // John at index 1
  });

  it('emoji + substantial text is substantive (ratio <= 60%)', () => {
    // 4 emojis + 8 letters = 4/12 ~ 33% — under threshold, and token count ≥ 3
    expect(isTrivial('😂😂😂😂 asta e bine').trivial).toBe(false);
  });

  it('single substantive sentence is substantive', () => {
    expect(isTrivial('Nu e adevarat deloc ce spui').trivial).toBe(false);
  });

  it('news-like comment with diacritics is substantive', () => {
    expect(isTrivial('Sunt de acord cu afirmația aceasta.').trivial).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isTrivial — diagnostic metrics shape
// ─────────────────────────────────────────────────────────────────────────────

describe('isTrivial — metrics', () => {
  it('metrics populated for every decision', () => {
    const r = isTrivial('😂😂 hello world test');
    expect(r.metrics.nonWhitespaceCodepoints).toBeGreaterThan(0);
    expect(r.metrics.alphanumericTokens).toBeGreaterThan(0);
    expect(typeof r.metrics.emojiRatio).toBe('number');
  });

  it('emoji ratio correctly computed', () => {
    const r = isTrivial('😂😂ab'); // 2 emoji codepoints + 2 letters = 0.5
    expect(r.metrics.emojiCodepoints).toBe(2);
    expect(r.metrics.nonWhitespaceCodepoints).toBe(4);
    expect(r.metrics.emojiRatio).toBeCloseTo(0.5, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isTrivial — determinism
// ─────────────────────────────────────────────────────────────────────────────

describe('isTrivial — purity', () => {
  it('same input yields same output', () => {
    const t = '[Sticker]';
    expect(isTrivial(t)).toEqual(isTrivial(t));
  });

  it('regex state is not leaked between calls', () => {
    // Stateful /g regex bug: if lastIndex isn't reset, second call on the
    // same stringy input could misbehave. Lock it.
    expect(isTrivial('[Sticker]').trivial).toBe(true);
    expect(isTrivial('[Sticker]').trivial).toBe(true);
    expect(isTrivial('[Sticker]').trivial).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildTrivialIndexSet
// ─────────────────────────────────────────────────────────────────────────────

// §CT-44 (2026-05-06) — `buildTrivialIndexSet` + `filterTrivialCommentFlags`
// describe blocks removed alongside v3-pipeline purge. Those functions were
// v3-only consumers of `L1Output`. The `isTrivial` tests above remain.
