// The dashboard names three levels and speaks to the person whose feed it is: no sentence in any
// of the four languages names a child, a teenager or a parent. What a card says about how a post
// was shown is one line for every level ("Shown as"), and the reading lenses are named for what they
// do, not for who reads.
//
// The checked text is every string value, at any depth, and what every function value returns for a
// plain sample. Portuguese "responsável" is left out of the pattern because the dashboard also uses
// it for a thing in charge of an item, not for a person.

import { describe, expect, it } from 'vitest';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';

const WORDS = new RegExp(
  [
    '\\bchild(ren)?\\b', '\\bkids?\\b', '\\bteen(s|age|ager|agers)?\\b', '\\bparents?\\b',
    'copil', 'părint', 'parinte', 'adolescen',
    'niñ', 'hij[oa]s?\\b', 'padre', 'madre', 'adolescente',
    'crian[cç]', 'filh[oa]', '\\bpais\\b',
  ].join('|'),
  'i',
);

function collect(value: unknown, path: string, out: Array<[string, string]>, depth = 0): void {
  if (depth > 6 || value == null) return;
  if (typeof value === 'string') out.push([path, value]);
  else if (typeof value === 'function') {
    for (const args of [['Strict', 3, 2], [3, 2], ['strict']] as unknown[][]) {
      try {
        const r = (value as (...a: unknown[]) => unknown)(...args);
        collect(r, path + '()', out, depth + 1);
        return;
      } catch {
        // try the next argument shape
      }
    }
  } else if (Array.isArray(value)) value.forEach((v, i) => collect(v, `${path}[${i}]`, out, depth + 1));
  else if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) collect(v, `${path}.${k}`, out, depth + 1);
  }
}

describe('the dashboard speaks to the person whose feed it is', () => {
  for (const lang of ['en', 'es', 'pt-BR', 'ro'] as const) {
    it(`no sentence in ${lang} names a child, a teenager or a parent`, () => {
      const out: Array<[string, string]> = [];
      collect((DASHBOARD_STRINGS as unknown as Record<string, unknown>)[lang], lang, out);
      expect(out.length).toBeGreaterThan(500);
      const hits = out.filter(([, s]) => WORDS.test(s)).map(([k, s]) => `${k}: ${s.slice(0, 90)}`);
      expect(hits).toEqual([]);
    });
  }

  it('the shown-as line is the same for every level', () => {
    for (const lang of ['en', 'es', 'pt-BR', 'ro'] as const) {
      const f = (DASHBOARD_STRINGS as unknown as Record<string, { feedShownAs: (m: string) => string }>)[lang].feedShownAs;
      expect(f('child')).toBe(f('teen'));
      expect(f('teen')).toBe(f('adult'));
      expect(f('strict')).toBe(f('relaxed'));
    }
  });
});
