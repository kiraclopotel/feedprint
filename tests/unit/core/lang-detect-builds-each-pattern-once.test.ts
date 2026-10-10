// SPEED1: the language check builds each word pattern once, not once per word per post.
// Two things are pinned: the result is identical to the old function on every calibration text
// (the old function is copied below as the reference), and the patterns are built once across calls.
// Draft for tests/unit/core/lang-detect-builds-each-pattern-once.test.ts

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { detectLanguage } from '../../../src/core/lang-detect';

const RO_WORDS = [
  'și', 'nu', 'sunt', 'care', 'cu', 'pe', 'pentru',
  'mai', 'dacă', 'când', 'din', 'mă', 'îmi', 'îți', 'ce', 'foarte',
  'bine', 'sau', 'fi', 'fost', 'avem', 'aveți', 'acum',
  'nici', 'iar', 'acest', 'acesta', 'aceasta', 'nimic', 'poate', 'trebuie', 'aici', 'acolo',
];
const RO_WORDS_SHARED = ['de', 'la', 'se', 'dar', 'este'];
const EN_WORDS = [
  'the', 'and', 'is', 'are', 'not', 'this', 'that', 'of', 'in', 'on',
  'for', 'with', 'you', 'have', 'was', 'were', 'can', 'will', 'would',
  'they', 'their', 'there', 'what', 'who', 'when', 'how',
];
const RO_DIACRITIC_RE = /[ăâîșțşţĂÂÎȘȚŞŢ]/g;

function oldCountWordHits(normalizedLower: string, words: string[]): number {
  let count = 0;
  for (const w of words) {
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?:^|[^\\p{L}])${escaped}(?:$|[^\\p{L}])`, 'giu');
    const matches = normalizedLower.match(pattern);
    if (matches) count += matches.length;
  }
  return count;
}

function oldDetect(text: string) {
  if (!text || text.trim().length === 0) {
    return { language: 'unknown', ro_score: 0, en_score: 0 };
  }
  const normalized = text.toLowerCase();
  const diacriticMatches = normalized.match(RO_DIACRITIC_RE);
  const ro_diacritic_hits = diacriticMatches ? diacriticMatches.length : 0;
  const ro_own = oldCountWordHits(normalized, RO_WORDS);
  const ro_shared = ro_diacritic_hits > 0 || ro_own > 0 ? oldCountWordHits(normalized, RO_WORDS_SHARED) : 0;
  const ro_score = ro_diacritic_hits * 2 + (ro_own + ro_shared);
  const en_score = oldCountWordHits(normalized, EN_WORDS);
  let language: string;
  if (ro_score < 3 && en_score < 3) language = 'unknown';
  else if (ro_score >= en_score * 3) language = 'ro';
  else if (en_score >= ro_score * 3) language = 'en';
  else language = 'mixed';
  return { language, ro_score, en_score };
}

function collectTexts(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const n of node) collectTexts(n, out);
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'text' && typeof v === 'string') out.push(v);
      else collectTexts(v, out);
    }
  }
}

function calibrationTexts(): string[] {
  const out: string[] = [];
  for (const f of ['adversarial-benign-v1', 'functional-pairs', 'multilang-filters-v1']) {
    const raw = readFileSync(`tests/fixtures/calibration/${f}.json`, 'utf8');
    collectTexts(JSON.parse(raw), out);
  }
  return out;
}

const HAND_TEXTS = [
  '',
  '   ',
  'Ești foarte bun și puternic.',
  'si nu este asa cum sunt ei care cu de pe la',
  'Aşa este şi aşa trebuie',
  'politicieni corupți de la putere',
  'the cat and the dog are not in this house, you have what they would',
  'nuclear nu pe',
  'El contenido presenta a un grupo de personas como culpables de la crisis de la vivienda.',
];

describe('lang-detect: same answers as the old function', () => {
  it('gives identical language and scores on every calibration text', () => {
    const texts = [...calibrationTexts(), ...HAND_TEXTS];
    expect(texts.length).toBeGreaterThan(300);
    const differences = texts.filter((t) => {
      const a = detectLanguage(t);
      const b = oldDetect(t);
      return a.language !== b.language || a.ro_score !== b.ro_score || a.en_score !== b.en_score;
    });
    expect(differences).toEqual([]);
  });
});

describe('lang-detect: each word pattern is built once', () => {
  const RealRegExp = globalThis.RegExp;
  afterEach(() => {
    globalThis.RegExp = RealRegExp;
  });

  it('builds no new word pattern on later calls', () => {
    let wordPatternBuilds = 0;
    class CountingRegExp extends RealRegExp {
      constructor(pattern: string | RegExp, flags?: string) {
        super(pattern as string, flags);
        if (typeof pattern === 'string' && pattern.startsWith('(?:^|[^\\p{L}])')) wordPatternBuilds += 1;
      }
    }
    globalThis.RegExp = CountingRegExp as unknown as RegExpConstructor;

    // The first call may build the patterns; the next fifty may not.
    detectLanguage('Ești foarte bun și puternic, the cat and the dog are not here.');
    const afterFirst = wordPatternBuilds;
    for (let i = 0; i < 50; i += 1) {
      detectLanguage(`post ${i}: nu este asa, the cat is not in the house and ești foarte bun`);
    }
    expect(wordPatternBuilds).toBe(afterFirst);
    // And never more than one pattern per listed word.
    expect(wordPatternBuilds).toBeLessThanOrEqual(RO_WORDS.length + RO_WORDS_SHARED.length + EN_WORDS.length);
  });
});
