// The record's own note, in the reader's language, for the dashboard card.
//
// A decision block carries one fixed sentence when what the page showed differs from what the row
// asked for (src/content/record/decision.ts). The export card shows it through a table restated in
// its inline script (src/forensics/html-export-scripts.ts, NOTE); the dashboard card shows it here,
// in the export's own words, so a hide that could not be applied does not read "hidden, shown as
// marked" with no reason on one screen and with one on the other.

import type { ResolvedUiLanguage } from './index';
import { I18N } from './export-strings';

type NoteKey =
  | 'feedNoteNotApplied' | 'feedNoteSettingOff' | 'feedNoteLegacyActed'
  | 'feedNoteVideoSkipped' | 'feedNoteVideoMarked' | 'feedNoteVideoFolded' | 'feedNoteLateVerdict' | 'feedNotePairVetoed'
  | 'feedNoteAdHidden';

/**
 * The signed sentences, by the words a record carries. They are spelled out here because a record
 * already written keeps its sentence for good, and this layer imports nothing from the content
 * script; tests/unit/forensics/a-card-says-what-the-record-says.test.tsx reads them against the constants in decision.ts.
 */
export const DECISION_NOTE_KEYS: Readonly<Record<string, NoteKey>> = {
  'the page could not apply the action; the item stayed as the record says under applied': 'feedNoteNotApplied',
  'the household switched this action off; the item stayed as served': 'feedNoteSettingOff',
  'the legacy path acted before the table was wired; applied is what it did': 'feedNoteLegacyActed',
  'the video rule for this mode skipped the video; applied is what it did': 'feedNoteVideoSkipped',
  'the video rule for this mode marked the caption in yellow and left the video playing; applied is what it did': 'feedNoteVideoMarked',
  'a fold has no meaning on a video, so the video rule for this mode hid it; applied is what it did': 'feedNoteVideoFolded',
  'the reading answered after the item had scrolled away; it was applied when the item came back; applied is what it did': 'feedNoteLateVerdict',
  'a second model did not agree, so nothing acted': 'feedNotePairVetoed',
  'Block ads hid this advertisement; applied is what it did': 'feedNoteAdHidden',
};

/**
 * What to say beside the record's action: its note in the reader's language, a note this build does
 * not know as written, or, for a hide that did not land and carries no note, the sentence for that.
 * Nothing when the record has neither.
 */
export function decisionNoteWords(
  lang: ResolvedUiLanguage,
  note: string | null | undefined,
  visualApplied: boolean | undefined,
): string | null {
  if (typeof note === 'string' && note) {
    const key = DECISION_NOTE_KEYS[note];
    return key ? I18N[lang][key] : note;
  }
  return visualApplied === false ? I18N[lang].feedNoteNotApplied : null;
}
