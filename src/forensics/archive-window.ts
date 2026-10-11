// FeelingWise — the walk window (item 7, second slice, 14 Sep 2026).
//
// The first slice gave every archived month a summary, so the dashboard
// boots without reading a single archived record. The tabs that walk records
// (Overview, Exposure, Patterns, Statistics, Activity once opened) still read
// every archived month the first time one of them opened: at the owner's
// pace, about 2,900 records a day, that is a million records a year unpacked
// into the page for a tab whose widest view is eight weeks.
//
// This module bounds that walk. The record-walking tabs read the archived
// months that overlap the last WALK_WINDOW_DAYS days and nothing older; every
// figure that says "all-time" or "the whole record" keeps coming from the
// summaries of the months that were not loaded, folded with the records that
// were (archive-summary.ts). The two halves never overlap: a month is either
// loaded (its records count) or summarised (its summary counts), never both.
//
// What stays outside this window on purpose:
//   • Verify (Dashboard.tsx onVerify) walks every month, because a chain
//     check that skipped a month would not be one.
//   • The export and the backup read what they always read.
//
// The widest window any tab draws today: Exposure's "last 4 weeks" against
// the 4 weeks before it (56 days), Patterns' 28 days, Statistics' 8 weekly
// buckets (56 days), Overview's 7 days against the 7 before. 90 days covers
// every one with a month to spare, so the tabs show exactly what they showed
// when every month was loaded.

import type { ForensicRecord } from '../types/forensic';
import type { ChainAnchor } from './chain-anchor-store';
import { utcMonthKey } from './archive-naming';
import { readArchiveAnchors, readArchiveRecordsDetailed } from './archive-reader';
import type { MonthSummary } from './archive-summary';

export const WALK_WINDOW_DAYS = 90;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The 'YYYY-MM' of the day `days` days before `now`; months at or after it are in the window. */
export function walkWindowStartMonth(now: Date, days: number = WALK_WINDOW_DAYS): string {
  return utcMonthKey(new Date(now.getTime() - days * MS_PER_DAY));
}

/**
 * The archived months to load for the record-walking tabs: those at or after
 * the window's start month, oldest first. 'YYYY-MM' keys compare as text.
 */
export function monthKeysInWindow(
  monthKeys: readonly string[],
  now: Date,
  days: number = WALK_WINDOW_DAYS,
): string[] {
  const start = walkWindowStartMonth(now, days);
  return monthKeys.filter((k) => k >= start).sort();
}

interface LoadedMonth {
  monthKey: string;
  records: ForensicRecord[];
  anchors: ChainAnchor[];
}

export interface ArchiveReaders {
  records: (monthKey: string) => Promise<ForensicRecord[]>;
  anchors: (monthKey: string) => Promise<ChainAnchor[]>;
}

/**
 * A month's readable records. A row that will not decode is left out and
 * counted in the log, so it costs the tabs that one row and not the month.
 */
async function readWalkableRecords(monthKey: string): Promise<ForensicRecord[]> {
  const { records, unreadable } = await readArchiveRecordsDetailed(monthKey);
  if (unreadable.length > 0) {
    console.warn(`[FeelingWise] archived month ${monthKey}: ${unreadable.length} stored row(s) did not decode and are left out of the walk window`);
  }
  return records;
}

const defaultReaders: ArchiveReaders = { records: readWalkableRecords, anchors: readArchiveAnchors };

export interface LoadArchiveMonthsResult {
  /** The months that could be read, oldest first — exactly the loaded set. */
  months: LoadedMonth[];
  /** Requested month keys that could not be read and stay summarised instead. */
  unreadableMonths: string[];
}

/**
 * The named months with their records and anchors, oldest first. A month that
 * cannot be read is named in `unreadableMonths` instead of only logged: the
 * caller's loaded set is exactly `months`, so the fold never double counts
 * and never drops a month silently, but before `unreadableMonths` existed
 * (adversarial read, 18 Sep 2026) nothing in the return value said which
 * month, or how many, were missing from it.
 */
export async function loadArchiveMonths(
  monthKeys: readonly string[],
  readers: ArchiveReaders = defaultReaders,
): Promise<LoadArchiveMonthsResult> {
  const months: LoadedMonth[] = [];
  const unreadableMonths: string[] = [];
  for (const monthKey of [...monthKeys].sort()) {
    try {
      months.push({
        monthKey,
        records: await readers.records(monthKey),
        anchors: await readers.anchors(monthKey),
      });
    } catch (err) {
      console.warn(`[FeelingWise] archived month ${monthKey} unavailable for the walk window:`, err);
      unreadableMonths.push(monthKey);
    }
  }
  return { months, unreadableMonths };
}

/** The summaries of the months whose records are NOT loaded: the half of the record that is counted, not walked. */
export function summariesOutsideLoaded(
  summaries: readonly MonthSummary[],
  loadedMonthKeys: ReadonlySet<string>,
): MonthSummary[] {
  return summaries.filter((s) => !loadedMonthKeys.has(s.monthKey));
}
