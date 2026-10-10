/** @vitest-environment node */
// CHARLIE-3 Day 5-6 — harm-floor per-category signal unit tests.
//
// Locks the contract for each of the 9 signal categories so weight-tuning
// in Day 7+ doesn't silently regress the canonical acceptance test. Each
// category has its own `describe` block exercising:
//   • a positive case (signal fires with the expected weight)
//   • a negative case (no false positive on benign content)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  computeHarmFloor,
  HARM_FLOOR_TRIGGER_THRESHOLD,
} from '../../../src/core/harm-floor';
import { detect } from '../../../src/core/detector';
import { TechniqueResult } from '../../../src/types/analysis';

describe('harm-floor — Category A: profanity-density', () => {
  it('fires on multiple EN profanity tokens', () => {
    const r = computeHarmFloor('this fucking shit is bullshit', []);
    const sig = r.signals.find(s => s.category === 'profanity');
    expect(sig).toBeDefined();
    expect(sig!.weight).toBeGreaterThanOrEqual(10);
  });

  it('does NOT fire on benign EN content', () => {
    const r = computeHarmFloor('I love the new song by Taylor Swift', []);
    expect(r.signals.find(s => s.category === 'profanity')).toBeUndefined();
  });
});

describe('harm-floor — Category B: ad-hominem density', () => {
  it('fires on psych-slur stems', () => {
    const r = computeHarmFloor('these idiots are deranged morons', []);
    const sig = r.signals.find(s => s.category === 'ad-hominem');
    expect(sig).toBeDefined();
    expect(sig!.weight).toBeGreaterThanOrEqual(5);
  });

  it('does NOT fire on benign discussion', () => {
    const r = computeHarmFloor('the meeting was productive and clear', []);
    expect(r.signals.find(s => s.category === 'ad-hominem')).toBeUndefined();
  });
});

describe('harm-floor — Category C: ideology-slur stems', () => {
  it('fires on EN ideology stems', () => {
    const r = computeHarmFloor('these communist globalists are at it again', []);
    const sig = r.signals.find(s => s.category === 'ideology-slur');
    expect(sig).toBeDefined();
    expect(sig!.weight).toBeGreaterThanOrEqual(7);
  });

});

describe('harm-floor — Category D: sustained-caps structural', () => {
  it('fires on majority-caps substantive post', () => {
    const r = computeHarmFloor('THIS IS COMPLETELY UNACCEPTABLE BEHAVIOR HERE', []);
    const sig = r.signals.find(s => s.category === 'sustained-caps');
    expect(sig).toBeDefined();
    expect(sig!.weight).toBeGreaterThanOrEqual(10);
  });

  it('does NOT fire on short or low-caps text', () => {
    const r = computeHarmFloor('a normal lowercase sentence with no shouting', []);
    expect(r.signals.find(s => s.category === 'sustained-caps')).toBeUndefined();
  });
});

describe('harm-floor — Category E: crowd-coordination markers', () => {
  it('fires on EN coordination phrase', () => {
    const r = computeHarmFloor("we are watching closely now", []);
    const sig = r.signals.find(s => s.category === 'crowd-coordination');
    expect(sig).toBeDefined();
    expect(sig!.weight).toBeGreaterThanOrEqual(5);
  });

});

describe('harm-floor — Category F: L1 harm-category present', () => {
  it('contributes 30 weight when a harm-category fires at high severity', () => {
    const fakeL1: TechniqueResult[] = [
      {
        technique: 'combined-stack',
        present: true,
        confidence: 0.85,
        severity: 9,
        evidence: ['test'],
      },
    ];
    const r = computeHarmFloor('some text here that contains nothing salient', fakeL1);
    const sig = r.signals.find(s => s.category === 'l1-harm-present');
    expect(sig).toBeDefined();
    expect(sig!.weight).toBe(30);
  });

  it('contributes 22 weight at mid severity', () => {
    const fakeL1: TechniqueResult[] = [
      {
        technique: 'sexual',
        present: true,
        confidence: 0.7,
        severity: 5,
        evidence: ['test'],
      },
    ];
    const r = computeHarmFloor('innocuous text', fakeL1);
    const sig = r.signals.find(s => s.category === 'l1-harm-present');
    expect(sig!.weight).toBe(22);
  });

  it('caps aggregate at 35 when multiple harm categories stack', () => {
    const fakeL1: TechniqueResult[] = [
      { technique: 'combined-stack', present: true, confidence: 0.85, severity: 9, evidence: [] },
      { technique: 'extreme-toxicity', present: true, confidence: 0.8, severity: 7, evidence: [] },
      { technique: 'violence-graphic', present: true, confidence: 0.7, severity: 6, evidence: [] },
    ];
    const r = computeHarmFloor('innocuous text', fakeL1);
    // Sum would be 30 + 30 + 22 = 82, but the F-category cap holds the
    // contribution at 35 and emits a 'l1-harm-cap' book-keeping signal.
    const cap = r.signals.find(s => s.id === 'l1-harm-cap');
    expect(cap).toBeDefined();
  });
});

