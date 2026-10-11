// M363. The standalone checker took no language at all, so
// feelingwise.org/check-ro.html printed an English verdict under a Romanian
// heading, while the checker built INTO an export is generated per locale. The
// page exists to talk a reader out of trusting the file's own script, so
// following our advice cost them their language.
//
// Two things have to hold at once and they pull against each other. The
// Romanian reading has to be Romanian all the way down, footnotes included,
// because a Romanian verdict over English footnotes reads as broken rather than
// as honest. And the English reading has to be BYTE-IDENTICAL to what the
// published tool printed before, because translating it and rewording it are
// two changes and only one of them was made.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { VERIFIER_WORDS, VERIFIER_LOCALES } from '../../src/forensics/verifier-words';
import { I18N } from '../../src/i18n/export-strings';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('the words table', () => {
  it('carries every key in every locale it claims', () => {
    const keys = Object.keys(VERIFIER_WORDS.en).sort();
    for (const locale of VERIFIER_LOCALES) {
      const got = Object.keys(VERIFIER_WORDS[locale]).sort();
      expect(got, `${locale} is missing or has extra keys`).toEqual(keys);
      for (const key of keys) {
        expect(VERIFIER_WORDS[locale][key as keyof typeof VERIFIER_WORDS.en].length,
          `${locale}.${key} is empty`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the same placeholders in every locale', () => {
    // A dropped {n} is a sentence that prints nothing where a number belongs,
    // and nothing else in the pipeline would notice.
    // {n|înregistrare|înregistrări|de înregistrări} is {n} with the words that go with it (finding 6, 8 Oct 2026).
    const placeholders = (s: string) =>
      (s.match(/\{\w+(?:\|[^}]*)?\}/g) ?? []).map(p => p.replace(/\|[^}]*/, '')).sort().join(',');
    for (const key of Object.keys(VERIFIER_WORDS.en)) {
      const want = placeholders(VERIFIER_WORDS.en[key as keyof typeof VERIFIER_WORDS.en]);
      for (const locale of VERIFIER_LOCALES) {
        if (locale === 'en') continue;
        expect(placeholders(VERIFIER_WORDS[locale][key as keyof typeof VERIFIER_WORDS.en]),
          `${locale}.${key} does not carry the same placeholders as English`).toBe(want);
      }
    }
  });

  // One verdict, one word, in the checker and in the export's own page, in each language both speak. 9 Oct 2026: the
  // Romanian checker said EȘUAT and the export EȘUATĂ; the English checker said BROKEN and the export FAILED, and
  // BROKEN reads as damage to a stranger. Both say VERIFIED / PARTIALLY VERIFIED / FAILED now, and their Romanian.
  const VERDICTS = {
    en: { verified: 'VERIFIED', partial: 'PARTIALLY VERIFIED', failed: 'FAILED' },
    ro: { verified: 'VERIFICAT', partial: 'VERIFICAT PARȚIAL', failed: 'EȘUAT' },
  } as const;
  it.each(Object.keys(VERDICTS) as Array<keyof typeof VERDICTS>)('%s: says the three verdicts with the same words as the export', (lang) => {
    const v = VERDICTS[lang];
    const w = VERIFIER_WORDS[lang];
    const e = I18N[lang];
    expect(w.verified.startsWith(`${v.verified}:`)).toBe(true);
    expect(e.chainVerified.endsWith(`: ${v.verified}`)).toBe(true);
    expect(w.partial.startsWith(`${v.partial}:`)).toBe(true);
    expect(e.chainPartial.endsWith(`: ${v.partial}`)).toBe(true);
    expect(w.broken).toBe(`${v.failed}.`);
    expect(w.brokenAtRecord.startsWith(`${v.failed} `)).toBe(true);
    expect(w.brokenBefore.startsWith(`${v.failed} `)).toBe(true);
    expect(e.chainBroken.endsWith(`: ${v.failed}`)).toBe(true);
  });

  it('does not leave a Romanian sentence in English', () => {
    // The cheap failure this catches is a key added to English and copied into
    // Romanian untranslated, which is invisible until a Romanian reads it.
    const same: string[] = [];
    for (const key of Object.keys(VERIFIER_WORDS.en) as (keyof typeof VERIFIER_WORDS.en)[]) {
      const en = VERIFIER_WORDS.en[key];
      // Short pieces that are punctuation and a placeholder are allowed to
      // match: ' ({detail})' is the same in both and translating it would be
      // an invention.
      if (en.replace(/\{\w+\}/g, '').replace(/[^\p{L}]/gu, '').length < 4) continue;
      if (VERIFIER_WORDS.ro[key] === en) same.push(String(key));
    }
    expect(same, 'these Romanian strings are still the English ones').toEqual([]);
  });
});

describe('the generated checker', () => {
  const mjs = read('verifier/verify-export.mjs');
  const browser = read('verifier/verify-export.browser.js');

  it.each([['verify-export.mjs', () => mjs], ['verify-export.browser.js', () => browser]])(
    '%s carries the words and takes a language',
    (_name, get) => {
      const src = get();
      expect(src).toContain('function wordsFor(lang)');
      expect(src).toContain('function describe(report, lang)');
      expect(src).toContain('function render(report, root, lang)');
      // The table is serialised in, so a Romanian sentence is literally present.
      expect(src).toContain(VERIFIER_WORDS.ro.verified.slice(0, 40));
    },
  );

  it('falls back to English rather than printing a half-translated report', () => {
    expect(mjs).toContain("const DEFAULT_LOCALE = 'en'");
  });
});

// The site's half of this check (the served copy of the browser checker equals the repository's, and the two
// check pages ask for the reader's language) is tests/private/site/the-site-serves-the-checker.test.ts: the site
// folder is not in the public copy of this repository (scripts/public-snapshot.mjs).
