// FeelingWise — the word filter against run-together, leet and diacritic forms
//
// PLAN-2026-09-14 item 5 and standing decision 5. The owner saw
// "dickheadmotherfucker" pass in the wild on 14 Sep; this suite is the two-
// sided proof that the class is closed and that closing it did not hand back
// any of the false positives the corpus probe bought with 886,000 sentences.
//
// The cases are data: tests/fixtures/calibration/run-together-v1.json. Add a word there
// and it is checked on the next run with no code change.
//
// The suite also pins the three things that make the method safe rather than
// lucky — complete segmentation, at least one listed term, and a suffix list
// with no Spanish or Portuguese ending in it — and the timing budget, because
// this code runs on every post and every comment before first paint.

import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoPath } from '../../helpers/repo-root';
import {
  filterProfanity,
  setReaderRegion,
  type ProfanityTier,
} from '../../../src/core/profanity-filter';

interface Case {
  text: string;
  term?: string;
  tier?: ProfanityTier;
  /** Overrides the language's reader locale for this one case. */
  locale?: string | null;
  why: string;
}

interface Language {
  label: string;
  locale: string | null;
  mustMatch: Case[];
  mustNotMatch: Case[];
}

const fixture = JSON.parse(
  readFileSync(repoPath('tests', 'fixtures', 'calibration', 'run-together-v1.json'), 'utf8'),
) as {
  alwaysNegative: { cases: Case[] };
  languages: Record<string, Language>;
};

const languages = Object.entries(fixture.languages);

afterAll(() => setReaderRegion(undefined));

function run(c: Case, locale: string | null) {
  setReaderRegion(c.locale !== undefined ? c.locale : locale);
  return filterProfanity(c.text, 'child', { tier: c.tier ?? 'both' });
}

describe('run-together fixture: shape', () => {
  it('covers all four interface languages', () => {
    expect(languages.map(([code]) => code).sort()).toEqual(['en', 'es', 'pt', 'ro']);
  });

  for (const [code, lang] of languages) {
    it(`${code} has both sides, with at least ten legitimate words per language`, () => {
      expect(lang.mustMatch.length, `${code} mustMatch`).toBeGreaterThanOrEqual(10);
      expect(lang.mustNotMatch.length, `${code} mustNotMatch`).toBeGreaterThanOrEqual(10);
    });

    it(`${code} gives every case a reason`, () => {
      for (const c of [...lang.mustMatch, ...lang.mustNotMatch]) {
        expect(c.why, c.text).toBeTruthy();
      }
    });
  }
});

for (const [code, lang] of languages) {
  describe(`${code} (${lang.label}) — must match`, () => {
    for (const c of lang.mustMatch) {
      it(`"${c.text}"`, () => {
        const r = run(c, lang.locale);
        expect(r.filtered, `${c.why} — matched nothing`).toBe(true);
        if (c.term) expect(r.matches, c.why).toContain(c.term);
      });
    }
  });

  describe(`${code} (${lang.label}) — must not match`, () => {
    for (const c of lang.mustNotMatch) {
      it(`"${c.text}"`, () => {
        const r = run(c, lang.locale);
        expect(r.filtered, `${c.why} — matched ${r.matches.join(', ')}`).toBe(false);
      });
    }
  });
}

describe('the false positives on record stay negative at every locale', () => {
  const locales = [null, ...languages.map(([, l]) => l.locale)];
  for (const c of fixture.alwaysNegative.cases) {
    for (const locale of locales) {
      it(`[${locale ?? 'region unknown'}] "${c.text}"`, () => {
        for (const tier of ['both', 'slurs', 'profanity'] as const) {
          setReaderRegion(locale);
          const r = filterProfanity(c.text, 'child', { tier });
          expect(r.filtered, `${c.why} — matched ${r.matches.join(', ')} on tier ${tier}`).toBe(false);
        }
      });
    }
  }
});

describe('why the method is safe, not lucky', () => {
  const stars = (t: string) => filterProfanity(t, 'child', { tier: 'both' });

  it('a segmentation must consume the WHOLE token', () => {
    // 'assfuck' segments; 'assfuckz' does not, because 'z' is left over.
    expect(stars('assfuck').filtered).toBe(true);
    expect(stars('assfuckz').filtered).toBe(false);
    expect(stars('qassfuck').filtered).toBe(false);
  });

  it('a segmentation needs at least one listed term, not only compound morphemes', () => {
    // 'headface' is two compound morphemes and no profanity at all.
    expect(stars('headface').filtered).toBe(false);
    expect(stars('headbagwipe').filtered).toBe(false);
  });

  it('a single listed term plus an inflection is NOT a run-together match', () => {
    // This is the forward-stem case, which EXACT_ONLY deliberately gates. If
    // the segmenter accepted it, every exact-only term would get its stem
    // reach back and futebol would return.
    setReaderRegion('pt-BR');
    expect(filterProfanity('futes', 'child', { tier: 'both' }).filtered).toBe(false);
    setReaderRegion(null);
  });

  it('no Spanish or Portuguese verb ending is an allowed inflection', () => {
    // -ar, -es, -ado are exactly what produced molestar and molestes.
    for (const w of ['molestar', 'molestes', 'molestado', 'futuro', 'futebol']) {
      expect(stars(w).filtered, w).toBe(false);
    }
  });

  it('a bare number can never reach the dictionary, however it folds', () => {
    // 4 -> a and 5 -> s would make '455' into 'ass' without the letter guard.
    for (const w of ['455', '4555', '45500', '0455', '455 455 455']) {
      expect(stars(w).filtered, w).toBe(false);
    }
    // ...but a digit standing in for a letter inside a word still resolves.
    expect(stars('a55hole').filtered).toBe(true);
  });

  it('a token long enough to be an id or a hash is never segmented', () => {
    expect(stars('a'.repeat(41)).filtered).toBe(false);
    expect(stars(`assfuck${'x'.repeat(60)}`).filtered).toBe(false);
  });

  it('masks the run-together token and nothing around it', () => {
    const r = filterProfanity('hey dickheadmotherfucker calm down', 'child', { tier: 'profanity' });
    expect(r.cleanText).toBe('hey ******************** calm down');
    expect(r.cleanText.length).toBe('hey dickheadmotherfucker calm down'.length);
  });
});

