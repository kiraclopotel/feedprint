import { describe, it, expect } from 'vitest';
import { aggregateSeverity } from '../../../src/core/severity';
import { TechniqueResult } from '../../../src/types/analysis';

function makeTechnique(
  technique: TechniqueResult['technique'],
  severity: number,
  present = true,
): TechniqueResult {
  return { technique, present, confidence: 0.5, severity, evidence: [] };
}

describe('severity scoring', () => {
  it('returns 0 when no techniques present', () => {
    const result = aggregateSeverity([
      makeTechnique('fear-appeal', 5, false),
      makeTechnique('shame-attack', 3, false),
    ]);
    expect(result).toBe(0);
  });

  it('returns technique severity for single technique', () => {
    const result = aggregateSeverity([makeTechnique('shame-attack', 6)]);
    expect(result).toBe(6);
  });

  it('aggregates two techniques: highest + second * 0.3', () => {
    const result = aggregateSeverity([
      makeTechnique('shame-attack', 6),
      makeTechnique('misleading-format', 4),
    ]);
    // 6 + 4*0.3 = 7.2
    expect(result).toBeCloseTo(7.2, 1);
  });

  it('aggregates three+ techniques: highest + remaining * 0.2', () => {
    const result = aggregateSeverity([
      makeTechnique('shame-attack', 6),
      makeTechnique('fear-appeal', 4),
      makeTechnique('anger-trigger', 3),
    ]);
    // 6 + (4*0.2 + 3*0.2) = 6 + 1.4 = 7.4
    expect(result).toBeCloseTo(7.4, 1);
  });

  it('caps base at 10', () => {
    const result = aggregateSeverity([
      makeTechnique('shame-attack', 10),
      makeTechnique('fear-appeal', 10),
      makeTechnique('anger-trigger', 10),
      makeTechnique('fomo', 10),
      makeTechnique('bandwagon', 10),
    ]);
    expect(result).toBeLessThanOrEqual(10);
  });

  it('ignores not-present techniques', () => {
    const result = aggregateSeverity([
      makeTechnique('shame-attack', 6, true),
      makeTechnique('fear-appeal', 8, false), // not present
    ]);
    expect(result).toBe(6); // only shame-attack counts
  });
});
