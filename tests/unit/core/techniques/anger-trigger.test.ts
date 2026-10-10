import { describe, it, expect } from 'vitest';
import { angerTriggerClassifier } from '../../../../src/core/techniques/anger-trigger';

const classify = (text: string) => angerTriggerClassifier.classify({ text });

describe('anger-trigger classifier', () => {
  it('detects dehumanizing language', () => {
    const result = classify('These parasites are ruining everything');
    expect(result.present).toBe(true);
    expect(result.technique).toBe('anger-trigger');
  });

  it('detects blame-shifting conspiracy language', () => {
    const result = classify("They're destroying our way of life");
    expect(result.present).toBe(true);
  });

  it('detects case-sensitive DYING/KILLING etc', () => {
    const result = classify('People are DYING and nobody cares');
    expect(result.present).toBe(true);
  });

  it('does not trigger on lowercase dying', () => {
    const result = classify('The plants are dying from lack of water');
    expect(result.present).toBe(false);
  });

  it('detects wake up sheeple', () => {
    const result = classify('Wake up sheeple, they want you to suffer');
    expect(result.present).toBe(true);
  });

  it('does not trigger on benign text', () => {
    const result = classify('Had a great day at the park with the kids');
    expect(result.present).toBe(false);
  });

  it('dampens with personal emotion exception', () => {
    const result = classify("I'm angry about the outrage over this");
    // Exception dampens the score
    expect(result.severity).toBeLessThan(3);
  });

  it('caps confidence at 0.70', () => {
    const result = classify(
      'These traitors and scum are destroying everything! Wake up sheeple! They hate you! KILLING our future!'
    );
    expect(result.confidence).toBeLessThanOrEqual(0.70);
  });
});