describe('timing budget: under 0.2 ms per 200-character text', () => {
  // The filter runs on every post and every comment before first paint, so the
  // budget is the point of the pass, not a nicety.
  const TEXTS = [
    'The council meeting ran long again tonight and the housing item was pushed to next month, which is the third time this year that the same proposal has been delayed without any public explanation at.',
    'Am fost la magazin si am cumparat paine, lapte si niste mere pentru copii, dar am uitat complet de cafea, asa ca maine dimineata trebuie sa ma intorc din nou acolo ca sa iau si restul lucrurilor bune.',
    'El partido de futbol del domingo fue un desastre completo porque el arbitro no vio la falta y el entrenador se quejo durante todo el segundo tiempo sin que nadie del equipo pudiera hacer algo mas ok.',
    'O futebol brasileiro esta passando por um momento dificil e os torcedores estao cansados de promessas que nunca se cumprem, mas ainda assim continuam indo ao estadio todos os fins de semana por amor.',
    'you absolute dickheadmotherfucker nobody wants to read another one of these threads about the same tired topic again and again and again and again and again and again and again and again ok fine yes',
  ];

  it('every sample really is about 200 characters', () => {
    for (const t of TEXTS) expect(t.length, t.slice(0, 30)).toBeGreaterThanOrEqual(190);
    for (const t of TEXTS) expect(t.length, t.slice(0, 30)).toBeLessThanOrEqual(215);
  });

  const BUDGET_MS = 0.2;

  // The same kind of work as the matcher, every piece of every word looked up in a set of four
  // thousand, but without building strings: a loop that built them read up to half again slower
  // beside a slowed matcher, and so raised the budget of the very matcher it was checking.
  const pieceKey = (key: number, code: number) => (Math.imul(key, 31) + (code | 32)) & 0x3fffffff;
  const REFERENCE_KEYS = new Set<number>();
  for (const word of TEXTS.join(' ').split(/[^A-Za-z]+/)) {
    REFERENCE_KEYS.add([...word].reduce((key, ch) => pieceKey(key, ch.charCodeAt(0)), 0));
  }
  for (let i = 0; REFERENCE_KEYS.size < 4000; i++) REFERENCE_KEYS.add(Math.imul(i, 2654435761) & 0x3fffffff);
  const isLetter = (code: number) => (code | 32) >= 97 && (code | 32) <= 122;
  const reference = (text: string): number => {
    let hits = 0;
    let wordStart = 0;
    for (let end = 0; end <= text.length; end++) {
      if (end < text.length && isLetter(text.charCodeAt(end))) continue;
      for (let s = wordStart; s < end; s++) {
        let key = 0;
        for (let e = s; e < end; e++) {
          key = pieceKey(key, text.charCodeAt(e));
          if (e > s && REFERENCE_KEYS.has(key)) hits++;
        }
      }
      wordStart = end + 1;
    }
    return hits;
  };

  // The reference loop's cost per text with nothing else running, measured with this file alone on
  // a Ryzen 9 7900X, where the matcher itself took 0.054 ms.
  const REFERENCE_QUIET_MS = 0.0024;

  it('stays inside the budget', () => {
    setReaderRegion(null);
    let hits = 0;
    const perText = (work: (text: string) => number, times: number): number => {
      const started = performance.now();
      for (let i = 0; i < times; i++) for (const t of TEXTS) hits += work(t);
      return (performance.now() - started) / (times * TEXTS.length);
    };
    const matcher = (text: string) => filterProfanity(text, 'child', { tier: 'both' }).matches.length;
    perText(matcher, 300);
    perText(reference, 300);

    // Batches of about a millisecond, so most finish before the scheduler hands the core to another
    // process and the best of many is the cost itself; the reference runs five times the rounds per
    // batch because at four it sometimes read almost twice its cost for a whole run beside a slow matcher.
    let matcherMs = Infinity;
    let referenceMs = Infinity;
    for (let batch = 0; batch < 200; batch++) {
      matcherMs = Math.min(matcherMs, perText(matcher, 4));
      referenceMs = Math.min(referenceMs, perText(reference, 20));
    }
    expect(hits, 'the timed loops found nothing, so they may not have run').toBeGreaterThan(0);

    // Even the best batch ran up to 1.8 times slower beside 48 busy processes, and the reference loop
    // slowed about as much, so the budget grows with it; a matcher that got slower on its own does not.
    const slowdown = Math.max(1, referenceMs / REFERENCE_QUIET_MS);
    const budget = BUDGET_MS * slowdown;
    expect(
      matcherMs,
      `${matcherMs.toFixed(4)} ms per 200-character text against ${budget.toFixed(4)} (${BUDGET_MS} ms, times ${slowdown.toFixed(2)} for a busy machine)`,
    ).toBeLessThan(budget);
  }, 20000);
});
