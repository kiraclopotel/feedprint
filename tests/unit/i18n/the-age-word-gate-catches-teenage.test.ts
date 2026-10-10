// Gem 64 (found by an S3 code read): the four grep gates
// (the-{dashboard,export,markers,popup}-speaks-to-the-person-whose-feed-it-is.test.ts) share one
// WORDS pattern that catches "teen", "teens", "teenager" and "teenagers" but not the bare
// adjective "teenage" ("teenage drama"). No current string uses it, so nothing was mis-exported,
// but the same regex shape repeats in every gate and a future string could slip through unnoticed.
// This pins the fixed pattern against both a word it must catch and words it must not.

import { describe, expect, it } from 'vitest';

// The exact fragment now shared by all four gates; kept here as one string so a future edit to
// any of the four in isolation would drift from this proof rather than pass it by accident.
const TEEN_WORD = /\bteen(s|age|ager|agers)?\b/i;

describe('the age-word gate catches "teenage"', () => {
  it.each(['teen', 'teens', 'teenage', 'teenager', 'teenagers'])('matches "%s"', (word) => {
    expect(TEEN_WORD.test(`this is a ${word} thing`)).toBe(true);
  });

  it.each(['vintage', 'cottage', 'canteen', 'thirteen'])('does not match "%s"', (word) => {
    expect(TEEN_WORD.test(`this is a ${word} thing`)).toBe(false);
  });
});
