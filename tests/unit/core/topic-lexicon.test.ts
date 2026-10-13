// The topic matcher (src/core/policy/topic-lexicon.ts) and the list it carries (src/core/topic-lists/gambling-v1.json).
//
// Two sides, both pinned. The `matches` sentences of tests/fixtures/calibration/topics-v1.json must be found and the
// `clean` ones must not: the clean side is where a hide wrongly takes a person's post, so it holds the near misses
// (better/bet, scraps/craps, bookmarked/bookie) and the ordinary English other languages' lists would catch. The shipped
// module must equal what the written lists say, minus any entry the list writer marked high risk and any listed in
// measured-drops.json. These are written sentences; how often the list collides with real posts is the U3 count.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { activeTopics, matchTopics } from '../../../src/core/policy/topic-lexicon';
import { repoPath } from '../../helpers/repo-root';

interface Sentence { lang: string; text: string }
const DROPS = (JSON.parse(readFileSync(repoPath('tests', 'fixtures', 'topic-lists', 'measured-drops.json'), 'utf8')) as { drops: Record<string, Record<string, string>> }).drops;
const fixture = JSON.parse(readFileSync(repoPath('tests', 'fixtures', 'calibration', 'topics-v1.json'), 'utf8')) as {
  matches: Sentence[];
  clean: Sentence[];
};
const GAMBLING_V1 = JSON.parse(readFileSync(repoPath('src', 'core', 'topic-lists', 'gambling-v1.json'), 'utf8')) as Record<'en' | 'ro' | 'es' | 'pt-BR', Array<[string, string, boolean]>>;
const ON = ['gambling'] as const;

describe('the written sentences', () => {
  for (const s of fixture.matches) {
    it(`finds [${s.lang}] ${s.text}`, () => {
      expect(matchTopics(ON, s.text)?.topic).toBe('gambling');
    });
  }
  for (const s of fixture.clean) {
    it(`leaves [${s.lang}] ${s.text || '(empty)'}`, () => {
      expect(matchTopics(ON, s.text)).toBeNull();
    });
  }
  it('covers all four languages on both sides', () => {
    for (const side of [fixture.matches, fixture.clean]) {
      expect([...new Set(side.map((s) => s.lang))].sort()).toEqual(['en', 'es', 'pt-BR', 'ro']);
    }
  });
});

describe('the shipped list is the written list', () => {
  const LANGS = [['en', 'en'], ['ro', 'ro'], ['es', 'es'], ['pt-br', 'pt-BR']] as const;
  for (const [file, key] of LANGS) {
    it(`${key}: every written term ships except a high-risk one and a measured collision, in order`, () => {
      const written = JSON.parse(readFileSync(repoPath('tests', 'fixtures', 'topic-lists', `gambling-v1.${file}.json`), 'utf8')) as {
        entries: Array<{ term: string; kind: string; exact: boolean; risk: string }>;
      };
      const dropped = DROPS[file] ?? {};
      const expected = written.entries.filter((e) => e.risk !== 'high' && !(e.term in dropped)).map((e) => [e.term, e.kind, e.exact === true]);
      expect(GAMBLING_V1[key].map((t) => [...t])).toEqual(expected);
    });
  }
  it('a term left out by measure or by the name guard is not shipped, and says why', () => {
    const lists: Record<string, keyof typeof GAMBLING_V1> = { en: 'en', ro: 'ro', es: 'es', 'pt-br': 'pt-BR' };
    for (const [file, terms] of Object.entries(DROPS)) {
      for (const [term, why] of Object.entries(terms)) {
        expect(why.length, `${file} ${term} carries its reason`).toBeGreaterThan(20);
        expect(GAMBLING_V1[lists[file]].some((x) => x[0] === term), `${file} ${term} is not shipped`).toBe(false);
      }
    }
  });

  it('has no high-risk term on its pages: a common word that is also a brand never ships', () => {
    const shipped = new Set(Object.values(GAMBLING_V1).flat().map((t) => t[0]));
    expect(shipped.has('blaze')).toBe(false);
  });
  it('every term is folded lower-case letters and digits', () => {
    for (const list of Object.values(GAMBLING_V1)) {
      for (const [term] of list) expect(term).toMatch(/^[a-z0-9]+( [a-z0-9]+)*$/);
    }
  });
});