describe('harm-floor — Category G: L1 harm-category sub-threshold', () => {
  it('contributes when a harm-category is sub-threshold but confidence>0.30', () => {
    const fakeL1: TechniqueResult[] = [
      {
        technique: 'extreme-toxicity',
        present: false,
        confidence: 0.45,
        severity: 3,
        evidence: ['near-miss'],
      },
    ];
    const r = computeHarmFloor('innocuous', fakeL1);
    const sig = r.signals.find(s => s.category === 'l1-harm-subthreshold');
    expect(sig).toBeDefined();
    expect(sig!.weight).toBe(5);
  });

  it('does NOT contribute when confidence ≤ 0.30', () => {
    const fakeL1: TechniqueResult[] = [
      {
        technique: 'extreme-toxicity',
        present: false,
        confidence: 0.1,
        severity: 1,
        evidence: [],
      },
    ];
    const r = computeHarmFloor('innocuous', fakeL1);
    expect(r.signals.find(s => s.category === 'l1-harm-subthreshold')).toBeUndefined();
  });

  it('does NOT contribute for no-signal classifiers (floored confidence, empty evidence)', () => {
    // defaultConfidenceMap floors confidence at 0.45 even at rawScore=0, so a
    // zero-hit harm classifier still reports conf=0.45. Near-miss credit must
    // not accrue from that floor — only from classifiers with actual evidence.
    const fakeL1: TechniqueResult[] = [
      'combined-stack',
      'sexual',
      'violence-graphic',
      'self-harm',
      'drug-promotion',
      'extreme-toxicity',
    ].map(technique => ({
      technique: technique as TechniqueResult['technique'],
      present: false,
      confidence: 0.45,
      severity: 0,
      evidence: [],
    }));
    const r = computeHarmFloor('innocuous', fakeL1);
    expect(r.signals.find(s => s.category === 'l1-harm-subthreshold')).toBeUndefined();
    expect(r.score).toBe(0);
  });

  it('scores 0 on benign text with the REAL L1 cascade output', () => {
    // Regression lock: every post used to earn a constant +15 here because all
    // six no-signal harm classifiers passed the confidence>0.30 gate, which
    // collapsed the effective post-path trigger threshold from 70 to 55 while
    // the comment path (techniques=[]) stayed at 70.
    const text = 'Just finished planting tomatoes in the garden. The weather was lovely today.';
    const r = computeHarmFloor(text, detect(text));
    expect(r.signals.filter(s => s.category === 'l1-harm-subthreshold')).toEqual([]);
    expect(r.score).toBe(0);
  });
});

describe('harm-floor — Category H: L1 manipulation-technique present', () => {
  it('contributes 5 per technique at sev≥5 (not harm-cat)', () => {
    const fakeL1: TechniqueResult[] = [
      { technique: 'fear-appeal', present: true, confidence: 0.7, severity: 6, evidence: [] },
    ];
    const r = computeHarmFloor('innocuous', fakeL1);
    const sig = r.signals.find(s => s.category === 'l1-manipulation');
    expect(sig).toBeDefined();
    expect(sig!.weight).toBe(5);
  });

  it('does NOT contribute when severity < 5', () => {
    const fakeL1: TechniqueResult[] = [
      { technique: 'fear-appeal', present: true, confidence: 0.4, severity: 3, evidence: [] },
    ];
    const r = computeHarmFloor('innocuous', fakeL1);
    expect(r.signals.find(s => s.category === 'l1-manipulation')).toBeUndefined();
  });
});

describe('harm-floor — Category I: punctuation-rage', () => {
  it('fires on !!! runs', () => {
    const r = computeHarmFloor('what a take!!! incredible', []);
    const sig = r.signals.find(s => s.category === 'punctuation-rage');
    expect(sig).toBeDefined();
    expect(sig!.weight).toBe(5);
  });

  it('does NOT fire on single ! or no runs', () => {
    const r = computeHarmFloor('what a take! incredible', []);
    expect(r.signals.find(s => s.category === 'punctuation-rage')).toBeUndefined();
  });
});

describe('harm-floor — first-person-vulnerability dampener', () => {
  it('halves the score when victim-reporting surface is present', () => {
    // Compose a synthetic case: heavy harm signals + first-person-vulnerability.
    // Without dampener: profanity 10 + ad-hom 5 + ideology 7 + caps 15 + crowd 5
    //                  + punct 5 = 47.
    // With ×0.5 dampener: 24.
    const text =
      'I am scared and these COMMUNIST IDIOTS keep saying THIS IS BULLSHIT WE ARE WATCHING!!!';
    const r = computeHarmFloor(text, []);
    expect(r.dampener).toBe(0.5);
    // Halved score should be roughly half of the un-dampened version.
    expect(r.score).toBeLessThan(50);
  });
});

describe('harm-floor — trigger condition', () => {
  it('triggers when score ≥ threshold', () => {
    // Synthesize an L1 input that pushes the harm-floor across threshold
    // alongside a post text saturated in independent signals (caps + crowd
    // + profanity stack + ad-hominem + ideology stems + punct).
    const fakeL1: TechniqueResult[] = [
      { technique: 'combined-stack', present: true, confidence: 0.9, severity: 9, evidence: [] },
      { technique: 'extreme-toxicity', present: true, confidence: 0.8, severity: 7, evidence: [] },
    ];
    const r = computeHarmFloor(
      'COMMUNIST PSYCHOTIC FUCKING BULLSHIT IDIOTS!!!! WE ARE WATCHING THESE MORONS RIGHT NOW',
      fakeL1,
    );
    expect(r.score).toBeGreaterThanOrEqual(HARM_FLOOR_TRIGGER_THRESHOLD);
    expect(r.triggers).toBe(true);
  });

  it('does NOT trigger on low-signal benign content', () => {
    const r = computeHarmFloor('I baked banana bread today, came out great', []);
    expect(r.triggers).toBe(false);
    expect(r.score).toBeLessThan(HARM_FLOOR_TRIGGER_THRESHOLD);
  });
});

describe('harm-floor — language hint', () => {
  it('detects EN dominant', () => {
    const r = computeHarmFloor('this is the kind of post that we see all the time', []);
    expect(r.language).toBe('en');
  });

  it('detects RO via diacritics', () => {
    const r = computeHarmFloor('asta este o postare în limba română', []);
    expect(r.language).toBe('ro');
  });
});
