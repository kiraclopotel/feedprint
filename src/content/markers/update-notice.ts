// When the extension is updated or reloaded under an open tab, the script in that tab keeps running
// but can no longer reach the extension, so nothing on the page is checked any more until the page is
// refreshed. Covers already up say so (strandChildShield); a feed with no cover up said nothing, so
// it looked protected while it was not. This puts one small line on the page that says it, and a
// click on it refreshes the page.
//
// The old script cannot ask Chrome which product it belongs to after an update, so the line names no
// product: it is the same sentence the stranded covers use.

import { MARKER_STRINGS } from '../../i18n/marker-strings';
import type { ResolvedUiLanguage } from '../../i18n';
import { markContextInvalidated, onContextInvalidated } from '../../storage/context-guard';

const UPDATE_NOTICE_ATTRIBUTE = 'data-fw-update-notice';

/** Show the line once per document; a second call leaves the first in place. */
function showUpdateNotice(doc: Document, lang: ResolvedUiLanguage): HTMLElement | null {
  const existing = doc.querySelector<HTMLElement>(`[${UPDATE_NOTICE_ATTRIBUTE}]`);
  if (existing) return existing;
  const parent = doc.body ?? doc.documentElement;
  if (!parent) return null;
  const text = MARKER_STRINGS[lang]?.coverStrandedNotice ?? MARKER_STRINGS.en.coverStrandedNotice;
  // The live region holds the button, so a screen reader hears the line and the button keeps its role.
  const region = doc.createElement('div');
  region.setAttribute(UPDATE_NOTICE_ATTRIBUTE, '');
  region.setAttribute('role', 'status');
  region.style.cssText = 'all: initial; position: fixed; left: 16px; bottom: 16px; z-index: 2147483646;';
  const notice = doc.createElement('button');
  notice.type = 'button';
  notice.textContent = text;
  // Inline, because the page's own style sheet decides everything else on the page; the values sit
  // above the sites' own fixed bars.
  notice.style.cssText = [
    'all: initial',
    'display: block',
    'max-width: min(360px, calc(100vw - 32px))',
    'box-sizing: border-box',
    'padding: 10px 14px',
    'border-radius: 8px',
    'background: #1f2933',
    'color: #ffffff',
    'font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    'text-align: left',
    'box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35)',
    'cursor: pointer',
  ].join('; ');
  notice.addEventListener('click', () => {
    try {
      doc.defaultView?.location.reload();
    } catch {
      // A page that refuses the reload keeps the line; the person can still refresh by hand.
    }
  });
  region.appendChild(notice);
  parent.appendChild(region);
  return region;
}

/**
 * Arm the line for this tab. The extension's going away is usually noticed when the script next
 * calls it, which is when a new post arrives; a person who comes back to a quiet tab after an update
 * would see nothing until they scrolled. So a return to the tab also checks: an extension that was
 * updated or removed leaves the old script with no runtime id.
 */
export function armUpdateNotice(doc: Document, langOf: () => ResolvedUiLanguage): void {
  onContextInvalidated(() => {
    showUpdateNotice(doc, langOf());
  });
  const checkOnReturn = (): void => {
    if (doc.visibilityState !== 'visible') return;
    let alive = false;
    try {
      alive = typeof chrome !== 'undefined' && typeof chrome?.runtime?.id === 'string';
    } catch {
      alive = false;
    }
    if (!alive) {
      doc.removeEventListener('visibilitychange', checkOnReturn);
      markContextInvalidated();
    }
  };
  doc.addEventListener('visibilitychange', checkOnReturn);
}
