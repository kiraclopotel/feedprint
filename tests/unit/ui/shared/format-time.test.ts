// One clock per surface: the formatters, driven with a fixed instant and a
// fixed language, asserted against written-out strings.
//
// The zone is pinned to Asia/Tokyo (UTC+9, no DST) BEFORE the module under
// test is imported, for two reasons. It makes the local assertions
// reproducible on any machine, and it makes local and UTC nine hours apart, so
// a formatter that quietly returned UTC where local was asked for (the defect
// class this module closes) cannot pass.
process.env.TZ = 'Asia/Tokyo';

import { describe, expect, it } from 'vitest';
import {
  dayKeyAsLocalDate,
  formatDateLocal,
  formatDateLongLocal,
  formatDateTimeLocal,
  formatDayMonthLocal,
  formatDayOfMonth,
  formatHourAxis,
  formatMonthShort,
  formatTimeLocal,
  formatUtcStamp,
  formatUtcTime,
  formatWeekdayNarrow,
  formatWeekdayShort,
  localDayKey,
} from '../../../../src/ui/shared/format-time';

// 2026-09-18 14:50:44 UTC is 2026-09-18 23:50:44 in Tokyo: same calendar day,
// a clock nine hours apart.
const AT = '2026-09-18T14:50:44.000Z';
// 2026-09-18 17:30:00 UTC is 2026-09-19 02:30 in Tokyo: the NEXT calendar day.
// Any formatter that prints "18" for this instant is on the wrong clock.
const LATE = '2026-09-18T17:30:00.000Z';

describe('the zone the local assertions are written against', () => {
  it('is the pinned one, so a green run means what it says', () => {
    expect(new Date(AT).getTimezoneOffset()).toBe(-540);
  });
});

describe('the reader\'s clock, the reader\'s language', () => {
  it('writes a full instant in each shipped language', () => {
    expect(formatDateTimeLocal(AT, 'en')).toBe('Sep 18, 2026, 23:50');
    expect(formatDateTimeLocal(AT, 'ro')).toBe('18 sept. 2026, 23:50');
    expect(formatDateTimeLocal(AT, 'es')).toBe('18 sept 2026, 23:50');
    expect(formatDateTimeLocal(AT, 'pt-BR')).toBe('18 de set. de 2026, 23:50');
  });

  it('writes a date', () => {
    expect(formatDateLocal(AT, 'en')).toBe('Sep 18, 2026');
    expect(formatDateLocal(AT, 'ro')).toBe('18 sept. 2026');
    expect(formatDateLocal(AT, 'es')).toBe('18 sept 2026');
    expect(formatDateLocal(AT, 'pt-BR')).toBe('18 de set. de 2026');
  });

  it('writes a day named in full, for a heading', () => {
    expect(formatDateLongLocal(AT, 'en')).toBe('Friday, September 18');
    expect(formatDateLongLocal(AT, 'ro')).toBe('vineri, 18 septembrie');
  });

  it('writes a day and month with no year, for a chip', () => {
    expect(formatDayMonthLocal(AT, 'en')).toBe('Sep 18');
    expect(formatDayMonthLocal(AT, 'ro')).toBe('18 sept.');
  });

  it('writes a 24-hour wall clock, with and without seconds', () => {
    expect(formatTimeLocal(AT, 'en')).toBe('23:50');
    expect(formatTimeLocal(AT, 'en', true)).toBe('23:50:44');
    // The 24-hour clock is the same in every language on purpose: a reader
    // comparing this against the ledger's UTC stamp is doing arithmetic.
    expect(formatTimeLocal(AT, 'pt-BR', true)).toBe('23:50:44');
  });

  it('writes weekday and month labels for an axis', () => {
    expect(formatWeekdayShort(AT, 'en')).toBe('Fri');
    expect(formatWeekdayShort(AT, 'es')).toBe('vie');
    expect(formatWeekdayNarrow(AT, 'en')).toBe('F');
    expect(formatWeekdayNarrow(AT, 'es')).toBe('V');
    expect(formatMonthShort(AT, 'en')).toBe('Sep');
    expect(formatMonthShort(AT, 'ro')).toBe('sept.');
  });

  it('writes the deliberately number-only axis labels', () => {
    expect(formatHourAxis(AT)).toBe('23h');
    expect(formatDayOfMonth(AT)).toBe('18');
  });

  // The whole point of the local family. If any of these ever equals the UTC
  // answer, the formatter is reading the wrong clock.
  it('is the LOCAL day, not the UTC day, when the two differ', () => {
    expect(formatDateLocal(LATE, 'en')).toBe('Sep 19, 2026');
    expect(formatTimeLocal(LATE, 'en')).toBe('02:30');
    expect(formatWeekdayShort(LATE, 'en')).toBe('Sat');
    expect(formatDayOfMonth(LATE)).toBe('19');
  });

  it('does not read the browser language: the same instant differs by argument', () => {
    expect(formatDateLocal(AT, 'en')).not.toBe(formatDateLocal(AT, 'ro'));
    expect(formatDateLocal(AT, 'es')).not.toBe(formatDateLocal(AT, 'pt-BR'));
  });

  it('takes an ISO string, epoch ms, or a Date, and agrees with itself', () => {
    const ms = Date.parse(AT);
    expect(formatDateTimeLocal(ms, 'en')).toBe(formatDateTimeLocal(AT, 'en'));
    expect(formatDateTimeLocal(new Date(ms), 'en')).toBe(formatDateTimeLocal(AT, 'en'));
  });

  it('hands back the raw value rather than printing "Invalid Date"', () => {
    expect(formatDateTimeLocal('not-a-time', 'en')).toBe('not-a-time');
    expect(formatTimeLocal('', 'en')).toBe('');
    expect(formatUtcStamp('nonsense')).toBe('nonsense');
  });
});

describe('the record\'s own clock', () => {
  it('writes the sealed instant in UTC, in a fixed shape, in no language', () => {
    expect(formatUtcStamp(AT)).toBe('2026-09-18 14:50:44');
    expect(formatUtcStamp(LATE)).toBe('2026-09-18 17:30:00');
    expect(formatUtcTime(AT)).toBe('14:50:44');
    expect(formatUtcTime(AT, false)).toBe('14:50');
  });

  it('is nine hours from the local answer for the same instant, and says so', () => {
    expect(formatUtcTime(AT, false)).toBe('14:50');
    expect(formatTimeLocal(AT, 'en')).toBe('23:50');
    expect(formatUtcTime(AT, false)).not.toBe(formatTimeLocal(AT, 'en'));
  });
});

describe('calendar-day keys', () => {
  it('cuts a local day key, and the key follows the local day', () => {
    expect(localDayKey(AT)).toBe('2026-09-18');
    // 02:30 Tokyo on the 19th, from an instant still on the 18th in UTC.
    expect(localDayKey(LATE)).toBe('2026-09-19');
  });

  it('reads a key back at local noon, so it cannot slip a date', () => {
    const d = dayKeyAsLocalDate('2026-09-18');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8);
    expect(d.getDate()).toBe(18);
    expect(d.getHours()).toBe(12);
    expect(formatDateLocal(d, 'en')).toBe('Sep 18, 2026');
  });

  it('round-trips a key through the reader\'s language and back to the same day', () => {
    expect(localDayKey(dayKeyAsLocalDate('2026-01-01'))).toBe('2026-01-01');
    expect(localDayKey(dayKeyAsLocalDate('2026-12-31'))).toBe('2026-12-31');
  });
});
