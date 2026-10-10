// FeelingWise — selector-family miss diagnostics (wiring Q31).
//
// The per-platform engagement files sweep UNION selector families (every
// selector contributes matches), so they cannot route through
// queryAllWithFallback's first-hit-wins chain. Before this helper their
// staleness failure mode was silence: a platform DOM rotation left the
// toggle visibly on and the elements visibly unhidden, with nothing
// recorded anywhere. Reels-blocker's "gate matched but no containers"
// warning is the reference shape; this generalizes it and also lands the
// miss on the dashboard's selector-health surface via recordSelectorMiss.
//
// Reporting is throttled to once per (label, pathname): sweeps run on a
// sub-second cadence and an empty page would otherwise flood the health
// counters.
//
// The miss is a counter, not a warning (2026-09-03). It used to console.warn,
// and Chrome collects content-script warnings into the extension's Errors
// list, so every new pathname on X, Facebook and TikTok filled that list
// with "selector family matched NOTHING" lines the owner read as breakage.
// Per the 2026-06-06 lesson these are mostly structural misses on pages
// where the element legitimately is not there; the extraction canary is
// the instrument that says a platform is broken. The line now prints only
// under `window.__FW_DEBUG__`.

import { recordSelectorHit, recordSelectorMiss } from '../../diagnostics/selector-health';
import { fwDebug } from '../fw-log';

const _missLoggedPath = new Map<string, string>();
const _hitLoggedPath = new Map<string, string>();

/**
 * Report the outcome of one full family sweep. `matched` is the number of
 * elements the family's selectors returned (hidden or not). Zero matches on
 * a new pathname records one selector-health miss and one debug line;
 * any later hit on the same label clears the throttle so a genuine
 * recovery-then-rotation sequence reports again.
 *
 * W88 (2026-08-18): a sweep with matches now records ONE primary hit per
 * (label, pathname) — before this, family labels recorded ONLY misses, so
 * the dashboard health surface read "0 primary / 100% miss" for a family
 * that matched on every sweep. That instrument artifact is what the owner's
 * 2026-08-18 diagnostics reported for youtube.engagement-metrics and
 * youtube.action-buttons while the live /watch DOM matched fine. Hit
 * recording uses the same per-(label, path) throttle as the miss side so
 * the sub-second sweep cadence doesn't inflate primary counts.
 */
export function noteSelectorFamilySweep(label: string, matched: number): void {
  // The UTC day is part of the key because the health counters restart at midnight UTC: keyed on
  // the path alone, a tab that stays on one page across midnight never counts on the new day.
  const path = typeof location !== 'undefined' ? location.pathname : '';
  const throttleKey = `${new Date().toISOString().slice(0, 10)} ${path}`;
  if (matched > 0) {
    _missLoggedPath.delete(label);
    if (_hitLoggedPath.get(label) === throttleKey) return;
    _hitLoggedPath.set(label, throttleKey);
    recordSelectorHit(label, 0);
    return;
  }
  _hitLoggedPath.delete(label);
  if (_missLoggedPath.get(label) === throttleKey) return;
  _missLoggedPath.set(label, throttleKey);
  recordSelectorMiss(label);
  fwDebug(`[FW selector-family] ${label}: matched nothing on ${path}`);
}

/** Test hook: clears the per-path throttle state. */
export function __resetSelectorFamilyMissStateForTest(): void {
  _missLoggedPath.clear();
  _hitLoggedPath.clear();
}
