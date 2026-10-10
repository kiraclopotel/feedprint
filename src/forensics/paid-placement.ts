// FeelingWise - advertising is a category, never a harm.
//
// THE READING THIS FIXES. A blind read of 300 items from the owner's own six
// day export (docs/research/BLIND-READ-2026-09-14.md) drew 150 items the app
// had acted on. 75 of them were plain sponsored ads, recorded by the child and
// teen pipeline as technique `consumer-rapid-frame` at severity 6 from nothing
// but the platform's own "Sponsored" marker. The frozen adult reader fired on
// NONE of them. Half of everything the product called a finding was the ad
// blocker wearing the judge's coat, and every harm number the owner reads was
// carrying it: the flagged count, the flagged share, the severity bands, the
// technique league table, the popup's actions today, the export summary.
//
// THE RULE (rebuild plan 2026-09-14, standing decision 1). Ads are never harm.
// They are recorded exactly as before, hidden by the user's own Block Ads rule,
// and counted as paid placement. They leave every harm count, every severity
// and every "acted" number. Nothing here changes what is written: the record,
// its techniques, its severity and its hash are untouched, and a legacy ad that
// carries a severity keeps it on disk. Display and counting ignore it.
//
// WHAT COUNTS AS AN AD. One predicate, `isPaidPlacement`, defined once in
// export-numbers.ts (the pure engine the exported HTML also runs) and re-
// exported here so every counting surface in the extension asks the same
// question. It reads four structured signals, never a technique name:
//
//   detectionMode 'sponsored-ad' / 'sponsored-ad:adult'  the child/teen and
//                  adult pipeline verdicts (src/analysis/pipeline.ts:703-720)
//   detectionMode 'block:ads:<token>'                    the adult Block Ads
//                  category event (src/content/post-path/result-apply.ts:801-818)
//   decision rail 'sponsored'                            the policy table's
//                  own row (src/core/policy/table.ts:112)
//   accountType 'advertiser'                             a promoted post the
//                  adapter proved (src/types/forensic.ts:1076-1089)
//
// The technique name is deliberately NOT a signal: `consumer-rapid-frame` is a
// real judge verdict on organic content too ("run, don't walk", a dropshipper's
// countdown), and reading the technique would have thrown those away with the
// ads.

import type { ForensicRecord } from '../types/forensic';
import { isPaidPlacement } from './export-numbers';

export { isPaidPlacement };

/**
 * How bad this record is, for ranking and for the severity bands: 0 for an ad,
 * whatever number the record carries. Otherwise the record's own peak, the
 * overall score and the per-technique severities together, which is the
 * reading every severity surface already used.
 */
export function harmSeverityOf(r: ForensicRecord): number {
  if (isPaidPlacement(r)) return 0;
  let s = typeof r.overallScore === 'number' && Number.isFinite(r.overallScore) ? r.overallScore : 0;
  for (const t of r.techniques ?? []) {
    const sev = t?.severity;
    if (typeof sev === 'number' && Number.isFinite(sev) && sev > s) s = sev;
  }
  return s;
}
