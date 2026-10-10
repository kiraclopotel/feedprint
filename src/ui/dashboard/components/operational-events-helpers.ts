// The operational panel's arithmetic, with no React in it.
//
// Adding up an hour's buckets, sorting selector counters into the ones with enough misses to judge
// and the ones without, picking the colour of a drift dot, stripping the heavy sample list out of a
// diagnostics blob before it goes to the clipboard, and lowering an acknowledgement baseline that
// sits above the counter it acknowledged.
//
// Cut out of OperationalEventsPanel.tsx on 2026-09-16 (PLAN-2026-09-16 item 10.3). The component
// imports these back and re-exports the four the tests read, so nothing that used them changed.

import type { DiagnosticsSnapshot } from '../../../diagnostics/diagnostics';
import { type PlatformDrift, SELECTOR_MIN_DENOM, type SelectorHealthCounter } from '../../../diagnostics/selector-health';
import { AIFailureKind, OperationalEventBucket } from '../../../forensics/chain-debug-stats';
import type { DashboardStrings } from '../../../i18n/dashboard-strings';

export const ISSUE_ACKS_KEY = 'fwOpsIssueAcksV1';
export const BUCKET_SIZE_MS = 60 * 60 * 1000;          // 1-hour buckets
export const WINDOW_DURATION_MS = 24 * 60 * 60 * 1000; // 24-hour window

export function sumLlmFailure(buckets: OperationalEventBucket[]): Partial<Record<AIFailureKind, number>> {
  const out: Partial<Record<AIFailureKind, number>> = {};
  for (const b of buckets) {
    for (const k of Object.keys(b.llmFailure) as AIFailureKind[]) {
      out[k] = (out[k] ?? 0) + (b.llmFailure[k] ?? 0);
    }
  }
  return out;
}

/**
 * How many of the day's AI failures will NOT clear themselves, and so need the
 * owner to do something. `src/ai/client.ts:320` already draws this line and
 * refuses to retry across it; `auth-refusal` is the kind on the permanent side
 * that he can actually act on (the proxy returns it for missing / malformed /
 * unknown / revoked licences and for a tier mismatch). Pure.
 */
export function ownerActionableLlmFailures(
  breakdown: Partial<Record<AIFailureKind, number>>,
): number {
  return breakdown['auth-refusal'] ?? 0;
}

export interface SelectorDriftRow {
  label: string;
  total: number;
  miss: number;
  missPct: number;
  fallbackPct: number;
}

/**
 * Split the suspect selectors into the ones whose rate means something and the
 * ones seen too few times to rate. A percentage over a denominator of one is
 * not a measurement: the owner's 2026-08-20 dump flagged `facebook.count-chips`
 * at "100% miss" off a single observation, on the same screen where the
 * per-platform rollup said Facebook was OK — one panel contradicting itself.
 * Same lying-instrument class as R-W88, one level down.
 *
 * The thin ones are returned, not dropped. Muting an instrument is the other
 * way to lie about it, and a selector that misses its only look is exactly what
 * a rotting selector looks like on day one — the reader should see it, just not
 * as a verdict. Mirrors the record-identity panel's "too few to rate yet".
 * Pure.
 */
export function partitionSelectorDrift(
  counters: readonly SelectorHealthCounter[],
): { rated: SelectorDriftRow[]; unrated: SelectorDriftRow[] } {
  const suspect = counters
    .map((c): SelectorDriftRow => {
      const total = c.primary + c.fallback1 + c.fallback2 + c.fallbackDeep + c.miss;
      const fallbacks = c.fallback1 + c.fallback2 + c.fallbackDeep;
      return {
        label: c.label,
        total,
        miss: c.miss,
        missPct: total > 0 ? Math.round((c.miss / total) * 100) : 0,
        fallbackPct: total > 0 ? Math.round((fallbacks / total) * 100) : 0,
      };
    })
    .filter(d => d.total > 0 && (d.miss > 0 || d.fallbackPct >= 20))
    .sort((a, b) => b.missPct - a.missPct || b.fallbackPct - a.fallbackPct);
  return {
    rated: suspect.filter(d => d.total >= SELECTOR_MIN_DENOM),
    unrated: suspect.filter(d => d.total < SELECTOR_MIN_DENOM),
  };
}

/**
 * Per-platform status dot: color + label. Pure, exported so the "green must
 * mean watched and matched" contract is testable without a full render.
 * 'healthy' (real selector counters, no drift) and 'confirmed-by-canary'
 * (zero selector counters, only a positive extraction heartbeat) are
 * deliberately DIFFERENT colors and DIFFERENT text — collapsing them back
 * into the same green "OK" is the exact 2026-08-24 defect this split fixes.
 */
export function platformDriftDot(
  s: PlatformDrift['status'],
  t: DashboardStrings,
): { color: string; text: string } {
  return s === 'healthy' ? { color: 'var(--fw-green)', text: t.opsDriftOk }
    : s === 'confirmed-by-canary' ? { color: 'var(--fw-teal)', text: t.opsDriftCanaryConfirmed }
    : s === 'drifting' ? { color: 'var(--fw-amber)', text: t.opsDriftDrifting }
    : s === 'broken' ? { color: 'var(--fw-red)', text: t.opsDriftBroken }
    : s === 'not-instrumented' ? { color: 'var(--fw-muted)', text: t.opsDriftNotInstrumented }
    : { color: 'var(--fw-muted)', text: t.opsDriftNotMonitored };
}
export function sanitizeDiagnosticsForClipboard(
  diagnostics: DiagnosticsSnapshot | null,
): (Omit<DiagnosticsSnapshot, 'samples'> & { samples: Array<{ t: string; usedMB: number }> }) | null {
  if (!diagnostics) return null;
  return {
    ...diagnostics,
    samples: diagnostics.samples.map(({ t, usedMB }) => ({ t, usedMB })),
  };
}
/**
 * Acks with every baseline that sits above its card's current counter lowered
 * to that counter. Returns the same object when nothing changed, so a caller
 * can skip the write (wiring audit 13 Sep, D2-34).
 */
export function rebaseAcks(
  acks: Record<string, number>,
  cards: ReadonlyArray<{ key: string; measure?: number }>,
): Record<string, number> {
  let next: Record<string, number> | null = null;
  for (const c of cards) {
    if (c.measure === undefined) continue;
    const base = acks[c.key];
    if (base !== undefined && c.measure < base) {
      next = next ?? { ...acks };
      next[c.key] = c.measure;
    }
  }
  return next ?? acks;
}
