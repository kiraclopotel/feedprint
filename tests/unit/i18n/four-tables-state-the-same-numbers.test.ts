// The four language tables have to agree about numbers (2026-09-18).
//
// Key parity is a compile error and an empty value is a test. Nothing compared
// what the strings SAY. A Romanian reader told the record holds 1,000 entries
// where the English says 10,000, or that a PIN is five digits where it is four,
// reads a false sentence with every other test green, and nobody in this house
// reads all four tables.
//
// WHAT THIS FOUND WHEN IT WAS FIRST RUN, which is the honest headline: nothing.
// Every static string in the popup, dashboard and export tables carries the same
// digits in all four languages, apart from the one clock sentence below, which
// differ correctly. The crypto tokens were checked the same way by hand and are
// symmetric too: SHA-256 twice in each dashboard table, RFC 3161 and SHA-256 in
// the same counts per locale in the export table. So this is a guard and not a
// repair, which is the right time to write one.
//
// A number is compared by its DIGITS alone, with separators dropped, because
// 10,000 and 10.000 are the same number in different languages and a check that
// called them different would be noise that gets switched off.
//
// WHAT IT DOES NOT COVER. Static strings only. A table entry that is a function
// takes its numbers from the caller, so the same call has to produce the same
// digits in all four, which is a different check over a different thing and is
// not this one. It also says nothing about whether a translated sentence means
// what the English one means; an emphasis dropped or a limit softened in one
// language is exactly the kind of thing this cannot see.

import { describe, expect, it } from 'vitest';
import { POPUP_STRINGS } from '../../../src/i18n/popup-strings';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';
import { I18N as EXPORT_STRINGS } from '../../../src/i18n/export-strings';

const LANGS = ['en', 'ro', 'es', 'pt-BR'] as const;
type Lang = (typeof LANGS)[number];

// Sentences whose digits differ on purpose, each with the reason. A key is
// added here only when a reader in that language is told the same fact.
const CLOCK_CONVERSIONS = new Set([
  // "between 10 pm and 2 am" reads as 22:00 and 02:00 in ro, and 22h and 2h in
  // pt-BR. The same two hours of the night, on a 24 hour clock.
  'dashboard.expoLateSub',
]);

/**
 * The digits of every number in a sentence, separators dropped, in order. The
 * class carries the non-breaking space as an escape and never as the character
 * itself: an invisible byte in a character class is the kind of thing a later
 * reader deletes by accident and cannot see they have.
 */
function digitsOf(s: string): string[] {
  return [...s.matchAll(/\d[\d.,\u00a0 ]*\d|\d/g)]
    .map((m) => m[0].replace(/\D/g, ''))
    .filter((d) => d.length > 0);
}

interface Row { table: string; key: string; en: string; other: string; lang: Lang }

function disagreements(table: string, tables: Record<string, Record<string, unknown>>): Row[] {
  const out: Row[] = [];
  for (const key of Object.keys(tables.en)) {
    if (CLOCK_CONVERSIONS.has(`${table}.${key}`)) continue;
    const en = tables.en[key];
    if (typeof en !== 'string') continue;
    const base = digitsOf(en).join('|');
    for (const lang of LANGS.slice(1)) {
      const v = tables[lang]?.[key];
      if (typeof v !== 'string') continue;
      if (digitsOf(v).join('|') !== base) out.push({ table, key, en, other: v, lang });
    }
  }
  return out;
}

describe('the four language tables state the same numbers', () => {
  it.each([
    ['popup', POPUP_STRINGS],
    ['dashboard', DASHBOARD_STRINGS],
    ['export', EXPORT_STRINGS],
  ])('%s', (name, tables) => {
    const bad = disagreements(name, tables as never);
    const report = bad.map((r) => `${r.table}.${r.key} [${r.lang}]\n    en: ${r.en}\n    ${r.lang}: ${r.other}`).join('\n');
    expect(bad, `a number differs between languages. Either the translation is wrong, or it is a `
      + `clock or a unit that reads differently and belongs in CLOCK_CONVERSIONS with its reason:\n${report}`).toEqual([]);
  });

  it('the check can tell two numbers apart, so an empty result means something', () => {
    // A guard that found nothing has to prove it can find something, or the
    // empty result above is indistinguishable from a broken reader.
    const planted = { en: { k: 'the record holds 10,000 entries' }, ro: { k: 'registrul conține 1.000 de intrări' } };
    expect(disagreements('planted', planted as never)).toHaveLength(1);
    const same = { en: { k: 'up to 10,000' }, ro: { k: 'până la 10.000' } };
    expect(disagreements('planted', same as never)).toEqual([]);
  });
});
