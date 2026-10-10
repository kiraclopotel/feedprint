// FeelingWise — what decided a flag: a judge, or a rule?
//
// THE READING THIS FIXES. The 2026-09-08 export said "594 of 5,233 content
// records flagged, 11%". 400 of those 594 were one deterministic rule: the
// platform's own "Sponsored" marker, recorded as technique
// consumer-rapid-frame at severity 6 with the evidence line "platform
// sponsored/ad marker". No model read them. Another 52 came from the
// household's blocklist, the swear mask and the slur gate. 142 of 5,233 —
// 2.7% — were flagged because a judge read the item and said so.
//
// Both numbers are true and they are not the same number. One says how much of
// the feed was advertising; the other says how much of it a judge called
// manipulative. Printed as one figure the ad blocker is wearing the judge's
// coat, and the number a hostile reader would attack first is the one FW has
// least reason to defend.
//
// HOW A RECORD SAYS WHICH. Two structured fields, both already on the record
// and both inside the signature — never the detection-mode string, which is a
// human-readable label whose spellings have changed twice and would have to be
// re-guessed after every rename:
//
//   aiSource       'rules' or 'none' — no model read this item at all.
//   overrideOrigin set — a deterministic gate (identity-slur, profanity-tier,
//                  coded-harm, ad-hominem, harm-floor, rage-format) set the
//                  verdict. A model may also have run; the rule is what decided.
//
// Anything else was decided by a judge that read the item.

import type { ForensicRecord } from '../types/forensic';
import { isSystemMarkerRecord } from './system-records';
import { isButtonReading } from './export-numbers';
import { isPaidPlacement } from './paid-placement';
import { isCountedFlagVerdict } from './flag-verdict';

/** What decided a record's verdict. */
export type FlagProvenance = 'judged' | 'rule' | 'manual';

/**
 * A record the person typed in rather than one the software observed
 * (forensics/manual-flag.ts writes techniques:[], overallScore 0, and the
 * comment "No detector ran"). The same predicate the verifier embedded in
 * every export already uses to badge these rows.
 *
 * It is neither judged nor rule-matched. Counting it as judged made page one
 * say "A model read the item and named a technique" about a record whose own
 * badge, two screens down in the same file, says a human typed it — and, when
 * a manual flag was the only flag, made the rule row add "Every flag in this
 * file was made by a judge that read the item."
 */
function isManualRecord(r: ForensicRecord): boolean {
  return r.feedSource === 'manual'
    || (typeof r.detectionMode === 'string' && r.detectionMode.startsWith('manual'))
    || (typeof r.id === 'string' && r.id.startsWith('fr-manual-'));
}

/**
 * The detection mode with the delivery prefix removed. A record replayed after
 * a chain rotation carries 'late-after-rotation:<mode>' (logger.ts), so
 * splitting on the first colon grouped every replayed record under one
 * meaningless family instead of its own.
 */
export function baseDetectionMode(mode: string | undefined): string {
  const m = typeof mode === 'string' ? mode : '';
  return m.startsWith('late-after-rotation:') ? m.slice('late-after-rotation:'.length) : m;
}

/**
 * Which flagged records are in the share at all: the same counting rule the
 * page-one flagged share and the Statistics balance bar use. Environment
 * records and system markers are neither flagged nor clean; a cancelled record
 * was never decided.
 *
 * An image analysis record (kind 'image') is left out too: it is a second
 * record about a post that is already in the share as its own impression, so
 * counting it doubled that post on the flagged side while the numbers table
 * (export-numbers.ts isImpression) never counted it as seen (wiring audit
 * 13 Sep, C32). The two predicates answer different questions on purpose:
 * isImpression asks "could the person have seen it", which a cancelled scan
 * satisfies; this asks "was it decided either way", which it does not (C33).
 */
export function isDecidedContentRecord(r: ForensicRecord): boolean {
  if (r.kind === 'environment' || r.kind === 'image' || isSystemMarkerRecord(r)) return false;
  // A reading the person asked for is left out on the image record's ground: a second
  // record about a post, written because a button was pressed and not because the feed
  // served something or the product decided something (export-numbers.ts isButtonReading).
  if (isButtonReading(r)) return false;
  const v = r.verdict;
  // A record with no verdict predates the field, and was only ever written
  // when flagged. A masked record was read and nothing was charged: decided,
  // on the clean side.
  // "Seen a lot" was not read, so it is on neither side (the dashboard's checked set leaves it out too).
  return v === 'pass' || v === 'masked' || v === 'blocked' || isCountedFlagVerdict(r);
}

