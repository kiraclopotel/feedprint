// FeelingWise — where a month's summary lives, and how it stays true.
//
// Each month archive (feelingwise-forensics-YYYY-MM) carries one summary
// document in its `summary` store (archive schema v3), keyed by the month.
// Two writers keep it current at the moment the archive changes:
//   • the eviction writer (archive-writer.ts) adds the records it appended,
//     when the summary's record count matched the store before the append;
//     otherwise it drops the summary so the next reader recomputes it;
//   • month rotation (chain-rotation.ts) drops the summary after its copy.
// The reader (readMonthSummaries) trusts a summary only when its record
// count equals the store's count, and recomputes and stores it otherwise. So
// a summary is never a second truth: a mismatch is repaired from the records
// the moment it is seen.
//
// This module opens archives through openArchiveDb, which upgrades a v1/v2
// month to v3 on first open; archive-reader.ts stays read-only by
// construction and is not touched.

import type { ForensicRecord } from '../types/forensic';
import {
  ARCHIVE_RECORDS_STORE,
  ARCHIVE_SUMMARY_STORE,
  archiveDbName,
  openArchiveDb,
} from './archive-naming';
import { listArchiveMonthsDetailed, readArchiveRecordsDetailed } from './archive-reader';
import { assertExtensionRealm } from '../storage/realm-guard';
import {
  MONTH_SUMMARY_VERSION,
  addRecordsToSummary,
  emptyMonthSummary,
  summarizeMonth,
  type MonthSummary,
} from './archive-summary';

function countStore(db: IDBDatabase, store: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** The stored summary of an open month archive, or null. */
export function readStoredSummary(db: IDBDatabase, monthKey: string): Promise<MonthSummary | null> {
  if (!db.objectStoreNames.contains(ARCHIVE_SUMMARY_STORE)) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const req = db.transaction(ARCHIVE_SUMMARY_STORE, 'readonly').objectStore(ARCHIVE_SUMMARY_STORE).get(monthKey);
    req.onsuccess = () => {
      const v = req.result as MonthSummary | undefined;
      resolve(v && v.version === MONTH_SUMMARY_VERSION && v.monthKey === monthKey ? v : null);
    };
    req.onerror = () => reject(req.error);
  });
}

export function writeStoredSummary(db: IDBDatabase, summary: MonthSummary): Promise<void> {
  if (!db.objectStoreNames.contains(ARCHIVE_SUMMARY_STORE)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ARCHIVE_SUMMARY_STORE, 'readwrite');
    tx.objectStore(ARCHIVE_SUMMARY_STORE).put(summary);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('summary write aborted'));
  });
}

function deleteStoredSummary(db: IDBDatabase, monthKey: string): Promise<void> {
  if (!db.objectStoreNames.contains(ARCHIVE_SUMMARY_STORE)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ARCHIVE_SUMMARY_STORE, 'readwrite');
    tx.objectStore(ARCHIVE_SUMMARY_STORE).delete(monthKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('summary delete aborted'));
  });
}

/**
 * Called by the eviction writer after it confirmed `appended` records are in
 * the month. `countBefore` is the store's count before the append. When the
 * stored summary described exactly that count, the appended records are added
 * to it; otherwise the summary is dropped and the next reader recomputes it
 * from the records. Best effort: a failure here leaves the summary absent or
 * stale-but-detectable (its count will not match), never wrong-and-trusted.
 */
export async function noteAppendedRecords(
  db: IDBDatabase,
  monthKey: string,
  appended: readonly ForensicRecord[],
  countBefore: number,
): Promise<void> {
  try {
    const stored = await readStoredSummary(db, monthKey);
    if (stored && stored.recordCount === countBefore) {
      await writeStoredSummary(db, addRecordsToSummary(stored, appended));
      return;
    }
    if (stored) await deleteStoredSummary(db, monthKey);
    else if (countBefore === 0) {
      // A brand new month: the appended records are the whole archive.
      await writeStoredSummary(db, addRecordsToSummary(emptyMonthSummary(monthKey), appended));
    }
  } catch (err) {
    console.warn(`[FeelingWise] month summary for ${monthKey} not updated:`, err);
    try { await deleteStoredSummary(db, monthKey); } catch { /* the reader recomputes */ }
  }
}

/** Called by month rotation after it copied records in: the reader recomputes. */
export async function dropSummaryForMonth(db: IDBDatabase, monthKey: string): Promise<void> {
  try { await deleteStoredSummary(db, monthKey); } catch (err) {
    console.warn(`[FeelingWise] month summary for ${monthKey} not dropped:`, err);
  }
}

/**
 * One month's summary, trusted only when its record count equals the store's,
 * recomputed from the records and stored otherwise. `readArchiveRecordsDetailed` is the
 * one expensive step, paid once per month that changed since its last summary.
 */
export async function readMonthSummary(monthKey: string): Promise<MonthSummary> {
  assertExtensionRealm(archiveDbName(monthKey));
  const db = await openArchiveDb(monthKey);
  let count = 0;
  try {
    if (db.objectStoreNames.contains(ARCHIVE_RECORDS_STORE)) count = await countStore(db, ARCHIVE_RECORDS_STORE);
    const stored = await readStoredSummary(db, monthKey);
    if (stored && stored.recordCount === count) return stored;
  } finally {
    db.close();
  }
  // Recompute outside the open handle: readArchiveRecordsDetailed opens its own.
  // A row that will not decode is left out of the figures rather than costing
  // the month its whole summary.
  const { records, unreadable } = await readArchiveRecordsDetailed(monthKey);
  const fresh = summarizeMonth(monthKey, records);
  // The rows the read found are the truth the summary describes, counted
  // whether or not they decoded so the count matches the store's; the store's
  // count above can differ if a write landed in between, in which case the
  // next reader sees the mismatch and recomputes again.
  fresh.recordCount = records.length + unreadable.length;
  const db2 = await openArchiveDb(monthKey);
  try {
    await writeStoredSummary(db2, fresh);
  } catch (err) {
    console.warn(`[FeelingWise] month summary for ${monthKey} not stored:`, err);
  } finally {
    db2.close();
  }
  return fresh;
}

export interface MonthSummariesResult {
  /** Every archived month's summary that could be read, oldest first. */
  summaries: MonthSummary[];
  /**
   * False when the month enumeration itself was incomplete, or at least one
   * month's summary could not be read or recomputed — `summaries` is then
   * missing that month's contribution to every fold built from it. Nothing
   * may fold this into an "all time" figure while this is false without
   * saying so.
   */
  complete: boolean;
  /** Month keys whose summary could not be produced, in the order attempted. */
  unreadableMonths: string[];
}

/**
 * Every archived month's summary, oldest first. A month that cannot be read
 * is named in `unreadableMonths` instead of only logged: a console warning
 * alone left every "all time" fold silently short with nothing in the
 * return value a caller could check (adversarial read, 18 Sep 2026).
 */
export async function readMonthSummaries(): Promise<MonthSummariesResult> {
  const listing = await listArchiveMonthsDetailed();
  const summaries: MonthSummary[] = [];
  const unreadableMonths: string[] = [];
  for (const monthKey of listing.months) {
    try {
      summaries.push(await readMonthSummary(monthKey));
    } catch (err) {
      console.warn(`[FeelingWise] month summary for ${monthKey} unavailable:`, err);
      unreadableMonths.push(monthKey);
    }
  }
  return { summaries, complete: listing.complete && unreadableMonths.length === 0, unreadableMonths };
}
