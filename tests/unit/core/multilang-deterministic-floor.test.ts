// FeelingWise — Spanish and Portuguese deterministic-floor unit tests
//
// Drives tests/fixtures/calibration/multilang-filters-v1.json, the two-sided corpus:
// ACCEPT cases must match, REJECT cases must not. The house rule is that a
// filter without its REJECT half cannot be told apart from an inverted one
// (darking, 2026-08-26), so a change that only adds ACCEPT cases is not a
// change that has been checked.
//
// Every REJECT case whose reason carries a number came out of
// scripts/corpus/multilang-fp-probe.ts against 441,690 Spanish and 444,028
// Portuguese sentences plus our own corpus. They are regressions with a
// measured cost, not hypotheticals.

import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  filterProfanity,
  setReaderRegion,
  parseLocale,
  type ProfanityTier,
} from '../../../src/core/profanity-filter';
import { REGIONAL_TERMS, LANGUAGE_EXCLUSIONS } from '../../../src/core/lexicon-regional';
import { detectCodedHarm } from '../../../src/core/coded-harm-catcher';
import { computeHarmFloor, HARM_FLOOR_TRIGGER_THRESHOLD } from '../../../src/core/harm-floor';
import { detect } from '../../../src/core/detector';
import { repoPath } from '../../helpers/repo-root';

interface Case {
  expect: 'match' | 'clear';
  tier: ProfanityTier;
  locale: string | null;
  term?: string;
  text: string;
  why: string;
}

interface L1Case {
  expect: 'match' | 'clear';
  technique?: string;
  text: string;
  why: string;
}

interface CodedCase {
  expect: 'match' | 'clear';
  category?: string;
  text: string;
  why: string;
}

const corpus = JSON.parse(
  readFileSync(repoPath('tests', 'fixtures', 'calibration', 'multilang-filters-v1.json'), 'utf8'),
) as { cases: Case[]; coded_cases: CodedCase[]; l1_cases: L1Case[] };

const l1Accept = corpus.l1_cases.filter(c => c.expect === 'match');
const l1Reject = corpus.l1_cases.filter(c => c.expect === 'clear');

const codedAccept = corpus.coded_cases.filter(c => c.expect === 'match');
const codedReject = corpus.coded_cases.filter(c => c.expect === 'clear');

const accept = corpus.cases.filter(c => c.expect === 'match');
const reject = corpus.cases.filter(c => c.expect === 'clear');

afterAll(() => setReaderRegion(undefined));

describe('multilang ACCEPT corpus — these must match', () => {
  it('has enough cases to be worth running', () => {
    expect(accept.length).toBeGreaterThanOrEqual(60);
  });

  for (const c of accept) {
    it(`[${c.locale ?? 'unknown'}] ${c.term}: "${c.text}"`, () => {
      setReaderRegion(c.locale);
      const r = filterProfanity(c.text, 'child', { tier: c.tier });
      expect(r.filtered, c.why).toBe(true);
      if (c.term) expect(r.matches, c.why).toContain(c.term);
    });
  }
});

describe('multilang REJECT corpus — these must not match', () => {
  it('has enough cases to be worth running', () => {
    expect(reject.length).toBeGreaterThanOrEqual(45);
  });

  for (const c of reject) {
    it(`[${c.locale ?? 'unknown'}] "${c.text}"`, () => {
      setReaderRegion(c.locale);
      const r = filterProfanity(c.text, 'child', { tier: c.tier });
      expect(r.filtered, `${c.why} — matched ${r.matches.join(', ')}`).toBe(false);
    });
  }
});

