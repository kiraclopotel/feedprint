// The export's words speak to the person whose feed it is: no sentence in any of the four languages
// names a child, a teenager or a parent. The two labels for a setting written before the levels
// existed ("child", "teen") are the one allowed exception: they name a value a record was signed with,
// which is history and is never rewritten.

import { describe, expect, it } from 'vitest';
import { I18N } from '../../../src/i18n/export-strings';

const WORDS = new RegExp(
  [
    '\\bchild(ren)?\\b', '\\bkids?\\b', '\\bteen(s|age|ager|agers)?\\b', '\\bparents?\\b',
    'copil', 'părint', 'parinte', 'adolescen',
    'niñ', 'hij[oa]s?\\b', 'padre', 'madre', 'adolescente',
    'crian[cç]', 'filh[oa]', '\\bpais\\b',
  ].join('|'),
  'i',
);
const OLD_SETTING_LABELS = new Set(['epochModeChild', 'epochModeTeen']);

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

describe('the export speaks to the person whose feed it is', () => {
  for (const lang of ['en', 'es', 'pt-BR', 'ro'] as const) {
    it(`no sentence in ${lang} names a child, a teenager or a parent`, () => {
      const out: Array<[string, string]> = [];
      collect((I18N as unknown as Record<string, unknown>)[lang], lang, out);
      expect(out.length).toBeGreaterThan(300);
      const hits = out
        .filter(([k, s]) => WORDS.test(s) && !OLD_SETTING_LABELS.has(k.split('.').pop() ?? ''))
        .map(([k, s]) => `${k}: ${s.slice(0, 90)}`);
      expect(hits).toEqual([]);
    });
  }
});
