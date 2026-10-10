// Activity feed display-sort — the single sort site behind the "As seen" /
// "Worst first" control. Pure functions extracted from Dashboard.tsx so the
// ordering contract is unit-testable without mounting the React tree (same
// pattern as group-records.ts / feed-filters.ts).
//
// 'worst' ranks a GROUP by its peak member severity (a thread is as bad as its
// worst item); the flat filtered list ranks records directly. Both sorts are
// stable copies: equal-severity entries keep their as-seen relative order as
// the tie-break, and the input array is never mutated.

import type { ForensicRecord } from '../../../types/forensic';
import type { RecordGroup } from './PostGroupCard';
import { isPaidPlacement } from '../../../forensics/paid-placement';

/** Harm rank for the display sort.
 *
 *  overallScore, defensively coerced: a record missing the field (legacy /
 *  malformed) reads as 0 so the sort comparator stays consistent — a NaN
 *  comparator makes Array.prototype.sort order implementation-defined.
 *
 *  A `blocked` record ranks 0 regardless of the number it carries. The
 *  rule-based blockers stamp overallScore 10 on every record they write
 *  (logger.ts logBlockedEvent), where 10 records that the rule matched
 *  exactly, not that anything was harmful — most of those records are
 *  advertisements. Reading that as a severity put every ad at the maximum, so
 *  on the owner's 5,376-record chain twenty-five ads filled the head of
 *  "Worst first" and the first genuine finding sat at position 26. Same defect
 *  the HTML export carried until 2026-08-23; a block is a category, not a
 *  severity, and it must not rank as one. */
export function recordScore(r: ForensicRecord): number {
  if (r.verdict === 'blocked') return 0;
  // The same reading, one class wider: an ad ranks 0 whatever it carries. The
  // blocked test above already caught the adult ad blocks, but a child or teen
  // sponsored-ad record is written flagged-hidden at severity 6, so twenty-five
  // ads could still head "Worst first" from the other path (standing decision
  // 1, 2026-09-14).
  if (isPaidPlacement(r)) return 0;
  const s = r.overallScore;
  return typeof s === 'number' && Number.isFinite(s) ? s : 0;
}

/** Peak member severity of a group — the post record plus every child. */
export function groupPeakScore(g: RecordGroup): number {
  let max = -1;
  const members = g.postRecord ? [g.postRecord, ...g.children] : g.children;
  for (const m of members) {
    const s = recordScore(m);
    if (s > max) max = s;
  }
  return max;
}

/** Worst-first over post groups: highest peak severity first, as-seen order as
 *  the stable tie-break. Returns a new array; input untouched. */
export function sortGroupsWorstFirst(groups: readonly RecordGroup[]): RecordGroup[] {
  return [...groups].sort((a, b) => groupPeakScore(b) - groupPeakScore(a));
}

/** Worst-first over the flat (filtered) record list: highest overallScore
 *  first, as-seen order as the stable tie-break. Returns a new array. */
export function sortRecordsWorstFirst(list: readonly ForensicRecord[]): ForensicRecord[] {
  return [...list].sort((a, b) => recordScore(b) - recordScore(a));
}
