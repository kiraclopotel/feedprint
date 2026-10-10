// A gap between two records, written the way a person reads one.
//
// Shared by the language files beside it (PLAN-2026-09-16 item 10.2).

/**
 * A gap a person can read. Seconds up to a minute, then minutes, then hours.
 * `+961s` was technically a number and practically unreadable.
 */
export function formatGap(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  // Round once, to whole minutes, before splitting: rounding the remainder after the split
  // turned 7,170 seconds into "1h 60m".
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
