// "Showing 500 of 500 records" reads as the whole history. It is the last few
// days, because the live chain is capped at FORENSIC_RECORD_CAP and the
// recorder writes fast enough to reach it in days. Nothing on any screen said
// so until 2026-09-05, and recording every served post (the same day) made the
// window shorter still.
//
// Locked here: the sentence exists in every interface language, it names the
// span AND the ceiling, and the ceiling it names is the real constant rather
// than a number typed into a string.

import { describe, expect, it } from 'vitest';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';
import { UI_LANGUAGES } from '../../../src/i18n';
import { FORENSIC_RECORD_CAP } from '../../../src/forensics/store';

describe('the dashboard says how far back the live record goes', () => {
  it.each([...UI_LANGUAGES])('%s names the span, the count and the ceiling', (lang) => {
    const note = DASHBOARD_STRINGS[lang].recordWindowNote('3 September', '5 September', 2431, FORENSIC_RECORD_CAP);
    expect(note).toContain('3 September');
    expect(note).toContain('5 September');
    // The count and the cap, in that language's own digit grouping.
    expect(note).toMatch(/2[\s.,  ]?431/u);
    expect(note).toMatch(/10[\s.,  ]000/u);
    expect(note.length).toBeGreaterThan(40);
  });

  it('every language mentions the archive, so the turnover does not read as loss', () => {
    // EN 'archive', RO 'arhiva', ES 'archivo', PT-BR 'arquivo'.
    for (const lang of UI_LANGUAGES) {
      const note = DASHBOARD_STRINGS[lang].recordWindowNote('1 May', '2 May', 10, FORENSIC_RECORD_CAP);
      expect(note.toLowerCase(), lang).toMatch(/arch|arhiv|arquiv/);
    }
  });

  it('states the real cap, not a number someone typed', () => {
    // If the constant moves and the string does not, this fails.
    const note = DASHBOARD_STRINGS.en.recordWindowNote('a', 'b', 1, FORENSIC_RECORD_CAP);
    expect(note).toContain(FORENSIC_RECORD_CAP.toLocaleString('en-US'));
    expect(FORENSIC_RECORD_CAP).toBeGreaterThan(0);
  });

  it('the Romanian archived note kept its diacritics', () => {
    // The rest of the RO table carries them; this one string had been folded to
    // ASCII ("inregistrari ... pastrate in arhiva").
    const ro = DASHBOARD_STRINGS.ro.showingArchivedNote(12);
    expect(ro).toContain('înregistrări');
    expect(ro).toContain('păstrate');
    expect(ro).not.toContain('inregistrari');
  });
});
