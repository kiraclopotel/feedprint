// What the header's dots and the AI banner should say, worked out from settings and the licence.
//
// Pure functions on purpose: they are the part of the popup a test can read without a DOM.
//
// Cut out of src/ui/popup/Popup.tsx on 2026-09-16 (PLAN-2026-09-16 item 10.3), which was 1,871
// lines holding every panel at once. Popup.tsx re-exports the names it exported before.

import type { ProxyProbeResult } from '../../../ai/client';
import type { DotState } from './header';

export function computeStatusStates(
  license: { tier: string },
  probeResult: ProxyProbeResult | null = null,
): { licenseState: DotState } {
  let licenseState: DotState;
  if (license.tier === 'free') {
    // Free is a plan, not a fault: no licence was bought, so nothing is missing to warn about.
    licenseState = 'free';
  } else if (probeResult === 'revoked') {
    licenseState = 'err';
  } else if (probeResult === 'ok') {
    licenseState = 'ok';
  } else if (probeResult === 'unknown') {
    licenseState = 'unchecked';
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
//   • 'none'    — paid key with an ok / not-yet-returned probe. We assume good
//                 until proven revoked, matching computeStatusStates — so a
//                 transient blip or the pre-probe window never false-alarms.
export type AiBannerState = 'none' | 'free' | 'revoked';

export function computeAiBannerState(
  license: { tier: string },
  probeResult: ProxyProbeResult | null = null,
): AiBannerState {
  if (license.tier === 'free') return 'free';
  if (probeResult === 'revoked') return 'revoked';
  return 'none';
}
