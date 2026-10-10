// buildUsageBuckets: the Forensics tab's "usage over time" histogram. One
// bucket per unit of the chosen frame, ending at `nowMs`; a record lands in
// the bucket its timestamp falls in and is counted once under exactly one of
// blocked / flagged / pass (flagged covers flagged, flagged-hidden and the
// legacy undefined verdict, the same set the rest of the dashboard uses).
// Records at or after `nowMs`, or before the frame's start, are not counted.

import { describe, expect, it } from 'vitest';
import { buildUsageBuckets } from '../../../../../src/ui/dashboard/components/UsageTimePanel';
import type { ForensicRecord } from '../../../../../src/types/forensic';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-06-11T12:00:00.000Z');

function rec(id: string, msAgo: number, verdict?: ForensicRecord['verdict']): ForensicRecord {
  const base = {
    id,
    timestamp: new Date(NOW - msAgo).toISOString(),
    platform: 'tiktok',
    author: 'a',
    postUrl: 'https://www.tiktok.com/@a/video/1',
    feedSource: 'foryou',
    originalText: 't',
    originalHash: 'h',
    originalLength: 1,
    neutralizedText: '',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    integrityHash: 'ih',
    ...(verdict === undefined ? {} : { verdict }),
  };
  return base as unknown as ForensicRecord;
}

describe('buildUsageBuckets', () => {
  it.each([
    ['day', 24, HOUR],
    ['week', 7, DAY],
    ['month', 30, DAY],
  ] as const)('frame %s yields %i contiguous buckets of %i ms ending at now', (frame, count, size) => {
    const b = buildUsageBuckets([], frame, NOW, 'en');
    expect(b).toHaveLength(count);
    expect(b[0].startMs).toBe(NOW - count * size);
    expect(b[count - 1].endMs).toBe(NOW);
    for (let i = 1; i < count; i++) expect(b[i].startMs).toBe(b[i - 1].endMs);
    expect(b.every((x) => x.count === 0 && x.flagged === 0 && x.blocked === 0 && x.pass === 0 && x.unjudged === 0)).toBe(true);
  });

  // Wiring audit 13 Sep 2026, D2-12: "year" used to be twelve 30-day buckets
  // labelled with month names under "last 12 months", a 360-day window that
  // started on no month. It is now twelve calendar months, the current one
  // last and cut at now.
  it('frame year yields the last 12 calendar months, the current month last and cut at now', () => {
    const b = buildUsageBuckets([], 'year', NOW, 'en');
    expect(b).toHaveLength(12);
    const now = new Date(NOW);
    expect(b[0].startMs).toBe(new Date(now.getFullYear(), now.getMonth() - 11, 1).getTime());
    expect(b[11].startMs).toBe(new Date(now.getFullYear(), now.getMonth(), 1).getTime());
    expect(b[11].endMs).toBe(NOW);
    for (let i = 1; i < 12; i++) expect(b[i].startMs).toBe(b[i - 1].endMs);
    for (const x of b) expect(new Date(x.startMs).getDate()).toBe(1);
    // A record on the first day of the oldest month is in it; one a day earlier is out.
    const inside = { ...rec('in', 0), timestamp: new Date(b[0].startMs + HOUR).toISOString() };
    const before = { ...rec('out', 0), timestamp: new Date(b[0].startMs - HOUR).toISOString() };
    const y = buildUsageBuckets([inside, before], 'year', NOW, 'en');
    expect(y[0].count).toBe(1);
    expect(y.reduce((s, x) => s + x.count, 0)).toBe(1);
  });

  // D2-13: a scan that reached no verdict is not a pass, and the chain's own
  // markers and room summaries are not things the person saw.
  it('files skipped and cancelled scans under "not judged", and does not count markers or room summaries', () => {
    const b = buildUsageBuckets([
      rec('skipped', HOUR, 'skipped'),
      rec('cancelled', HOUR, 'cancelled-stale'),
      rec('pass', HOUR, 'pass'),
      { ...rec('marker', HOUR, 'pass'), kind: 'heartbeat-marker' } as ForensicRecord,
      { ...rec('room', HOUR, 'pass'), kind: 'environment' } as ForensicRecord,
    ], 'day', NOW, 'en');
    const x = b[23];
    expect(x.count).toBe(3);
    expect(x.unjudged).toBe(2);
    expect(x.pass).toBe(1);
    expect(x.flagged + x.blocked + x.pass + x.unjudged).toBe(x.count);
  });

  it('places each record in the bucket its timestamp falls in', () => {
    const b = buildUsageBuckets([
      rec('a', 30 * 60 * 1000),        // 30 min ago -> last bucket
      rec('b', 2 * HOUR + 1),          // just over 2 h ago -> third from last
      rec('c', 23 * HOUR + 59 * 60 * 1000), // almost 24 h ago -> first bucket
    ], 'day', NOW, 'en');
    expect(b[23].count).toBe(1);
    expect(b[21].count).toBe(1);
    expect(b[0].count).toBe(1);
    expect(b.reduce((s, x) => s + x.count, 0)).toBe(3);
  });

  it('does not count records at or after now, before the frame start, or with an unparseable timestamp', () => {
    const future = rec('f', -1);
    const atNow = rec('n', 0);
    const tooOld = rec('o', 24 * HOUR + 1);
    const garbage = { ...rec('g', HOUR), timestamp: 'not-a-date' } as ForensicRecord;
    const b = buildUsageBuckets([future, atNow, tooOld, garbage], 'day', NOW, 'en');
    expect(b.reduce((s, x) => s + x.count, 0)).toBe(0);
  });

  it('counts every record once under exactly one of blocked / flagged / pass', () => {
    const b = buildUsageBuckets([
      rec('blocked', HOUR, 'blocked'),
      rec('flagged', HOUR, 'flagged'),
      rec('hidden', HOUR, 'flagged-hidden'),
      rec('legacy', HOUR),
      rec('pass', HOUR, 'pass'),
      rec('reframe', HOUR, 'educational-reframe'),
    ], 'day', NOW, 'en');
    const x = b[23];
    expect(x.count).toBe(6);
    expect(x.blocked).toBe(1);
    expect(x.flagged).toBe(3);
    expect(x.pass).toBe(2);
    expect(x.blocked + x.flagged + x.pass).toBe(x.count);
  });

  it('labels day buckets by local hour, oldest first', () => {
    const b = buildUsageBuckets([], 'day', NOW, 'en');
    const expected = `${String(new Date(b[0].startMs).getHours()).padStart(2, '0')}h`;
    expect(b[0].label).toBe(expected);
    expect(new Set(b.map((x) => x.label)).size).toBe(24);
  });
});
