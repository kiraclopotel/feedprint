// The model's refusal was shown to the reader as the rewrite.
//
// Seen on a live X thread 2026-09-19, one comment caught in three states: the
// original, the FeelingWise marker, and in between a softened line reading
// "I'm sorry, but I can't help with that." That sentence
// is not a rewrite of anything. It is the provider declining, and the product
// put it on the page in place of somebody's words, under its own name.
//
// Why it got through: validateRewrite rejects meta-talk, false self-admission,
// injected advisories, length blowups and register flattening, and a refusal is
// none of those. It is short, fluent, first-person, contains no forbidden
// pattern, and passes every gate. The one thing nobody had told the validator is
// that the model sometimes answers the question "rewrite this" with "no".
//
// It matters more than a cosmetic bug. The product's claim is that a softened
// line is the same point said without the charge. A refusal replaces the point
// entirely, so a reader sees agreement where there was an attack, and the record
// keeps that as what was said.
//
// The check lives here rather than in the neutralizer's own pattern list because
// src/core/neutralizer.ts is frozen and changes only on the owner's word for
// that specific edit.

import { describe, it, expect } from 'vitest';
import { validateRewrite } from '../../../src/analysis/comment-rewriter';

/** The comment from the report. The rewrite is meant to carry this point without the abuse. */
const ORIGINAL =
  "We don't need to ask Grok whether you're a colossal Jew-hating idiot, we can clearly see that for ourselves.";

describe('a model refusal is not a rewrite (2026-09-19)', () => {
  const REFUSALS = [
    // The exact string the customer was shown.
    "I'm sorry, but I can't help with that.",
    "I'm sorry, but I can't help with that",
    "I am sorry, but I cannot help with that.",
    'Sorry, I cannot assist with that request.',
    "I can't help with that.",
    "I'm unable to help with this request.",
    'I cannot fulfill this request.',
    "As an AI, I can't rewrite that.",
    "I won't be able to help with that.",
  ];

  for (const refusal of REFUSALS) {
    it(`refuses to pass: ${refusal}`, () => {
      const verdict = validateRewrite(refusal, ORIGINAL);
      expect(verdict.valid, `a refusal was accepted as a rewrite: ${refusal}`).toBe(false);
    });
  }

  it('says which gate caught it, so the record can say why nothing was shown', () => {
    const verdict = validateRewrite("I'm sorry, but I can't help with that.", ORIGINAL);
    expect(verdict.valid).toBe(false);
    expect(verdict.reason, 'named as a refusal rather than folded into another reason').toBe('refusal');
  });

  // The other half. A rewrite that merely SOUNDS apologetic is a legitimate
  // softening, and rejecting those would leave flagged comments unrewritten,
  // which is the failure this product is for.
  const REAL_REWRITES = [
    'I disagree with you strongly, and I think the evidence points the other way.',
    "I'm sorry you feel that way, but I still think the argument does not hold.",
    'I cannot agree with this take at all.',
    "Sorry, but I think you have this backwards and here is why.",
    'I am sorry to say it, but the numbers do not support that claim.',
  ];

  for (const good of REAL_REWRITES) {
    it(`still accepts a real rewrite: ${good}`, () => {
      const verdict = validateRewrite(good, ORIGINAL);
      expect(verdict.valid, `a legitimate rewrite was rejected as a refusal: ${good}`).toBe(true);
    });
  }
});
