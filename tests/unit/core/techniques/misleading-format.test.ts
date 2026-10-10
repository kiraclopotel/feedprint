import { describe, it, expect } from 'vitest';
import { misleadingFormatClassifier } from '../../../../src/core/techniques/misleading-format';

const classify = (text: string) => misleadingFormatClassifier.classify({ text });

describe('misleading-format classifier', () => {
  it('detects high ALL-CAPS ratio', () => {
    const result = classify('THIS IS ALL CAPS TEXT FOR NO GOOD REASON AT ALL');
    expect(result.present).toBe(true);
    expect(result.technique).toBe('misleading-format');
  });

  it('excludes common acronyms from caps count', () => {
    const result = classify('The FBI and CIA investigated the NASA facility near the UN');
    expect(result.present).toBe(false);
  });

  it('detects the test tweet', () => {
    const result = classify(
      "You're DISGUSTING if you don't have a beach body by summer. NO EXCUSES."
    );
    expect(result.present).toBe(true);
    expect(result.severity).toBeGreaterThanOrEqual(3);
  });

  it('does not trigger on normal text', () => {
    const result = classify('Today I went to the store and bought some groceries');
    expect(result.present).toBe(false);
    expect(result.severity).toBe(0);
  });

  it('detects high exclamation density', () => {
    const result = classify(
      'Amazing! Incredible! Unbelievable! You must see this! Best ever! So good!'
    );
    expect(result.severity).toBeGreaterThan(0);
  });

  it('handles empty text', () => {
    const result = classify('');
    expect(result.present).toBe(false);
    expect(result.severity).toBe(0);
  });

  it('caps confidence at 0.70', () => {
    const result = classify(
      'THIS IS ALL CAPS! EVERYTHING IS CAPS! EVERY WORD! MORE CAPS! STILL MORE!'
    );
    expect(result.confidence).toBeLessThanOrEqual(0.70);
  });
});
