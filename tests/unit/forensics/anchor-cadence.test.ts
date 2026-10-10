// The cadence the product promises: the head is stamped every few hours.
//
// The site and the letters say the record is "anchored with independent RFC
// 3161 timestamp services every few hours". Two things made that untrue for
// the reader it matters most to.
//
// One: the alarm's first fire is its own period, so a fresh install waited six
// hours for its first anchor and its first key stamp. The owner's diagnostics
// read four hours with neither, and nothing in the code said why. That half is
// locked in service-worker.test.ts (delayInMinutes 15).
//
// Two: the only rule for anchoring again was a rule about volume, 50 new chain
// positions. A household that reads a little never adds 50 between two
// six-hour ticks, so its head could sit unstamped for days. This file locks
// the rule about time that now sits beside it.

import { describe, it, expect } from 'vitest';
import {
  ANCHOR_AGE_SLACK_MINUTES,
  anchorDueOnHeartbeat,
  anchorIsStale,
  HEARTBEAT_STAMP_RETRY_MINUTES,
  MAX_HOURS_BETWEEN_ANCHORS,
} from '../../../src/forensics/chain-anchor-store';

const NOW = Date.parse('2026-09-17T12:00:00.000Z');
const hoursAgo = (h: number): string => new Date(NOW - h * 3600_000).toISOString();

describe('when the chain head is stamped again', () => {
  it('a light reader whose chain grew a little is stamped after the hours pass', () => {
    // 12 new positions, and the last anchor is a day old. When volume alone decided, that head was never stamped.
    expect(anchorIsStale({ requestedAt: hoursAgo(24), anchoredChainPosition: 100 }, 112, NOW)).toBe(true);
  });

  it('an idle install is not stamped again, however long it has been', () => {
    // The head has not moved, so there is nothing new to cover and a fresh
    // token would say nothing a reader does not already have.
    expect(anchorIsStale({ requestedAt: hoursAgo(72), anchoredChainPosition: 100 }, 100, NOW)).toBe(false);
    expect(anchorIsStale({ requestedAt: hoursAgo(72), anchoredChainPosition: 100 }, 99, NOW)).toBe(false);
  });

  it('a fresh anchor holds: the hours have to pass first', () => {
    expect(anchorIsStale({ requestedAt: hoursAgo(1), anchoredChainPosition: 100 }, 140, NOW)).toBe(false);
    expect(
      anchorIsStale({ requestedAt: hoursAgo(MAX_HOURS_BETWEEN_ANCHORS), anchoredChainPosition: 100 }, 101, NOW),
    ).toBe(true);
  });

  it('the next tick stamps even though the last anchor was written after its own tick', () => {
    // requestedAt is written once the authorities have answered, seconds to minutes after the
    // alarm fired, and the next tick comes exactly one period after that fire. Without slack the
    // anchor is always a little younger than the window, and a light reader waits a second
    // period: twelve hours, not six.
    const short = (seconds: number): string => new Date(NOW - MAX_HOURS_BETWEEN_ANCHORS * 3600_000 + seconds * 1000).toISOString();
    expect(anchorIsStale({ requestedAt: short(30), anchoredChainPosition: 100 }, 101, NOW)).toBe(true);
    expect(anchorIsStale({ requestedAt: short(5 * 60), anchoredChainPosition: 100 }, 101, NOW)).toBe(true);
  });

  it('the slack stays a small share of the window, so a young anchor still holds', () => {
    expect(ANCHOR_AGE_SLACK_MINUTES).toBeGreaterThan(0);
    expect(ANCHOR_AGE_SLACK_MINUTES).toBeLessThanOrEqual(30);
    expect(anchorIsStale({ requestedAt: hoursAgo(MAX_HOURS_BETWEEN_ANCHORS - 1), anchoredChainPosition: 100 }, 140, NOW)).toBe(false);
  });

  it('an anchor with an unreadable time is never called stale', () => {
    // A malformed row must not turn the anchor path into a timer that asks
    // three authorities for a token on every tick.
    expect(anchorIsStale({ requestedAt: '', anchoredChainPosition: 1 }, 999, NOW)).toBe(false);
    expect(anchorIsStale({ requestedAt: 'not a date', anchoredChainPosition: 1 }, 999, NOW)).toBe(false);
    expect(
      anchorIsStale({ requestedAt: undefined as unknown as string, anchoredChainPosition: 1 }, 999, NOW),
    ).toBe(false);
  });

  it('the hours are no longer than the alarm that checks them', () => {
    // A window wider than the six-hour alarm would mean a tick that finds the
    // anchor one minute too young and waits another six hours, which turns
    // "every few hours" into up to twelve.
    expect(MAX_HOURS_BETWEEN_ANCHORS).toBeLessThanOrEqual(6);
  });
});

describe('when the 15-minute heartbeat asks for a stamp', () => {
  const minutesAgo = (m: number): string => new Date(NOW - m * 60_000).toISOString();

  it('asks once six hours have passed since the last stamp, so a half-hour reader is stamped the same day', () => {
    expect(anchorDueOnHeartbeat({ requestedAt: hoursAgo(6) }, null, NOW)).toBe(true);
    expect(anchorDueOnHeartbeat({ requestedAt: hoursAgo(30) }, hoursAgo(30), NOW)).toBe(true);
  });

  it('does not ask a minute before six hours, so a heavy reader is stamped no more often than by the alarm', () => {
    expect(anchorDueOnHeartbeat({ requestedAt: minutesAgo(6 * 60 - 1) }, null, NOW)).toBe(false);
    expect(anchorDueOnHeartbeat({ requestedAt: hoursAgo(1) }, null, NOW)).toBe(false);
    expect(MAX_HOURS_BETWEEN_ANCHORS).toBe(6);
  });

  it('asks when the install has no stamp yet', () => {
    expect(anchorDueOnHeartbeat(null, null, NOW)).toBe(true);
  });

  it('waits an hour after an attempt, so authorities out of reach are not asked every quarter of an hour', () => {
    expect(anchorDueOnHeartbeat({ requestedAt: hoursAgo(9) }, minutesAgo(15), NOW)).toBe(false);
    expect(anchorDueOnHeartbeat(null, minutesAgo(HEARTBEAT_STAMP_RETRY_MINUTES - 1), NOW)).toBe(false);
    expect(anchorDueOnHeartbeat({ requestedAt: hoursAgo(9) }, minutesAgo(HEARTBEAT_STAMP_RETRY_MINUTES), NOW)).toBe(true);
  });

  it('does not let an unreadable stamp time make every tick ask', () => {
    expect(anchorDueOnHeartbeat({ requestedAt: 'not a date' }, null, NOW)).toBe(false);
    expect(anchorDueOnHeartbeat({ requestedAt: hoursAgo(9) }, 'not a date', NOW)).toBe(true);
  });
});
