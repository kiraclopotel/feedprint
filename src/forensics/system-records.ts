// FeelingWise — system-record predicates (wiring Q38/Q39, W47).
//
// The chain carries nine housekeeping marker kinds (reset, month rotation,
// cap prune, gap, heartbeat, import, repair, redaction, reconcile) that are
// evidence about the CHAIN, never about the feed. Every
// parent-facing aggregation must exclude them, and before this module the
// exclusion was a copy-pasted triple comparison — which is exactly how the
// prune-marker kind (added in W20) missed two sites (feed-composition,
// topics) while landing in four others (W36). One predicate, one place.
//
// `kind:'environment'` (room summaries) is deliberately NOT in this set:
// environment records describe observed feed surroundings, and each surface
// decides separately whether they count as content (StatisticsTab and
// overview-data exclude them from the balance pool; the theme corpus keeps
// them out via its own text sources).

import type { ForensicRecord } from '../types/forensic';

export const SYSTEM_MARKER_KINDS: ReadonlySet<string> = new Set([
  'reset-marker',
  'month-rotation-marker',
  'prune-marker',
  'gap-marker',
  'heartbeat-marker',
  'import-marker',
  'repair-marker',
  'redaction-marker',
  'reconcile-marker',
]);

/** True for chain-housekeeping marker records (reset / rotation / prune / gap / heartbeat / import / repair / redaction / reconcile). */
export function isSystemMarkerRecord(r: Pick<ForensicRecord, 'kind'>): boolean {
  return r.kind !== undefined && SYSTEM_MARKER_KINDS.has(r.kind);
}
