// FeelingWise - the UTC day, as 'YYYY-MM-DD'. A leaf module: no storage, no chrome, safe to import from any bundle.

/**
 * UTC-day boundary helper. Returns 'YYYY-MM-DD' in UTC. Used by `getSettings()` to gate the daily-counter reset and
 * by the diagnostics counters for their day stamp. Local `toDateString()` would let timezone changes (travel, DST)
 * trigger spurious resets mid-day. Exported for unit testing.
 */
export function utcDayKey(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
