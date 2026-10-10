import { describe, it, expect } from 'vitest';
import { fearAppealClassifier } from '../../../../src/core/techniques/fear-appeal';
import { FEAR_APPEAL_CASES } from '../../../fixtures/techniques/fear-appeal-cases';

const classify = (text: string) => fearAppealClassifier.classify({ text });

describe('fear-appeal classifier — core behavior', () => {
  it('detects catastrophizing language', () => {
    const result = classify('This is a doomsday scenario for your family');
    expect(result.present).toBe(true);
    expect(result.technique).toBe('fear-appeal');
    expect(result.severity).toBeGreaterThanOrEqual(3);
  });

  it('detects hidden threat patterns', () => {
    const result = classify("They don't want you to know the real truth");
    expect(result.present).toBe(true);
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  it('detects consequence threats', () => {
    const result = classify("If you don't act now, your children will suffer");
    expect(result.present).toBe(true);
  });

  it('detects countdown urgency with fear', () => {
    const result = classify('We only have 5 years before total collapse');
    expect(result.present).toBe(true);
  });

  it('does not trigger on benign text', () => {
    const result = classify('The weather is nice today and I feel great');
    expect(result.present).toBe(false);
    expect(result.severity).toBe(0);
  });

  it('dampens score for news-attribution register', () => {
    const plain = classify('This is a doomsday crisis for everyone and your family');
    const withAttribution = classify('According to officials, this crisis is alarming, data shows');
    expect(withAttribution.severity).toBeLessThan(plain.severity);
  });

  it('dampens score for personal emotion expression (first-person vulnerability)', () => {
    const result = classify("I'm scared about the danger ahead");
    expect(result.present).toBe(false);
    expect(result.severity).toBeLessThan(3);
  });

  it('confidence scales beyond old 0.70 ceiling for strong-evidence cases', () => {
    // New scorer allows up to 0.92. Strong case should exceed the old cap.
    const result = classify(
      "Doomsday apocalypse! They are hiding deadly threats from your family. If you don't act it'll be too late. We have 3 days left. Doctors won't tell you!"
    );
    expect(result.confidence).toBeGreaterThan(0.70);
    expect(result.confidence).toBeLessThanOrEqual(0.92);
  });

  it('always returns technique name fear-appeal', () => {
    const result = classify('Just a normal sentence');
    expect(result.technique).toBe('fear-appeal');
  });
});

describe('fear-appeal classifier — adversarial robustness', () => {
  it('handles smart quotes (normalizes to ASCII)', () => {
    const result = classify('They don\u2019t want you to know about this deadly threat to your family');
    expect(result.present).toBe(true);
  });

  it('handles zero-width spaces injected into keywords', () => {
    const result = classify('They don\u200Bt want you\u200B to know about catastroph\u200Be coming');
    expect(result.present).toBe(true);
  });

  it('does not flag benign text padded with caps + exclamations', () => {
    const result = classify('The concert was AMAZING!!! Best night EVER!');
    expect(result.present).toBe(false);
  });
});

describe('fear-appeal classifier — fixture coverage', () => {
  for (const c of FEAR_APPEAL_CASES) {
    if (c.category === 'borderline') continue; // borderline is documented, not asserted
    it(`[${c.category}] ${c.id}: "${c.text.slice(0, 60)}..."`, () => {
      const result = classify(c.text);
      expect(result.present, `expected present=${c.expectPresent}`).toBe(c.expectPresent);
      if (c.expectMinSeverity !== undefined) {
        expect(result.severity, `severity ${result.severity} should be >= ${c.expectMinSeverity}`)
          .toBeGreaterThanOrEqual(c.expectMinSeverity);
      }
      if (c.expectMaxSeverity !== undefined) {
        expect(result.severity, `severity ${result.severity} should be <= ${c.expectMaxSeverity}`)
          .toBeLessThanOrEqual(c.expectMaxSeverity);
      }
    });
  }
});
