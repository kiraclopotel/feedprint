// The Issues tab speaks to the person: it says which check ran, not that one was "smarter"; it names no colour rails of a
// block that is closed by default; and it asks no one to "tell us".
//
// Five lines above the closed "Technical details (for support)" block: the intro named a label and colour rails that sit
// inside that block, three cards said the built-in filter was the dumb one ("the smarter AI was down"), and one told the
// reader to "tell us". The row rewrites them in all four languages. The legend and the support headings inside the closed
// block (opsLegend*) are support words and are left for their own row.

import { describe, expect, it } from 'vitest';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';

const LANGS = ['en', 'ro', 'es', 'pt-BR'] as const;

const OLD = new RegExp(
  [
    'smarter AI', 'AI-ul mai inteligent', 'IA más inteligente', 'mais inteligente da IA', 'IA mais inteligente',
    'teal rail', 'amber rail', 'bară turcoaz', 'franja verde azulada', 'faixa verde-azulada',
    'API-ul furnizorului AI a dat eroare, un lot',
    'tell us', 'spune-ne', 'avísanos', 'avise a gente',
  ].join('|'),
  'i',
);

function texts(path: string, value: unknown, out: Array<[string, string]>, depth = 0): void {
  if (depth > 6) return;
  if (typeof value === 'string') { out.push([path, value]); return; }
  if (typeof value === 'function') {
    try {
      const r = (value as (...a: unknown[]) => unknown)('day', 3, 2);
      if (typeof r === 'string') out.push([path, r]);
    } catch {
      // a function that needs another argument shape is not a sentence here
    }
    return;
  }
  if (Array.isArray(value)) { value.forEach((v, i) => texts(`${path}[${i}]`, v, out, depth + 1)); return; }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) texts(`${path}.${k}`, v, out, depth + 1);
  }
}

const table = (lang: string) => (DASHBOARD_STRINGS as unknown as Record<string, Record<string, unknown>>)[lang];

describe('the Issues tab speaks to the person', () => {
  for (const lang of LANGS) {
    it(`${lang}: no line outside the support block says "smarter", names a colour rail, or asks to "tell us"`, () => {
      const t = table(lang);
      expect(t, `no ${lang} table`).toBeTruthy();
      const found: Array<[string, string]> = [];
      for (const [key, value] of Object.entries(t)) {
        if (key.startsWith('opsLegend')) continue;
        texts(key, value, found);
      }
      expect(found.length, `${lang}: nothing was read`).toBeGreaterThan(200);
      const hits = found.filter(([, s]) => OLD.test(s)).map(([k, s]) => `${k}: ${s.slice(0, 100)}`);
      expect(hits).toEqual([]);
    });

    it(`${lang}: the card that points at "Technical details" quotes that block's own title`, () => {
      const t = table(lang);
      const title = String(t.opsTechDetails).split(' (')[0];
      expect(title.length).toBeGreaterThan(5);
      expect(String(t.opsCardDeliveryQuarantinedAction)).toContain(title);
    });
  }

  it('the allowance card, daily and monthly, has nothing to send anyone', () => {
    for (const lang of LANGS) {
      const f = table(lang).opsCardTextCapAction as (period: string) => string;
      for (const period of ['daily', 'monthly']) {
        const text = f(period);
        expect(OLD.test(text), `${lang} ${period}: ${text}`).toBe(false);
        expect(text.endsWith('(UTC).'), `${lang} ${period} ends where the reset is told`).toBe(true);
      }
    }
    const en = table('en').opsCardTextCapAction as (period: string) => string;
    expect(en('monthly')).toBe('Nothing is required. It resets when the month changes (UTC).');
    expect(en('daily')).toBe('Nothing is required. It resets at midnight (UTC).');
  });

  it('the three filter cards say which check ran', () => {
    const en = table('en');
    expect(en.opsCardTierMismatchMeaning).toBe('For part of the day, posts were checked only by the built-in filter.');
    expect(en.opsCardCapMeaning).toBe('While the allowance was used up, new posts were checked only by the built-in filter.');
    expect(en.opsCardLlmMeaning).toBe('A few posts were checked only by the built-in filter while the AI service recovered.');
  });
});
