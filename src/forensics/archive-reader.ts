// FeelingWise — archived-month chain reader (dashboard-side, read-only).
//
// Month rotation (chain-rotation.ts) seals each completed month's records
// into its own IDB database (`feelingwise-forensics-YYYY-MM`). Until D3
// (docs/history/archive/reality-FUNCTION_MAP.md), nothing read those archives back inside
// the UI, so verification stopped at the active chain. This module is the
// read half: enumerate the archive databases and load their records so
// `verifyChainIntegrityAcrossMonths` can walk the chain-of-chains.
//
// Read-only by construction: databases are only opened when their name was
// enumerated from `indexedDB.databases()` (so they already exist), the open
// carries no version (an existing DB opens at its own version and no
// upgrade transaction runs), and a surprise `upgradeneeded` — which would
// mean the DB vanished between enumeration and open — aborts rather than
// create an empty archive.

import type { ForensicRecord } from '../types/forensic';
// Straight from archive-naming, not via chain-rotation's re-export:
// chain-rotation imports store.ts, so the re-export route dragged the whole
// active-store module graph into anything that merely wanted to READ an
// archive (backup.ts now does). archive-naming exists precisely to be the
// dependency-free end of this.
import { archiveDbName, parseArchiveDbName, ARCHIVE_ANCHORS_STORE } from './archive-naming';
import { storedEntryIndexFields, unwrapStoredEntries, unwrapStoredEntry } from './record-compression';
import { assertExtensionRealm } from '../storage/realm-guard';
import type { ChainAnchor } from '../types/chain-anchor';

const RECORDS_STORE = 'records';

/**
 * Pure core: archive month keys from a raw IDB database-name list, oldest
 * first. Non-archive names (active DB, sidecars, undefined) are dropped.
 * 'YYYY-MM' keys sort chronologically as plain text.
 */
export function archiveMonthKeysFromDbNames(names: Array<string | undefined>): string[] {
  const keys: string[] = [];
  for (const name of names) {
    if (!name) continue;
    const key = parseArchiveDbName(name);
    if (key) keys.push(key);
  }
  return keys.sort();
}

export interface ArchiveMonthListing {
  /** Archive month keys enumerated, oldest first. */
  months: string[];
  /**
   * False when the realm could not call `indexedDB.databases()` at all, so
   * `months` cannot be told apart from "no archives exist" by looking at it
   * alone. Confirmed by the adversarial read, 18 Sep 2026: `listArchiveMonths`
   * returned `[]` in both cases, which let `countArchivedRecords`,
   * `readMonthSummaries` and `loadArchiveMonths` all read as a complete zero
   * with no error anywhere a caller could see.
   */
  complete: boolean;
}

/**
 * `listArchiveMonths` with the enumeration failure named instead of folded
 * into an empty list. A caller that folds the result into an "all time"
 * figure should use this and check `complete`, not `listArchiveMonths`.
 */
export async function listArchiveMonthsDetailed(): Promise<ArchiveMonthListing> {
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') {
    return { months: [], complete: false };
  }
  const dbs = await indexedDB.databases();
  return { months: archiveMonthKeysFromDbNames(dbs.map(d => d.name)), complete: true };
}

/**
 * Archive month keys present in this origin's IDB, oldest first. Answers []
 * both when there are no archives and when the realm cannot enumerate at
 * all (indexedDB.databases unavailable) — a caller that must tell those two
 * apart needs `listArchiveMonthsDetailed` instead.
 */
export async function listArchiveMonths(): Promise<string[]> {
  return (await listArchiveMonthsDetailed()).months;
}

/**
 * Records of one archived month, in stored (insertion) order — the same
 * order rotation wrote them, which is what chain verification expects.
 */
export async function readArchiveRecords(monthKey: string): Promise<ForensicRecord[]> {
  return unwrapStoredEntries(await readArchiveEntries(monthKey));
}

/** One archived row that is stored and did not decode, named by the fields on its envelope. */
export interface UnreadableArchivedRow {
  id?: string;
  chainPosition?: number;
  timestamp?: string;
  /**
   * How many of the month's readable records were stored before this row. A
   * month can hold more than one chain, and this places the row in its own.
   */
  recordsBefore: number;
  reason: string;
}

/**
 * One month's records with the rows that did not decode named beside them.
 * Upkeep carries a damaged row into its month as the bytes it was stored as,
 * and that one row must not make the whole month unreadable to any reader.
 */
export async function readArchiveRecordsDetailed(
  monthKey: string,
): Promise<{ records: ForensicRecord[]; unreadable: UnreadableArchivedRow[] }> {
  const records: ForensicRecord[] = [];
  const unreadable: UnreadableArchivedRow[] = [];
  for (const entry of await readArchiveEntries(monthKey)) {
    try {
      records.push(await unwrapStoredEntry(entry));
    } catch (err) {
      const reason = err instanceof Error ? (err.message || err.name) : String(err);
      unreadable.push({
        ...storedEntryIndexFields(entry),
        recordsBefore: records.length,
        reason: reason || 'the stored row could not be decoded',
      });
    }
  }
  return { records, unreadable };
}

