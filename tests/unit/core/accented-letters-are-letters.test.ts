// An accent is not a word boundary, though JavaScript thinks it is.
//
// `\b` in a JavaScript regular expression sits between a word character and a
// non-word character, and only a-z, 0-9 and _ are word characters. Every
// accented letter in the three non-English languages this product ships is
// therefore a boundary, so a listed token sitting after an accent inside a
// longer word matches as if it stood alone:
//
//   prostático   ->  \b prost \b ático      the Romanian for "stupid",
//                                            inside the Portuguese for
//                                            "prostatic"
//   oxímoron     ->  ox \b moron \b         the Spanish figure of speech
//   retardatário ->  \b retardat \b ário    a latecomer, in Portuguese
//
// Each of those added five points towards hiding a post that no model had read,
// in a language where accents are ordinary. Measured on 2026-09-17 by the stem
// sweep against the four shipped languages' dictionaries.
//
// Two fixes, both in harm-floor.ts. The haystack folds its diacritics before
// the patterns run, which can only remove matches: every pattern in that file
// is written without diacritics on purpose, and the aggressive pass already
// folded them. And the four stems that were open (`idiot\w*` and the rest) now
// list the inflections that are the insult, because folding alone still let
// 'idiot' reach 'idiotalamo' and 'psycho' reach 'psychology'.

import { describe, expect, it } from 'vitest';
import { detectAdHominemToken, computeHarmFloor } from '../../../src/core/harm-floor';

/** The gate, asked the way the pipeline asks it. */
function flagged(text: string): boolean {
  return detectAdHominemToken(text) !== null;
}

const ORDINARY: ReadonlyArray<[string, string]> = [
  ['prostático', 'prostatic, Portuguese: carries "prost" after an accent'],
  ['prostáticos', 'the plural of the same'],
  ['oxímoron', 'the Spanish figure of speech: carries "moron" after an accent'],
  ['retardatário', 'a latecomer, Portuguese'],
  ['retardatários', 'the plural of the same'],
  ['idiotálamo', 'anatomy, Portuguese'],
  ['idiotérmico', 'idiothermic, Portuguese'],
  ['cretinínico', 'Portuguese'],
  ['psychological', 'what a person calls the help they are looking for'],
  ['psychology', 'the subject'],
  ['psychotherapy', 'the treatment'],
  ['psychologist', 'the person who gives it'],
];

const STILL_AN_INSULT = [
  'esti prost', 'proastă', 'prostule', 'idiot', 'idiots', 'idiotic', 'idiotule',
  'moron', 'morons', 'psycho', 'psychopath', 'psychopathic', 'retarded', 'retardat',
  'cretin', 'cretinule', 'imbecil', 'stupid', 'loser', 'deranged', 'insane', 'dumbass',
];

describe('a word that only contains an insult because of an accent', () => {
  it.each(ORDINARY)('%s (%s) is not an ad hominem', word => {
    expect(flagged(`el este ${word} aici`)).toBe(false);
  });

  it('does not push an ordinary sentence towards the harm floor either', () => {
    // The gate feeds the ad-hominem signal at five points a hit. Three of these
    // words in one medical sentence used to be fifteen points of "personal
    // attack". Written as 'B' until 2026-09-17, which is not in the category
    // union at all, so the comparison was false whatever the gate did: the
    // assertion passed on a sentence that fires three times. Found by the typed
    // test lane, not by the suite, which does not typecheck.
    const before = computeHarmFloor('discutam despre prostático, oxímoron si retardatário');
    expect(before.signals.some(s => s.category === 'ad-hominem')).toBe(false);
  });
});

describe('what the gate is for', () => {
  it.each(STILL_AN_INSULT)('%s is still an ad hominem', text => {
    expect(flagged(`el este ${text} aici`)).toBe(true);
  });

  it('still reads an accented Romanian insult, which is why the fold is safe', () => {
    expect(flagged('esti o proastă')).toBe(true);
    expect(flagged('ce tâmpit')).toBe(true);
  });
});
