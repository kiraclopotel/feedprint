// Three shipped rules that fired on ordinary sentences, and the sentences.
//
// The sibling of stems-that-reached-ordinary-words.test.ts, one layer up: that
// file is about single words reaching into other languages, this one is about
// whole rules reaching into ordinary speech. Found 2026-09-19 by running each
// rule's own literal, read out of its source file, against sentences nobody
// would flag.
//
// All three had the same shape, and in all three the answer was already written
// down somewhere else in this repository:
//
//   • The Romanian group-blame rule was "toți" plus any twenty characters plus
//     a common verb. Its Spanish sibling, twelve lines away, requires a named
//     out-group and carries a negative lookbehind for "no todos", because "not
//     all X are Y" is the opposite of group blame. Romanian negates the same
//     way and had neither.
//
//   • self-harm.ts shipped a bare "go die" at weight 4. coded-harm-catcher.ts,
//     the deterministic net beside it, refuses that exact phrase by name and
//     gives the reason: it collides with gaming language.
//
//   • The English exposure rule fired on the bare verb. Its Spanish and
//     Portuguese versions were narrowed on 2026-09-04 with the rule stated in
//     their own comment: exposure needs the locator, not the verb.
//
// Two sides, always. A rule that stops firing on everything is not fixed, it is
// off, so every REJECT below is paired with an ACCEPT that must still fire.

import { describe, expect, it } from 'vitest';
import { scapegoatingClassifier } from '../../../src/core/techniques/scapegoating';
import { selfHarmClassifier } from '../../../src/core/techniques/self-harm';
import { extremeToxicityClassifier } from '../../../src/core/techniques/extreme-toxicity';
import type { TechniqueClassifier } from '../../../src/core/techniques/types';

const fires = (c: TechniqueClassifier, text: string): boolean =>
  c.classify({ text, platform: 'twitter' } as never).present;

describe('rules that reached ordinary sentences (2026-09-19)', () => {
  describe('Romanian group blame needs a group', () => {
    // Each of these was measured firing, strong, before the narrowing.
    const ORDINARY: ReadonlyArray<[string, string]> = [
      ['Toti colegii mei sunt fericiti azi.', 'all my colleagues are happy today'],
      ['Toți prietenii mei sunt minunați.', 'all my friends are wonderful'],
      ['Toti copiii sunt la scoala acum.', 'all the children are at school now'],
      ['Toate fetele sunt gata de plecare.', 'all the girls are ready to leave'],
      ['Toți vecinii mei au masini noi.', 'all my neighbours have new cars'],
    ];
    it.each(ORDINARY)('leaves %s alone (%s)', (text) => {
      expect(fires(scapegoatingClassifier, text)).toBe(false);
    });

    const BLAME: readonly string[] = [
      'Toți imigranții sunt criminali si trebuie scosi afara.',
      'Toti tiganii fura, asa au fost mereu.',
      'Toți politicienii sunt corupti pana la unul.',
      'Toti astia sunt de vina pentru cum arata tara.',
    ];
    it.each(BLAME)('still catches %s', (text) => {
      expect(fires(scapegoatingClassifier, text)).toBe(true);
    });

    it('does not read a denial as the thing it denies', () => {
      // The reason the Spanish sibling carries the same lookbehind.
      expect(fires(scapegoatingClassifier, 'Nu toți imigranții sunt criminali, asta e prostie.')).toBe(false);
    });
  });

  describe('"go die" cannot hide a sentence on its own', () => {
    const GAMING: readonly string[] = [
      'go die in the lava level, it respawns you at the checkpoint',
      'lol just go die already noob, you suck at this game',
      'you go die on that boss like twenty times before it clicks',
    ];
    it.each(GAMING)('leaves %s alone', (text) => {
      expect(fires(selfHarmClassifier, text)).toBe(false);
    });

    const DIRECTED: readonly string[] = [
      'kill yourself, nobody wants you here',
      'go kill yourself you waste of air',
      'you should die honestly',
      'kys',
    ];
    it.each(DIRECTED)('still catches %s', (text) => {
      expect(fires(selfHarmClassifier, text)).toBe(true);
    });

    it('still adds its weight beside something else', () => {
      // Under the threshold alone, over it in company. This is the difference
      // between a narrowing and a deletion, and it is the point of the weight.
      expect(fires(selfHarmClassifier, 'go die')).toBe(false);
      expect(fires(selfHarmClassifier, 'go die, no one would miss you')).toBe(true);
    });
  });

  describe('exposure needs the locator, not the verb', () => {
    const BIOGRAPHY: readonly string[] = [
      'He works at Google now, loves the new job.',
      'She lives in Paris with her husband.',
      'They work at the hospital downtown and she loves it.',
      'He lives at home with his parents while he saves up.',
      'She works at a bakery on weekends.',
    ];
    it.each(BIOGRAPHY)('leaves %s alone', (text) => {
      expect(fires(extremeToxicityClassifier, text)).toBe(false);
    });

    const EXPOSURE: readonly string[] = [
      'Her address is 14 Elm Street, go say hi to her',
      'his real name is Daniel and I have screenshots',
      'she lives on Chapel Street, someone should drop by',
      'their phone number is right here if anyone wants it',
    ];
    it.each(EXPOSURE)('still catches %s', (text) => {
      expect(fires(extremeToxicityClassifier, text)).toBe(true);
    });

    it('still catches naming the school a person attends', () => {
      // Kept deliberately: this one is the exposure, not a fact about a day.
      expect(fires(extremeToxicityClassifier, 'she goes to school at Lincoln High, third period')).toBe(true);
    });
  });
});
