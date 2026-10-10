import { describe, it, expect } from 'vitest';
import { classifyCombined } from '../../../../src/core/techniques';
import { ClassifierOutput } from '../../../../src/core/techniques/types';

function makeOutput(
  technique: ClassifierOutput['technique'],
  present: boolean,
  severity?: number,
  evidence?: string[],
): ClassifierOutput {
  const resolvedSeverity = severity ?? (present ? 5 : 0);
  const resolvedEvidence = evidence ?? (present ? [`${technique}-evidence`] : []);
  return {
    technique,
    present,
    confidence: 0.5,
    severity: resolvedSeverity,
    evidence: resolvedEvidence,
  };
}

describe('combined meta-classifier', () => {
  it('does not trigger with 0 present techniques', () => {
    const results = [
      makeOutput('fear-appeal', false),
      makeOutput('shame-attack', false),
    ];
    const result = classifyCombined(results);
    expect(result.present).toBe(false);
    expect(result.technique).toBe('combined');
  });

  it('does not trigger with 2 present techniques', () => {
    const results = [
      makeOutput('fear-appeal', true),
      makeOutput('shame-attack', true),
      makeOutput('anger-trigger', false),
    ];
    const result = classifyCombined(results);
    expect(result.present).toBe(false);
  });

  it('triggers with 3 present techniques', () => {
    const results = [
      makeOutput('fear-appeal', true),
      makeOutput('shame-attack', true),
      makeOutput('anger-trigger', true),
    ];
    const result = classifyCombined(results);
    expect(result.present).toBe(true);
    expect(result.severity).toBe(3);
    expect(result.evidence).toHaveLength(3);
  });

  it('severity equals count of present techniques (capped at 10)', () => {
    const results = [
      makeOutput('fear-appeal', true),
      makeOutput('shame-attack', true),
      makeOutput('anger-trigger', true),
      makeOutput('fomo', true),
      makeOutput('bandwagon', true),
    ];
    const result = classifyCombined(results);
    expect(result.severity).toBe(5);
  });

  it('evidence contains technique names', () => {
    const results = [
      makeOutput('fear-appeal', true),
      makeOutput('shame-attack', true),
      makeOutput('anger-trigger', true),
    ];
    const result = classifyCombined(results);
    expect(result.evidence).toContain('fear-appeal');
    expect(result.evidence).toContain('shame-attack');
    expect(result.evidence).toContain('anger-trigger');
  });

  it('caps confidence at 0.70', () => {
    const results = Array.from({ length: 9 }, (_, i) =>
      makeOutput('fear-appeal', true),
    );
    const result = classifyCombined(results);
    expect(result.confidence).toBeLessThanOrEqual(0.70);
  });

  // DEC-008 (LOOP-005a): Combined fires only with ≥3 techniques, each severity ≥5, each with independent evidence.
  describe('DEC-008 strict rule', () => {
    it('does not trigger with 2 techniques even if severity is high', () => {
      const results = [
        makeOutput('fear-appeal', true, 9),
        makeOutput('shame-attack', true, 8),
      ];
      const result = classifyCombined(results);
      expect(result.present).toBe(false);
    });

    it('does not trigger when 3 techniques all have severity <5', () => {
      const results = [
        makeOutput('fear-appeal', true, 4),
        makeOutput('shame-attack', true, 3),
        makeOutput('anger-trigger', true, 2),
      ];
      const result = classifyCombined(results);
      expect(result.present).toBe(false);
    });

    it('fires only when ≥3 techniques each have severity ≥5 with independent evidence', () => {
      const results = [
        makeOutput('fear-appeal', true, 5, ['fear-cue']),
        makeOutput('shame-attack', true, 6, ['shame-cue']),
        makeOutput('anger-trigger', true, 7, ['anger-cue']),
      ];
      const result = classifyCombined(results);
      expect(result.present).toBe(true);
      expect(result.evidence).toHaveLength(3);
    });

    it('ignores under-severity techniques when counting toward the ≥3 threshold', () => {
      const results = [
        makeOutput('fear-appeal', true, 7, ['fear-cue']),
        makeOutput('shame-attack', true, 6, ['shame-cue']),
        makeOutput('anger-trigger', true, 3, ['weak-cue']), // below severity gate
        makeOutput('fomo', true, 2, ['weak-fomo']), // below severity gate
      ];
      const result = classifyCombined(results);
      expect(result.present).toBe(false); // only 2 qualifying techniques
    });

    it('requires independent evidence on each qualifying technique', () => {
      const results = [
        makeOutput('fear-appeal', true, 7, ['fear-cue']),
        makeOutput('shame-attack', true, 6, []), // no evidence → disqualified
        makeOutput('anger-trigger', true, 8, ['anger-cue']),
      ];
      const result = classifyCombined(results);
      expect(result.present).toBe(false);
    });
  });
});
