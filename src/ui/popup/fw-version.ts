// The version label the popup footers print.
//
// Cut out of src/ui/popup/Popup.tsx on 2026-09-16 (PLAN-2026-09-16 item 10.3), which was 1,871
// lines holding every panel at once. Popup.tsx re-exports the names it exported before.

/**
 * Single source of truth for the version label rendered in popup
 * footers. Pre-2026-05-24 three sites (setup/home/keys footers)
 * hardcoded `v1.0.4`/`v1.0.4`/`v1.0.5` literals while
 * `manifest.json:version` was `1.1.0`. Parent saw stale version →
 * misleads support / debugging. Audit A7-03 HIGH closure.
 */
export function getFwVersion(): string {
  try {
    const v = chrome?.runtime?.getManifest?.()?.version;
    return v ? `v${v}` : 'v?';
  } catch {
    return 'v?';
  }
}