/** Is this record on the flagged side of that share?
 *
 * A paid placement never is, whatever verdict it carries (standing decision 1,
 * 2026-09-14). The 400 ads in the reading at the top of this file were the
 * whole reason the rule row existed; they are now counted on their own line as
 * paid placement, so the flagged share is what a judge or a household rule did
 * to content, and advertising is reported as advertising. The record is
 * unchanged: this predicate only decides where it is counted. */
export function isFlaggedRecord(r: ForensicRecord): boolean {
  if (isPaidPlacement(r)) return false;
  return isCountedFlagVerdict(r);
}

/**
 * What decided this record — a judge that read it, or a rule that matched it.
 *
 * Reads the two structured fields, never the detection-mode text. A record
 * written before `overrideOrigin` existed cannot say a gate fired, and reads as
 * judged when a model ran; that is the honest answer for a record that does not
 * carry the evidence, and the export says the field is absent rather than
 * pretending the split is exact for old rows.
 */
export function flagProvenance(r: ForensicRecord): FlagProvenance {
  if (isManualRecord(r)) return 'manual';
  if (r.aiSource === 'rules' || r.aiSource === 'none') return 'rule';
  if (r.overrideOrigin) return 'rule';
  return 'judged';
}

export interface FlagSplit {
  /** Records on the flagged side, however decided. */
  flagged: number;
  /** Of those, the ones a judge read and called manipulative. */
  judged: number;
  /** Of those, the ones a deterministic rule matched. */
  rule: number;
  /** Of those, the ones a person added by hand. No detector ran on these. */
  manual: number;
  /**
   * Advertising, counted apart from every other number here: records the
   * platform's own ad marker identified, which the user's Block Ads rule hides
   * and no judge read. They are inside `decided` (the file decided what to do
   * with them) and inside no other field, so flagged + paidPlacement is the
   * whole acted mass and `flagged` alone is the part about content.
   */
  paidPlacement: number;
  /** Everything decided either way — the denominator of both shares. */
  decided: number;
  /**
   * Rule-derived flags grouped by what the rule was, largest first.
   *
   * The label is the deterministic gate that DECIDED — `overrideOrigin` when a
   * gate set the verdict, otherwise the detection-mode family. Reading the mode
   * alone labelled an override-decided flag with the LLM batch's own name, so a
   * slur the identity gate caught was filed under 'comment-batch' beside the
   * model's verdicts it had just overruled. A display grouping only; never the
   * basis of the split above.
   */
  ruleKinds: Array<{ kind: string; records: number }>;
}

/**
 * Split a file's flagged records by what decided them.
 *
 * Returns null when nothing in the file was decided either way — an export of
 * pure markers, or an empty one — so a caller prints "no content records"
 * rather than "0%".
 */
export function computeFlagSplit(records: readonly ForensicRecord[]): FlagSplit | null {
  let flagged = 0;
  let judged = 0;
  let rule = 0;
  let manual = 0;
  let paidPlacement = 0;
  let decided = 0;
  const kinds = new Map<string, number>();
  for (const r of records) {
    if (!isDecidedContentRecord(r)) continue;
    decided++;
    if (isPaidPlacement(r)) { paidPlacement++; continue; }
    if (!isFlaggedRecord(r)) continue;
    flagged++;
    const provenance = flagProvenance(r);
    if (provenance === 'judged') {
      judged++;
      continue;
    }
    if (provenance === 'manual') {
      manual++;
      continue;
    }
    rule++;
    // The gate that decided, not the pipeline the record travelled through.
    const kind = r.overrideOrigin || baseDetectionMode(r.detectionMode).split(':')[0] || 'unnamed';
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  }
  if (decided === 0) return null;
  return {
    flagged,
    judged,
    rule,
    manual,
    paidPlacement,
    decided,
    ruleKinds: [...kinds.entries()]
      .map(([kind, records]) => ({ kind, records }))
      .sort((a, b) => (b.records !== a.records ? b.records - a.records : a.kind < b.kind ? -1 : 1)),
  };
}
