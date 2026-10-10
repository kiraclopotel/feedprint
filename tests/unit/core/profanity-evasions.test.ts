// The "no swearing" tier against typed evasions (owner's second live test,
// 2026-09-03: "dafuq" and "Screw that whole family" slipped; "screw" stays an
// ordinary word). Every new form is checked against the 57k real-post corpus
// by scripts/corpus/profanity-fp-probe.ts before it lands here.

import { describe, expect, it } from 'vitest';
import { filterProfanity } from '../../../src/core/profanity-filter';

function stars(text: string): string {
  return filterProfanity(text, 'child', { tier: 'profanity' }).cleanText;
}

describe('profanity tier: typed evasions and phonetic spellings', () => {
  const caught: [string, string][] = [
    ['dafuq is this', '***** is this'],
    ['fkn hell', '*** hell'],
    ['this is fking wild', 'this is ***** wild'],
    ['fck this', '*** this'],
    ['fcking nonsense', '****** nonsense'],
    ['fuk off', '*** off'],
    ['effing great', '****** great'],
    ['wtf happened', '*** happened'],
    ['stfu already', '**** already'],
    ['what a mofo', 'what a ****'],
    ['a$$ and sh1t', '*** and ****'],
    ['a total dumbfuck', 'a total ********'],
    ['batshit take', '******* take'],
    ['you asshat', 'you ******'],
    ['pure horseshit', 'pure *********'],
  ];
  for (const [text, expected] of caught) {
    it(`stars "${text}"`, () => {
      expect(stars(text)).toBe(expected);
    });
  }

  it('reads # and - as hand-typed masks: "f-ck", "sh#t", "f*cking"', () => {
    expect(stars('f-ck that')).toBe('**** that');
    expect(stars('sh#t happens')).toBe('**** happens');
    expect(stars('so f*cking tired')).toBe('so ******* tired');
    expect(stars('motherf*cker')).toBe('************');
  });

  const benign = [
    'Screw that whole family',
    'screw the lid on tight',
    'I write F# at work',
    'she got an F- on the test',
    'the S-T segment on the ECG',
    'Phuket in the rainy season',
    'Effingham county fair',
    'our co-op sells e-mail lists',
    'MF DOOM was the best',
    'a BS in chemistry',
    'frickin cold today',
    'a five-star, well-known place',
  ];
  for (const text of benign) {
    it(`leaves "${text}" alone`, () => {
      const r = filterProfanity(text, 'child', { tier: 'profanity' });
      expect(r.filtered, `matched ${r.matches.join(',')}`).toBe(false);
      expect(r.cleanText).toBe(text);
    });
  }
});
