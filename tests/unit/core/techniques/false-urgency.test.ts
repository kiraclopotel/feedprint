import { describe, it, expect } from 'vitest';
import { falseUrgencyClassifier } from '../../../../src/core/techniques/false-urgency';

const classify = (text: string) => falseUrgencyClassifier.classify({ text });

describe('false-urgency classifier', () => {
  it('detects LAST CHANCE (case-sensitive)', () => {
    const result = classify('LAST CHANCE to get this deal!');
    expect(result.present).toBe(true);
    expect(result.technique).toBe('false-urgency');
  });

  it('detects scarcity language', () => {
    const result = classify('Only 3 spots left, sign up now');
    expect(result.present).toBe(true);
  });

  it('detects clock-is-ticking urgency', () => {
    const result = classify("Don't wait, the clock is ticking before it's too late");
    expect(result.present).toBe(true);
  });

  it('detects multiple strong urgency signals', () => {
    const result = classify("ACT NOW! Only 3 spots left! Don't wait!");
    expect(result.present).toBe(true);
    expect(result.severity).toBeGreaterThanOrEqual(6);
  });

  it('implicit deadline alone does not trigger', () => {
    const result = classify('need to have a beach body by summer');
    // Only matches MODERATE implicit deadline (+1), below threshold of 3
    expect(result.present).toBe(false);
    expect(result.severity).toBeLessThan(3);
  });

  it('does not trigger on benign scheduling', () => {
    const result = classify('The submission deadline is next Friday');
    expect(result.present).toBe(false);
  });

  it('does not trigger on benign text', () => {
    const result = classify('I enjoy reading books in the afternoon');
    expect(result.present).toBe(false);
  });

  it('caps confidence at 0.70', () => {
    const result = classify(
      "HURRY! ACT NOW! Only 5 left! Don't hesitate! Expires today! In the next 2 hours! Clock is ticking! Before it's too late!"
    );
    expect(result.confidence).toBeLessThanOrEqual(0.70);
  });
});
