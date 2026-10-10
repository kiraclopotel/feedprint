// Where the dashboard keeps each archived month's count by its own rules
// (month-sets.ts), and the background run that fills it. The counts live in the
// derived-data database beside the theme cache, never in the evidence store:
// the chain reset already empties that database, and losing it only means the
// next open counts again. It is opened with the same name, version and store as
// theme-cache.ts opens it, or one of the two opens fails; one row per month,
// keyed apart from the theme entry.

import type { MonthSummary } from '../../forensics/archive-summary';
import { readArchiveRecordsDetailed } from '../../forensics/archive-reader';
import { openSimpleStore } from '../../forensics/idb-open';
import { countMonthSets, monthsToCount, type MonthSets, type OlderMonthsProgress } from './month-sets';

const DB_NAME = 'feelingwise-derived';
const DB_VERSION = 1;
const STORE = 'cache';
const KEY_PREFIX = 'month-sets:';

interface StoredMonthSets extends MonthSets {
  key: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = openSimpleStore(DB_NAME, DB_VERSION, STORE, { keyPath: 'key' });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

/** Test hook: close and forget the open connection, so a test can delete the database. */
export async function _resetMonthSetsDbForTests(): Promise<void> {
  const open = dbPromise;
  dbPromise = null;
  if (open) (await open.catch(() => null))?.close();
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('month sets write aborted'));
  });
}

/** Every stored month count, by month. Empty on any error: the counts are derived and the badge falls back to the summaries. */
export async function readStoredMonthSets(): Promise<Map<string, MonthSets>> {
  try {
    const db = await openDb();
    const range = IDBKeyRange.bound(KEY_PREFIX, KEY_PREFIX + '\uffff');
    const all = await new Promise<StoredMonthSets[]>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll(range);
      req.onsuccess = () => resolve(req.result as StoredMonthSets[]);
      req.onerror = () => reject(req.error);
    });
    return new Map(all.map(({ key: _key, ...sets }) => [sets.monthKey, sets]));
  } catch (e) {
    console.warn('[fw] stored month counts unavailable', e);
    return new Map();
  }
}

async function writeMonthSets(sets: MonthSets): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  const row: StoredMonthSets = { ...sets, key: KEY_PREFIX + sets.monthKey };
  tx.objectStore(STORE).put(row);
  await done(tx);
}

async function dropMonthSets(monthKeys: readonly string[]): Promise<void> {
  if (monthKeys.length === 0) return;
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  for (const k of monthKeys) tx.objectStore(STORE).delete(KEY_PREFIX + k);
  await done(tx);
}

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Count every month whose stored count is missing or stale, one month at a
 * time, oldest first, yielding to the page between months and saving each
 * month as it finishes, so a closed tab resumes where it stopped. Drops the
 * counts of months no longer listed when the listing is complete. Calls
 * onMonth after each month with the counts so far and the progress. Never
 * throws: a month that will not read keeps its summary in the badge.
 */
export async function countOlderMonths(
  summaries: readonly MonthSummary[],
  listingComplete: boolean,
  onMonth: (sets: ReadonlyMap<string, MonthSets>, progress: OlderMonthsProgress) => void,
  stored?: ReadonlyMap<string, MonthSets>,
): Promise<Map<string, MonthSets>> {
  const sets = new Map(stored ?? await readStoredMonthSets());
  if (listingComplete) {
    const listed = new Set(summaries.map((s) => s.monthKey));
    const gone = [...sets.keys()].filter((k) => !listed.has(k));
    try {
      await dropMonthSets(gone);
    } catch (e) {
      console.warn('[fw] could not drop the counts of months no longer archived', e);
    }
    for (const k of gone) sets.delete(k);
  }
  const todo = monthsToCount(summaries, sets);
  const progress: OlderMonthsProgress = { done: 0, total: todo.length };
  onMonth(sets, { ...progress });
  for (const summary of todo) {
    await nextTask();
    try {
      const { records, unreadable } = await readArchiveRecordsDetailed(summary.monthKey);
      const counted = countMonthSets(summary, records, unreadable.length);
      sets.set(summary.monthKey, counted);
      try {
        await writeMonthSets(counted);
      } catch (e) {
        console.warn(`[fw] the count of ${summary.monthKey} holds for this page only`, e);
      }
    } catch (e) {
      console.warn(`[fw] ${summary.monthKey} could not be counted by the dashboard's rules; its summary stands`, e);
    }
    progress.done += 1;
    onMonth(sets, { ...progress });
  }
  return sets;
}
