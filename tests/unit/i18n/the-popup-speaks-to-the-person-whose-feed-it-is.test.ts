// The popup names three levels and speaks to the person whose feed it is. No popup sentence
// may talk about a child, a teenager or a parent: the setting is not an age, and the person
// reading the popup is the one it protects, whether they chose the level or a family did.
//
// The pattern covers the four languages of the tables. It is checked on every string value and on
// the text every function value returns for a plain sample.

import { describe, expect, it } from 'vitest';
import { POPUP_STRINGS } from '../../../src/i18n/popup-strings';

const WORDS = new RegExp(
  [
    '\\bchild(ren)?\\b', '\\bkids?\\b', '\\bteen(s|age|ager|agers)?\\b', '\\bparents?\\b',
    'copil', 'părint', 'parinte', 'adolescen',
    'niñ', 'hij[oa]s?\\b', 'padre', 'madre', 'adolescente',
    'crian[cç]', 'filh[oa]', 'respons[aá]vel', 'pais\\b',
  ].join('|'),
  'i',
);

function texts(table: Record<string, unknown>): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(table)) {
    if (typeof value === 'string') out.push([key, value]);
    else if (typeof value === 'function') {
      try {
        const r = (value as (...a: unknown[]) => unknown)('Strict', 3, 2);
        if (typeof r === 'string') out.push([key, r]);
      } catch {
        // a function that needs a different argument shape is not a sentence here
      }
    }
  }
  return out;
}

describe('the popup speaks to the person whose feed it is', () => {
  for (const lang of ['en', 'es', 'pt-BR', 'ro'] as const) {
    it(`no sentence in ${lang} names a child, a teenager or a parent`, () => {
      const table = (POPUP_STRINGS as unknown as Record<string, Record<string, unknown>>)[lang];
      const hits = texts(table).filter(([, s]) => WORDS.test(s)).map(([k, s]) => `${k}: ${s.slice(0, 90)}`);
      expect(hits).toEqual([]);
    });
  }

  it('the three level words are the ones the dashboard uses', () => {
    const P = POPUP_STRINGS as unknown as Record<string, Record<string, string>>;
    expect([P.en.modeChild, P.en.modeTeen, P.en.modeAdult]).toEqual(['Strict', 'Moderate', 'Relaxed']);
    expect([P.es.modeChild, P.es.modeTeen, P.es.modeAdult]).toEqual(['Estricto', 'Moderado', 'Relajado']);
    expect([P['pt-BR'].modeChild, P['pt-BR'].modeTeen, P['pt-BR'].modeAdult]).toEqual(['Rigoroso', 'Moderado', 'Relaxado']);
    expect([P.ro.modeChild, P.ro.modeTeen, P.ro.modeAdult]).toEqual(['Strict', 'Moderat', 'Relaxat']);
  });
});
