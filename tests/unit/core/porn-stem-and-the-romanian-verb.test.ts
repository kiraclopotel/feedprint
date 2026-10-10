// "pornesti" is not pornography.
//
// Measured on 2026-09-17 by scripts/verify/filter-falsepos.ts, which runs every
// deterministic gate over this repo's own site, interface and specification
// text: 21,307 sentences, four languages, nothing anyone would want hidden. The
// swearing list fired on four live Romanian sentences of our own site, all of
// them the verb "a porni" (to start, to turn on):
//
//   "O citire AI a evidentei, daca o pornesti tu."      (receipts-ro)
//   "Instalezi, fixezi pictograma, pornesti butoanele." (off-setup-ro)
//
// The stem 'porn' matches any word beginning with it. Eighteen forms of the
// verb had already been excepted by hand in BENIGN_PREFIX_WORDS, with a note
// recording 48 hits in the corpus, and seven more still fired: 'pornesti',
// 'porneasca', 'pornisem', 'pornisera', 'pornisesi', 'pornitul', 'pornitului'.
// Two of those are the commonest forms in the language ("you turn it on", and
// the subjunctive "sa porneasca"). In Child mode this masks the sentence; the
// person sees stars where an ordinary word was, and the record says a rule
// decided it, with no model having read anything.
//
// A verb does not converge by listing its forms. The stem is exact-only now,
// and the words that really are pornography are entries of their own, so
// nothing is lost on the side that matters.

import { describe, expect, it } from 'vitest';
import { filterProfanity } from '../../../src/core/profanity-filter';

/** As the filter sees it: inside a sentence, Child mode, the swearing tier. */
function fires(word: string): boolean {
  return filterProfanity(`sa ${word} ceva acum`, 'child', { tier: 'profanity' }).filtered;
}

// The conjugation, not a sample of it: present, subjunctive, imperfect,
// pluperfect, participle with its articles, gerund, and the noun.
const A_PORNI = [
  'porni', 'pornesc', 'pornesti', 'porneste', 'pornim', 'porniti',
  'porneasca', 'porneam', 'porneai', 'pornea', 'porneati', 'porneau',
  'pornisem', 'pornisesi', 'pornise', 'pornisera', 'pornind',
  'pornit', 'pornita', 'pornite', 'pornitul', 'pornitului',
  'pornire', 'pornirea', 'pornirii', 'porniri', 'pornirile',
];

/** What the entry is actually for. */
const REALLY_PORNOGRAPHY = [
  'porn', 'porno', 'pornografie', 'pornografic', 'pornhub', 'pornstar', 'porntube',
];

describe('the Romanian verb a porni', () => {
  it.each(A_PORNI)('%s is an ordinary word and is left alone', word => {
    expect(fires(word)).toBe(false);
  });

  it('leaves the site sentences that found this alone', () => {
    for (const line of [
      'O citire AI a evidentei, daca o pornesti tu.',
      'Instalezi, fixezi pictograma, pornesti butoanele.',
      'Nimic nu pleaca spre un AI decat daca pornesti tu stratul platit.',
      'Un panou care iti cerea sa pornesti o setare deja pornita.',
    ]) {
      expect(filterProfanity(line, 'child', { tier: 'profanity' }).filtered, line).toBe(false);
    }
  });
});

describe('what the entry is for', () => {
  it.each(REALLY_PORNOGRAPHY)('%s is still caught', word => {
    expect(fires(word)).toBe(true);
  });

  it('catches it in a sentence a child could be shown', () => {
    expect(filterProfanity('check out this porn site', 'child', { tier: 'profanity' }).filtered).toBe(true);
    expect(filterProfanity('trimite-mi pornografie', 'child', { tier: 'profanity' }).filtered).toBe(true);
  });
});
