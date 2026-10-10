// Two parts of this repository assert opposite things about one act.
//
// tests/unit/forensics/destructive-paths-archive-first.test.ts holds the rule
// that no path may remove a record from the active chain without first putting
// it where the export can still reach it, and proves that a reset archives
// every record rather than destroying it. store.ts says the same in its own
// words at the top of resetForensicChainLocked: "the user asked for a fresh
// chain, never for the old one to stop existing". The dashboard then reads
// those archives straight back into allRecords, so the entries are on the
// screen again after the reset finishes.
//
// The dialog that asks the user to type a word before all of this said:
// "Wipes everything FW has recorded: every flag, scan, author, verdict...
// Destructive and irreversible." In four languages.
//
// Both halves are false. Nothing is wiped, and nothing is irreversible. The
// behaviour is the right one and is deliberate; the words simply never caught
// up with it, and no check compared them, because a string and a chain are
// tested by different files that never meet.
//
// Which direction the error runs matters. A person resets a RECORDER because
// they want something gone: someone documenting harassment who has decided not
// to keep it, a teenager on an install a parent set up. Telling them the
// entries are destroyed when the entries are archived and back on the screen is
// the one misstatement this product cannot afford. (2026-09-18)

import { describe, it, expect } from 'vitest';
import { DASHBOARD_STRINGS } from '../../../../../src/i18n/dashboard-strings';
import { UI_LANGUAGES } from '../../../../../src/i18n';

/** Every fragment the modal renders, in the order it renders them. */
function resetBody(lang: (typeof UI_LANGUAGES)[number]): string {
  const t = DASHBOARD_STRINGS[lang];
  return [t.resetBody1, t.resetBodyBold1, t.resetBody2, t.resetBodyBold2, t.resetBody3].join('');
}

/**
 * The first four fragments, which are the ones describing THE RESET. The fifth
 * describes what else the reader can do, and it is allowed to say that
 * uninstalling erases everything, because uninstalling does. Scoping the ban
 * this way rather than matching prose across the whole dialog: "Chrome erases
 * everything it stored" is a true sentence that a whole-dialog word match
 * cannot tell apart from the false one it replaced.
 */
function whatTheResetDoes(lang: (typeof UI_LANGUAGES)[number]): string {
  const t = DASHBOARD_STRINGS[lang];
  return [t.resetBody1, t.resetBodyBold1, t.resetBody2, t.resetBodyBold2].join('');
}

/**
 * Words that claim the record stops existing. One per language, in the forms
 * the four dialogs actually used, so this list is evidence and not a guess.
 */
const CLAIMS_DESTRUCTION: Record<string, string[]> = {
  en: ['irreversible', 'wipes everything', 'destructive'],
  ro: ['ireversibil', 'distructiv', 'șterge tot ce'],
  es: ['irreversible', 'destructivo', 'borra todo'],
  'pt-BR': ['irreversível', 'destrutivo', 'apaga tudo'],
};

/** Words that name where the entries go. */
const NAMES_THE_ARCHIVE: Record<string, string[]> = {
  en: ['archive'],
  ro: ['arhiv'],
  es: ['archivo'],
  'pt-BR': ['arquivo'],
};

describe('the reset dialog says what reset does', () => {
  // A missing key would make every loop below skip a language in silence.
  it('covers every interface language', () => {
    for (const lang of UI_LANGUAGES) {
      expect(CLAIMS_DESTRUCTION[lang], `${lang} has a destruction word list`).toBeDefined();
      expect(NAMES_THE_ARCHIVE[lang], `${lang} has an archive word list`).toBeDefined();
    }
  });

  it('claims destruction in no language', () => {
    for (const lang of UI_LANGUAGES) {
      const body = whatTheResetDoes(lang).toLowerCase();
      for (const claim of CLAIMS_DESTRUCTION[lang]) {
        expect(
          body.includes(claim),
          `${lang}: the dialog says "${claim}", and destructive-paths-archive-first.test.ts ` +
          'proves every record is archived instead. Say what the reset does.',
        ).toBe(false);
      }
    }
  });

  it('tells the reader where their entries went', () => {
    for (const lang of UI_LANGUAGES) {
      const body = resetBody(lang).toLowerCase();
      const named = NAMES_THE_ARCHIVE[lang].some((w) => body.includes(w));
      expect(named, `${lang}: the entries survive the reset, so the dialog names where`).toBe(true);
    }
  });

  // A dialog that answered the above by going vague would be worse than the
  // one it replaced: the reader still has to know what they are about to lose.
  it('still says plainly what IS cleared', () => {
    const body = resetBody('en').toLowerCase();
    for (const cleared of ['scan', 'author', 'verdict']) {
      expect(body, `the English dialog names the ${cleared} data as cleared`).toContain(cleared);
    }
  });

  // The one honest route to a record that is really gone. It has two parts and
  // the second is easy to leave out: the daily sealed copy in Downloads is
  // outside everything Chrome erases, which the privacy page was corrected to
  // say on the same day this dialog was.
  it('names both halves of removing everything, not just the extension', () => {
    const body = resetBody('en').toLowerCase();
    expect(body, 'uninstalling is the route').toContain('uninstall');
    expect(body, 'and the copies in Downloads are not covered by it').toContain('download');
  });

  it('keeps the four dialogs saying the same thing', () => {
    for (const lang of UI_LANGUAGES) {
      const body = resetBody(lang);
      expect(body.length, `${lang} is not a stub`).toBeGreaterThan(200);
      expect(body, `${lang} has no em dash`).not.toContain('—');
    }
  });
});
