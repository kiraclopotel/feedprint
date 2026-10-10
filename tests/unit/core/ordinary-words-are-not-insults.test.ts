// G4 (the grow owner's row G4, from A2's standalone part). Three bare stems matched ordinary words: `simp\w*` read
// "simple", "simply", "simplify"; `woke\w*` read "woke" in "I woke up early"; `breeze` and `hyde` alone read as a vape
// advert ("a light breeze in Hyde Park"). The first two feed the harm floor's ideology stems (7 points each, to 15,
// toward the 70 that hides a post on every plan, free included) and the combined-stack classifier; the last feeds the
// drug-promotion classifier. The patterns now name the insult or the brand: simp, simps, simping, simped; woke, wokeism,
// wokeist(s), wokeness (not "woke up" or "woke me"); a vape brand only beside a vape word.
// A true insult or a vape brand still hits; nothing else changes (no weight, no threshold, no other pattern).

import { describe, it, expect } from 'vitest';
import { computeHarmFloor } from '../../../src/core/harm-floor';
import { combinedStackClassifier } from '../../../src/core/techniques/combined-stack';
import { drugPromotionClassifier } from '../../../src/core/techniques/drug-promotion';

const ideologyWeight = (text: string): number =>
  computeHarmFloor(text).signals.find((s) => s.category === 'ideology-slur')?.weight ?? 0;
const ideologyEvidence = (text: string): string =>
  computeHarmFloor(text).signals.find((s) => s.category === 'ideology-slur')?.evidence ?? '';
const groupBlame = (text: string): string[] => combinedStackClassifier.classify({ text }).evidence;
const vapeEvidence = (text: string): string[] => drugPromotionClassifier.classify({ text }).evidence;

describe('ordinary words are not insults (harm floor, ideology stems)', () => {
  const ordinary = [
    'I woke up early and made a simple breakfast',
    'She simply woke me at six, so the plan is simple enough to simplify',
    'They woke us and told him the simplest way',
    'We woke her, woke him, woke them and woke you with a simple song',
  ];
  for (const text of ordinary) {
    it(`no ideology signal on "${text}"`, () => {
      expect(ideologyWeight(text), ideologyEvidence(text)).toBe(0);
    });
  }

  const insults: Array<[string, string]> = [
    ['you are a simp', 'simp'],
    ['simping for her again', 'simping'],
    ['a room full of simps', 'simps'],
    ['he simped so hard', 'simped'],
    ['woke ideology is ruining it', 'woke'],
    ['all this wokeism', 'wokeism'],
    ['the wokeness of it', 'wokeness'],
    ['these wokeists and their rules', 'wokeists'],
    // The exception for "woke up", "woke me" ends at a word end: a word that only starts with up, me, him, her, them, us
    // or you is the word the insult is aimed at (critic 1, G4-CRITIC.md: these four fell out of the first commit).
    ['the woke media lies', 'woke'],
    ['woke men', 'woke'],
    ['woke youth', 'woke'],
    ['woke themes', 'woke'],
  ];
  for (const [text, stem] of insults) {
    it(`still counts "${text}"`, () => {
      expect(ideologyWeight(text), 'the stem is still counted').toBeGreaterThan(0);
      expect(ideologyEvidence(text).toLowerCase()).toContain(stem);
    });
  }
});

describe('ordinary words are not insults (combined-stack group-blame pattern)', () => {
  it('"I woke up early and made a simple breakfast" lists no group-blame match', () => {
    expect(groupBlame('I woke up early and made a simple breakfast').filter((e) => /woke|simp/i.test(e))).toEqual([]);
  });
  for (const text of ['you are a simp', 'simping for her', 'woke ideology', 'wokeism']) {
    it(`still lists a match for "${text}"`, () => {
      expect(groupBlame(text).filter((e) => /woke|simp/i.test(e)).length).toBeGreaterThan(0);
    });
  }
});

describe('ordinary words are not vape adverts (drug-promotion)', () => {
  it('"A light breeze in Hyde Park this morning" is not present and lists no vape match', () => {
    const text = 'A light breeze in Hyde Park this morning';
    expect(drugPromotionClassifier.classify({ text }).present).toBe(false);
    expect(vapeEvidence(text).filter((e) => /breeze|hyde/i.test(e))).toEqual([]);
  });
  for (const text of ['new Breeze Pro flavors', 'Breeze Plus is the best one', 'hyde edge drop', 'Hyde Bar flavors', 'breeze smart haul']) {
    it(`still matches the brand in "${text}"`, () => {
      expect(vapeEvidence(text).filter((e) => /breeze|hyde/i.test(e)).length).toBeGreaterThan(0);
    });
  }
  it('an elf bar or a puff bar review still matches, as before', () => {
    expect(vapeEvidence('elf bar flavors ranked').length).toBeGreaterThan(0);
    expect(vapeEvidence('puff bar review').length).toBeGreaterThan(0);
  });
});
