// G5 (2026-08-04): previousPeriodWindow derived the baseline window by
// subtracting the current window's FIXED-MILLISECOND length. Local calendar
// days are 23–25h on DST-transition days (the same drift class ExposureView's
// '4-weeks' window fixed in F3c — "DST-safe day span, SOL finding 2"), so a
// baseline whose span crosses a transition started at 23:00/01:00 instead of
// local midnight: the far boundary drifted an hour against bucketByDay's
// local-midnight columns and the ISO-string record filter in ExposureView.
//
// The baseline must step back by LOCAL CALENDAR days — the same calendar-date
// arithmetic periodWindow itself uses — so both boundaries stay on local
// midnights whichever side of a transition they land on.
//
// TZ pinning: same technique as exposure-window-dst.test.ts — Node ≥16 honors
// runtime `process.env.TZ` reassignment on all platforms (verified on this
// repo's Windows runner, Node 24). America/New_York: spring-forward
// 2026-03-08, fall-back 2026-11-01. The offset sanity assertions fail loudly
// if pinning ever stops working.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { periodWindow, previousPeriodWindow } from '../../../src/forensics/data-layer';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

let savedTZ: string | undefined;

beforeAll(() => {
  savedTZ = process.env.TZ;
  process.env.TZ = 'America/New_York';
});

afterAll(() => {
  if (savedTZ === undefined) delete process.env.TZ;
  else process.env.TZ = savedTZ;
});

const winLen = (w: { startISO: string; endISO: string }) =>
  new Date(w.endISO).getTime() - new Date(w.startISO).getTime();

describe('previousPeriodWindow across DST transitions (G5)', () => {
  it('sanity: TZ pinning took effect (EST −300 / EDT −240)', () => {
    expect(new Date(2026, 0, 15).getTimezoneOffset()).toBe(300);
    expect(new Date(2026, 6, 15).getTimezoneOffset()).toBe(240);
  });

  it('baseline crossing spring-forward starts at local midnight, right calendar day', () => {
    // Week Sun 03-15 → Sun 03-22 (all EDT). Baseline = Sun 03-08 → Sun 03-15
    // crosses the 03-08 02:00 spring-forward. The fixed-ms form landed the
    // baseline start at Sat 03-07 23:00 EST — wrong calendar day.
    const current = periodWindow('week', new Date(2026, 2, 20));
    const prev = previousPeriodWindow(current);
    const start = new Date(prev.startISO);

    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(2); // March
    expect(start.getDate()).toBe(8);
    // Contract: baseline ends exactly where current starts.
    expect(prev.endISO).toBe(current.startISO);
    // 7 calendar days minus the skipped spring-forward hour.
    expect(winLen(prev)).toBe(7 * DAY_MS - HOUR_MS);
  });

  it('baseline crossing fall-back starts at local midnight', () => {
    // Week Sun 11-08 → Sun 11-15 (all EST). Baseline = Sun 11-01 → Sun 11-08
    // crosses the 11-01 02:00 fall-back. The fixed-ms form landed the
    // baseline start at 11-01 01:00 EDT — right day, wrong boundary.
    const current = periodWindow('week', new Date(2026, 10, 12));
    const prev = previousPeriodWindow(current);
    const start = new Date(prev.startISO);

    expect(start.getHours()).toBe(0);
    expect(start.getMonth()).toBe(10); // November
    expect(start.getDate()).toBe(1);
    expect(prev.endISO).toBe(current.startISO);
    // 7 calendar days plus the repeated fall-back hour.
    expect(winLen(prev)).toBe(7 * DAY_MS + HOUR_MS);
  });

  it('handles a CURRENT window that itself crosses the transition (odd-length span)', () => {
    // Week Sun 03-08 → Sun 03-15 is 7 days minus 1h. The day count must
    // round, not truncate, so the baseline is still exactly 7 calendar days
    // back: Sun 03-01 00:00, not 03-01 01:00.
    const current = periodWindow('week', new Date(2026, 2, 10));
    expect(winLen(current)).toBe(7 * DAY_MS - HOUR_MS);
    const prev = previousPeriodWindow(current);
    const start = new Date(prev.startISO);

    expect(start.getHours()).toBe(0);
    expect(start.getMonth()).toBe(2); // March
    expect(start.getDate()).toBe(1);
    expect(prev.endISO).toBe(current.startISO);
  });

  it('month baseline crossing spring-forward stays on a local midnight', () => {
    // April 2026 (30 days, all EDT) → baseline spans 30 calendar days back
    // from Apr 1, crossing 03-08: Mar 2 00:00, not Mar 1 23:00 EST.
    const current = periodWindow('month', new Date(2026, 3, 15));
    const prev = previousPeriodWindow(current);
    const start = new Date(prev.startISO);

    expect(start.getHours()).toBe(0);
    expect(start.getMonth()).toBe(2); // March
    expect(start.getDate()).toBe(2);
    expect(prev.endISO).toBe(current.startISO);
  });
});
