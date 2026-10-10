// Harm-laundering guard — fires when a violent original is rewritten into a
// calm version that drops the violence (the 8b's worst failure, measured on
// a 2026-06-04 chain). Cases below are REAL original->shipped-rewrite
// pairs from that chain.

import { describe, it, expect } from 'vitest';
import { detectHarmLaundering, hasViolentHarm } from '../../../src/core/harm-laundering';

describe('detectHarmLaundering — real laundered pairs from the chain', () => {
  const laundered: [string, string][] = [
    ['This is wickedness Vickrum and you deserve death by hanging.', 'I think Vickrum deserves justice for his crime.'],
    ['It is only shame that the house is still not burned down with the so called "zoo residents" inside', 'I think the house should be held accountable for its actions.'],
    ['Stab someone in Waterford Ireland, get bail, brag, stab someone else in Dublin, murder them, flee', "I don't think Ireland is a good place."],
    ['Some random migrant stabbed that kid, the government finished him off, and then lied about it.', 'I think the government should be held accountable for its actions.'],
    ['Sa le moara toate neamurile la jegurile de perciunati care omor oameni nevinovati', 'Sunt nemultumit de acest grup.'],
  ];

  it('flags every laundered violent->calm pair', () => {
    for (const [orig, rw] of laundered) {
      expect(detectHarmLaundering(orig, rw)).toBe(true);
    }
  });
});

describe('detectHarmLaundering — must NOT over-fire', () => {
  it('does not fire when the original has no violence', () => {
    expect(detectHarmLaundering('You are such a clueless idiot, nobody agrees with you', 'I disagree with your point.')).toBe(false);
  });

  it('does not fire when the rewrite faithfully keeps the violence', () => {
    // a faithful rewrite is rejected by OTHER guards, not this one
    expect(detectHarmLaundering('kill them all', 'They are calling to kill people.')).toBe(false);
  });

  it('hasViolentHarm detects lethal language, ignores benign text', () => {
    expect(hasViolentHarm('you deserve death by hanging')).toBe(true);
    expect(hasViolentHarm('the migrant stabbed that kid')).toBe(true);
    expect(hasViolentHarm('I had a great day at the park')).toBe(false);
    expect(hasViolentHarm('this product is amazing, love it')).toBe(false);
  });

  // Word-boundary + tightened-token regression (pre-ship review found the
  // unboundaried regex matched INSIDE ordinary words and on figurative speech).
  it('does NOT match lethal substrings inside ordinary words', () => {
    for (const t of ['candied apples', 'gasoline prices', 'a great hangout', 'I studied hard', 'foodie heaven', 'diehard fan', 'methodology', 'methane levels', 'cracked screen', 'in the cockpit']) {
      expect(hasViolentHarm(t)).toBe(false);
    }
  });

  it('does NOT match figurative non-lethal phrasings', () => {
    for (const t of ["I'm dead 😂", 'dead serious', 'you shot down my idea', 'hang out with us', 'drop dead gorgeous']) {
      expect(hasViolentHarm(t)).toBe(false);
    }
  });
});
