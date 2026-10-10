// LOOP-027.2 regression — session-scoped FORENSIC_LOG dedup.
//
// When the pipeline's processingCache returns a manipulative cache hit,
// content/index.ts used to unconditionally emit FORENSIC_LOG, and addRecord
// appended unconditionally. Scroll-back / retweet / SPA re-mount produced
// duplicate IDB records. Fixed by gating the emit with a session-scoped Set
// of post-text. These tests lock the gate semantics.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  shouldLogForensic,
  _resetForensicDedupForTesting,
} from '../../../src/content/index';

beforeEach(() => {
  _resetForensicDedupForTesting();
});

describe('content/index — shouldLogForensic (LOOP-027.2)', () => {
  it('allows first sighting of a post text', () => {
    expect(shouldLogForensic('The first post text.')).toBe(true);
  });

  it('suppresses a repeat of identical text', () => {
    expect(shouldLogForensic('Repeat me.')).toBe(true);
    expect(shouldLogForensic('Repeat me.')).toBe(false);
    expect(shouldLogForensic('Repeat me.')).toBe(false);
  });

  it('distinguishes whitespace / punctuation variants — these are NOT the same post', () => {
    expect(shouldLogForensic('Hello world')).toBe(true);
    expect(shouldLogForensic('Hello world ')).toBe(true);       // trailing space
    expect(shouldLogForensic('Hello  world')).toBe(true);       // double space
    expect(shouldLogForensic('Hello world!')).toBe(true);       // punctuation
  });

  it('is case-sensitive — matches bit-exact extraction, not normalized form', () => {
    expect(shouldLogForensic('Breaking News')).toBe(true);
    expect(shouldLogForensic('breaking news')).toBe(true);
    expect(shouldLogForensic('BREAKING NEWS')).toBe(true);
  });

  it('resetter restores first-sighting semantics', () => {
    shouldLogForensic('persisted');
    expect(shouldLogForensic('persisted')).toBe(false);
    _resetForensicDedupForTesting();
    expect(shouldLogForensic('persisted')).toBe(true);
  });

  it('handles a large batch without unbounded memory growth', () => {
    // The implementation evicts oldest half at 2000 entries. Beyond capacity,
    // later inserts still succeed and still dedup for the last-kept window.
    for (let i = 0; i < 2500; i++) {
      expect(shouldLogForensic(`post-${i}`)).toBe(true);
    }
    // A fresh text still gets through
    expect(shouldLogForensic('after-eviction')).toBe(true);
    // Most-recent text is still remembered (tail was never evicted)
    expect(shouldLogForensic('post-2499')).toBe(false);
  });

  it('empty string is treated as any other text (dedup applies)', () => {
    expect(shouldLogForensic('')).toBe(true);
    expect(shouldLogForensic('')).toBe(false);
  });

  // TikTok empty-caption video records: the emit branch in onProcessingResult
  // keys the dedup on `post.id` (`tk-vid-<videoId>`), NOT `post.text`. This
  // test documents WHY: keying on the empty caption text would collapse every
  // captionless video to a single chain record (the empty-string case above),
  // dropping ~half the watched videos. Keying on the video identity keeps one
  // record per distinct video while still suppressing the same video on
  // re-detection.
  describe('TikTok video records dedup by identity, not empty caption text', () => {
    it('two distinct empty-caption videos keyed by id do NOT collapse', () => {
      // What WOULD happen if keyed on the (empty) caption text:
      expect(shouldLogForensic('')).toBe(true);
      expect(shouldLogForensic('')).toBe(false); // second video lost
      _resetForensicDedupForTesting();

      // What the fix does — key on `tk-vid-<videoId>`:
      expect(shouldLogForensic('tk-vid-7000000000000000001')).toBe(true);
      expect(shouldLogForensic('tk-vid-7000000000000000002')).toBe(true); // survives
    });

    it('the SAME video id is still deduped (no spam on re-detection)', () => {
      expect(shouldLogForensic('tk-vid-7234567890123456789')).toBe(true);
      expect(shouldLogForensic('tk-vid-7234567890123456789')).toBe(false);
      expect(shouldLogForensic('tk-vid-7234567890123456789')).toBe(false);
    });
  });
});

describe('the dedup set is what stops a second record for one post', () => {
  // The module header says this gate exists because addRecord is an
  // unconditional append: a 202-record live scroll on a real install showed
  // about 20% duplication matching this pattern. boundedAdd then dropped the oldest
  // HALF of the set whenever it filled, so a reader who scrolled past the cap
  // and scrolled back got a second signed record for a post already on the
  // chain — the same duplication, reintroduced by the fix's own memory bound.
  // Every count this product publishes is a count of these rows.

  it('a post seen at the start of a long session is still deduped after the cap is passed', () => {
    const first = 'the very first post of a long scroll session';
    expect(shouldLogForensic(first)).toBe(true);
    // Well past the old 2000-entry cap, so the old half-eviction had fired.
    for (let i = 0; i < 3000; i++) shouldLogForensic(`filler-${i}`);
    expect(shouldLogForensic(first)).toBe(false);
  });

  it('bounds itself by characters held, shedding the oldest key only', () => {
    // An entry count is a bad proxy for memory: 2000 keys of a 10,000-character
    // post is 40 MB, and 2000 keys of a 20-character comment threw away 1000
    // items to save 40 kB. The bound is the characters held, and it sheds one
    // key per insertion rather than half the session at a stroke.
    const long = (n: number) => `${n}:`.padEnd(100_000, 'x');
    // Enough 100,000-character keys to pass the character budget several times
    // over while staying far under any plausible entry ceiling.
    for (let i = 0; i < 60; i++) shouldLogForensic(long(i));
    // The newest keys are still remembered...
    expect(shouldLogForensic(long(59))).toBe(false);
    expect(shouldLogForensic(long(58))).toBe(false);
    // ...and the oldest was shed to stay inside the budget. Checked last: a
    // miss re-adds the key and sheds another.
    expect(shouldLogForensic(long(0))).toBe(true);
  });
});
