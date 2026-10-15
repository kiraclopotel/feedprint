// What the header's dots and the AI banner should say, worked out from settings and the licence.
//
// Pure functions on purpose: they are the part of the popup a test can read without a DOM.
//
// Cut out of src/ui/popup/Popup.tsx on 2026-09-16 (PLAN-2026-09-16 item 10.3), which was 1,871
// lines holding every panel at once. Popup.tsx re-exports the names it exported before.

import type { ProxyProbeResult } from '../../../ai/client';
import type { DotState } from './header';

/** The site's help section on the AI reading, which says what a key costs and where to get one. Home links it when a
 * key has expired, the License tab when there is no key or it has expired; it lives here so neither tab imports the other. */
export const KEY_HELP_URL = 'https://feelingwise.org/help#ai-reading';

export function computeStatusStates(
  license: { tier: string },
  probeResult: ProxyProbeResult | null = null,
  // A reading call with this key got through lately (ai/reading-got-through.ts): the key is accepted, whatever the
  // models list said. It stands in only where the list gave no answer; a refusal is never overruled by it.
  readingGotThrough = false,
): { licenseState: DotState } {
  let licenseState: DotState;
  if (license.tier === 'free') {
    // Free is a plan, not a fault: no licence was bought, so nothing is missing to warn about.
    licenseState = 'free';
  } else if (probeResult === 'revoked' || probeResult === 'expired') {
    licenseState = 'err';
  } else if (probeResult === 'ok') {
    licenseState = 'ok';
  } else if (probeResult === 'unknown') {
    licenseState = readingGotThrough ? 'ok' : 'unchecked';
  } else {
    licenseState = 'checking';
  }
  return { licenseState };
}

// ─── AI-off banner state (POP-5) ───
//
// The header dot is not enough: a well-formatted but revoked/typo'd paid key
// renders "Active" pills and "on" AI toggles while every classification call
// 401s server-side. This mirrors the free-tier banner into a second honest
// state so the parent SEES that AI checks are off, not just a small red dot.
//
//   • 'free'    — no paid key; AI pipeline never runs (existing known trap).
//   • 'revoked' — paid-shaped key that the proxy rejected (probe = 'revoked').
//   • 'expired' — the proxy refused the key because its paid period ended (probe = 'expired').
//   • 'none'    — paid key with an ok / not-yet-returned probe. We assume good
//                 until proven revoked, matching computeStatusStates — so a
//                 transient blip or the pre-probe window never false-alarms.
export type AiBannerState = 'none' | 'free' | 'revoked' | 'expired';

export function computeAiBannerState(
  license: { tier: string },
  probeResult: ProxyProbeResult | null = null,
): AiBannerState {
  if (license.tier === 'free') return 'free';
  if (probeResult === 'revoked') return 'revoked';
  if (probeResult === 'expired') return 'expired';
  return 'none';
}
