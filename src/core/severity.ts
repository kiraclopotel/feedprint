// There is no per-age boost: the one that existed never ran, since no caller passed an age. One
// comes back only with a measurement behind it.

import { TechniqueResult } from '../types/analysis';

export function aggregateSeverity(techniques: TechniqueResult[]): number {
  const present = techniques.filter(t => t.present);
  if (present.length === 0) return 0;

  const sorted = [...present].sort((a, b) => b.severity - a.severity);

  let base: number;
  if (sorted.length === 1) {
    base = sorted[0].severity;
  } else if (sorted.length === 2) {
    base = sorted[0].severity + sorted[1].severity * 0.3;
  } else {
    base = sorted[0].severity
      + sorted.slice(1).reduce((sum, t) => sum + t.severity * 0.2, 0);
  }
  return Math.min(base, 10);
}