async function readArchiveEntries(monthKey: string): Promise<unknown[]> {
  assertExtensionRealm(archiveDbName(monthKey));
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(archiveDbName(monthKey));
    req.onupgradeneeded = () => {
      // Enumerated a moment ago but gone now: abort so this read can never
      // materialize an empty archive DB.
      req.transaction?.abort();
      reject(new Error(`archive ${monthKey} disappeared before read`));
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  try {
    if (!db.objectStoreNames.contains(RECORDS_STORE)) return [];
    return await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction(RECORDS_STORE, 'readonly');
      const getAll = tx.objectStore(RECORDS_STORE).getAll();
      getAll.onsuccess = () => resolve(getAll.result);
      getAll.onerror = () => reject(getAll.error);
    });
  } finally {
    db.close();
  }
}

/**
 * The independent timestamps a retired month carries.
 *
 * Rotation copies the active anchor sidecar in here before it clears it
 * (chain-rotation.ts), so a month keeps the evidence that a party with no
 * stake in the dispute saw its chain. Months archived before 2026-09-04 have
 * no anchors store, or an empty one, and return [] - honestly nothing, not an
 * error.
 */
export async function readArchiveAnchors(monthKey: string): Promise<ChainAnchor[]> {
  assertExtensionRealm(archiveDbName(monthKey));
  let db: IDBDatabase;
  try {
    db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(archiveDbName(monthKey));
      req.onupgradeneeded = () => {
        req.transaction?.abort();
        reject(new Error(`archive ${monthKey} disappeared before read`));
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
  try {
    if (!db.objectStoreNames.contains(ARCHIVE_ANCHORS_STORE)) return [];
    return await new Promise<ChainAnchor[]>((resolve, reject) => {
      const tx = db.transaction(ARCHIVE_ANCHORS_STORE, 'readonly');
      const req = tx.objectStore(ARCHIVE_ANCHORS_STORE).getAll();
      req.onsuccess = () => resolve(req.result as ChainAnchor[]);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  } finally {
    db.close();
  }
}

/**
 * Every archived month with its records and its anchors, oldest first. The
 * records field is the exact `archives` shape `verifyChainIntegrityAcrossMonths`
 * takes; the anchors ride alongside for the export. `unreadable` names the
 * month's rows that did not decode, which Verify reports as damaged.
 */
export async function loadArchivesOldestFirst(): Promise<
  Array<{ monthKey: string; records: ForensicRecord[]; anchors: ChainAnchor[]; unreadable: UnreadableArchivedRow[] }>
> {
  const months = await listArchiveMonths();
  const out: Array<{ monthKey: string; records: ForensicRecord[]; anchors: ChainAnchor[]; unreadable: UnreadableArchivedRow[] }> = [];
  for (const monthKey of months) {
    const { records, unreadable } = await readArchiveRecordsDetailed(monthKey);
    out.push({
      monthKey,
      records,
      anchors: await readArchiveAnchors(monthKey),
      unreadable,
    });
  }
  return out;
}

export interface ArchivedRecordCount {
  /** Records counted across the archived months that could be opened. */
  count: number;
  /**
   * False when the month enumeration itself was incomplete, or at least one
   * month could not be opened — `count` is then a floor, not the total.
   * Nothing may render this figure as "the total" while this is false; the
   * gap belongs in the same sentence as the number. Before this field
   * existed (adversarial read, 18 Sep 2026), one unreadable month silently
   * shrank every "all time" figure the dashboard showed, with no way for a
   * caller to tell a true zero from an unread one.
   */
  complete: boolean;
  /** Month keys that could not be opened, in enumeration order. */
  unreadableMonths: string[];
}

/**
 * How many records the month archives hold, without decompressing any of
 * them.
 *
 * The dashboard counts records with `getRecords()`, which reads the ACTIVE
 * store only. That was harmless while eviction destroyed the overflow: the
 * active chain WAS everything the install still held. Since archive-on-evict
 * it is not, and a header that keeps reporting the active count alone would
 * show the number falling every time the cap is enforced, telling the user
 * they are losing records at the exact moment the app started keeping them.
 */
export async function countArchivedRecords(): Promise<ArchivedRecordCount> {
  const listing = await listArchiveMonthsDetailed();
  let total = 0;
  const unreadableMonths: string[] = [];
  for (const monthKey of listing.months) {
    assertExtensionRealm(archiveDbName(monthKey));
    try {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(archiveDbName(monthKey));
        req.onupgradeneeded = () => {
          req.transaction?.abort();
          reject(new Error(`archive ${monthKey} disappeared before count`));
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      try {
        if (!db.objectStoreNames.contains(RECORDS_STORE)) continue;
        total += await new Promise<number>((resolve, reject) => {
          const req = db.transaction(RECORDS_STORE, 'readonly').objectStore(RECORDS_STORE).count();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      } finally {
        db.close();
      }
    } catch {
      // One unreadable month must not zero the whole figure, and must not
      // pass as counted either: it is named here so a caller can say the
      // total is a floor instead of showing a smaller "all time" than the
      // record actually holds.
      unreadableMonths.push(monthKey);
    }
  }
  return { count: total, complete: listing.complete && unreadableMonths.length === 0, unreadableMonths };
}
