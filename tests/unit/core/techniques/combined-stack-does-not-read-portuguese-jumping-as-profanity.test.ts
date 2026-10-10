// 'pula' is Romanian profanity and also the Portuguese for "jumps". Near-miss evidence from this
// classifier adds five points to the harm floor, so the bare word must count for nothing here.

import { describe, it, expect } from 'vitest';
import { combinedStackClassifier } from '../../../../src/core/techniques/combined-stack';
import { detect } from '../../../../src/core/detector';
import { computeHarmFloor } from '../../../../src/core/harm-floor';

describe('combined-stack does not read Portuguese "pula" as profanity', () => {
  it('finds nothing in a boy jumping into a pool', () => {
    const text = 'O menino pula na piscina todo dia';
    expect(combinedStackClassifier.classify({ text }).evidence).toEqual([]);
    expect(computeHarmFloor(text, detect(text)).score).toBe(0);
  });

  it('still counts the Romanian phrase', () => {
    const text = 'bag pula in voi toti';
    expect(combinedStackClassifier.classify({ text }).evidence.length).toBeGreaterThan(0);
  });
});