describe('how a term is matched', () => {
  const hit = (text: string) => matchTopics(ON, text);

  it('never as a raw substring', () => {
    expect(hit('the better betting of a bettor')?.term).toBe('bettor');
    expect(hit('better and bettered and bet-ter')).toBeNull();
    expect(hit('scraps and scrapes')).toBeNull();
  });

  it('a word marked exact matches only the whole word', () => {
    expect(hit('craps tonight')?.term).toBe('craps');
    expect(hit('crapsy scrap')).toBeNull();
    expect(hit('a bwin ad')?.term).toBe('bwin');
    expect(hit('bwinning')).toBeNull();
  });

  it('a word not marked exact reaches its endings', () => {
    expect(hit('two gamblers and a casino')?.term).toBe('casino');
    expect(hit('the gamblers')?.term).toBe('gambler');
    expect(hit('my sportsbooks')?.term).toBe('sportsbook');
    // The doubled s collapses, so pt-BR cassino is reached through casino (the same stem, one letter written twice).
    expect(hit('o cassino abriu')?.topic).toBe('gambling');
  });

  it('diacritics and capitals do not matter, on either side', () => {
    expect(hit('RASCA Y GANA')?.term).toBe('rasca y gana');
    expect(hit('Câștigă la PACANELE')?.term).toBe('pacanele');
    expect(hit('bônus sem depósito')?.term).toBe('bonus sem deposito');
  });

  it('a phrase matches whole tokens only', () => {
    expect(hit('place your bets now')?.kind).toBe('phrase');
    expect(hit('free bets')?.term).toBe('free bets');
    expect(hit('a freebetter')).toBeNull();
  });

  it('a brand matches as one token or as its written phrase', () => {
    expect(hit('open the bet365 app')).toMatchObject({ term: 'bet365', kind: 'brand' });
    expect(hit('William Hill odds')).toMatchObject({ term: 'william hill', kind: 'brand' });
  });

  it('reads the card around a post, and says where it found the word', () => {
    expect(matchTopics(ON, 'a kind message', { text: 'the quoted post is about a casino' })).toMatchObject({ scope: 'card', term: 'casino' });
    expect(matchTopics(ON, 'the casino', { text: 'nothing here' })).toMatchObject({ scope: 'own' });
    expect(matchTopics(ON, 'a kind message', { text: 'a walk by the river' })).toBeNull();
  });
});

describe('words that are ordinary English', () => {
  it('are not applied to a post that reads as English', () => {
    // pt-BR and es carry these as gambling words; in an English sentence they are everyday ones.
    expect(matchTopics(ON, 'I bet the weather is nice today')).toBeNull();
    expect(matchTopics(ON, 'We beat the odds and hit the jackpot')).toBeNull();
    expect(matchTopics(ON, 'She wore aviator glasses to the show')).toBeNull();
  });

  it('are applied to a post that does not', () => {
    expect(matchTopics(ON, 'o jackpot de hoje está alto')?.term).toBe('jackpot');
    expect(matchTopics(ON, 'el jackpot de la ruleta')?.topic).toBe('gambling');
  });

  it('the bare word "bet", English slang in the owner\'s record, is not a gambling word on its own', () => {
    for (const text of ['I bet it works', 'Bet.', 'bet', 'bets are off', 'a bet liberou o saque pelo pix']) {
      expect(matchTopics(ON, text), text).toBeNull();
    }
    expect(matchTopics(ON, 'a casa de apostas liberou o saque pelo pix')?.topic).toBe('gambling');
    expect(matchTopics(ON, 'a bet365 liberou o saque pelo pix')?.term).toBe('bet365');
  });

  it('still find the English list and every brand name inside an English sentence', () => {
    expect(matchTopics(ON, 'the new casino is open for you')?.term).toBe('casino');
    expect(matchTopics(ON, 'you can try betano or superbet with this code')?.kind).toBe('brand');
    expect(matchTopics(ON, 'the best one is betnacional and it is free')?.term).toBe('betnacional');
  });
});

describe('what switches it on', () => {
  it('reads the topic switch off the stored features, and only a true "enabled"', () => {
    expect(activeTopics({ 'topic-gambling': { enabled: true } })).toEqual(['gambling']);
    expect(activeTopics({ 'topic-gambling': { enabled: false } })).toEqual([]);
    expect(activeTopics({ 'topic-gambling': { enabled: 'yes' } })).toEqual([]);
    expect(activeTopics({ 'parent-blocklist': { enabled: true } })).toEqual([]);
    expect(activeTopics({})).toEqual([]);
    expect(activeTopics(undefined)).toEqual([]);
    expect(activeTopics(null)).toEqual([]);
  });

  it('no topic switched on: nothing matches, whatever the text says', () => {
    expect(matchTopics([], 'bet365 casino blackjack gambling')).toBeNull();
  });
});

describe('what it costs', () => {
  it('a long post with no listed word is read in well under a tenth of a second', () => {
    const post = Array.from({ length: 600 }, (_, i) => `word${i % 40} ordinary sentence about the weather`).join(' ');
    matchTopics(ON, 'warm up the index');
    const started = performance.now();
    for (let i = 0; i < 10; i++) matchTopics(ON, post);
    expect((performance.now() - started) / 10).toBeLessThan(100);
  });
});
