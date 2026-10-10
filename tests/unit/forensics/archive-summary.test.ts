// Item 7 (14 Sep 2026), the pure half: a month's summary, folded with the
// active chain's stats, equals computeStats over all the records. If this
// equality ever breaks, the summary has become a second truth and must not
// ship; the dashboard reads it in place of the archived records at boot.

import { describe, expect, it } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';
import { computeStats } from '../../../src/forensics/store';
import {
  addRecordsToSummary,
  emptyMonthSummary,
  flaggedInSummaries,
  foldSummariesIntoStats,
  hourKeyOf,
  recordsInSummaries,
  summarizeMonth,
} from '../../../src/forensics/archive-summary';

const PLATFORMS = ['tiktok', 'instagram', 'twitter', 'facebook', 'youtube'];
const TECHNIQUES = ['anger-trigger', 'fear-appeal', 'genuine opinion', 'Genuine-Opinion', 'shame-attack', 'made by ai'];
const VERDICTS: Array<ForensicRecord['verdict']> = ['pass', 'flagged', 'flagged-hidden', 'blocked', 'skipped', undefined, 'pass', 'flagged'];

/** A deterministic spread of records across `months` months ending at `end`. */
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
      techniques: flaggedLike
        ? [
          { name: TECHNIQUES[i % TECHNIQUES.length], severity: 5, confidence: 0.9 },
          // A second label that folds into the first's canonical bucket on
          // some records: counted once per record, as computeStats does.
          { name: TECHNIQUES[(i + 3) % TECHNIQUES.length], severity: 4, confidence: 0.8 },
        ]
        : [],
      overallScore: flaggedLike ? 5 : 0,
      userAgeCategory: 'adult',
      verdict,
      chainPosition: i,
      signature: i % 7 === 0 ? undefined : 'sig',
      chainAnchor: i % 11 === 0 ? 'pre-rekey' : undefined,
    } as unknown as ForensicRecord);
  }
  return out;
}

function monthOf(r: ForensicRecord): string {
  return r.timestamp.slice(0, 7);
}

const wholeHourZone = new Date().getTimezoneOffset() % 60 === 0;

describe('archive summary equals computeStats', () => {
  const now = new Date();
  const all = build(6000, now, 4);
  // Split: the oldest three months archived, the newest slice active, with
  // an archive that also holds part of the current month (eviction does).
  const byMonth = new Map<string, ForensicRecord[]>();
  for (const r of all) {
    const k = monthOf(r);
    byMonth.set(k, [...(byMonth.get(k) ?? []), r]);
  }
  const months = [...byMonth.keys()].sort();
  const active = all.slice(all.length - 700);
  const activeIds = new Set(active.map(r => r.id));
  const archived = all.filter(r => !activeIds.has(r.id));
  const summaries = months
    .map(m => summarizeMonth(m, archived.filter(r => monthOf(r) === m)))
    .filter(s => s.recordCount > 0);

  it('counts every record it was given and no other', () => {
    expect(recordsInSummaries(summaries)).toBe(archived.length);
    expect(flaggedInSummaries(summaries)).toBe(
      archived.filter(r => r.verdict === 'flagged' || r.verdict === 'flagged-hidden' || r.verdict === undefined).length,
    );
  });

  it('folded with the active chain it equals computeStats over everything', () => {
    const expected = computeStats([...archived, ...active]);
    const got = foldSummariesIntoStats(computeStats(active), summaries, now);
    expect(got.total).toBe(expected.total);
    expect(got.blockedTotal).toBe(expected.blockedTotal);
    expect(got.unsignedRecordsCount).toBe(expected.unsignedRecordsCount);
    expect(got.byPlatform).toEqual(expected.byPlatform);
    expect(got.byTechnique).toEqual(expected.byTechnique);
    if (wholeHourZone) {
      expect(got.today).toBe(expected.today);
      expect(got.thisWeek).toBe(expected.thisWeek);
      expect(got.thisMonth).toBe(expected.thisMonth);
      expect(got.blockedThisWeek).toBe(expected.blockedThisWeek);
    } else {
      // A half-hour zone can be off by the records of one UTC hour.
      const perHour = Math.ceil(all.length / (4 * 30 * 24)) + 1;
      expect(Math.abs(got.today - expected.today)).toBeLessThanOrEqual(perHour);
      expect(Math.abs(got.thisWeek - expected.thisWeek)).toBeLessThanOrEqual(perHour);
      expect(Math.abs(got.thisMonth - expected.thisMonth)).toBeLessThanOrEqual(perHour);
    }
  });

  it('adding records incrementally gives the same summary as summarising at once', () => {
    const m = months[0];
    const recs = archived.filter(r => monthOf(r) === m);
    const atOnce = summarizeMonth(m, recs);
    const step = emptyMonthSummary(m);
    addRecordsToSummary(step, recs.slice(0, 100));
    addRecordsToSummary(step, recs.slice(100));
    const strip = (s: typeof atOnce) => ({ ...s, computedAt: '' });
    expect(strip(step)).toEqual(strip(atOnce));
  });

  it('holds counts only: no text, author, hash or id survives into the summary', () => {
    const json = JSON.stringify(summaries);
    expect(json).not.toContain('"originalText"');
    expect(json).not.toContain('"author"');
    expect(json).not.toContain('"originalHash"');
    expect(json).not.toContain('"id":"r');
  });

  it('hour keys are UTC hours and reject non-timestamps', () => {
    expect(hourKeyOf('2026-08-03T21:15:00.000Z')).toBe('2026-08-03T21');
    expect(hourKeyOf('2026-08-03T23:59:59.999+02:00')).toBe('2026-08-03T21');
    expect(hourKeyOf('not a date')).toBeNull();
    expect(hourKeyOf(undefined)).toBeNull();
  });
});
