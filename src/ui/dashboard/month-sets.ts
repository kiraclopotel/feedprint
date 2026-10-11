// Each archived month counted by the dashboard's own rules (record-sets.ts).
//
// The month summaries under src/forensics count "flagged" by the store's rule,
// which also counts a flagged image reading or "Read this for me" reading. The
// loaded months count by the module's rule, which does not, so the Activity
// badge would change when a tab loads an old month. This file recounts each archived month from
// its stored rows with countRecordSets, once per month and version, and keeps
// the result beside the summary, never in it: the summary store is forensics
// code and is only read here.
//
// Derived data. Nothing in the record changes: the rows are read through
// archive-reader (read only; it never upgrades or writes an archive), and the
// counts live beside the theme cache in the derived-data database
// (month-sets-store.ts), which the chain reset empties. Deleting it loses nothing; the next open counts
// again.
//
// A stored count is used only while it still describes the month: the same
// version of this file and the same fingerprint of the month's summary (its
// row count and its flagged, blocked and unsigned counts, which the summary
// store keeps true to the stored rows on every read). A month that is gone
// from the archive listing is dropped.
//
// The flagged ids are kept, not only the flagged count, so the badge can skip
// an item that is in an unloaded month and in the active chain as well (an
// eviction caught mid-move, or a restore), exactly as allRecords does for the
// months that are loaded.

import type { ForensicRecord } from '../../types/forensic';
import { recordsInSummaries, type MonthSummary } from '../../forensics/archive-summary';
import { countRecordSets, isFlaggedItem, type RecordSetCounts } from './record-sets';

/** Bump when record-sets.ts changes what a set holds: every month counts again. */
// 2: "seen a lot" left flagged (10 Oct 2026).
export const MONTH_SETS_VERSION = 2;

export interface MonthSets {
  version: number;
  monthKey: string;
  /** The summary this count was made against (summaryFingerprint). */
  fingerprint: string;
  /** Stored rows that would not decode; they are in the summary's row count, not in `counts`. */
  unreadable: number;
  counts: RecordSetCounts;
  /** Ids of the month's flagged items, by the module's rule. */
  flaggedIds: string[];
  /** When it was counted, ISO. */
  countedAt: string;
}

export function summaryFingerprint(s: MonthSummary): string {
  return `${s.recordCount}:${s.flagged}:${s.blocked}:${s.unsigned}`;
}

/** True while the stored count still describes the month its summary describes. */
export function isFreshFor(sets: MonthSets | undefined, summary: MonthSummary): sets is MonthSets {
  return !!sets && sets.version === MONTH_SETS_VERSION && sets.monthKey === summary.monthKey
    && sets.fingerprint === summaryFingerprint(summary);
}

/** One month's sets from its stored rows. Pure. */
export function countMonthSets(
  summary: MonthSummary,
  records: readonly ForensicRecord[],
  unreadable: number,
  now: Date = new Date(),
): MonthSets {
  return {
    version: MONTH_SETS_VERSION,
    monthKey: summary.monthKey,
    fingerprint: summaryFingerprint(summary),
    unreadable,
    counts: countRecordSets(records),
    flaggedIds: records.filter(isFlaggedItem).map((r) => r.id),
    countedAt: now.toISOString(),
  };
}

/** The months whose stored count is missing or no longer describes them, oldest first. */
export function monthsToCount(
  summaries: readonly MonthSummary[],
  stored: ReadonlyMap<string, MonthSets>,
): MonthSummary[] {
  return summaries.filter((s) => !isFreshFor(stored.get(s.monthKey), s));
}

export interface OlderMonthsProgress {
  /** Months counted by the module's rules so far in this run. */
  done: number;
  /** Months this run set out to count. */
  total: number;
}


const NO_SETS: ReadonlyMap<string, MonthSets> = new Map();

/**
 * The Activity badge: flagged items over all months, by the module's rule. A
 * month that is not loaded adds its counted flagged ids that are not loaded
 * already, so an item kept in an old month and in the active chain counts
 * once, as allRecords counts it. A month not counted yet adds its summary's
 * flagged count, which also counts a flagged image or button reading, until
 * its count is ready (olderMonthsNotCounted says how many).
 */
