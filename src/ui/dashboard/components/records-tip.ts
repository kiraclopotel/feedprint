// Cheap append-only "tip" signature for the forensic record set.
//
// The dashboard re-pulls records on every tab visibility/focus change and once
// shortly after first paint (the freshness settle). Replacing the records array
// each time re-renders the whole virtualized feed and re-fires ResizeObserver
// height measurement — which reads as the feed "scrolling by itself". The chain
// is APPEND-ONLY, so an unchanged tip (record count + last record id + last
// timestamp) means an identical set: the re-pull can keep the existing array
// reference and skip the churn. O(1) — touches only length + the last element.

import type { ForensicRecord } from '../../../types/forensic';

/**
 * Stable one-line signature of the record set's tip. Same string ⇒ nothing was
 * appended since the last read (for an append-only store). Empty set → '0'.
 */
export function recordTip(records: ForensicRecord[]): string {
  const n = records.length;
  if (n === 0) return '0';
  const last = records[n - 1];
  return `${n}|${last.id}|${last.timestamp}`;
}
