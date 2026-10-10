// FeelingWise — Profanity filter unit tests (LOOP-262 / LOOP-265)
//
// Covers the two-tier model:
//   • 'slurs'     — always-rewrite on any caller that passes this tier
//   • 'profanity' — mode-sensitive rewrite (child rewrites, teen flag-only)
//   • 'both'      — legacy default, unchanged semantics
// Plus the specific "retarded" regression that started this loop.

import { describe, it, expect } from 'vitest';
import { filterProfanity, __TEST_ONLY } from '../../../src/core/profanity-filter';

describe('filterProfanity — benign-homograph exceptions (real external FPs)', () => {
  // Surfaced by the OpenAI moderation eval set: forward-stem slur matching
  // over-fired on benign words sharing a slur prefix. These must NOT flag.
  const benignHomographs = [
    'we are spicy today, really',          // spic -> spicy
    'add more spice to the curry',          // spic -> spice
    'I love spices in my food',             // spic -> spices
    'the spicey chicken sandwich changed',  // spic -> spicey (common typo)
    'a thumb spica splint for the sprain',  // spic -> spica (medical)
    'a giant anteater can cripple a jaguar with one swipe', // verb, not a target
    'this fabric is a fire retardant',      // retard -> retardant
    'fire retardants slow the spread',      // retard -> retardants
    'congenital mental retardation syndrome', // retard -> retardation (clinical)
  ];
  for (const text of benignHomographs) {
    it(`does not slur-flag benign: "${text}"`, () => {
      const r = filterProfanity(text, 'teen', { tier: 'slurs' });
      expect(r.filtered, `matched ${r.matches.join(',')}`).toBe(false);
    });
  }

  it('still flags the actual slur inflection "retarded" (regression guard)', () => {
    expect(filterProfanity('you are retarded', 'teen', { tier: 'slurs' }).filtered).toBe(true);
  });

  it('still flags the actual slur "spic" (regression guard)', () => {
    expect(filterProfanity('you are a spic', 'teen', { tier: 'slurs' }).filtered).toBe(true);
  });
});

describe('filterProfanity — slurs tier', () => {
  it('rewrites the slur for child mode', () => {
    const r = filterProfanity('You are retarded', 'child', { tier: 'slurs' });
    expect(r.filtered).toBe(true);
    expect(r.cleanText).toBe('You are ********');
    expect(r.matches).toContain('retard');
  });

  it('rewrites the slur for teen mode (LOOP-262 — was passing through)', () => {
    const r = filterProfanity('You are retarded', 'teen', { tier: 'slurs' });
    expect(r.filtered).toBe(true);
    expect(r.cleanText).toBe('You are ********');
  });

  it('rewrites the slur for adult mode too when tier is slurs (caller chooses mode eligibility)', () => {
    // Slurs tier bypasses the adult-skip rule because it is always-rewrite.
    // The caller controls which modes invoke this tier.
    const r = filterProfanity('You are retarded', 'teen', { tier: 'slurs' });
    expect(r.filtered).toBe(true);
    expect(r.cleanText).toBe('You are ********');
  });

  it('does NOT match casual profanity when tier is slurs only', () => {
    // "shit" is in PROFANITY list, not SLURS. Slurs-tier call must ignore it.
    const r = filterProfanity('what the shit', 'child', { tier: 'slurs' });
    expect(r.filtered).toBe(false);
    expect(r.cleanText).toBe('what the shit');
  });

  it('catches leetspeak slur variants (r3tarded, r3t4rd)', () => {
    const r = filterProfanity('total r3tarded move', 'teen', { tier: 'slurs' });
    expect(r.filtered).toBe(true);
  });

  it('catches `loony` (Phase-1 corpus-mined ableist slur, added 2026-05-14)', () => {
    const r = filterProfanity('what a loony idea', 'teen', { tier: 'slurs' });
    expect(r.filtered).toBe(true);
    expect(r.matches).toContain('loony');
  });

  it('catches plural `fags` (external gap-finder find — 3-char `fag` is exempt from stem matching, so the plural needs its own entry)', () => {
    const r = filterProfanity('liquidate the fags', 'teen', { tier: 'slurs' });
    expect(r.filtered).toBe(true);
    expect(r.matches).toContain('fags');
  });

  it('catches `jewboy` and its plural via the stem (external gap-finder find)', () => {
    expect(filterProfanity('convert the jewboys', 'teen', { tier: 'slurs' }).filtered).toBe(true);
    expect(filterProfanity('that jewboy over there', 'teen', { tier: 'slurs' }).filtered).toBe(true);
  });
});

