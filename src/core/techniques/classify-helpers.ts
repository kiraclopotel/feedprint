// The scorer shared by the plain regex classifiers.

import { TechniqueName } from '../../types/analysis';
import { ClassifierOutput } from './types';

export interface PatternSet {
  strong: RegExp[];
  moderate: RegExp[];
  exceptions: RegExp[];
}

export function runPatternClassifier(
  text: string,
  technique: TechniqueName,
  patterns: PatternSet,
): ClassifierOutput {
  let score = 0;
  let strongHits = 0;
  const evidence: string[] = [];

  for (const pat of patterns.strong) {
    const match = text.match(pat);
    if (match) {
      score += 3;
      strongHits++;
      evidence.push(match[0]);
    }
  }

  for (const pat of patterns.moderate) {
    const match = text.match(pat);
    if (match) {
      score += 1;
      evidence.push(match[0]);
    }
  }

  for (const pat of patterns.exceptions) {
    if (pat.test(text)) {
      score = Math.floor(score * 0.4);
    }
  }

  const severity = Math.min(score, 10);
  const confidence = strongHits >= 2 ? 0.7 : strongHits === 1 ? 0.55 : 0.4;

  return {
    technique,
    present: severity >= 3,
    confidence,
    severity,
    evidence,
  };
}
