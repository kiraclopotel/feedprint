// What an item reads as on the dashboard: its own text, or the words that stand in for the marker a caption-less
// hidden item is stored under (forensics/stand-in.ts, shared with the export).
//
// Kept out of record-sets.ts: the dashboard's word tables import record-sets, and the export's table imports them,
// so record-sets reading that table closes a loop.

import type { ForensicRecord } from '../../types/forensic';
import type { ResolvedUiLanguage } from '../../types/ui-language';
import { standInKey } from '../../forensics/stand-in';
import { withoutStuckFoldLabel } from '../../forensics/stuck-fold-label';
import { I18N } from '../../i18n/export-strings';

export function shownText(r: ForensicRecord, lang: ResolvedUiLanguage): string {
  const key = standInKey(r);
  return key ? I18N[lang][key] : ownWords(r);
}

/**
 * A handle with a place to break the line after each dot, underscore and hyphen. A long handle has no break of its own, so
 * a narrow cell cut it at its width, in the middle of a word ("corner.ba" over "kery"). A zero-width space prints nothing.
 */
export function breakableHandle(handle: string): string {
  return handle.replace(/([._-])/g, '$1​');
}

/** The text without the page's "See more" button, which the records written before 12 Oct 2026 carry on their ends (the signed text is not changed). */
export function ownWords(r: ForensicRecord): string {
  return withoutStuckFoldLabel(r.originalText || '', r.platform, r.textCapture);
}
