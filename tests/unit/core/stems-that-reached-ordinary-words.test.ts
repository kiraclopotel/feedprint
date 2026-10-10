// Sixteen stems, measured against 436,389 words, in the four shipped languages.
//
// The instrument is `scripts/verify/stem-collisions.ts`, which was named nowhere
// in the tree until 2026-09-19: the numbers below were readable and the thing
// that produced them was reachable only by knowing it existed. Quote the key or
// not the number.
//
// The sweep ran every stem of four characters or more against this repository's
// own writing plus the Hunspell dictionaries for Romanian, Spanish, Portuguese
// and English. The dictionaries are not in the tree and never will be: they are
// GPL-2.0 / LGPL-2.1 / MPL-1.1 and this repository is AGPL-3.0-or-later, so the
// instrument reads them from a cache outside it. What the sweep found is here,
// word for word, because a test that names the words is the only part of that
// measurement a person can read later without re-running it.
//
// Each of these was hidden or masked with no model reading the item. Nine of the
// sixteen collided in Romanian, Spanish or Portuguese, which is where a list
// written in English reaches furthest into words that mean something else.
//
// The fix per stem is the one 'porn' got: exact-only, with the inflections that
// really are offensive listed as entries of their own. A glued form still
// resolves through the run-together segmenter, which is the path 'assfuck' and
// 'dickheadmotherfucker' take, so the evasion cover is unchanged.

import { describe, expect, it } from 'vitest';
import { filterProfanity } from '../../../src/core/profanity-filter';

/** As a household gets it: inside a sentence, Child mode, both tiers. */
function hidden(word: string): boolean {
  return filterProfanity(`text ${word} here`, 'child', { tier: 'both' }).filtered;
}

/** What each stem was reaching, with the language the dictionary gave it. */
const ORDINARY: ReadonlyArray<{ stem: string; word: string; means: string }> = [
  { stem: 'arse', word: 'arsenic', means: 'the element' },
  { stem: 'arse', word: 'arseniat', means: 'an arsenate salt, Romanian' },
  { stem: 'arse', word: 'arsenifer', means: 'arsenic-bearing, Romanian' },
  { stem: 'arse', word: 'arsenioso', means: 'arsenious, Spanish' },
  { stem: 'spic', word: 'spicul', means: 'the ear of wheat, Romanian' },
  { stem: 'spic', word: 'spicuiesc', means: 'I glean, I excerpt, Romanian' },
  { stem: 'spic', word: 'spicuire', means: 'gleaning, Romanian' },
  { stem: 'spic', word: 'spicule', means: 'a small needle-like structure' },
  { stem: 'muie', word: 'muieresc', means: 'womanly, Romanian' },
  { stem: 'muie', word: 'muierime', means: 'womenfolk, Romanian' },
  { stem: 'cacat', word: 'cacatua', means: 'a cockatoo, Portuguese' },
  { stem: 'cacat', word: 'cacateira', means: 'a cockatoo tree, Portuguese' },
  { stem: 'curva', word: 'curvatura', means: 'curvature' },
  { stem: 'curva', word: 'curvado', means: 'bent, Portuguese' },
  { stem: 'piss', word: 'pissasfalto', means: 'a bitumen, Portuguese' },
  { stem: 'piss', word: 'pisseta', means: 'a wash bottle, Portuguese' },
  { stem: 'cock', word: 'cockatiel', means: 'the bird' },
  { stem: 'cock', word: 'cockle', means: 'the shellfish' },
  { stem: 'cock', word: 'cocksure', means: 'overconfident' },
  { stem: 'dick', word: 'dickerson', means: 'a surname' },
  { stem: 'dick', word: 'dickson', means: 'a surname' },
  { stem: 'retardat', word: 'retardatario', means: 'a latecomer, Spanish' },
  { stem: 'slut', word: 'slutesc', means: 'I disfigure, Romanian' },
  { stem: 'slut', word: 'slutire', means: 'disfigurement, Romanian' },
  { stem: 'nigga', word: 'niggard', means: 'a miser, the case every filter fails' },
  { stem: 'nigga', word: 'niggardliness', means: 'stinginess' },
  { stem: 'pussy', word: 'pussycat', means: 'the cat' },
  { stem: 'pussy', word: 'pussyfoot', means: 'to tread carefully' },
  { stem: 'cracker', word: 'crackerjack', means: 'excellent' },
  { stem: 'vagina', word: 'vaginal', means: 'medicine' },
  { stem: 'vagina', word: 'vaginalite', means: 'an inflammation, Portuguese' },
  { stem: 'penis', word: 'peniscar', means: 'Portuguese' },
  { stem: 'rapist', word: 'rapistro', means: 'white mustard, Portuguese' },
  { stem: 'bastard', word: 'bastardilha', means: 'a typeface, Portuguese' },
  { stem: 'bastard', word: 'bastardocarpia', means: 'botany, Portuguese' },
  { stem: 'clitoris', word: 'clitorismo', means: 'medicine, Portuguese' },
  { stem: 'orgasm', word: 'orgasmometro', means: 'an instrument name' },
];

/**
 * The one collision that was judged and kept. 'bulangi' reaches a single rare
 * Portuguese noun, and as a stem it carries 'bulangiu' and 'bulangii', which
 * are the forms a Romanian reader meets. A rare word in one language does not
 * buy the loss of a live insult in another, and a decision like that belongs in
 * a test rather than in a note nobody runs.
 */
const ACCEPTED_COLLISION = 'bulangismo';

/** What those same stems are for, and must still catch. */
const OFFENSIVE = [
  'arse', 'arsehole', 'spic', 'spics', 'muie', 'cacat', 'curva',
  'piss', 'pissed', 'pissing', 'cock', 'dick', 'retard', 'retardat',
  'slut', 'sluts', 'slutty', 'nigga', 'niggas', 'nigger', 'pussy', 'pussies',
  'cracker', 'vagina', 'penis', 'rapist', 'rapists', 'bastard', 'bastards',
  'clitoris', 'orgasm', 'bulangiu',
];

/** Glued forms, which are how someone gets round an exact-only entry. */
const GLUED = ['assfuck', 'retardface', 'dickheadmotherfucker', 'cocksucker', 'dickhead'];

describe('a word that is not offensive at all', () => {
  it.each(ORDINARY)('$word ($means) is left alone, though $stem is on the list', ({ word }) => {
    expect(hidden(word)).toBe(false);
  });

  it('keeps the one collision that was judged worth its cost, and says so here', () => {
    expect(hidden(ACCEPTED_COLLISION)).toBe(true);
    expect(hidden('bulangiu')).toBe(true);
  });

  it('leaves the canonical case alone, as it always did', () => {
    // 'therapist' is one token and no listed term begins "the", so this was
    // never at risk; it is here because it is the case everyone names, and a
    // reader of this file should see it answered.
    expect(hidden('therapist')).toBe(false);
    // Two tokens is a different question, and the answer there is yes.
    expect(filterProfanity('the rapist walked free', 'child', { tier: 'both' }).filtered).toBe(true);
  });
});

describe('what those stems are for', () => {
  it.each(OFFENSIVE)('%s is still caught', word => {
    expect(hidden(word)).toBe(true);
  });

  it.each(GLUED)('%s is still caught, glued', word => {
    expect(hidden(word)).toBe(true);
  });
});
