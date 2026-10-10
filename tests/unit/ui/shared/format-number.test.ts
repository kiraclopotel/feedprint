// @vitest-environment node
//
// The one place a number becomes a string, measured against the four languages
// it has to serve rather than against the one the machine happens to be in.
//
// The defect this module closes: twenty six bare `.toLocaleString()` calls
// under src/ui, each following the BROWSER's locale rather than the language
// the reader picked in FeelingWise's own settings. A Romanian interface on a US
// English browser printed "3,278" where Romanian writes "3.278".
//
// The assertions below never hard-code a separator character. They compare the
// four languages against each other and against Intl's own answer, so this file
// stays true on a runner with a different ICU build.

import { describe, expect, it } from 'vitest';
import { formatCount, formatDecimal, formatPercent } from '../../../../src/ui/shared/format-number';
import { intlLocaleFor, UI_LANGUAGES } from '../../../../src/i18n';

describe('formatCount', () => {
  it('groups in the reader’s own language, not the browser’s', () => {
    for (const lang of UI_LANGUAGES) {
      const expected = new Intl.NumberFormat(intlLocaleFor(lang)).format(3278);
      expect(formatCount(3278, lang), `${lang} follows the interface language`).toBe(expected);
    }
  });

  // The whole point, stated as a difference rather than as a character: English
  // and Romanian must not agree about this number, or the module is doing
  // nothing and every test above it passes vacuously.
  it('gives a different string for at least two of the four languages', () => {
    const all = new Set(UI_LANGUAGES.map((l) => formatCount(1234567, l)));
    expect(all.size, 'the four languages do not all write a million the same way').toBeGreaterThan(1);
  });

  it('rounds, so a count is never printed with a fraction', () => {
    expect(formatCount(12.4, 'en')).toBe('12');
    expect(formatCount(12.6, 'en')).toBe('13');
  });

  it('prints a dash rather than NaN', () => {
    expect(formatCount(Number.NaN, 'en')).toBe('–');
    expect(formatCount(Number.POSITIVE_INFINITY, 'ro')).toBe('–');
  });

  it('handles zero and negatives without special-casing them', () => {
    expect(formatCount(0, 'en')).toBe('0');
    expect(formatCount(-5, 'en')).toBe('-5');
  });
});

describe('formatDecimal', () => {
  it('keeps the digit count fixed, so a column lines up', () => {
    expect(formatDecimal(2, 'en', 1)).toBe('2.0');
    expect(formatDecimal(2.05, 'en', 1)).toBe('2.1');
    expect(formatDecimal(2, 'en', 2)).toBe('2.00');
  });

  it('uses the reader’s decimal mark', () => {
    for (const lang of UI_LANGUAGES) {
      const expected = new Intl.NumberFormat(intlLocaleFor(lang), {
        minimumFractionDigits: 1, maximumFractionDigits: 1,
      }).format(2.5);
      expect(formatDecimal(2.5, lang, 1)).toBe(expected);
    }
  });
});

describe('formatPercent', () => {
  // The trap this function exists to avoid. Intl's 'percent' style divides by a
  // hundred, so passing it 12.6 would print 1,260%. Every share in this
  // codebase is already scaled, so the unit is taken as given.
  it('treats its input as already a percentage', () => {
    expect(formatPercent(12.6, 'en')).toBe('12.6%');
    expect(formatPercent(100, 'en')).toBe('100%');
  });

  it('drops the decimal on a whole number', () => {
    expect(formatPercent(50, 'en')).toBe('50%');
    expect(formatPercent(50.5, 'en')).toBe('50.5%');
  });

  it('prints a dash rather than NaN%', () => {
    expect(formatPercent(Number.NaN, 'en')).toBe('–');
  });
});

describe('the cache', () => {
  // Formatters are cached per locale and shape because these run in render
  // paths over lists of hundreds of rows. A cache that returned the wrong
  // formatter would be worse than no cache, so the shapes are proven distinct.
  it('does not serve a decimal formatter to a count, or one language to another', () => {
    expect(formatCount(1234, 'en')).not.toBe(formatDecimal(1234, 'en', 2));
    expect(formatCount(1234, 'en')).toBe(formatCount(1234, 'en'));
    const en = formatCount(1234567, 'en');
    const ro = formatCount(1234567, 'ro');
    expect(en, 'a second call in another language is not served the first one').not.toBe(ro);
    expect(formatCount(1234567, 'en'), 'and the first language is unchanged by it').toBe(en);
  });
});
