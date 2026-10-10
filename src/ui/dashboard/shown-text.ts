// What an item reads as on the dashboard: its own text, or the words that stand in for the marker a caption-less
// hidden item is stored under (forensics/stand-in.ts, shared with the export).
//
// Kept out of record-sets.ts: the dashboard's word tables import record-sets, and the export's table imports them,
// so record-sets reading that table closes a loop.

import type { ForensicRecord } from '../../types/forensic';
import type { ResolvedUiLanguage } from '../../types/ui-language';
import { standInKey } from '../../forensics/stand-in';
import { I18N } from '../../i18n/export-strings';

export function shownText(r: ForensicRecord, lang: ResolvedUiLanguage): string {
  const key = standInKey(r);
  return key ? I18N[lang][key] : (r.originalText || '');
}
