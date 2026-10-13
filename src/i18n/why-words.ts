// The why, as words, for one policy row and the family the reader answered when there is one.
//
// R5, a topic the person chose, names the topic itself when the caller knows which (whyByTopic).
//
// Four rows of the policy table (src/core/policy/table.ts) fire on a severity band alone,
// for any family: J1, J2, J7 and J8. Their words in whyByRow therefore name no family. When
// the record carries the measured reader's answer (decision.reading.family), or the caller
// on the page has it, the family's own words are the true why and are used instead. Every
// other row already names its condition and is returned as it stands.
//
// One function so the notice on the page, the card in the panel and the card in the export
// cannot drift apart again; the export's inline script restates the same rule in ES5
// (src/forensics/html-export-scripts.ts, the fw-decision line) and
// tests/unit/forensics/why-follows-the-reading.test.tsx reads all three side by side.

import type { ResolvedUiLanguage } from './index';
import { MARKER_STRINGS } from './marker-strings';
import type { PolicyRowId } from '../types/policy-row';

/** The rows whose condition is a severity band and nothing else. */
const BAND_ONLY_ROWS: readonly string[] = ['J1', 'J2', 'J7', 'J8'];

export function whyWords(lang: ResolvedUiLanguage, row: string, family?: string | null, topic?: string | null): string | undefined {
  const ms = MARKER_STRINGS[lang];
  // A chosen topic names itself ("Mentions gambling"); a topic this build has no words for keeps the row's generic line.
  if (row === 'R5' && topic) {
    const byTopic = (ms.whyByTopic as Readonly<Record<string, string>>)[topic];
    if (byTopic) return byTopic;
  }
  if (family && BAND_ONLY_ROWS.includes(row)) {
    const byFamily = (ms.whyByFamily as Readonly<Record<string, string>>)[family];
    if (byFamily) return byFamily;
  }
  return ms.whyByRow[row as PolicyRowId];
}
