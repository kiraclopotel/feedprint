// FeelingWise — shared UI helpers (popup + dashboard).
//
// compactNum — compact thousands/millions label. 1_234 → "1.2K", 1_000_000 → "1M".
export function compactNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

// FeelingWise — shared theme helpers (popup + dashboard).
//
// Single source of truth for theme resolution + DOM application. Pre-2026-05-24
// the dashboard had inline copies of these helpers and the popup had none —
// users who picked light mode in the dashboard still saw a dark popup
// (popup fell through to the @media prefers-color-scheme fallback in
// tokens.css). Now both surfaces import from here and respond to the same
// `settings.dashboardTheme` value.
//
// The settings field is still called `dashboardTheme` for back-compat
// (renaming would force a v11 schema migration on every existing install
// for zero behavior gain). It's semantically the global theme preference.

import type { DashboardTheme } from '../../storage/settings';
import { resolveUiLanguage } from '../../i18n';

export type ThemeChoice = 'dark' | 'light' | 'system';

/**
 * Collapse a preference into a concrete theme.
 *
 * 'system' resolves via `prefers-color-scheme: light` matchMedia query.
 * On surfaces where window/matchMedia aren't available (very early at
 * SW boot), defaults to 'dark' — matches the pre-v10 hardcoded state
 * so existing installs see no visual change.
 */
function resolveTheme(pref: DashboardTheme): 'dark' | 'light' {
  if (pref === 'dark' || pref === 'light') return pref;
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return 'dark';
}

/**
 * Set `document.documentElement.dataset.theme` to the resolved theme.
 *
 * tokens.css selectors `:root[data-theme="light"]` / `:root[data-theme="dark"]`
 * have higher specificity than the plain `:root` defaults and the `@media`
 * fallback, so an explicit attribute always wins.
 */
export function applyTheme(pref: DashboardTheme): void {
  if (typeof document === 'undefined' || !document.documentElement) return;
  document.documentElement.dataset.theme = resolveTheme(pref);
  // Mirror the PREFERENCE (not the resolved value) to localStorage so the
  // next page open can apply it synchronously before chrome.storage answers
  // (chrome.storage has no sync read; this mirror is the only pre-paint
  // source). Best-effort: the mirror is a cache, chrome.storage stays the
  // source of truth.
  try { localStorage.setItem(THEME_MIRROR_KEY, pref); } catch { /* storage blocked */ }
  applyStoredLanguage();
}

/**
 * Set `<html lang>` from the stored interface-language preference.
 *
 * Accessibility audit (2026-09-18): the popup and dashboard shipped with
 * `<html lang="en">` in their static HTML and nothing ever corrected it
 * afterward, so a Romanian, Spanish or Brazilian Portuguese interface was
 * read out by an English speech synthesiser with English pronunciation
 * rules regardless of settings.uiLanguage. Called from applyTheme rather
 * than asking every existing call site (the eager pre-mount apply, the
 * theme picker, a settings reload from another window) to also learn about
 * language, since every one of them already calls applyTheme and none of
 * them needs to change to pick this up.
 */
function applyStoredLanguage(): void {
  if (typeof document === 'undefined' || !document.documentElement) return;
  // Synchronous first pass: the same navigator.language fallback
  // resolveUiLanguage already uses for an unset 'auto' preference, so the
  // attribute is right immediately for anyone who has not picked an
  // explicit interface language.
  document.documentElement.lang = resolveUiLanguage(undefined);
  if (typeof chrome === 'undefined' || !chrome?.storage?.local) return;
  chrome.storage.local.get(['uiLanguage']).then((res) => {
    document.documentElement.lang = resolveUiLanguage(res.uiLanguage as string | undefined);
  }).catch(() => { /* storage unavailable; the navigator.language guess above stands */ });
}

/** localStorage cache of `dashboardTheme` for synchronous pre-paint reads. */
const THEME_MIRROR_KEY = 'fwThemePrefMirror';

/** Synchronously read the mirrored preference, if any. */
export function readThemeMirror(): DashboardTheme | null {
  try {
    const v = localStorage.getItem(THEME_MIRROR_KEY);
    return v === 'dark' || v === 'light' || v === 'system' ? v : null;
  } catch {
    return null;
  }
}

/**
 * 3-state cycle: dark → light → system → dark.
 *
 * Used by the dashboard header's one-click theme button. The popup uses a
 * 3-button segmented control instead (more discoverable on a 380px
 * settings surface, no need to remember the cycle order).
 */
export function nextThemeInCycle(t: DashboardTheme): DashboardTheme {
  return t === 'dark' ? 'light' : t === 'light' ? 'system' : 'dark';
}

/**
 * Eager pre-mount theme apply.
 *
 * Reads `dashboardTheme` from `chrome.storage.local` and applies it to
 * `<html>` BEFORE React renders. Reduces (does not fully eliminate — async
 * storage read takes a few ms) the flash for users whose explicit
 * preference differs from their OS preference.
 *
 * Call at module load time, NOT inside a React component. Safe in any
 * extension-page context (popup, dashboard, options); a no-op when
 * chrome.storage isn't available.
 */
export function eagerApplyStoredTheme(): void {
  // Synchronous first pass from the localStorage mirror — lands before the
  // first paint in practice (module scripts execute before render), which
  // kills the dark flash for explicit light-mode users (found 2026-08-02).
  const mirrored = readThemeMirror();
  if (mirrored) applyTheme(mirrored);
  if (typeof chrome === 'undefined' || !chrome?.storage?.local) return;
  chrome.storage.local.get(['dashboardTheme']).then((res) => {
    const pref = res.dashboardTheme as DashboardTheme | undefined;
    // Authoritative pass: corrects a stale mirror and backfills it.
    applyTheme(pref ?? mirrored ?? 'dark');
  }).catch(() => { /* storage unavailable — CSS @media fallback handles it */ });
}

/**
 * Subscribe to OS-level prefers-color-scheme changes while the user's
 * preference is 'system'. Returns a cleanup function that removes the
 * listener. No-op when the surface doesn't support matchMedia.
 *
 * Usage (in React):
 *   useEffect(() => {
 *     if (pref !== 'system') return;
 *     return subscribeToSystemThemeChanges(() => applyTheme('system'));
 *   }, [pref]);
 */
export function subscribeToSystemThemeChanges(handler: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}
