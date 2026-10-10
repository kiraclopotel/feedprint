// FeelingWise — content-side inspection-pass gate.
//
// A tab the parent dashboard opened ("View original", metrics recheck) runs an
// INSPECTION PASS: extraction, scanning, forensic logging and metrics capture
// all run normally, but no DOM intervention is applied — no hide, cover,
// collapse, rewrite or marker. The parent came to SEE the post; the recheck
// came to RE-MEASURE it.
//
// Child-safety framing: the flag can only come from the service worker's
// inspection-tab registry, which only dashboard actions populate. The default
// here is null (NOT inspection), and every failure path — no chrome runtime,
// message error, malformed response — resolves to null. A normal child tab is
// provably unaffected: no registry match means protection is unchanged.

export type InspectionMode = 'reveal' | 'observe';

let activeMode: InspectionMode | null = null;

/** True when this tab is a dashboard-originated inspection tab. */
export function isInspectionTab(): boolean {
  return activeMode !== null;
}

export function activeInspectionMode(): InspectionMode | null {
  return activeMode;
}

/**
 * Map an IS_INSPECTION_TAB response to a mode. Pure and fail-closed: anything
 * other than a well-formed `{ inspection: true, mode: 'reveal' | 'observe' }`
 * resolves to null (full protection).
 */
export function resolveInspectionMode(response: unknown): InspectionMode | null {
  if (!response || typeof response !== 'object') return null;
  const r = response as { inspection?: unknown; mode?: unknown };
  if (r.inspection !== true) return null;
  return r.mode === 'reveal' || r.mode === 'observe' ? r.mode : null;
}

/**
 * Query the service worker once at content-script startup, BEFORE any
 * intervention can fire. Any failure leaves the tab in full-protection mode.
 */
export async function initInspectionMode(
  send: (msg: { type: 'IS_INSPECTION_TAB' }) => Promise<unknown> = defaultSend,
): Promise<void> {
  try {
    activeMode = resolveInspectionMode(await send({ type: 'IS_INSPECTION_TAB' }));
  } catch {
    activeMode = null;
  }
}

async function defaultSend(msg: { type: 'IS_INSPECTION_TAB' }): Promise<unknown> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return null;
  return chrome.runtime.sendMessage(msg);
}

export function _setInspectionModeForTesting(mode: InspectionMode | null): void {
  activeMode = mode;
}