describe('filterProfanity — profanity tier', () => {
  it('rewrites profanity for child mode', () => {
    const r = filterProfanity('this is shit', 'child', { tier: 'profanity' });
    expect(r.filtered).toBe(true);
    expect(r.cleanText).toBe('this is ****');
  });

  it('flags but does NOT rewrite for teen mode (legacy contract)', () => {
    const r = filterProfanity('this is shit', 'teen', { tier: 'profanity' });
    expect(r.filtered).toBe(true);
    expect(r.cleanText).toBe('this is shit');
  });

  // Teen never rewrites profanity (flags only); child always rewrites.
  it('teen mode flags but does not rewrite profanity (default)', () => {
    const r = filterProfanity('this is shit', 'teen', { tier: 'profanity' });
    expect(r.filtered).toBe(true);
    expect(r.cleanText).toBe('this is shit');
  });

  it('does NOT match slur when tier is profanity only', () => {
    const r = filterProfanity('you are retarded', 'child', { tier: 'profanity' });
    expect(r.filtered).toBe(false);
    expect(r.cleanText).toBe('you are retarded');
  });
});

describe('filterProfanity — both (default)', () => {
  it('matches either list when tier is omitted', () => {
    const r1 = filterProfanity('you are retarded', 'child');
    expect(r1.filtered).toBe(true);

    const r2 = filterProfanity('what the shit', 'child');
    expect(r2.filtered).toBe(true);
  });

  it('teen flags both lists by default (does not rewrite)', () => {
    const r = filterProfanity('what the shit', 'teen');
    expect(r.filtered).toBe(true);
    expect(r.cleanText).toBe('what the shit');
  });
});

describe('filterProfanity — wordlist invariants', () => {
  it('ENGLISH_SLURS includes retard stem (LOOP-265)', () => {
    expect(__TEST_ONLY.ENGLISH_SLURS.has('retard')).toBe(true);
  });

  it('slurs and profanity lists are disjoint', () => {
    const slurs = __TEST_ONLY.ENGLISH_SLURS;
    const profanity = __TEST_ONLY.ENGLISH_PROFANITY;
    for (const term of slurs) {
      expect(profanity.has(term)).toBe(false);
    }
  });

});

describe('filterProfanity — clean input passes through', () => {
  it('returns filtered:false for clean text in any tier + any mode', () => {
    const cleanText = 'The individuals involved have shown extraordinary resilience and courage.';
    for (const mode of ['child', 'teen'] as const) {
      for (const tier of ['slurs', 'profanity', 'both'] as const) {
        const r = filterProfanity(cleanText, mode, { tier });
        expect(r.filtered).toBe(false);
        expect(r.cleanText).toBe(cleanText);
      }
    }
  });
});

describe('filterProfanity — common-word collisions must NOT flag (over-flag guard)', () => {
  // Short or stem-matching dictionary entries collided with very common
  // benign words: bare 'cum' == Romanian "how" (one of the most frequent RO
  // words), and 'anal' stem-matched English "analysis"/"analog" and Romanian
  // "analfabet". Both were removed (the unambiguous 'cumshot' is retained).
  // Over-flagging is the PRIMARY failure per VISION — these must stay benign.
  const mustPass = [
    'cum adica fericita?',      // RO: "what do you mean happy?"
    'Pai cum altfel?!',         // RO: "well how else?!"
    'cum se face acest lucru',  // RO: "how is this done"
    'the analysis shows a trend',
    'an analog signal',
    'poporul e analfabet',      // RO: "the people are illiterate"
  ];
  for (const t of mustPass) {
    it(`passes benign: "${t}"`, () => {
      for (const tier of ['profanity', 'both'] as const) {
        expect(filterProfanity(t, 'teen', { tier }).filtered).toBe(false);
      }
    });
  }

  // Genuine vulgar terms must STILL flag — the fix removes collisions, not coverage.
  const mustFlag = ['that was a cumshot', 'watching porn all day', 'you are a slut'];
  for (const t of mustFlag) {
    it(`still flags genuine: "${t}"`, () => {
      expect(filterProfanity(t, 'teen', { tier: 'profanity' }).filtered).toBe(true);
    });
  }
});
