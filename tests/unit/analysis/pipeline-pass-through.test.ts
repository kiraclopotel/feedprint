// §CT-10 (2026-05-04) — BUG-CT-9.1 path (C) high-risk pass-through gate.
//
// Validates the membership predicate that decides whether the LLM rewrite
// should be suppressed (original text kept on the page) for techniques where
// 8b combined-detect-neutralize has been observed to fail catastrophically
// (voice-inversion / content fabrication). Full diagnosis + Council
// recommendation in .brain/BUGS_2026-05-03.md §10.1.
//
// Coverage:
//   • parasocial-coercion → pass-through (V1 hotfix scope)
//   • Other manipulation techniques → not pass-through (rewrite trusted)
//   • Undefined primaryTechnique → not pass-through (no signal to gate on)
//
// Pure-function unit test: the gate logic is membership in a ReadonlySet.
// The full pipeline integration is exercised by the existing post-LLM tests
// (neutralizer.test.ts) + manual MCP verification on a real machine after
// reload (chrome-extension:// boundary).

import { describe, it, expect } from 'vitest';
import { isHighRiskPassThrough } from '../../../src/analysis/pipeline';

describe('pipeline — §CT-10 BUG-CT-9.1 high-risk pass-through gate', () => {
  it('flags parasocial-coercion as high-risk pass-through (V1 hotfix scope)', () => {
    expect(isHighRiskPassThrough('parasocial-coercion')).toBe(true);
  });

  it('does NOT flag fear-appeal (rewrite path is reliable for this technique)', () => {
    expect(isHighRiskPassThrough('fear-appeal')).toBe(false);
  });

  it('does NOT flag shame-attack (rewrite path is reliable for this technique)', () => {
    expect(isHighRiskPassThrough('shame-attack')).toBe(false);
  });

  it('does NOT flag scapegoating (already routes via action="collapse" upstream)', () => {
    expect(isHighRiskPassThrough('scapegoating')).toBe(false);
  });

  it('does NOT flag hyperreal-trauma-bait (already routes via action="collapse" upstream)', () => {
    expect(isHighRiskPassThrough('hyperreal-trauma-bait')).toBe(false);
  });

  it('does NOT flag body-comparison-priming (no documented 8b-rewrite failure yet)', () => {
    // V1 set is conservative — only techniques with empirical failure evidence.
    // body-comparison-priming may join the set in V1.5 if observed; do not
    // pre-empt per VISION §2.5 own-failures-explicitly + feedback_dont_trust_code.
    expect(isHighRiskPassThrough('body-comparison-priming')).toBe(false);
  });

  it('returns false for undefined primaryTechnique', () => {
    expect(isHighRiskPassThrough(undefined)).toBe(false);
  });
});
