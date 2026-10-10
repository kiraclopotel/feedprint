// FeelingWise — archive database naming + opening, in one dependency-free place.
//
// Extracted from chain-rotation.ts so the eviction writer (archive-writer.ts)
// can open the same archive databases WITHOUT importing chain-rotation, which
// imports store.ts — the cycle store.ts → chain-rotation.ts → store.ts.
// chain-rotation.ts re-exports everything here, so its existing importers are
// unaffected.
//
// The archive schema is defined once, here. Two writers now append to these
// databases — month rotation (whole-chain, at a UTC month flip) and eviction
// (overflow, whenever the active chain passes its cap) — and they must agree
// on the store name, the indexes and the version, or the second one to open a
// month would trigger an upgrade against the first one's schema.

import { assertExtensionRealm } from '../storage/realm-guard';

export const ARCHIVE_RECORDS_STORE = 'records';
/**
 * Where an archived month's RFC 3161 anchors live.
 *
 * Until 2026-09-04 rotation cleared the active anchor sidecar and copied
 * nothing, so an archived month kept its signed records and lost every
 * independent timestamp over them. The anchors were the only evidence in the
 * file that a party with no stake in the dispute had seen the chain, and they
 * had a maximum life of one calendar month. Disputes are not litigated inside
 * the month they happen.
 */
export const ARCHIVE_ANCHORS_STORE = 'anchors';
/**
 * The records store's index on the envelope's lifted `id` (record-compression
 * lifts it to the envelope top for exactly this). Added at v3 (2026-09-14) so
 * the eviction writer can ask "is this id already here" per id instead of
 * reading and decompressing the whole month twice per pass: at ~87,000
 * records a month that read was the daily alarm's main cost.
 */
export const ARCHIVE_ID_INDEX = 'id';
/**
 * One summary document per month (archive-summary.ts), keyed by monthKey.
 * Added at v3 with the id index. Counts only; derived from the records and
 * recomputed whenever its record count stops matching the store's.
 */
export const ARCHIVE_SUMMARY_STORE = 'summary';
/** v1: records only. v2 (2026-09-04): the anchors store beside them. v3 (2026-09-14): the id index and the summary store. */
const ARCHIVE_DB_VERSION = 3;

/** UTC month key 'YYYY-MM'. Stable across timezone changes + DST. */
export function utcMonthKey(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Previous UTC month key. Handles January (year wrap). */
export function previousUtcMonthKey(d: Date = new Date()): string {
  // Date.UTC with month=-1 rolls to December of the previous year.
  const prior = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  return utcMonthKey(prior);
}

/** IDB database name for an archive month. */
export function archiveDbName(monthKey: string): string {
  return `feelingwise-forensics-${monthKey}`;
}

/** Parse an archive DB name back to its month key. Returns null if not an archive name. */
export function parseArchiveDbName(dbName: string): string | null {
  const m = /^feelingwise-forensics-(\d{4}-\d{2})$/.exec(dbName);
  return m ? m[1] : null;
}

export function openArchiveDb(monthKey: string): Promise<IDBDatabase> {
  assertExtensionRealm(archiveDbName(monthKey));
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(archiveDbName(monthKey), ARCHIVE_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ARCHIVE_RECORDS_STORE)) {
        const store = db.createObjectStore(ARCHIVE_RECORDS_STORE, { autoIncrement: true });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('platform', 'platform', { unique: false });
        store.createIndex('chainPosition', 'chainPosition', { unique: false });
      }
      // Added at v2 and created unconditionally when absent, so a month
      // archived under v1 gains the store the first time it is opened again.
      // Keyed by the anchor id, so copying the same anchor twice (a rotation
      // that wrote the archive and then failed the cutover, then retried)
      // overwrites rather than duplicates.
      if (!db.objectStoreNames.contains(ARCHIVE_ANCHORS_STORE)) {
        const anchors = db.createObjectStore(ARCHIVE_ANCHORS_STORE, { keyPath: 'id' });
        anchors.createIndex('anchoredChainPosition', 'anchoredChainPosition', { unique: false });
      }
      // v3: the id index, created on a month archived under v1 or v2 the
      // first time it is opened again. Non-unique on purpose: an interrupted
      // move can leave one id twice, and the reader de-duplicates; a unique
      // index would make the upgrade itself fail on such a month.
      const records = req.transaction?.objectStore(ARCHIVE_RECORDS_STORE);
      if (records && !records.indexNames.contains(ARCHIVE_ID_INDEX)) {
        records.createIndex(ARCHIVE_ID_INDEX, 'id', { unique: false });
      }
      if (!db.objectStoreNames.contains(ARCHIVE_SUMMARY_STORE)) {
        db.createObjectStore(ARCHIVE_SUMMARY_STORE, { keyPath: 'monthKey' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
