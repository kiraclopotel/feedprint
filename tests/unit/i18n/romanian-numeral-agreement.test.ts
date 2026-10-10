// Q63 (wiring W59): the Romanian "de" rule at n >= 20.
//
// Counts of 0, or with two-digit remainder 00 or 20-99, take "de" before
// the noun ("3 elemente" but "20 de elemente"). roPlural/roPluralWord
// implemented it correctly all along; ~25 manual templates bypassed them.
// All are converted; the source-scan below fails on any new bypass.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { roPlural, roPluralWord } from '../../../src/i18n';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';
import { POPUP_STRINGS } from '../../../src/i18n/popup-strings';

const ro = DASHBOARD_STRINGS.ro;
const roPop = POPUP_STRINGS.ro;
// The Romanian files only: this rule is about Romanian, and since PLAN-2026-09-16 item 10.2 each
// language is its own file. Scanning the file that assembles them would read four imports.
const DASHBOARD_STRINGS_PATH = 'src/i18n/dashboard/ro.ts';
const POPUP_STRINGS_PATH = 'src/i18n/popup/ro.ts';

// A second rule landed on the same helper on 2026-09-19: the number it prints is
// grouped the way Romanian writes it. Sixteen call sites in ro.ts already passed
// 'ro-RO' to toLocaleString and the ninety coming through roPlural did not, so two
// sentences on one screen disagreed about what a thousand looks like.
describe('roPlural groups the number in Romanian (2026-09-19)', () => {
  it('writes a thousand the way Romanian writes it', () => {
    expect(roPlural(3278, 'intrare', 'intrări')).toBe('3.278 de intrări');
    expect(roPlural(1000, 'intrare', 'intrări')).toBe('1.000 de intrări');
  });

  it('decides "de" on the raw number, not on the grouped text', () => {
    // The trap this fix could have introduced. 1000 has a two-digit remainder of
    // 00 and takes "de"; reading digits off "1.000" once a separator appears is
    // how that would silently stop being true.
    expect(roPlural(1000, 'element', 'elemente')).toContain(' de ');
    expect(roPlural(1019, 'element', 'elemente')).not.toContain(' de ');
    expect(roPlural(1020, 'element', 'elemente')).toBe('1.020 de elemente');
    expect(roPlural(1101, 'element', 'elemente')).toBe('1.101 elemente');
  });

  it('leaves small numbers exactly as they were', () => {
    // Every assertion written before this change used a number under a thousand,
    // which is why none of them moved. Pinned so that stays a fact.
    expect(roPlural(1, 'element', 'elemente')).toBe('1 element');
    expect(roPlural(3, 'element', 'elemente')).toBe('3 elemente');
    expect(roPlural(20, 'element', 'elemente')).toBe('20 de elemente');
    expect(roPlural(999, 'element', 'elemente')).toBe('999 de elemente');
  });

  it('reaches the sentences a person actually reads', () => {
    expect(ro.opsChainCount(4500)).toContain('4.500 de înregistrări');
  });
});

describe('roPlural helpers (shared implementation)', () => {
  it('applies the de rule at the documented boundaries', () => {
    expect(roPlural(1, 'element', 'elemente')).toBe('1 element');
    expect(roPlural(3, 'element', 'elemente')).toBe('3 elemente');
    expect(roPlural(19, 'element', 'elemente')).toBe('19 elemente');
    expect(roPlural(20, 'element', 'elemente')).toBe('20 de elemente');
    expect(roPlural(100, 'element', 'elemente')).toBe('100 de elemente');
    expect(roPlural(101, 'element', 'elemente')).toBe('101 elemente');
    expect(roPluralWord(20, 'zi', 'zile')).toBe('de zile');
    expect(roPluralWord(3, 'zi', 'zile')).toBe('zile');
  });
});

describe('converted templates render both forms', () => {
  it('dashboard samples', () => {
    expect(ro.patItems(3)).toBe('3 elemente');
    expect(ro.patItems(20)).toBe('20 de elemente');
    expect(ro.patDays(20)).toContain('20 de zile');
    expect(ro.opsChainCount(20)).toContain('20 de înregistrări');
    expect(ro.opsChainCount(3)).toContain('3 înregistrări');
    expect(ro.expoOfTotal(20)).toContain('20 de intrări');
    expect(ro.pinLockedFor(30)).toContain('30 de secunde');
    expect(ro.statsUndatedNote(20)).toContain('20 de înregistrări');
    expect(ro.recidEscalatingTip(5, 20)).toContain('20 de elemente văzute');
  });

  it('popup samples', () => {
    expect(roPop.callsPerDay(2000)).toContain('de apeluri AI');
    expect(roPop.callsPerDay(3)).toContain('3 apeluri AI');
    expect(roPop.metaUsage(3, 20, 15)).toContain('de apeluri AI');
    expect(roPop.pinLockedFor(30)).toContain('30 de secunde');
  });
});

describe('no manual RO count-noun template remains (source-scan)', () => {
  it('dashboard-strings and popup-strings carry no ${n} <noun> bypass', () => {
    const BYPASS = /\$\{[^}]+\} (înregistrări|elemente|zile|secunde|camere|comentarii|apeluri|intervale|intrări|postări)\b/g;
    for (const file of [DASHBOARD_STRINGS_PATH, POPUP_STRINGS_PATH]) {
      const src = readFileSync(join(process.cwd(), file), 'utf8');
      const hits = src.match(BYPASS) ?? [];
      expect(hits, `${file}: ${hits.join(' | ')}`).toEqual([]);
    }
  });
});
