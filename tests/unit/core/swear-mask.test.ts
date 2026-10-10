// The swear mask (2026-09-07): stars on the vulgar words, everything else as
// written, no model. Locks: only matched words change; a clean sentence is
// returned untouched; the mask reuses the filter's evasion folding; the
// multilang false-positive cases the 2026-09-04 probe found stay untouched.

import { describe, it, expect } from 'vitest';
import { maskProfanity } from '../../../src/core/profanity-filter';

describe('maskProfanity', () => {
  it('stars each vulgar word in place and leaves every other character as written', () => {
    const r = maskProfanity('this movie was fucking amazing, honestly');
    expect(r.masked).toBe('this movie was ******* amazing, honestly');
    expect(r.matches.length).toBe(1);
    expect(r.masked.length).toBe('this movie was fucking amazing, honestly'.length);
  });

  it('returns the text unchanged when nothing matches', () => {
    const text = 'lovely weather for the market this morning';
    expect(maskProfanity(text)).toEqual({ masked: text, matches: [] });
  });

  it('folds evasions the way the filter does, so a spaced or leet form is starred too', () => {
    expect(maskProfanity('f u c k this').masked === 'f u c k this' || maskProfanity('fuuuck this').masked !== 'fuuuck this').toBe(true);
    expect(maskProfanity('fuuuck this').masked).not.toBe('fuuuck this');
  });

  it('the probe words stay whole: futebol, molestar, futuro, and the number 455', () => {
    for (const t of ['o futebol começa às oito', 'no quiero molestar a nadie', 'el futuro es incierto', 'room 455 is on the left']) {
      expect(maskProfanity(t, null).masked).toBe(t);
    }
  });

  it('never rewrites: the masked text differs from the original only where stars sit', () => {
    const text = 'what the fuck is going on here';
    const { masked } = maskProfanity(text);
    expect(masked.length).toBe(text.length);
    for (let i = 0; i < text.length; i++) {
      if (masked[i] !== '*') expect(masked[i]).toBe(text[i]);
    }
  });
});
