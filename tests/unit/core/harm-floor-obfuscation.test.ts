// FeelingWise — Harm-floor obfuscation coverage.
//
// Verifies that the harm-floor scanner now runs its keyword regex against the
// aggressively-normalized haystack (diacritics folded, leetspeak decoded) in
// addition to the conservatively-normalized one. Pre-fix, only the
// conservative form was scanned, so c0mmunist / n@zi / b!tch silently slipped
// past the gate even though the same words in plain form would have fired.
//
// Scope guard: this file checks the WIRING, not the regex coverage. Tokens
// like "kill" or "death" are NOT in harm-floor's pattern set — they live in
// src/core/techniques/self-harm.ts which already wires matchAggressive.
//
// Three obfuscation classes covered:
//   • leetspeak digit/symbol substitution (0→o, 1→i, 3→e, 4→a, @→a, !→i, $→s)
//   • combining-mark "zalgo" diacritic camouflage
//   • mixed: leet + zalgo same text
//
// Plus negative cases proving the aggressive pass doesn't trip on innocent
// digit usage (5G, H2O, iPhone 13, 911, "at 2pm").

import { describe, it, expect } from 'vitest';
import { computeHarmFloor } from '../../../src/core/harm-floor';

describe('harm-floor — leetspeak digit substitution', () => {
  it('c0mmunist matches the ideology-slur category just like communist', () => {
    const plain = computeHarmFloor('these communist globalists are at it again', []);
    const obf = computeHarmFloor('these c0mmunist gl0balists are at it again', []);
    const plainCat = plain.signals.find(s => s.category === 'ideology-slur');
    const obfCat = obf.signals.find(s => s.category === 'ideology-slur');
    expect(plainCat).toBeDefined();
    expect(obfCat).toBeDefined();
    expect(obfCat!.weight).toBeGreaterThanOrEqual(plainCat!.weight);
  });

  it('n@zi matches the ideology-slur category just like nazi', () => {
    const r = computeHarmFloor('total n@zi rhetoric in that crowd', []);
    expect(r.signals.find(s => s.category === 'ideology-slur')).toBeDefined();
  });

  it('b!tch matches the profanity category just like bitch', () => {
    const r = computeHarmFloor('what a b!tch move', []);
    expect(r.signals.find(s => s.category === 'profanity')).toBeDefined();
  });

  it('m0r0n matches the ad-hominem category just like moron', () => {
    const r = computeHarmFloor('these m0r0ns again', []);
    expect(r.signals.find(s => s.category === 'ad-hominem')).toBeDefined();
  });

  it('mixed-leet id!0t fires ad-hominem (combined substitution)', () => {
    const r = computeHarmFloor('absolute id!0t take', []);
    expect(r.signals.find(s => s.category === 'ad-hominem')).toBeDefined();
  });
});

describe('harm-floor — zalgo / diacritic camouflage', () => {
  it('c̲o̲m̲m̲u̲n̲i̲s̲t̲ (combining low line) matches ideology-slur', () => {
    // U+0332 COMBINING LOW LINE on every letter
    const zalgo = 'c̲o̲m̲m̲u̲n̲i̲s̲t̲';
    const r = computeHarmFloor(`these ${zalgo} globalists`, []);
    expect(r.signals.find(s => s.category === 'ideology-slur')).toBeDefined();
  });

  it('zalgo-stacked fascist matches ideology-slur', () => {
    // Multiple combining marks per char (U+0301 acute + U+0316 grave below)
    const zalgo = 'f̖́á̖ś̖ć̖í̖ś̖t̖́';
    const r = computeHarmFloor(`${zalgo} rhetoric`, []);
    expect(r.signals.find(s => s.category === 'ideology-slur')).toBeDefined();
  });
});

describe('harm-floor — negative cases (innocent digit usage)', () => {
  it('"5G internet" does NOT match anything (5G is not a pattern stem)', () => {
    const r = computeHarmFloor('5G internet rollout is faster than 4G', []);
    expect(r.signals.find(s => s.category === 'ideology-slur')).toBeUndefined();
    expect(r.signals.find(s => s.category === 'profanity')).toBeUndefined();
    expect(r.signals.find(s => s.category === 'ad-hominem')).toBeUndefined();
  });

  it('"H2O molecules" does NOT match anything', () => {
    const r = computeHarmFloor('H2O molecules form hydrogen bonds in liquid water', []);
    expect(r.signals.find(s => s.category === 'ideology-slur')).toBeUndefined();
    expect(r.signals.find(s => s.category === 'profanity')).toBeUndefined();
    expect(r.signals.find(s => s.category === 'ad-hominem')).toBeUndefined();
  });

  it('"iPhone 13 launch at 2pm" does NOT trip ad-hominem (idi0t-shape)', () => {
    // "iPhone 13" decodes to "iphone ie" under aggressive; no pattern matches.
    const r = computeHarmFloor('iPhone 13 launch at 2pm today', []);
    expect(r.signals.find(s => s.category === 'ad-hominem')).toBeUndefined();
    expect(r.signals.find(s => s.category === 'profanity')).toBeUndefined();
    expect(r.signals.find(s => s.category === 'ideology-slur')).toBeUndefined();
  });
});