export function flaggedItemsAllMonths(
  loaded: readonly ForensicRecord[],
  unloadedSummaries: readonly MonthSummary[],
  monthSets: ReadonlyMap<string, MonthSets> = NO_SETS,
): number {
  let n = countRecordSets(loaded).flagged;
  let seen: Set<string> | null = null;
  for (const summary of unloadedSummaries) {
    const sets = monthSets.get(summary.monthKey);
    if (!isFreshFor(sets, summary)) {
      n += summary.flagged;
      continue;
    }
    if (!seen) seen = new Set(loaded.map((r) => r.id));
    for (const id of sets.flaggedIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      n += 1;
    }
  }
  return n;
}

/** The unloaded months still counted by their summary, not by the module. */
export function olderMonthsNotCounted(
  unloadedSummaries: readonly MonthSummary[],
  monthSets: ReadonlyMap<string, MonthSets> = NO_SETS,
): number {
  return unloadedSummaries.filter((s) => !isFreshFor(monthSets.get(s.monthKey), s)).length;
}

export interface EntriesBreakdown {
  /** The header's number. */
  total: number;
  /** The months loaded in the page, sorted into their sets. */
  loaded: RecordSetCounts;
  /** Stored rows in the months not loaded, from their summaries. */
  olderCounted: number;
  /** Those months sorted into the same sets, once every one of them is counted; null until then. */
  olderSorted: RecordSetCounts | null;
  /** Rows in those months that would not decode: olderCounted = olderSorted.entries + olderUnreadable. */
  olderUnreadable: number;
  /** What the header counts that none of the above reached: stored rows that would not open or decode. */
  unaccounted: number;
}

function addCounts(into: RecordSetCounts, c: RecordSetCounts): void {
  for (const k of ['entries', 'seen', 'items', 'checked', 'passed', 'flagged', 'seenALot', 'blocked', 'notChecked', 'roomSummaries', 'markers'] as const) {
    into[k] += c[k];
  }
  if (c.firstDay && (!into.firstDay || c.firstDay < into.firstDay)) into.firstDay = c.firstDay;
  if (c.lastDay && (!into.lastDay || c.lastDay > into.lastDay)) into.lastDay = c.lastDay;
}

/** The header chip opened: each line counted on its own, and what is left named, never folded in. */
export function entriesBreakdown(
  total: number,
  loaded: readonly ForensicRecord[],
  unloadedSummaries: readonly MonthSummary[],
  monthSets: ReadonlyMap<string, MonthSets> = NO_SETS,
): EntriesBreakdown {
  const sets = countRecordSets(loaded);
  const olderCounted = recordsInSummaries(unloadedSummaries);
  let olderSorted: RecordSetCounts | null = null;
  let olderUnreadable = 0;
  if (unloadedSummaries.length > 0 && olderMonthsNotCounted(unloadedSummaries, monthSets) === 0) {
    olderSorted = countRecordSets([]);
    for (const summary of unloadedSummaries) {
      const month = monthSets.get(summary.monthKey) as MonthSets;
      addCounts(olderSorted, month.counts);
      olderUnreadable += month.unreadable;
    }
  }
  return { total, loaded: sets, olderCounted, olderSorted, olderUnreadable, unaccounted: total - sets.entries - olderCounted };
}

/** The whole record's sets: the loaded months counted here, the older ones from their saved counts. */
export interface WholeRecordSets {
  sets: RecordSetCounts;
  /** Entries in older months not counted yet; the sets leave them out until they are. */
  olderPending: number;
  /** Stored entries no line reached, because they would not open or decode. */
  unread: number;
}

/**
 * The Statistics tab counts the whole record, not only the months the page loaded: as the record grows its older
 * months leave the loaded window, and a share counted on the window alone would quietly describe less and less of it.
 */
export function wholeRecordSets(
  total: number,
  loaded: readonly ForensicRecord[],
  unloadedSummaries: readonly MonthSummary[],
  monthSets: ReadonlyMap<string, MonthSets> = NO_SETS,
): WholeRecordSets {
  const b = entriesBreakdown(total, loaded, unloadedSummaries, monthSets);
  const sets = { ...b.loaded };
  if (b.olderSorted) addCounts(sets, b.olderSorted);
  return {
    sets,
    olderPending: b.olderSorted ? 0 : b.olderCounted,
    unread: b.olderUnreadable + Math.max(0, b.unaccounted),
  };
}