describe('region model', () => {
  it('an unknown region fires nothing region-dependent', () => {
    setReaderRegion(null);
    for (const entry of REGIONAL_TERMS) {
      const r = filterProfanity(entry.term, 'child', { tier: entry.tier });
      expect(r.matches, `${entry.term} must not fire without a region`).not.toContain(entry.term);
    }
  });

  it('a bare language yields no region, so Spain is never guessed for "es"', () => {
    expect(parseLocale('es')).toEqual({ lang: 'es' });
    expect(parseLocale('es-PE')).toEqual({ lang: 'es', region: 'PE' });
    expect(parseLocale('pt_BR')).toEqual({ lang: 'pt', region: 'BR' });
    expect(parseLocale(undefined)).toEqual({});
    // A bare language must not switch on the Spanish list: 'polla' is gated
    // to ES and 'es' alone does not say Spain.
    setReaderRegion('es');
    expect(filterProfanity('me toca la polla', 'child', { tier: 'profanity' }).filtered).toBe(false);
  });

  it('every region-dependent term fires in its own regions and nowhere else', () => {
    for (const entry of REGIONAL_TERMS) {
      for (const region of entry.offensiveIn) {
        setReaderRegion(`${entry.lang}-${region}`);
        const r = filterProfanity(entry.term, 'child', { tier: entry.tier });
        // `filtered` rather than the term string: plurals report the singular
        // they belong to (CANONICAL_TERM), and nothing else in a bare term can
        // match, so this is the same assertion without the alias noise.
        expect(r.filtered, `${entry.term} should fire in ${region}`).toBe(true);
      }
      // A region that is not in the list, in the same language.
      const outside = entry.lang === 'pt'
        ? (entry.offensiveIn.includes('PT') ? 'BR' : 'PT')
        : (entry.offensiveIn.includes('CO') ? 'ES' : 'CO');
      if (!entry.offensiveIn.includes(outside)) {
        setReaderRegion(`${entry.lang}-${outside}`);
        const r = filterProfanity(entry.term, 'child', { tier: entry.tier });
        expect(r.filtered, `${entry.term} must not fire in ${outside}`).toBe(false);
      }
    }
  });

  it('withdrawn terms stop firing for readers of that language and keep firing elsewhere', () => {
    for (const entry of LANGUAGE_EXCLUSIONS) {
      for (const lang of entry.excludedFor) {
        setReaderRegion(`${lang}-XX`);
        const r = filterProfanity(entry.term, 'child', { tier: 'both' });
        expect(r.matches, `${entry.term} must be withdrawn for ${lang}`).not.toContain(entry.term);
      }
      setReaderRegion('ro-RO');
      const kept = filterProfanity(entry.term, 'child', { tier: 'both' });
      if (!entry.excludedFor.includes('ro')) {
        expect(kept.matches, `${entry.term} must survive for other readers`).toContain(entry.term);
      }
    }
  });
});

describe('output fidelity', () => {
  it('leaves everything outside a match byte-identical, diacritics included', () => {
    setReaderRegion('es-PE');
    const r = filterProfanity('Qué mierda, mañana no voy a la reunión', 'child', { tier: 'profanity' });
    expect(r.cleanText).toBe('Qué ******, mañana no voy a la reunión');
  });

  it('masks with the same number of characters it replaced', () => {
    setReaderRegion(null);
    for (const text of ['O cão comeu a merda toda', 'Bună ziua, ce pulă mea', 'niño de mierda']) {
      const r = filterProfanity(text, 'child', { tier: 'profanity' });
      expect(r.cleanText.length, text).toBe(text.length);
    }
  });

  it('returns text unchanged when nothing matches', () => {
    setReaderRegion('pt-BR');
    const text = 'O cão comeu a maçã e o niño jogou futebol';
    expect(filterProfanity(text, 'child').cleanText).toBe(text);
  });
});

describe('coded-harm ACCEPT corpus — Spanish and Portuguese', () => {
  for (const c of codedAccept) {
    it(`${c.category}: "${c.text}"`, () => {
      const hit = detectCodedHarm(c.text);
      expect(hit, c.why).not.toBeNull();
      expect(hit?.category, c.why).toBe(c.category);
    });
  }
});

describe('coded-harm REJECT corpus — this tier hides the post', () => {
  it('has enough cases to be worth running', () => {
    expect(codedReject.length).toBeGreaterThanOrEqual(20);
  });

  for (const c of codedReject) {
    it(`"${c.text}"`, () => {
      const hit = detectCodedHarm(c.text);
      expect(hit, `${c.why} — matched ${hit?.category}/${hit?.pattern}`).toBeNull();
    });
  }
});

