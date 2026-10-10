// Item 7, second slice (14 Sep 2026): the record-walking tabs read only the
// archived months inside the walk window; every older month stays a summary.
// The proof this slice owes: 200,000 records over two years, and
//   • the tabs' load reads only the months in the window (a bounded number
//     of records, never the whole record);
//   • the counters folded from the loaded months' records plus the other
//     months' summaries equal computeStats over all 200,000 records;
//   • the usage histogram's year frame, built from the window's records plus
//     the summaries, equals the one built from every record.
// If either equality ever breaks, a month is being counted twice or dropped.

import { describe, expect, it } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';
import { computeStats } from '../../../src/forensics/store';
import { utcMonthKey } from '../../../src/forensics/archive-naming';
import {
  MONTH_SUMMARY_VERSION,
  foldSummariesIntoStats,
  flaggedInSummaries,
  summarizeMonth,
  type MonthSummary,
} from '../../../src/forensics/archive-summary';
import {
  WALK_WINDOW_DAYS,
  loadArchiveMonths,
  monthKeysInWindow,
  summariesOutsideLoaded,
  walkWindowStartMonth,
} from '../../../src/forensics/archive-window';
import { buildUsageBuckets } from '../../../src/ui/dashboard/components/UsageTimePanel';

const PLATFORMS = ['tiktok', 'instagram', 'twitter', 'facebook', 'youtube'];
const TECHNIQUES = ['anger-trigger', 'fear-appeal', 'genuine opinion', 'shame-attack', 'made by ai'];
const VERDICTS: Array<ForensicRecord['verdict']> = [
  'pass', 'flagged', 'flagged-hidden', 'blocked', 'skipped', undefined, 'pass', 'masked', 'cancelled-dom-recycled', 'flagged',
];

/** `n` records spread evenly over `months` months ending at `end`, deterministic. */
function build(n: number, end: Date, months: number): ForensicRecord[] {
  const out: ForensicRecord[] = [];
  const span = months * 30 * 86_400_000;
  const start = end.getTime() - span;
  for (let i = 0; i < n; i++) {
    const verdict = VERDICTS[i % VERDICTS.length];
    const flaggedLike = verdict === 'flagged' || verdict === 'flagged-hidden' || verdict === undefined;
    out.push({
      id: `r${i}`,
      timestamp: new Date(start + Math.floor((i * span) / n)).toISOString(),
      platform: PLATFORMS[i % PLATFORMS.length],
      originalText: `t${i}`,
      originalHash: `h${i}`,
      originalLength: 2,
      techniques: flaggedLike ? [{ name: TECHNIQUES[i % TECHNIQUES.length], severity: 5, confidence: 0.9 }] : [],
      verdict,
      kind: i % 97 === 0 ? 'environment' : 'post',
      chainPosition: i,
      signature: i % 13 === 0 ? undefined : `sig${i}`,
    } as unknown as ForensicRecord);
  }
  return out;
}

/** Split records into archived months (every month but the newest) and the active chain (the newest month). */
function splitByMonth(records: ForensicRecord[]): { months: Map<string, ForensicRecord[]>; active: ForensicRecord[] } {
  const months = new Map<string, ForensicRecord[]>();
  for (const r of records) {
    const k = utcMonthKey(new Date(r.timestamp));
    const list = months.get(k) ?? [];
    list.push(r);
    months.set(k, list);
  }
  const keys = [...months.keys()].sort();
  const activeKey = keys[keys.length - 1];
  const active = months.get(activeKey)!;
  months.delete(activeKey);
  return { months, active };
}

describe('the walk window', () => {
  it('names the months at or after the window start, sorted, and nothing older', () => {
    const now = new Date('2026-09-14T12:00:00Z');
    expect(walkWindowStartMonth(now, 90)).toBe('2026-06');
    expect(monthKeysInWindow(['2025-01', '2026-08', '2026-05', '2026-06', '2026-07'], now, 90))
      .toEqual(['2026-06', '2026-07', '2026-08']);
    expect(monthKeysInWindow(['2026-01', '2026-02'], now, 90)).toEqual([]);
    expect(monthKeysInWindow([], now)).toEqual([]);
    // A window that crosses the year boundary.
    expect(walkWindowStartMonth(new Date('2026-02-01T00:00:00Z'), WALK_WINDOW_DAYS)).toBe('2025-11');
  });

  it('loads only the months named, oldest first, and skips a month that fails without dropping the rest', async () => {
    const read: string[] = [];
    const loaded = await loadArchiveMonths(['2026-08', '2026-06', '2026-07'], {
      records: async (k) => { read.push(k); if (k === '2026-07') throw new Error('gone'); return [{ id: k } as ForensicRecord]; },
      anchors: async () => [],
    });
    expect(read).toEqual(['2026-06', '2026-07', '2026-08']);
    expect(loaded.months.map((m) => m.monthKey)).toEqual(['2026-06', '2026-08']);
    // Confirmed by the adversarial read, 18 Sep 2026: the failed month used to
    // be visible only as a console warning. The caller now gets its name in
    // the return value, so it can say a month is missing instead of the fold
    // going quietly short.
    expect(loaded.unreadableMonths).toEqual(['2026-07']);
  });

  it('the summaries outside the loaded set are exactly the complement', () => {
    const s = (monthKey: string) => ({ monthKey } as MonthSummary);
    const all = [s('2026-01'), s('2026-06'), s('2026-07')];
    expect(summariesOutsideLoaded(all, new Set(['2026-06', '2026-07'])).map((x) => x.monthKey)).toEqual(['2026-01']);
    expect(summariesOutsideLoaded(all, new Set()).map((x) => x.monthKey)).toEqual(['2026-01', '2026-06', '2026-07']);
  });
});

