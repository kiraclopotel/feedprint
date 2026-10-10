// FeelingWise — which usage band a record lands in.
//
// Lifted out of ui/dashboard/components/UsageTimePanel.tsx (item 7, second
// slice, 14 Sep 2026) so the month summary can count the same bands per hour
// without the forensics layer importing a React component. The rule is the
// wiring audit's (13 Sep, D2-12, D2-13): markers and room summaries are not
// things the person saw; a scan that reached no verdict is "not judged".

import type { ForensicRecord } from '../types/forensic';
import { isSystemMarkerRecord } from './system-records';
import { isPaidPlacement } from './paid-placement';
import { carriesFlagVerdict, isRepeatMarkOnly } from './flag-verdict';

export type UsageBand = 'flagged' | 'blocked' | 'pass' | 'unjudged';

/** Which band a record lands in, or null when it is not something the person saw. */
export function usageBand(r: ForensicRecord): UsageBand | null {
  if (r.kind === 'environment' || isSystemMarkerRecord(r)) return null;
  const v = r.verdict;
  if (v === 'blocked') return 'blocked';
  // Advertising never bands as flagged (standing decision 1, 2026-09-14): a
  // child or teen sponsored-ad record is written flagged-hidden at severity 6
  // from the platform's own marker. It is hidden by the user's Block Ads rule,
  // so it stacks with the blocked band, which is where rules live.
  //
  // Unless it was not hidden (2026-09-19). The decision above reads an ad as
  // blocked because the Block Ads rule hid it, and that rule can be off. When
  // it is, pipeline.ts says in its own comment what gets written: an adult-mode
  // ad enters the record "as a pass under the sponsored row with a note when
  // Block Ads is OFF". This line ran before the verdict was looked at, so that
  // record banded as blocked anyway.
  //
  // One ad, one pass over the data, two answers. addRecordsToSummary calls this
  // function and then, eleven lines further down in the same loop, counts the
  // month's blocked total with `isPaidPlacement(r) && r.verdict !== 'pass'`,
  // which excludes exactly this record. So the hourly chart told a parent the
  // ad was blocked while the total beside it said it was not, about an ad their
  // own setting had let through. That is the reading a parent uses to answer
  // "is Block Ads doing anything", and it answered yes on the evidence of an ad
  // it did not block.
  //
  // The rule is the summary's, because the summary's was right. A shown ad
  // falls through to the pass band below, which is where the things that
  // reached the person sit.
  if (isPaidPlacement(r) && v !== 'pass') return 'blocked';
  // "Seen a lot" was not read: it sits with the unjudged items, not in the flagged band (the Head, 10 Oct 2026).
  if (isRepeatMarkOnly(r) && carriesFlagVerdict(r)) return 'unjudged';
  if (carriesFlagVerdict(r) || v === 'harm-floor-trigger') return 'flagged';
  // A masked record is decided and nothing was charged (types/forensic.ts
  // verdict docblock); this histogram stacks what happened to what was
  // seen, it is not a pass rate, so it sits with the untouched items.
  if (v === 'pass' || v === 'masked' || v === 'educational-reframe') return 'pass';
  return 'unjudged';
}
