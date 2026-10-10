// 'combined' is the technique a reading falls to when its concern matches none of the named ones
// (the last return of mapConcernToTechnique in src/core/neutralizer.ts). The marker's title and
// reason for it once said "several patterns at once", the opposite of what the record holds. The
// stacked-hostility case has its own technique, 'combined-stack', and keeps its "several" words.

import { describe, it, expect } from 'vitest';
import { MARKER_TITLES, MARKER_REASONS } from '../../../src/i18n/marker-strings';

const LANGS = ['en', 'ro', 'es', 'pt-BR'] as const;

const SEVERAL = /\b(several|multiple|many|at once|mai multe|deodată|varios|varias|a la vez|vários|várias|de uma vez)\b/i;
const NO_NAMED = {
  en: /none of the named patterns/,
  ro: /niciun tipar cu nume/,
  es: /ningún patrón con nombre/,
  'pt-BR': /nenhum padrão com nome/,
} as const;

describe('the unnamed-pattern marker says that no named pattern fits', () => {
  it.each(LANGS)('%s: the title and the reason never say "several"', (lang) => {
    expect(MARKER_TITLES[lang].combined).not.toMatch(SEVERAL);
    expect(MARKER_REASONS[lang].combined).not.toMatch(SEVERAL);
  });

  it.each(LANGS)('%s: the reason says no named pattern covers it', (lang) => {
    expect(MARKER_REASONS[lang].combined).toMatch(NO_NAMED[lang]);
  });

  it.each(LANGS)('%s: the stacked-hostility title stays its own', (lang) => {
    expect(MARKER_TITLES[lang]['combined-stack']).not.toBe(MARKER_TITLES[lang].combined);
  });
});
