// FeelingWise — sequence-analysis ask-functions over the theme clustering
// core in topics.ts.
//
// HONESTY FRAME (binding for every consumer): each output is an OBSERVED
// pattern with provenance — counts, dates, and the member record ids that
// prove them. The vocabulary is "your feed served / repeated N items";
// never platform intent. Deterministic and recomputable from the chain.
//
// PURE read-side: pure functions over ForensicRecord[] / Theme[].
// No IDB, no chrome, no writes.

import type { Theme } from './topics';

// ─── Ask 1: predominant topics over time ─────────────────────────────────────

/** Top themes by member count (tie: more distinct days first). */
export function predominantThemes(themes: Theme[], opts?: { top?: number }): Theme[] {
  const top = opts?.top ?? 8;
  return [...themes]
    .sort((a, b) => b.recordCount - a.recordCount || b.daysActive - a.daysActive || a.id.localeCompare(b.id))
    .slice(0, top);
}

// (A per-platform `sessionize` helper lived here 2026-06..07 with zero
// runtime callers; deleted 2026-07-14 per the simplify rule. The app's ONE
// live session derivation is the dashboard ledger's — Dashboard.tsx
// SESSION_GAP_MIN, cross-platform by design. Recover the old helper from
// git history if a per-platform variant ever earns a real consumer.)

// ─── Ask 3: cross-day recurring themes ───────────────────────────────────────

/** Themes active on >= minDays distinct days — what keeps coming back. */
export function crossDayThemes(themes: Theme[], opts?: { minDays?: number }): Theme[] {
  const minDays = opts?.minDays ?? 3;
  return themes
    .filter((t) => t.daysActive >= minDays)
    .sort((a, b) => b.daysActive - a.daysActive || b.recordCount - a.recordCount || a.id.localeCompare(b.id));
}
