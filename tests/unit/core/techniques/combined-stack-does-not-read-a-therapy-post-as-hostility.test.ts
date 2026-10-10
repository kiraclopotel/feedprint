/** @vitest-environment node */
//
// Two lexicons for one question, and the measurement that closed the first was
// never applied to the second.
//
// The dictionary sweep of 2026-09-17 measured where the open ad-hominem stems
// reach and closed them in src/core/harm-floor.ts, naming the collisions in its
// own comment: 'psychological', 'psychology' and 'psychotherapy', the words a
// person uses to talk about getting help, behind `psycho\w*`; 'prostata' behind
// the Romanian `prost\w*`. combined-stack.ts kept a private copy of the same
// list, open, and shipped it.
//
// Measured on the shipped classifier before the fix, four ordinary sentences
// out of six fired as combined-stack at severity 4, including "my psychologist
// referred me for psychotherapy" and "he had a prostate scan and the prostatic
// reading came back clear". combined-stack renders on the dashboard as "lots of
// hostility" and the harm floor scores it +14, so a person writing about
// starting therapy had that written into their own forensic record, by a
// deterministic gate, with no model involved and nothing to appeal to.
//
// The file also defended the open stems with a claim that was false inside its
// own file: "a single collision cannot fire", because the obfuscated pass
// re-ran the SAME patterns at weight 1.0 and one category reached exactly the
// threshold alone. Both halves are fixed: the lexicon is imported rather than
// restated, and the re-run is weighted so the invariant the comments state is
// the invariant the arithmetic has.
//
// Two sides on purpose. A filter with only a REJECT corpus gets quieter every
// time somebody touches it, and a filter with only an ACCEPT corpus gets louder.
// (2026-09-18)

import { describe, it, expect } from 'vitest';
import { combinedStackClassifier } from '../../../../src/core/techniques/combined-stack';

/** Ordinary sentences a person writes. None of these is hostility. */
const MUST_STAY_QUIET: [string, string][] = [
  ['therapy, three collisions in one line',
   'i finally started psychotherapy and my psychologist says the psychological work is the hard part'],
  ['therapy, the plainest possible sentence',
   'my psychologist referred me for psychotherapy'],
  ['psychology as a subject',
   'psychology and psychotherapy are not the same thing'],
  ['a prostate scan, which the Romanian insult stem reached',
   'he had a prostate scan and the prostatic reading came back clear'],
  ['a cone, which the Spanish stem reached',
   'the traffic cone fell over and another cono rolled into the road'],
  ['colloquial praise that happens to use two of the tokens',
   'that concert was insane, absolutely deranged in the best way'],
  ['one category alone, which this technique is documented not to fire on',
   'you are a moron and an idiot, a complete loser'],
];

/** Stacked intensity across categories, which is what this technique is for. */
const MUST_FIRE: [string, string][] = [
  ['the canonical acceptance post',
   'NO FUCKING WAY!!!! SYNTHETIC TARGET IS AN ABSOLUTE COMMUNIST PSYCHOTIC IDIOT; THIS IS BULLSHIT WE ARE WATCHING'],
  ['profanity and insults together, without the shouting',
   'this absolute fucking moron is a cretin and the whole thing is bullshit'],
];

describe('combined-stack does not read a therapy post as hostility', () => {
  describe('stays quiet', () => {
    for (const [why, text] of MUST_STAY_QUIET) {
      it(why, () => {
        const r = combinedStackClassifier.classify({ text });
        expect(r.present, `fired on: ${text}`).toBe(false);
      });
    }
  });

  // The other side. A fix that made the classifier quieter everywhere would
  // pass every case above and be worthless.
  describe('still fires', () => {
    for (const [why, text] of MUST_FIRE) {
      it(why, () => {
        const r = combinedStackClassifier.classify({ text });
        expect(r.present, `went quiet on: ${text}`).toBe(true);
      });
    }
  });

  it('carries no evidence at all on the therapy sentences, not merely a low score', () => {
    for (const [, text] of MUST_STAY_QUIET.slice(0, 4)) {
      const r = combinedStackClassifier.classify({ text });
      expect(r.evidence, `matched something in: ${text}`).toEqual([]);
    }
  });

  // The arithmetic the file's own comments promise: one category cannot reach
  // the threshold on its own. Held as a property rather than a sentence,
  // because the sentence was there and was false for a year.
  it('needs two categories, which is what the comments have always said', () => {
    const oneCategory = 'moron idiot cretin loser imbecile';
    const twoCategories = 'moron idiot cretin, this is fucking bullshit';
    expect(combinedStackClassifier.classify({ text: oneCategory }).present).toBe(false);
    expect(combinedStackClassifier.classify({ text: twoCategories }).present).toBe(true);
  });
});
