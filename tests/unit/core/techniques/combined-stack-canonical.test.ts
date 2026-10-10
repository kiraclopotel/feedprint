/** @vitest-environment node */
// CHARLIE-3 Day 3 — combined-stack CANONICAL ACCEPTANCE GATE.
//
// Per the sub-agent brief contract: the synthetic X post text below
// MUST flag with present=true, severity ≥ 6. If it doesn't, ALPHA-1
// rejects combined-stack wholesale and returns to the sub-agent
// for re-iteration. This test is the explicit gate.

import { describe, it, expect } from 'vitest';
import { combinedStackClassifier } from '../../../../src/core/techniques/combined-stack';

describe('combined-stack — CANONICAL ACCEPTANCE GATE', () => {
  it('synthetic canonical post fires with present=true and severity ≥ 6', () => {
    const canonicalPost =
      'NO FUCKING WAY!!!! SYNTHETIC TARGET IS AN ABSOLUTE COMMUNIST PSYCHOTIC IDIOT; THIS IS BULLSHIT WE ARE WATCHING';
    const result = combinedStackClassifier.classify({ text: canonicalPost });
    expect(result.technique).toBe('combined-stack');
    expect(result.present).toBe(true);
    expect(result.severity).toBeGreaterThanOrEqual(6);
  });
});
