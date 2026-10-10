// The policy row behind a hide made by the paths that still choose actions today (the blocklist,
// the slur list, the coded-harm catcher, the sponsored label, the harm-floor categories, the batch
// judge's severity), so the notice and the record can say why in the table's own words
// (docs/design/HIDE-NOTICE-2026-09-07.md, section 3). It reads only what the record carries: the
// detectionMode and the technique names. Once decide() in table.ts is wired, it supplies the row
// and this module goes.
//
// A row is returned only when the signal maps to one cleanly; otherwise null, and the caller says
// nothing rather than something invented. Only a household's own blocklist word is shown back; a
// slur never is.

import type { PolicyRowId } from '../../types/policy-row';

export interface Why {
  row: PolicyRowId;
  /** The household's own rule that matched (R1 only). */
  match?: string;
  /**
   * The family the judge answered, when the caller has it; whyFor never sets it. The words in
   * src/i18n/why-words.ts need it on a band row, which names no family by itself.
   */
  family?: string;
}

const BY_TECHNIQUE: ReadonlyArray<readonly [string, PolicyRowId]> = [
  // J6, not R4. R4 is a rail: the record would say the platform's ad marker fired when it did not,
  // and the export would count an ordinary post as a paid placement (isPaidPlacement in
  // src/forensics/export-numbers.ts). An accuracy measurement found this confusion before: 11
  // false sponsored-ad alarms on shopping posts such as a phone case with a discount code
  // (docs/measurements/2026-08-02-accuracy.md, section 3d). A real ad gets R4 from its own
  // detectionMode before this list is read.
  ['consumer-rapid-frame', 'J6'],
  ['violence-graphic', 'P5'],
  ['sexual', 'P3'],
  ['self-harm', 'P2'],
  ['drug-promotion', 'P4'],
  ['scapegoating', 'J4'],
];

function bySeverity(severity: number | undefined): PolicyRowId | null {
  if (severity === undefined || Number.isNaN(severity)) return null;
  if (severity >= 9) return 'J1';
  if (severity >= 7) return 'J2';
  if (severity >= 4) return 'J7';
  return null;
}

/**
 * `techniques` in the order the hiding path gave them; `severity` is the record's top severity.
 */
export function whyFor(
  detectionMode: string | undefined,
  techniques: readonly string[],
  severity?: number,
): Why | null {
  const dm = detectionMode ?? '';
  if (dm.startsWith('blocklist:')) {
    // `blocklist:<word|phrase|account>:<rule>`; the rule may itself contain ':'.
    const rest = dm.slice('blocklist:'.length);
    const sep = rest.indexOf(':');
    const rule = sep === -1 ? '' : rest.slice(sep + 1);
    return rule ? { row: 'R1', match: rule } : { row: 'R1' };
  }
  if (dm.startsWith('slur:') || dm === 'pre-rewrite-hide:identity-slur') return { row: 'R2' };
  if (dm.startsWith('coded-harm:')) return { row: 'R3' };
  if (dm.startsWith('sponsored-ad')) return { row: 'R4' };
  if (dm.startsWith('dehumanization:')) return { row: 'J4' };
  if (dm === 'violence-narrating-video') return { row: 'P5' };
  for (const [name, row] of BY_TECHNIQUE) {
    if (techniques.includes(name)) return { row };
  }
  if (techniques.includes('extreme-toxicity') || techniques.includes('combined-stack') || dm === 'harm-laundering') {
    const row = bySeverity(severity) ?? 'J2';
    return { row };
  }
  // A profanity-only hide has no row: the table says swearing is never a hide.
  if (dm === 'pre-rewrite-hide:profanity-tier' || dm.startsWith('profanity')) return null;
  const row = bySeverity(severity);
  return row ? { row } : null;
}