describe('harm floor, Spanish and Portuguese density signals', () => {
  it('counts Spanish and Portuguese profanity and insults it used to ignore', () => {
    const before = computeHarmFloor('hoje eu fui ao mercado comprar pao para o jantar', []);
    expect(before.score).toBe(0);
    const after = computeHarmFloor('seu babaca de merda, otario, escroto, seu tarado', []);
    expect(after.score).toBeGreaterThan(0);
  });

  it('does not push ordinary Spanish or Portuguese over the trigger threshold', () => {
    // The whole 886k-sentence benign corpus scores 0 over the threshold; these
    // stand in for it in the suite. Categories A and B cap at 20 and 15, so
    // Spanish or Portuguese text alone can reach 35 at most: the floor is only
    // reachable in combination with an identity-slur hit, which is the point.
    for (const text of [
      'la carretera se curva y el paisaje es precioso a esta hora',
      'o time de futebol jogou muito bem no segundo tempo do jogo',
      'eres un estupido de mierda, un tarado, callate ya cabron',
      'seu babaca de merda, otario, escroto, vai tomar no caralho',
    ]) {
      expect(computeHarmFloor(text, []).score, text).toBeLessThan(HARM_FLOOR_TRIGGER_THRESHOLD);
    }
  });
});

describe('L1 cascade ACCEPT corpus — Spanish and Portuguese', () => {
  for (const c of l1Accept) {
    it(`${c.technique}: "${c.text}"`, () => {
      const hit = detect(c.text).find(r => r.technique === c.technique);
      expect(hit, `${c.technique} missing from the cascade output`).toBeDefined();
      expect(hit?.present, c.why).toBe(true);
    });
  }
});

describe('L1 cascade REJECT corpus — ordinary text stays unflagged', () => {
  it('has enough cases to be worth running', () => {
    expect(l1Reject.length).toBeGreaterThanOrEqual(20);
  });

  for (const c of l1Reject) {
    it(`"${c.text}"`, () => {
      const present = detect(c.text).filter(r => r.present);
      expect(present.map(p => p.technique), c.why).toEqual([]);
    });
  }
});

describe('L1 cascade, Spanish reaches parity with English', () => {
  // The point of the exercise. Before this, every harm-category classifier
  // returned present=false for Spanish and Portuguese whatever the text said,
  // so harm-floor category F (worth up to 35) contributed nothing and the
  // deterministic layer had no opinion at all about a Spanish self-harm post.
  const equivalent: Array<[string, string]> = [
    ['self-harm', 'matate ya, nadie te va a extranar, eres una mierda'],
    ['self-harm', 'se mate logo, ninguem vai sentir sua falta, seu merda'],
    ['violence-graphic', 'te voy a matar, te encuentro y te mato'],
    ['violence-graphic', 'vou te matar, te acho e te mato'],
  ];
  for (const [technique, text] of equivalent) {
    it(`${technique} fires and feeds the floor: "${text.slice(0, 34)}"`, () => {
      const results = detect(text);
      const hit = results.find(r => r.technique === technique);
      expect(hit?.present).toBe(true);
      // Category F credits a present harm category by severity; the floor
      // score must therefore be strictly higher with the cascade than without.
      const withCascade = computeHarmFloor(text, results).score;
      const without = computeHarmFloor(text, []).score;
      expect(withCascade).toBeGreaterThan(without);
    });
  }

  it('an English post and its Spanish equivalent score within 10 of each other', () => {
    const en = 'KILL YOURSELF you stupid fucking retard, nobody would miss you, everyone hates you idiot';
    const es = 'MATATE ya puto estupido de mierda, nadie te va a extranar, todos te odian idiota cabron';
    const score = (t: string) => computeHarmFloor(t, detect(t)).score;
    expect(Math.abs(score(en) - score(es))).toBeLessThanOrEqual(10);
  });
});
