import { LICENSE_STORAGE_KEY } from '../../storage/license';
import { ENTITLEMENTS_STORAGE_KEY, entitlementsMeaningChanged } from '../../storage/license-entitlements';

interface ModeStorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

export type ModeStorageListener = (
  changes: Record<string, ModeStorageChange>,
  areaName: string,
) => void;

/** Bind mode changes before any slow protection provider startup can yield. */
export function initializeModeAwareProtection(
  subscribe: ((listener: ModeStorageListener) => void) | null,
  onModeChange: (value: unknown) => void,
  onStrictLanguageChange?: () => void,
): void {
  subscribe?.((changes, areaName) => {
    if (areaName !== 'local') return;
    if ('mode' in changes) onModeChange(changes.mode?.newValue);
    // strictLanguage and the feature grid share one
    // invalidation path: each flips verdict-visual policy, so cached verdicts
    // computed under the old policy must not replay. Before `features` joined
    // (2026-08-04, laydown D10), toggling a feature took effect on the
    // engagement subsystem immediately but left the classification path
    // serving stale verdicts until reload — same settings panel, two
    // latencies. A mode switch writes mode+features+presets in ONE storage
    // set, so when `mode` is present its handler already runs a superset of
    // this invalidation and the features branch must not double-fire it.
    if ('mode' in changes) return;
    // The AI switch, the key and the plan list decide whether the reading may run, so a verdict the reading made
    // earlier on this page must not replay once any of them changes: a removed key or a switch turned off ends it at
    // once, not at the next reload.
    // A refresh of the plan list rewrites it with new dates on every success; only a change in what it turns on, or
    // in the key it names, invalidates, or every open tab would rescan on each refresh.
    const planChanged = ENTITLEMENTS_STORAGE_KEY in changes
      && entitlementsMeaningChanged(changes[ENTITLEMENTS_STORAGE_KEY]?.oldValue, changes[ENTITLEMENTS_STORAGE_KEY]?.newValue);
    if ('strictLanguage' in changes || 'features' in changes || 'aiAnalysisEnabled' in changes
      || LICENSE_STORAGE_KEY in changes || planChanged) {
      onStrictLanguageChange?.();
    }
  });
}
