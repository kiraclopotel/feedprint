// "Showing 500 of 500 records" reads as the whole history. It is the last few
// days, because the live chain is capped at FORENSIC_RECORD_CAP and the
// recorder writes fast enough to reach it in days. Nothing on any screen said
// so until 2026-09-05, and recording every served post (the same day) made the
// window shorter still.
//
// Locked here: the sentence exists in every interface language, it names the
// span AND the ceiling, and the ceiling it names is the real constant rather
// than a number typed into a string.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoPath } from '../../helpers/repo-root';
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

// The owner read "10,565 of 10,000" on the Record tab and doubted it (his walk, 12 Oct 2026). Both were true: the cap is kept by
// a move to the monthly archive that runs about once a day (the 'forensic-prune' alarm, and the maintenance button), and the
// recorder writes thousands of entries a day, so between two moves the live record stands above the cap. The sentence now says
// that when it does, and the cadence it names is the alarm's own, read from the table.
describe('the live record can stand above its cap between two moves, and the sentence says so', () => {
  it('over the cap, no language reads "N of CAP": the count is called a count above the cap, and the move is named as periodic', () => {
    const OVER = 10565;
    for (const lang of UI_LANGUAGES) {
      const note = DASHBOARD_STRINGS[lang].recordWindowNote('6 October', '12 October', OVER, FORENSIC_RECORD_CAP);
      expect(note, lang).toMatch(/10[\s.,  ]565/u);
      // Not the bare fraction "10,565 of 10,000" (en), "de" (es, pt-BR), "din" (ro) that read as a contradiction.
      expect(note, lang).not.toMatch(/10[\s.,  ]565\s(of|de|din)\s10[\s.,  ]000/u);
      // The cap appears twice: as what it is kept to, and as what the count can stand above.
      expect(note.match(/10[\s.,  ]000/gu)?.length, lang).toBe(2);
      expect(note.toLowerCase(), lang).toMatch(/arch|arhiv|arquiv/);
    }
    expect(DASHBOARD_STRINGS.en.recordWindowNote('a', 'b', OVER, FORENSIC_RECORD_CAP)).toContain('About once a day');
  });

  it('at or under the cap it is the fraction, as before, with the move named as periodic too', () => {
    for (const lang of UI_LANGUAGES) {
      const note = DASHBOARD_STRINGS[lang].recordWindowNote('1 May', '2 May', 9000, FORENSIC_RECORD_CAP);
      expect(note, lang).toMatch(/9[\s.,  ]?000/u);
      expect(note.match(/10[\s.,  ]000/gu)?.length, lang).toBe(2);
    }
    expect(DASHBOARD_STRINGS.en.recordWindowNote('a', 'b', FORENSIC_RECORD_CAP, FORENSIC_RECORD_CAP)).toContain('10,000 of 10,000');
  });

  it('"about once a day" is the alarm\'s own cadence', () => {
    const worker = readFileSync(repoPath('src', 'background', 'service-worker.ts'), 'utf8');
    expect(worker).toMatch(/\{ name: 'forensic-prune', opts: \{ periodInMinutes: 60 \* 24 \} \}/);
  });
});
