// F3c (2026-08 dashboard honesty audit): ExposureView's '4-weeks' window was
// computed as weekEnd − 28 × 24h of milliseconds. Local calendar days are
// 23–25h on DST-transition days (the exact class OverviewTab fixed — "DST-safe
// day span, SOL finding 2"), so any 4-week window crossing a transition
// started at 23:00/01:00 the wrong calendar day: the boundary drifted an hour
// against bucketByDay's local-midnight columns and the record filter.
//
// The window must span 28 LOCAL CALENDAR days ending at the current week's
// end — same calendar-date arithmetic periodWindow itself uses.
//
// TZ pinning: Node ≥16 honors runtime `process.env.TZ` reassignment on all
// platforms (verified on this repo's Windows runner, Node 24); the repo's
// other period tests are merely DST-tolerant (±1h) because they don't pin a
// zone. This test pins America/New_York and anchors the fake clock after the
// 2026-03-08 spring-forward so the 28-day window provably crosses it — the
// offset sanity assertions below fail loudly if pinning ever stops working.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { windowsFor } from '../../../../../src/ui/dashboard/components/ExposureView';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

let savedTZ: string | undefined;

beforeAll(() => {
  savedTZ = process.env.TZ;
  process.env.TZ = 'America/New_York';
  vi.useFakeTimers();
  // Friday 2026-03-20 noon local (EDT). Week = Sun 03-15 → Sun 03-22;
  // the trailing 28 days reach back to 02-22, across the 03-08 transition.
  vi.setSystemTime(new Date(2026, 2, 20, 12, 0, 0));
});

afterAll(() => {
  vi.useRealTimers();
  if (savedTZ === undefined) delete process.env.TZ;
  else process.env.TZ = savedTZ;
});

describe("ExposureView windowsFor('4-weeks') across a DST transition (F3c)", () => {
  it('anchors the window start on a local midnight 28 calendar days back', () => {
    // Sanity: TZ pinning took effect (EST −300 / EDT −240). Without it this
    // test cannot exercise a DST crossing at all — fail loudly, not silently.
    expect(new Date(2026, 0, 15).getTimezoneOffset()).toBe(300);
    expect(new Date(2026, 6, 15).getTimezoneOffset()).toBe(240);

    const { current } = windowsFor('4-weeks');
    const start = new Date(current.startISO);
    const end = new Date(current.endISO);

    // Local midnight. The fixed-ms form landed at 23:00 the PREVIOUS
    // calendar day whenever the window crossed spring-forward.
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);

    // Exactly 28 local calendar days before the week end (2026-02-22).
    const expected = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 28);
    expect(current.startISO).toBe(expected.toISOString());
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(1); // February
    expect(start.getDate()).toBe(22);
  });

  it('spans 28 calendar days = 28×24h minus the skipped spring-forward hour', () => {
    const { current } = windowsFor('4-weeks');
    const len = new Date(current.endISO).getTime() - new Date(current.startISO).getTime();
    expect(len).toBe(28 * DAY_MS - HOUR_MS);
  });

  it('keeps the previousPeriodWindow contract: baseline ends where current starts', () => {
    const { current, previous } = windowsFor('4-weeks');
    expect(previous.endISO).toBe(current.startISO);
  });
});
