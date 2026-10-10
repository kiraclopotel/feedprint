// The number formatters, run: a compact count and a decimal in each language the dashboard speaks. The string-table
// sweep (decimals-are-written-in-the-readers-language) cannot reach a number a component formats itself, so the
// formatters those components call are pinned here. Intl puts a no-break space before a unit word, so spaces are
// compared as plain spaces.

import { describe, expect, it } from 'vitest';
import { formatAsGiven, formatCompact, formatCount, formatDecimal, formatPercent } from '../../../../src/ui/shared/format-number';

const plain = (s: string): string => s.replace(/\s/g, ' ');

describe('numbers are written in the reader\'s language', () => {
  it('a compact count: Romanian says "mii", Spanish and Portuguese "mil", English "K"', () => {
    expect(plain(formatCompact(221_100, 'ro'))).toBe('221,1 mii');
    expect(plain(formatCompact(221_100, 'es'))).toBe('221,1 mil');
    expect(plain(formatCompact(221_100, 'pt-BR'))).toBe('221,1 mil');
    expect(formatCompact(221_100, 'en')).toBe('221.1K');
  });

  it('a decimal carries the comma in the three comma languages', () => {
    expect(formatDecimal(12.5, 'ro')).toBe('12,5');
    expect(formatAsGiven(12.5, 'es')).toBe('12,5');
    expect(plain(formatPercent(41.2, 'pt-BR'))).toBe('41,2%');
    expect(formatAsGiven(12.5, 'en')).toBe('12.5');
  });

  it('a count groups thousands the reader\'s way', () => {
    expect(formatCount(12_345, 'ro')).toBe('12.345');
    expect(formatCount(12_345, 'en')).toBe('12,345');
  });
});
