import { describe, it, expect } from 'vitest';
import { shameAttackClassifier } from '../../../../src/core/techniques/shame-attack';

const classify = (text: string) => shameAttackClassifier.classify({ text });

describe('shame-attack classifier', () => {
  it('detects identity-based shaming', () => {
    const result = classify("You're disgusting if you don't agree");
    expect(result.present).toBe(true);
    expect(result.technique).toBe('shame-attack');
  });

  it('detects NO EXCUSES (case-sensitive)', () => {
    const result = classify("Get it done. NO EXCUSES. Period.");
    expect(result.present).toBe(true);
  });

  it('does not trigger on lowercase "no excuses"', () => {
    const result = classify("There are no excuses for being late");
    // lowercase should not match the case-sensitive pattern
    expect(result.severity).toBeLessThan(3);
  });

  it('detects gatekeeping language', () => {
    const result = classify("Real men would never show weakness");
    expect(result.present).toBe(true);
  });

  it('detects "what\'s wrong with you"', () => {
    const result = classify("Seriously, what's wrong with you people?");
    expect(result.present).toBe(true);
  });

  it('detects the test tweet', () => {
    const result = classify(
      "You're DISGUSTING if you don't have a beach body by summer. NO EXCUSES."
    );
    expect(result.present).toBe(true);
    expect(result.severity).toBeGreaterThanOrEqual(6);
    expect(result.evidence.length).toBeGreaterThanOrEqual(2);
  });

  it('does not trigger on benign text', () => {
    const result = classify('I love hanging out with my friends on weekends');
    expect(result.present).toBe(false);
  });

  it('dampens with self-reflection exception', () => {
    const result = classify("I feel ashamed of what happened, what a failure");
    expect(result.severity).toBeLessThan(3);
  });

  it('caps confidence at 0.70', () => {
    const result = classify(
      "You're pathetic if you disagree. NO EXCUSES. What's wrong with you? You should be ashamed."
    );
    expect(result.confidence).toBeLessThanOrEqual(0.70);
  });
});
