// FeelingWise — the one place a number becomes a string.
//
// The sibling of format-time.ts, and the same defect one field over.
//
// A number on a FeelingWise surface was written with a bare `.toLocaleString()`
// in twenty six places. That follows the BROWSER's locale, not the language the
// reader picked in FeelingWise's own settings, so a Romanian interface on a US
// English browser printed "3,278" where Romanian writes "3.278", and a Spanish
// one printed the same. Two call sites did it correctly, each in its own way:
// one passed intlLocaleFor(uiLang) into toLocaleString, the other built its own
// Intl.NumberFormat. Three implementations of one rule, twenty six copies
// missing it, and nothing comparing them.
//
// It matters more here than it looks. This product's whole claim rests on
// counts a person will quote to somebody else: "3,278 records", "14 hidden".
// A thousands separator that disagrees with the rest of the sentence around it
// is the kind of small wrongness that makes a reader doubt the number.
//
// Every function takes the RESOLVED interface language and passes it through
// intlLocaleFor. None of them reads navigator.language.
//
// The banned alternatives (a bare toLocaleString(), a hand-rolled
// Intl.NumberFormat outside this file) are held out of src/ui by
// tests/repo/one-number-format-per-surface.test.ts.

import { intlLocaleFor, type ResolvedUiLanguage } from '../../i18n';

/**
 * Formatters are cached per locale and shape. Building an Intl.NumberFormat is
 * the expensive part, and these run inside render paths that redraw on every
 * filter press over lists of hundreds of rows.
 */
const cache = new Map<string, Intl.NumberFormat>();

function formatter(lang: ResolvedUiLanguage, opts?: Intl.NumberFormatOptions): Intl.NumberFormat {
  const locale = intlLocaleFor(lang);
  const key = `${locale}::${opts ? JSON.stringify(opts) : ''}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, opts);
    cache.set(key, f);
  }
  return f;
}

/** A number that is not a number is printed as a dash, never as "NaN". */
function guard(n: number): string | null {
  return Number.isFinite(n) ? null : '–';
}

/**
 * A count: records, posts, hidden items, tokens. Grouped in the reader's own
 * language, no decimals. This is the one almost every call site wants.
 */
export function formatCount(n: number, lang: ResolvedUiLanguage): string {
  return guard(n) ?? formatter(lang).format(Math.round(n));
}

/**
 * A number that carries decimals: a ratio, a mean, a rate. `digits` is both the
 * minimum and the maximum, so a column of them lines up.
 */
export function formatDecimal(n: number, lang: ResolvedUiLanguage, digits = 1): string {
  return guard(n) ?? formatter(lang, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

/**
 * A short count for a crowded place ("221.1K" in English, "221,1 mii" in Romanian): the language's own compact form,
 * one decimal at most. A hand-built "K" with a decimal point read as English inside a Romanian page. Romanian takes
 * the long word, because its short form is the same Latin "K" a Romanian reader does not write.
 */
export function formatCompact(n: number, lang: ResolvedUiLanguage): string {
  return guard(n) ?? formatter(lang, {
    notation: 'compact',
    compactDisplay: lang === 'ro' ? 'long' : 'short',
    maximumFractionDigits: 1,
  }).format(n);
}

/**
 * A number exactly as the caller rounded it, grouped and with the reader's decimal mark: 12.5 is "12,5" in Romanian.
 * For the string tables, whose lines take counts and already-rounded shares alike and must not re-round either.
 */
export function formatAsGiven(n: number, lang: ResolvedUiLanguage): string {
  return guard(n) ?? formatter(lang, { maximumFractionDigits: 2 }).format(n);
}

/**
 * A percentage that is already a percentage: pass 12.6, get "12.6%".
 *
 * Not Intl's 'percent' style, which divides by a hundred and would silently
 * turn every existing call site's 12.6 into 1,260%. The share values in this
 * codebase are all already scaled (pct1, passedPct, actedPct), so the unit is
 * taken as given and only the number is formatted.
 */
export function formatPercent(pct: number, lang: ResolvedUiLanguage, digits = 1): string {
  const bad = guard(pct);
  if (bad) return bad;
  const n = Number.isInteger(pct) ? formatCount(pct, lang) : formatDecimal(pct, lang, digits);
  return `${n}%`;
}
