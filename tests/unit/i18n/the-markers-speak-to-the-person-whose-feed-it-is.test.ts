// The words on the page, on a marker or a cover, speak to the person whose feed it is: no sentence in
// any of the four languages names a child, a teenager or a parent, and the line for a post that a
// Strict filter skipped names the level that did it, in the same words wherever it is shown.

import { describe, expect, it } from 'vitest';
import { MARKER_STRINGS } from '../../../src/i18n/marker-strings';

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
        collect((value as (...a: unknown[]) => unknown)(...args), path + '()', out, depth + 1);
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

describe('the markers speak to the person whose feed it is', () => {
  for (const lang of ['en', 'es', 'pt-BR', 'ro'] as const) {
    it(`no sentence in ${lang} names a child, a teenager or a parent`, () => {
      const out: Array<[string, string]> = [];
      collect((MARKER_STRINGS as unknown as Record<string, unknown>)[lang], lang, out);
      expect(out.length).toBeGreaterThan(100);
      const hits = out.filter(([, s]) => WORDS.test(s)).map(([k, s]) => `${k}: ${s.slice(0, 90)}`);
      expect(hits).toEqual([]);
    });

    it(`the skip line in ${lang} names the level and is the same on a cover and on a skipped post`, () => {
      const t = (MARKER_STRINGS as unknown as Record<string, Record<string, string>>)[lang];
      expect(t.skipLineChild).toBe(t.hideNoticeChild);
      expect(t.skipLineChild).toMatch(/Strict|Estricto|Rigoroso/);
    });
  }
});
