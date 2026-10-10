// Spoken-transcript coverage (2026-06-12): Whisper emits clean spoken-register
// profanity AND pre-censored forms ("f***", "sh*t"). The \b tokenizer
// fragments censored tokens and normalizeLeet strips '*', so a text-level
// exact-allowlist pass handles them. Failing examples before the fix:
//   filterProfanity('what the f***', ...) -> filtered: false
//   filterProfanity('he is a motherfucker', ...) -> filtered: false

import { describe, it, expect } from 'vitest';
import { filterProfanity } from '../../../src/core/profanity-filter';

describe('censored-form matching (Whisper pre-censored output)', () => {
  it('matches common censored profanity shapes', () => {
    const censored = [
      'what the f*** are you doing',
      'that is f**k up man',
      'this is complete sh*t',
      'oh s**t he saw us',
      'total bullsh*t honestly',
      'you b*tch',
      'what a c*nt move',
      'he is a d*ck',
      'such a wh*re',
      'she completely f****** over our country',
      'you motherf***er',
    ];
    for (const t of censored) {
      expect(filterProfanity(t, 'teen', { tier: 'profanity' }).filtered, t).toBe(true);
    }
  });

  it('matches censored slurs on the slur tier', () => {
    for (const t of ['shut up n***a', 'he said n*gger', 'called him a f*ggot']) {
      expect(filterProfanity(t, 'teen', { tier: 'slurs' }).filtered, t).toBe(true);
    }
  });

  it('replaces the censored token in child mode', () => {
    const r = filterProfanity('what the f*** man', 'child', { tier: 'profanity' });
    expect(r.filtered).toBe(true);
    expect(r.cleanText).toBe('what the **** man');
    expect(r.matches).toContain('fuck');
  });

  it('does NOT match benign asterisk usage (exact allowlist, no heuristic)', () => {
    const benign = [
      'use the A* algorithm for pathfinding',
      'see footnote a*** for details',
      'rated ****  by critics',
      'the regex a*b matches zero or more',
      'password hint: m***e (my pet)',
      '**bold text** in markdown',
      'C* is a music note variant',
    ];
    for (const t of benign) {
      expect(filterProfanity(t, 'child', { tier: 'profanity' }).filtered, t).toBe(false);
      expect(filterProfanity(t, 'child', { tier: 'slurs' }).filtered, t).toBe(false);
    }
  });
});

describe('spoken-register English additions', () => {
  it('catches compound/spoken forms the forward-stem matcher could not reach', () => {
    const vulgar = [
      'you motherfucker',           // motherfuck stem
      'motherfucking traffic',
      'that is bullshit',           // not reachable via 'shit' (not a prefix)
      'what a dumbass move',
      'stop being a jackass',
      'goddamn it',                 // goddam stem
      'god damn it',                // separated transcript form
      'god-damn it',
      'goddammit not again',
      'you bastard',
      'I am so pissed off',         // piss stem
      'stupid twat',
      'what a wanker',              // wank stem
      'that is bollocks',           // bollock stem
      'move your arse',
    ];
    for (const t of vulgar) {
      expect(filterProfanity(t, 'teen', { tier: 'profanity' }).filtered, t).toBe(true);
    }
  });

  it('does NOT flag the benign prefix collisions (Scunthorpe exceptions)', () => {
    const benign = [
      'Arsenal won the league',
      'arsenic levels in the water',
      'Arsene Wenger era',
      'arson investigation underway',   // arson does not share the arse prefix
      'the Wankel rotary engine',
      'a Pissarro painting',
      'a bastardized version of the recipe',
      'prick your finger for the blood test', // prick deliberately NOT listed
      'the pinprick of a needle',
      'damn good game',                 // damn deliberately NOT listed (mild)
      'Thank God\nDamn good game',       // phrase matcher must not cross lines
      'a hell of a comeback',           // hell deliberately NOT listed (mild)
      'this app is crap at saving',     // crap deliberately NOT listed (mild)
    ];
    for (const t of benign) {
      expect(filterProfanity(t, 'child', { tier: 'profanity' }).filtered, t).toBe(false);
    }
  });

  it('keeps bare mild damn excluded', () => {
    expect(filterProfanity('damn good game', 'teen', { tier: 'profanity' }).filtered).toBe(false);
  });
});
