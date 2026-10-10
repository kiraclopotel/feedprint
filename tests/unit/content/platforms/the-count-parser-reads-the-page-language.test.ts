// @vitest-environment jsdom
//
// B8 unit 2 (P33): one reader of the count text every platform prints, and it reads a shortened count with the
// language of the page. "1.2K" is 1200 everywhere (Instagram read it as 12000). Spanish and Portuguese "mil" is a
// thousand and Romanian "mil." is a million (Facebook read every "mil" as a million, so an es or pt count was a
// thousand times too big). A "mil" on a page in another language, or in a word that only begins with "mil",
// records no count: a count a thousand times off in a signed record is worse than none.

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCountText, pageLanguage } from '../../../../src/content/platforms/count-text';

const TABLE: ReadonlyArray<[lang: string, text: string, expected: number | undefined]> = [
  // English
  ['en', '966', 966],
  ['en', '1,200', 1200],
  ['en', '1,055,853', 1055853],
  ['en', '1.2K', 1200],
  ['en', '1.2k', 1200],
  ['en', '234K', 234000],
  ['en', '3M', 3000000],
  ['en', '2B', 2000000000],
  ['en', '1,2K', 1200],
  ['en', '84 comments', 84],
  ['en', '5 min', 5],
  // Romanian: "." groups thousands, "mii" is a thousand, "mil." and "mln" are a million
  ['ro', '1.200', 1200],
  ['ro', '1.055.853', 1055853],
  ['ro', '1,2K', 1200],
  ['ro', '3 mil.', 3000000],
  ['ro', '3 mil', 3000000],
  ['ro', '1,2 mil.', 1200000],
  ['ro', '5 mii', 5000],
  ['ro', '2 mln', 2000000],
  ['ro', '340 comentarii', 340],
  // Spanish: "mil" is a thousand, "M" a million
  ['es', '3 mil', 3000],
  ['es', '1,2 mil', 1200],
  ['es', '3 M', 3000000],
  ['es', '1.200', 1200],
  ['es', '1,2 mi', 1200000],
  // Portuguese: "mil" is a thousand, "mi" a million
  ['pt', '3 mil', 3000],
  ['pt', '1,2 mil', 1200],
  ['pt', '1,2 mi', 1200000],
  ['pt', '3 mi', 3000000],
  // A page whose language is not one of those, or that names none: "mil" is not guessed, K/M/B and plain numbers still read
  ['', '3 mil', undefined],
  ['en', '3 mil', undefined],
  ['de', '3 mil', undefined],
  ['', '1.2K', 1200],
  ['', '966', 966],
  ['', '3 M', 3000000],
  // Any other word that begins with "mil" is a size this reader will not guess
  ['pt', '3 milhões', undefined],
  ['ro', '2 milioane', undefined],
  ['es', '2 millones', undefined],
  ['', '3 mi', undefined],
  // Nothing to read
  ['en', '', undefined],
  ['en', '   ', undefined],
  ['en', 'abc', undefined],
];

describe('parseCountText reads a count with the language of the page', () => {
  it.each(TABLE)('[%s] %j reads as %s', (lang, text, expected) => {
    expect(parseCountText(text, lang)).toBe(expected);
  });

  it('reads no count from nothing', () => {
    expect(parseCountText(null, 'en')).toBeUndefined();
    expect(parseCountText(undefined, 'en')).toBeUndefined();
  });
});

describe('the language comes from the page when none is given', () => {
  afterEach(() => { document.documentElement.lang = ''; });

  it('reads the first two letters of the html lang, in lower case', () => {
    document.documentElement.lang = 'pt-BR';
    expect(pageLanguage()).toBe('pt');
    expect(parseCountText('3 mil')).toBe(3000);
    document.documentElement.lang = 'RO';
    expect(pageLanguage()).toBe('ro');
    expect(parseCountText('3 mil.')).toBe(3000000);
    document.documentElement.lang = 'es-419';
    expect(parseCountText('1,2 mil')).toBe(1200);
  });

  it('a page that names no language records no count for a "mil"', () => {
    document.documentElement.lang = '';
    expect(pageLanguage()).toBe('');
    expect(parseCountText('3 mil')).toBeUndefined();
    expect(parseCountText('1.2K')).toBe(1200);
  });
});

describe('every platform reads its counts through the one parser', () => {
  const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');

  it.each([
    ['src/content/platforms/facebook.ts'],
    ['src/content/platforms/instagram.ts'],
    ['src/content/platforms/twitter.ts'],
    ['src/content/platforms/comment-extractors.ts'],
  ])('%s imports parseCountText and holds no parser of its own', (file) => {
    const src = read(file);
    expect(src, 'it uses the shared parser').toMatch(/from '\.\/count-text'/);
    expect(src, 'no private parser is left').not.toMatch(/function parse(Facebook|Instagram|Twitter)(Count|Metric)\b/);
  });
});
