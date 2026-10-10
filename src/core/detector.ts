// Every pattern classifier, then combined on top. This gates nothing: paid tiers call the AI
// whether or not a classifier fired, and on the free tier a detection only holds back the harm
// floor's synthetic marker (src/analysis/pipeline.ts). Each scorer caps its own confidence, 0.70
// for the plain regex classifiers and 0.92 for the weighted ones, since a pattern cannot read
// context.

import { TechniqueResult } from '../types/analysis';
import { ClassifierInput } from './techniques/types';
import { classifiers, classifyCombined } from './techniques';

export function detect(
  text: string,
  author?: string,
  platform?: string,
): TechniqueResult[] {
  const input: ClassifierInput = { text, author, platform };

  const results = classifiers.map(c => c.classify(input));

  const combined = classifyCombined(results);

  return [...results, combined];
}
