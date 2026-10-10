// Voice-rule umbrella validator contract.
//
// `validateRewrite` is wired into BOTH the per-comment `neutralizeText`
// fallback path AND the BATCH V3 inline-rewrite path (`content/index.ts`
// flushBatch Promise.all). Before this, only the fallback ran the full
// 8-guard stack; the primary BATCH V3 inline path ran only the language
// validator — so generic-platitude register-flattenings like "I think
// this behavior is unacceptable" landed in DOM unchallenged. Item 4.1
// from `docs/history/archive/audits-2026-05-22/CODE_MAP.md`.

import { describe, it, expect } from 'vitest';
import { validateRewrite } from '../../../src/analysis/comment-rewriter';

describe('validateRewrite — voice-rule umbrella', () => {
  it('accepts a clean first-person defusion rewrite', () => {
    const result = validateRewrite(
      'I disagree with the position taken here.',
      "You're completely wrong about this.",
    );
    expect(result.valid).toBe(true);
  });

  it('rejects rewrites under 5 chars (too-short)', () => {
    const result = validateRewrite('hi', "You're completely wrong about this.");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('too-short');
  });

  it('rejects rewrites that meta-summarize the post (meta-talk)', () => {
    const result = validateRewrite(
      'This post expresses frustration toward the politicians involved.',
      "You're completely wrong about this.",
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('meta-talk');
  });

  it('rejects predicate-swap self-admission ("You\'re X" → "I\'m X")', () => {
    const result = validateRewrite("I'm stupid for sure.", "You're stupid for sure.");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('false-self-admission');
  });

  it('rejects injected advisory ("rely on credible sources")', () => {
    const result = validateRewrite(
      'I think we should rely on credible sources before accepting this.',
      "You're spreading misinformation again.",
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('advisory-injection');
  });

  it('rejects length-ratio blowup (>1.7× on substantive originals)', () => {
    const result = validateRewrite(
      'I find the position presented here to be deeply problematic and would urge careful re-examination of the underlying assumptions involved in this argument before drawing conclusions.',
      'this is wrong about everything',
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('length-blowup');
  });

  it('rejects register-flattening (markers in original lost in rewrite ≥80 chars)', () => {
    // Rewrite sized to clear the 80-char register threshold while staying
    // under both length-blowup tiers (≤100 chars OR ratio ≤ 1.7 vs the
    // 69-char original).
    const result = validateRewrite(
      'I disagree with the position taken here and would suggest a more measured tone going forward.',
      'YOU ARE COMPLETELY WRONG ABOUT EVERYTHING IN THIS DISCUSSION TODAY!!!',
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('register-flatten');
  });

  it("rejects FORBIDDEN_META_PATTERNS (editor's note, Note:, warnings)", () => {
    const result = validateRewrite(
      "Editor's note: this comment was redacted for clarity.",
      'random angry comment about politicians',
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('forbidden-meta');
  });

  it('rejects language-drift (RO original → EN rewrite)', () => {
    const result = validateRewrite(
      'I disagree with the politicians here.',
      'MARS PSD-AUR SOBOLANII violatori de minore politicieni corupți de la putere',
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('language-drift');
  });

  it('exposes diagnostic detail for hit-string reasons', () => {
    const result = validateRewrite(
      'I think we should rely on credible sources before accepting this.',
      "You're spreading misinformation again.",
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('advisory-injection');
    expect(result.detail).toBeDefined();
    expect(result.detail).toMatch(/credible sources/i);
  });

  it('rejects rewrite that preserves English profanity', () => {
    const result = validateRewrite(
      'he fucking hates you',
      'he fucking hates you',
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('profanity-preserved');
  });

  it('rejects rewrite that preserves Romanian profanity', () => {
    const result = validateRewrite(
      'Cred ca esti o muie ordinara si merita sa te futa.',
      'Esti o muie ordinara si nu meriti respect!!!',
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('profanity-preserved');
  });

  // Near-identical fixtures must be insult-free: an ad-hominem token in the
  // rewrite now trips the (earlier) profanity-preserved check — locked by the
  // Shield/Coach/Lens voice rule (DECISIONS 2026-07-02).
  it('rejects rewrite identical to original', () => {
    const original = 'Everyone in this thread keeps repeating the same wrong claim about the vote.';
    const result = validateRewrite(original, original);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('near-identical');
  });

  it('rejects rewrite near-identical with trivial punctuation change', () => {
    const result = validateRewrite(
      'Everyone in this thread keeps repeating the same wrong claim about the vote',
      'Everyone in this thread keeps repeating the same wrong claim about the vote.',
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('near-identical');
  });

  it('a rewrite that carries the insult rejects as profanity-preserved even when identical', () => {
    const original = 'This person is a complete moron and everyone knows it and should be ashamed.';
    const result = validateRewrite(original, original);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('profanity-preserved');
  });

  it('rejects the real 2026-07-02 chain failure: grammar-polished insult', () => {
    const result = validateRewrite(
      'Cred că persoana este un idiot.',
      'Un.idiot',
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('profanity-preserved');
  });

  it('accepts a genuinely different clean rewrite', () => {
    const result = validateRewrite(
      'I see things differently here and would express it more gently.',
      'You are a complete idiot for believing this garbage.',
    );
    expect(result.valid).toBe(true);
  });
});
