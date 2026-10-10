import { describe, it, expect } from 'vitest';
import { bandwagonClassifier } from '../../../../src/core/techniques/bandwagon';

const classify = (text: string) => bandwagonClassifier.classify({ text });

describe('bandwagon classifier', () => {
  it('detects false consensus', () => {
    const result = classify('Everyone knows this is the right thing to do');
    expect(result.present).toBe(true);
    expect(result.technique).toBe('bandwagon');
  });

  it('detects elitist consensus', () => {
    const result = classify('All smart people agree with this position');
    expect(result.present).toBe(true);
  });

  it('detects isolation pressure', () => {
    const result = classify("If you still disagree, you're the only one");
    expect(result.present).toBe(true);
  });

  it('does not trigger on benign text', () => {
    const result = classify('I went grocery shopping this morning');
    expect(result.present).toBe(false);
  });

  it('dampens with survey/data exception', () => {
    const result = classify('Survey shows everyone agrees with the policy');
    expect(result.severity).toBeLessThan(
      classify('Everyone agrees with this position').severity
    );
  });

  it('caps confidence at 0.70', () => {
    const result = classify(
      'Everyone knows this. Nobody disagrees. All reasonable people see it. Everyone else cares.'
    );
    expect(result.confidence).toBeLessThanOrEqual(0.70);
  });
});
