// The looks of Feedprint's popup and dashboard: a for the teal one every install has had, b cobalt, c graphite, d and
// e the two vivid ones. A look is one attribute on the page's root that popup-looks.css and dashboard-looks.css read
// beside the dark/light one; look a sets none, so a page that never learns of looks is look a. The choice is stored
// as settings.popupLook beside the theme, and mirrored the way the theme is, so the next opening of either page can
// apply it before the first paint. Both pages share one extension origin, so they share the mirror too.

import type { PopupLook } from '../../storage/settings';

export type { PopupLook };
export const POPUP_LOOKS: readonly PopupLook[] = ['a', 'b', 'c', 'd', 'e'];

export function isPopupLook(value: unknown): value is PopupLook {
  return typeof value === 'string' && (POPUP_LOOKS as readonly string[]).includes(value);
}

/** localStorage copy of settings.popupLook, read synchronously before chrome.storage answers. */
const LOOK_MIRROR_KEY = 'fwPopupLookMirror';

// Every function here reads the page only when there is one: Settings is also rendered on the server side in tests.
export function applyLook(look: unknown): void {
  if (typeof document === 'undefined' || !document.documentElement) return;
  // A value this build does not know, from a newer or damaged store, opens on A rather than on no look at all.
  const known = isPopupLook(look) ? look : 'a';
  if (known === 'a') delete document.documentElement.dataset.look;
  else document.documentElement.dataset.look = known;
  try { localStorage.setItem(LOOK_MIRROR_KEY, known); } catch { /* storage blocked: the stored setting still applies */ }
}

export function readAppliedLook(): PopupLook {
  if (typeof document === 'undefined' || !document.documentElement) return 'a';
  const look = document.documentElement.dataset.look;
  return isPopupLook(look) ? look : 'a';
}

export function readLookMirror(): PopupLook | null {
  try {
    const v = localStorage.getItem(LOOK_MIRROR_KEY);
    return isPopupLook(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Applies the mirrored look at once, then the stored one when chrome.storage answers. Called at module load, before
 * React renders, like the theme's eager apply.
 */
export function eagerApplyStoredLook(): void {
  const mirrored = readLookMirror();
  if (mirrored) applyLook(mirrored);
  if (typeof chrome === 'undefined' || !chrome?.storage?.local) return;
  chrome.storage.local.get(['popupLook']).then((res) => {
    applyLook(res.popupLook ?? mirrored ?? 'a');
  }).catch(() => { /* storage unavailable: the mirror, or look A, stands */ });
}

/** Applies a look chosen in the other page while this one is open, so the popup and the dashboard never disagree. */
export function followStoredLook(): void {
  if (typeof chrome === 'undefined' || !chrome?.storage?.onChanged) return;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.popupLook) applyLook(changes.popupLook.newValue);
  });
}