describe('200,000 records over two years: the window reads a bounded slice and the counters stay whole', () => {
  const now = new Date();
  const N = 200_000;
  const all = build(N, now, 24);
  const { months, active } = splitByMonth(all);
  const monthKeys = [...months.keys()].sort();
  const summaries = monthKeys.map((k) => summarizeMonth(k, months.get(k)!));

  it('the fixture is what it says: 200,000 records, about two years of archived months, every summary current', () => {
    expect(all.length).toBe(N);
    expect(monthKeys.length).toBeGreaterThanOrEqual(23);
    expect(monthKeys.length).toBeLessThanOrEqual(25);
    for (const s of summaries) {
      expect(s.version).toBe(MONTH_SUMMARY_VERSION);
      expect(s.recordCount).toBe(months.get(s.monthKey)!.length);
    }
  });

  it('opening a record-walking tab reads only the months in the window: at most four months, never the whole record', async () => {
    const wanted = monthKeysInWindow(monthKeys, now, WALK_WINDOW_DAYS);
    expect(wanted.length).toBeGreaterThanOrEqual(2);
    expect(wanted.length).toBeLessThanOrEqual(4);
    let recordsRead = 0;
    const loaded = await loadArchiveMonths(wanted, {
      records: async (k) => { const r = months.get(k)!; recordsRead += r.length; return r; },
      anchors: async () => [],
    });
    expect(loaded.months.map((m) => m.monthKey)).toEqual(wanted);
    expect(loaded.unreadableMonths).toEqual([]);
    // Four months of a 24-month spread is a sixth of the record, with slack.
    expect(recordsRead).toBeLessThan(N / 5);
    expect(recordsRead).toBeGreaterThan(0);
  });

  it('records of the loaded months plus summaries of the rest equal computeStats over all 200,000', async () => {
    const wanted = monthKeysInWindow(monthKeys, now, WALK_WINDOW_DAYS);
    const loaded = await loadArchiveMonths(wanted, { records: async (k) => months.get(k)!, anchors: async () => [] });
    const loadedKeys = new Set(loaded.months.map((m) => m.monthKey));
    const inPage = [...loaded.months.flatMap((m) => m.records), ...active];
    const unloaded = summariesOutsideLoaded(summaries, loadedKeys);
    expect(unloaded.length + loadedKeys.size).toBe(summaries.length);

    const folded = foldSummariesIntoStats(computeStats(inPage), unloaded);
    const whole = computeStats(all);
    expect(folded.total).toBe(whole.total);
    expect(folded.blockedTotal).toBe(whole.blockedTotal);
    expect(folded.unsignedRecordsCount).toBe(whole.unsignedRecordsCount);
    expect(folded.byPlatform).toEqual(whole.byPlatform);
    expect(folded.byTechnique).toEqual(whole.byTechnique);
    // The time windows fall inside the loaded months, so they are the records' own.
    expect(folded.today).toBe(whole.today);
    expect(folded.thisWeek).toBe(whole.thisWeek);
    expect(folded.thisMonth).toBe(whole.thisMonth);
    expect(folded.blockedThisWeek).toBe(whole.blockedThisWeek);

    const flaggedInPage = inPage.filter((r) => r.verdict === 'flagged' || r.verdict === 'flagged-hidden' || r.verdict === undefined).length;
    expect(flaggedInPage + flaggedInSummaries(unloaded)).toBe(whole.total);
  });

  it('the usage histogram over a year, from the window plus the summaries, equals the one over every record', async () => {
    const wanted = monthKeysInWindow(monthKeys, now, WALK_WINDOW_DAYS);
    const loaded = await loadArchiveMonths(wanted, { records: async (k) => months.get(k)!, anchors: async () => [] });
    const inPage = [...loaded.months.flatMap((m) => m.records), ...active];
    const unloaded = summariesOutsideLoaded(summaries, new Set(loaded.months.map((m) => m.monthKey)));
    // A whole-hour instant, so the UTC hour buckets and the local frame edges
    // agree in a whole-hour zone (the panel's stated precision).
    const nowMs = Math.floor(now.getTime() / 3_600_000) * 3_600_000;
    for (const frame of ['year', 'month', 'week'] as const) {
      const fromWindow = buildUsageBuckets(inPage, frame, nowMs, 'en', unloaded);
      const fromAll = buildUsageBuckets(all, frame, nowMs, 'en');
      expect(fromWindow.map((b) => [b.count, b.flagged, b.blocked, b.pass, b.unjudged]), frame)
        .toEqual(fromAll.map((b) => [b.count, b.flagged, b.blocked, b.pass, b.unjudged]));
      expect(fromAll.reduce((s, b) => s + b.count, 0), frame).toBeGreaterThan(0);
    }
  });
});
