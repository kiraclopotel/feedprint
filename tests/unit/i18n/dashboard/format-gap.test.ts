// The gap on the dashboard's platform-switch line must be a duration a clock can show.
// Rounding the minutes after splitting off the hours printed 7,170 seconds as "1h 60m".

import { describe, expect, it } from 'vitest';
import { formatGap } from '../../../../src/i18n/dashboard/format-gap';

describe('formatGap', () => {
  it('rounds to whole minutes before splitting hours from minutes', () => {
    expect(formatGap(3590)).toBe('1h');
    expect(formatGap(7170)).toBe('2h');
    expect(formatGap(7199)).toBe('2h');
  });

  it('keeps the readings that were already right', () => {
    expect(formatGap(59)).toBe('59s');
    expect(formatGap(60)).toBe('1m');
    expect(formatGap(961)).toBe('16m');
    expect(formatGap(3600)).toBe('1h');
    expect(formatGap(3630)).toBe('1h 1m');
    expect(formatGap(5400)).toBe('1h 30m');
  });

  it('never prints sixty minutes', () => {
    for (let s = 0; s <= 3 * 3600; s++) {
      expect(formatGap(s), `${s} seconds`).not.toMatch(/(^|\s)60m$/);
    }
  });
});
