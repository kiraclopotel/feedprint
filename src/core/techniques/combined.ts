// Three techniques must fire, each with its own evidence and severity 5 or more. Counting weak
// co-occurrence would make "combined" a catch-all.

import { ClassifierOutput } from './types';

export function classifyCombined(results: ClassifierOutput[]): ClassifierOutput {
  const qualifying = results.filter(
    r =>
      r.present &&
      r.technique !== 'combined' &&
      r.severity >= 5 &&
      r.evidence.length > 0,
  );
  const count = qualifying.length;

  return {
    technique: 'combined',
    present: count >= 3,
    severity: Math.min(count, 10),
    confidence: Math.min(0.4 + count * 0.06, 0.70),
    evidence: qualifying.map(r => r.technique),
  };
}
