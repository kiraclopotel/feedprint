// Activity record dot color — the circle on each timeline row's gutter node.
//
// Owner rule (2026-08-01): the dot carries the color of the record's
// TECHNIQUE, matching the technique palette the Technique frequency chart
// uses (TECHNIQUE_COLORS, mirrored as the --fw-tech-* tokens), so a card's
// dot and its technique chip/chart bar agree. Red is no longer the default —
// red now only appears for genuinely red techniques (e.g. graphic violence).
//
// Resolution order:
//   1. >1 distinct technique  → the "multiple techniques" mix color
//      (TECHNIQUE_COLORS['combined'] === --fw-tech-combined #5c6bc0).
//   2. exactly 1 technique    → that technique's palette color.
//   3. no technique:
//      a. verdict 'pass'      → green (the pass semantic, unchanged).
//      b. harm-floor record   → the safety category's technique color when the
//         floor's topCategory names one (sexual / violence-graphic / …),
//         else the profanity chip grey — the same semantics its chip carries.
//      c. verdict 'blocked'   → the blocked/AI-content purple used by its chip.
//      d. anything else       → muted (no claim).
//
// NOT this module: the marker severity ramp (--fw-marker-*) — that ramp is
// locked to the content-script markers and the Overview/Statistics severity
// bars; the Activity dot no longer reads it.

import type { ForensicRecord } from '../../../types/forensic';
import { canonicalizeTechniqueForStats } from '../../../forensics/store';
import { TECHNIQUE_COLORS } from './color-maps';

/** The dedicated multi-technique mix color (--fw-tech-combined). */
export const TECHNIQUE_MIX_COLOR = TECHNIQUE_COLORS['combined'];

const BLOCKED_DOT_COLOR = '#ab47bc';        // the blocked-category chip purple
const PROFANITY_DOT_COLOR = TECHNIQUE_COLORS['profanity'];
const MUTED_DOT_COLOR = 'var(--fw-muted)';
const PASS_DOT_COLOR = 'var(--fw-green)';

/** CSS color for a record's timeline dot. Always returns a usable value. */
export function recordDotColor(record: ForensicRecord): string {
  // Distinct canonical technique names — re-serves can duplicate a technique
  // entry; a duplicate is still ONE technique, not a mix.
  const names = new Set<string>();
  for (const t of record.techniques ?? []) {
    if (t?.name) names.add(canonicalizeTechniqueForStats(t.name));
  }
  if (names.size > 1) return TECHNIQUE_MIX_COLOR;
  if (names.size === 1) {
    const [name] = names;
    return TECHNIQUE_COLORS[name] ?? MUTED_DOT_COLOR;
  }
  // No technique on the record — fall to the verdict/floor semantic.
  if (record.verdict === 'pass') return PASS_DOT_COLOR;
  if (record.harmFloor) {
    const cat = record.harmFloor.topCategory;
    if (cat && TECHNIQUE_COLORS[canonicalizeTechniqueForStats(cat)]) {
      return TECHNIQUE_COLORS[canonicalizeTechniqueForStats(cat)];
    }
    return PROFANITY_DOT_COLOR;
  }
  if (record.verdict === 'blocked') return BLOCKED_DOT_COLOR;
  return MUTED_DOT_COLOR;
}
