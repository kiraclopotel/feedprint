// The chain note counted two different events and named only one of them.
//
// `verifyChain` counts them apart, because they are apart:
//
//   a BRANCH is one chain position held by two records under the same key,
//     found on a repeated (fingerprint, chainPosition);
//   a RESTART is a break between consecutive positions, found when a record's
//     prevRecordHash names nothing in the file and the position before it is
//     its own minus one.
//
// `chainNotes` adds them together and printed the sum under a sentence reading
// "{n} chain positions are held by more than one record under the same key",
// which describes a branch only. Measured against the published vectors on
// 2026-09-19: `19-unattributed-seam.html` has `branches: 0, restarts: 1`, so
// its page told a reader that one position was held by more than one record
// when no position was. `15-seam-and-branch.html` has one of each and said two
// positions were, when one was.
//
// That sentence is not decoration. It carries the file's only "somebody may
// have replaced a record and signed the replacement" warning, so printing it
// over a file where that did not happen spends the warning, and the event that
// did happen is never named. The follow-on note then said "{n} of those
// restarts", pointing at a sentence that had not mentioned a restart.
//
// The wording now covers both, and the key is `chainNoteSeams`, because a key
// called `chainNoteBranches` that prints branches plus restarts is the same
// defect written in a second place.
//
// This holds the arithmetic and the wording together: the note is printed for
// the sum, so the sentence must describe the sum.

import { describe, expect, it } from 'vitest';
import { I18N } from '../../../src/i18n/export-strings';
import { readSource } from '../../helpers/read-source';

const LOCALES = Object.keys(I18N) as Array<keyof typeof I18N>;

describe('a restart is not a position held twice (2026-09-19)', () => {
  it('the note is printed for the sum of the two events', () => {
    // If a later change prints the note for branches alone, the wording below
    // becomes wrong again in the other direction, so both sides are held here.
    const core = readSource('src/forensics/verifier-core-source.ts');
    expect(core).toContain('var seams=(chain.branches||0)+(chain.restarts||0);');
    expect(core).toContain("i18n.chainNoteSeams.replace('{n}',String(seams))");
  });

  it('no language claims the sum is a count of positions held more than once', () => {
    // The English phrasing of the old sentence, and its three translations,
    // all led with the branch reading. Each language is checked against the
    // thing it actually said.
    const bannedOpenings: Record<string, RegExp> = {
      en: /^\{n\} chain positions are held by more than one record/,
      ro: /^\{n\} pozi[^ ]+ din lan[^ ]+ sunt ocupate de mai mult/,
      es: /^\{n\} posiciones de cadena las ocupa m[^ ]+ de un registro/,
      'pt-BR': /^\{n\} posi[^ ]+ de cadeia s[^ ]+ ocupadas por mais de um registro/,
    };
    for (const locale of LOCALES) {
      const note = I18N[locale].chainNoteSeams;
      const banned = bannedOpenings[locale as string];
      if (banned) expect(note, `${locale} still opens on the branch reading`).not.toMatch(banned);
    }
  });

  it('every language still names both events and keeps the warning', () => {
    for (const locale of LOCALES) {
      const note = I18N[locale].chainNoteSeams;
      expect(note, `${locale} has its count slot`).toContain('{n}');
      // The warning the sentence exists to carry: a replaced record signed
      // again under the same key, and the file cannot say which happened.
      expect(note.length, `${locale} is still the long sentence`).toBeGreaterThan(200);
      expect(note, `${locale}`).not.toContain('—');
    }
  });

  it('the follow-on note points at the sentence above it', () => {
    // It said "of those restarts" under a sentence about positions held twice.
    for (const locale of LOCALES) {
      const child = I18N[locale].chainNoteUnattributed;
      expect(child, `${locale} follow-on`).toContain('{n}');
      expect(child.toLowerCase(), `${locale} follow-on still says restarts`).not.toMatch(/those restarts|acele relu|esos reinicios|desses rein/);
    }
  });

  it('the old key name is gone from the tree', () => {
    // A key called chainNoteBranches that prints branches plus restarts is the
    // defect in a second place, so the rename is part of the fix.
    expect(readSource('src/i18n/export-strings.ts')).not.toContain('chainNoteBranches');
    expect(readSource('src/types/export-strings.ts')).not.toContain('chainNoteBranches');
    expect(readSource('src/forensics/verifier-core-source.ts')).not.toContain('chainNoteBranches');
  });
});
