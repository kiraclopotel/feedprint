// The quiet-hours schedule of `media-timeout`. In core because the content script runs it and both
// popups read it. No DOM, no chrome, no clock of its own (the caller passes `now`), so the whole
// schedule can be tested without a browser.
//
// The schedule rides on the feature toggle's value as `{ schedule: QuietHoursWindow[] }`, per
// platform or global; with none, nothing changes, so no settings migration was needed. The manual
// toggle wins both ways: on blocks now whatever the schedule says, and only off hands control to
// the schedule, so a parent who wants the block gone flips the switch.
//
// Minutes are counted from local midnight on the device, not UTC: "21:00" means 21:00 where the
// child sits. A window's days name the day it starts, so an overnight window (22:00 to 06:00)
// listed for Friday runs into Saturday morning. Reading it the other way would move a school-night
// block by a day. `endMin` may be 1440, meaning "to midnight".
//
// A malformed window is dropped, not treated as a block. Failing closed suits the protection
// paths, where the alternative is exposure; here it would block a platform around the clock on a
// payload no parent wrote, with the parent's toggle off. An empty schedule also means "nothing to
// schedule", which the engagement controller relies on.

export interface QuietHoursWindow {
  /** getDay() numbers, 0 = Sunday: the day the window starts. */
  days: number[];
  /** Minutes since local midnight, inclusive. 0-1439. */
  startMin: number;
  /** Minutes since local midnight, exclusive. 1-1440. */
  endMin: number;
}

interface MediaTimeoutValue {
  schedule?: QuietHoursWindow[];
}

const MINUTES_PER_DAY = 1440;

function isValidMinute(n: unknown, max: number): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= max;
}

function readWindow(raw: unknown): QuietHoursWindow | null {
  if (!raw || typeof raw !== 'object') return null;
  const w = raw as Record<string, unknown>;
  if (!isValidMinute(w.startMin, MINUTES_PER_DAY - 1)) return null;
  if (!isValidMinute(w.endMin, MINUTES_PER_DAY) || w.endMin === 0) return null;
  // A zero-length window covers nothing; keeping it would make a schedule
  // look like work when it has none.
  if (w.startMin === w.endMin) return null;
  if (!Array.isArray(w.days)) return null;
  const days = w.days.filter(
    (d): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6,
  );
  if (days.length === 0) return null;
  return { days, startMin: w.startMin, endMin: w.endMin };
}

/** Only the well-formed windows; an empty array means nothing to schedule. */
export function readQuietHoursSchedule(featureValue: unknown): QuietHoursWindow[] {
  if (!featureValue || typeof featureValue !== 'object') return [];
  const raw = (featureValue as MediaTimeoutValue).schedule;
  if (!Array.isArray(raw)) return [];
  const windows: QuietHoursWindow[] = [];
  for (const entry of raw) {
    const w = readWindow(entry);
    if (w) windows.push(w);
  }
  return windows;
}

export function isWithinQuietHours(
  schedule: readonly QuietHoursWindow[],
  now: Date,
): boolean {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const today = now.getDay();
  const yesterday = (today + 6) % 7;

  for (const w of schedule) {
    if (w.startMin < w.endMin) {
      if (w.days.includes(today) && nowMin >= w.startMin && nowMin < w.endMin) {
        return true;
      }
      continue;
    }
    // Overnight: the end of the start day, then the start of the next.
    if (w.days.includes(today) && nowMin >= w.startMin) return true;
    if (w.days.includes(yesterday) && nowMin < w.endMin) return true;
  }
  return false;
}
