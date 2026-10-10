// Scunthorpe guard for the profanity list (pre-ship review 2026-06-04): the
// forward-stem matcher must NOT flag benign words that start with a profanity
// stem (method/cracked/cockpit) — otherwise profanity-soften silently alters
// benign passing teen/child comments.

import { describe, it, expect } from 'vitest';
import { filterProfanity } from '../../../src/core/profanity-filter';

describe('profanity Scunthorpe exceptions', () => {
  it('does NOT flag benign words that start with a profanity stem', () => {
    const benign = [
      'the method works well',
      'methane levels are rising',
      'a methodical approach',
      'my screen cracked yesterday',
      'pass the crackers please',
      'I sat in the cockpit',
      'a refreshing cocktail',
      'Charles Dickens wrote it',
    ];
    for (const t of benign) {
      expect(filterProfanity(t, 'teen', { tier: 'profanity' }).filtered).toBe(false);
    }
  });

  it('still flags real profanity (exceptions did not weaken detection)', () => {
    for (const t of ['this is shit', 'what the fuck', 'you dick']) {
      expect(filterProfanity(t, 'teen', { tier: 'profanity' }).filtered).toBe(true);
    }
  });
});

describe('Romanian transcript-tuned expansion (e4)', () => {
  it('catches the new vulgar terms, diacritics folded (Whisper writes them clean)', () => {
    const vulgar = [
      'ești o curvă ordinară',          // curva
      'curvar bătrân',                  // curva forward-stem
      'ce pulică mică ai',              // pulica (diminutive — the cocoșel-class that IS unambiguous)
      'în morții pulii tale',           // pulii (genitive)
      'ești un labagiu jalnic',         // labagi stem
      'labagiilor, treziți-vă',         // labagi stem, plural vocative
      'mă doare găoaza de tine',        // gaoaza
    ];
    for (const t of vulgar) {
      expect(filterProfanity(t, 'teen', { tier: 'profanity' }).filtered, t).toBe(true);
    }
  });

  it('catches the homophobic slur gaozar on the slur tier (always-act)', () => {
    expect(filterProfanity('ești un găozar', 'teen', { tier: 'slurs' }).filtered).toBe(true);
    expect(filterProfanity('gaozarule, pleacă', 'adult', { tier: 'slurs' }).filtered).toBe(true);
  });

  it('does NOT flag the adversarial benign surface the new stems live near', () => {
    const benign = [
      // curva collisions
      'the curvature of spacetime explains gravity',
      'curvature and curvatures in differential geometry',
      'her curvaceous figure in the painting',
      'omg she looks so curvacious in that dress', // common misspelling (review-found FP)
      'pulicaria dysenterica grows by the river',  // fleabane genus (biology)
      'me gustan tus curvas peligrosas',          // Spanish lyrics on RO feeds
      'the curve flattened after week two',       // EN curve (RO plural homograph stays uncaught)
      'curvele de nivel apar pe hartă',           // RO "contour lines" — curvele not listed
      // deliberately-excluded RO terms stay unmatched
      'Cocoșelul de aur este o poveste clasică',  // fairy tale (cocosel NOT added)
      'spermatozoidul este celula reproducătoare',// biology (sperma NOT added)
      'laba ursului este o plantă medicinală',    // plant (laba NOT added)
      'preotul îl slobozește pe credincios',      // liturgical verb (sloboz NOT added)
      'pisica doarme pe pulover',                 // pulover ≠ pula stem (4-char stem needs full prefix)
    ];
    for (const t of benign) {
      expect(filterProfanity(t, 'teen', { tier: 'profanity' }).filtered, t).toBe(false);
      expect(filterProfanity(t, 'teen', { tier: 'slurs' }).filtered, t).toBe(false);
    }
  });
});
