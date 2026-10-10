// FeelingWise — archive-on-evict writer.
//
// The active chain is capped so the dashboard stays responsive. Before this
// module existed the cap was enforced by DELETION, and the only thing that
// preserved history — month rotation — fires once per UTC month. At real
// write volume (~3000 records/day) a 10000 cap is reached in three days, so
// rotation never had a month left to archive and the overflow was destroyed:
// 27017 of 38834 positions lost on a real install before it was caught.
//
// This module is the other half of the eviction invariant: overflow is MOVED,
// not dropped. Records are appended into the same per-month archive databases
// that chain-rotation writes and archive-reader reads, so
// `exportEverythingHtml` picks them up with no further change.
//
// Ordering is deliberate and is the whole safety argument. IndexedDB has no
// cross-database transaction, so archive-then-delete can be interrupted
// between the two steps. Writing FIRST means an interruption leaves a record
// in both the archive and the active chain — a duplicate, which the reader
// de-duplicates and the next eviction pass resolves. Deleting first would
// leave the opposite, and there is no recovering from that.
//
// Appends are idempotent by record id: a month archive that already holds an
// id is not given it twice. That makes a retried pass safe and lets rotation
// and eviction share a month without fighting.
//
// "The record is in the archive" means the archive can produce the record
// back, not that an id resolves. Found by an adversarial read against the id
// index added 2026-09-14: the post-write confirmation had come to ask the
// index alone whether an id was present, which a truncated or unreadable
// payload answers exactly like a good one (the id lives in the envelope's
// lifted top-level field, untouched by damage to the compressed payload
// beside it). A corrupt row would pass the fast confirmation, authorize the
// delete of the only surviving copy, and only announce itself later when
// something tried to read that month — by which point unwrapping throws on
// the bad row, the whole month's read fails, and the backup builder that
// depends on it quietly narrows to the active chain. The confirmation below
// now holds every candidate for deletion to the standard rotation already
// holds archived records to before it clears the active chain
// (chain-rotation.ts's archiveContainsSource): fetch the one entry the index
// names, decompress it, and recompute its hash against the value the record
// carried before eviction. An id that indexes to nothing readable, or reads
// back to different content, is not confirmed, and its key is withheld —
// the active copy survives to be retried.

import type { ForensicRecord } from '../types/forensic';
import { sameStoredBytes, storedEntryIndexFields, unwrapStoredEntry } from './record-compression';
import { ARCHIVE_ID_INDEX, ARCHIVE_RECORDS_STORE, openArchiveDb, utcMonthKey } from './archive-naming';
import { noteAppendedRecords } from './archive-summary-store';
import { computeRecordIntegrityHash } from './canonical-payload';

/** One record as it is stored in the active DB, with its primary key. */
export interface StoredEntry {
  /** Active-DB primary key, so the caller can delete exactly what was archived. */
  key: IDBValidKey;
  /** The stored envelope, copied into the archive verbatim (compression preserved). */
  entry: unknown;
  /**
   * Unwrapped, for its id and timestamp. Absent when the row would not decode:
   * it is then moved as its stored bytes and confirmed by byte equality, so one
   * damaged row can neither be dropped nor hold the rest back.
   */
  record?: ForensicRecord;
}

/** The id an item is filed and confirmed under: the record's own, or the one on its envelope. */
function itemId(item: StoredEntry): string | undefined {
  return item.record ? item.record.id : storedEntryIndexFields(item.entry).id;
}

export type ArchiveOutcome =
  | { ok: true; archivedKeys: IDBValidKey[]; months: string[] }
  | { ok: false; reason: string };

/**
 * The month an evicted record belongs to. Records with an unparseable or
 * missing timestamp would otherwise pick 'NaN-NaN' and land in a database
 * whose name never parses back, making them unreadable — they go to the
 * epoch month instead, where they are at least enumerable and readable.
 */
function archiveMonthForRecord(item: StoredEntry): string {
  const t = Date.parse((item.record ? item.record.timestamp : storedEntryIndexFields(item.entry).timestamp) ?? '');
  return Number.isFinite(t) ? utcMonthKey(new Date(t)) : '1970-01';
}

/**
 * Which of `ids` are already in one month archive.
 *
 * Through the id index (archive v3) this is one key lookup per id and reads no
 * envelope. Before the index existed the check read and decompressed the whole
 * month, twice per eviction pass; at real volume that was most of the daily
 * alarm's work. A month opened without the index (it cannot happen through
 * openArchiveDb, which upgrades, but the fallback is cheap to keep) scans the
 * way it always did.
 *
 * This answers "is an entry with this id indexed", nothing more. It is the
 * right question for deciding what still needs writing (a duplicate write is
 * merely wasted work — the reader de-duplicates, per archive-naming.ts) and
 * the wrong one for deciding what may be deleted from the active chain. Use
 * `verifiedIdsInMonth` for that.
 */
async function presentIdsInMonth(db: IDBDatabase, ids: readonly string[]): Promise<Set<string>> {
  const present = new Set<string>();
  if (ids.length === 0 || !db.objectStoreNames.contains(ARCHIVE_RECORDS_STORE)) return present;
  const tx = db.transaction(ARCHIVE_RECORDS_STORE, 'readonly');
  const store = tx.objectStore(ARCHIVE_RECORDS_STORE);
  // The test doubles that stand in for IndexedDB do not all implement
  // IDBIndex.getKey; a store whose index cannot answer scans instead.
  const index = store.indexNames.contains(ARCHIVE_ID_INDEX) ? store.index(ARCHIVE_ID_INDEX) : null;
  if (index && typeof index.getKey === 'function') {
    await Promise.all(ids.map(id => new Promise<void>((resolve, reject) => {
      const req = index.getKey(id);
      req.onsuccess = () => { if (req.result !== undefined) present.add(id); resolve(); };
      req.onerror = () => reject(req.error);
    })));
    return present;
  }
  const wanted = new Set(ids);
  const entries: unknown[] = await new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  for (const raw of entries) {
    try {
      const id = (await unwrapStoredEntry(raw)).id;
      if (wanted.has(id)) present.add(id);
    } catch {
      // A corrupt archive entry cannot be matched by id. Skipping it risks
      // one duplicate, never a loss — which is the trade this module makes
      // everywhere.
    }
  }
  return present;
}

/**
 * Which of `bucket`'s records the archive can actually produce back, hashing
 * to the value they carried before eviction. This is the check the delete
 * depends on, and the one the id index made cheap to skip: `presentIdsInMonth`
 * proves an id resolves, this proves the row behind it is readable and
 * unchanged.
 *
 * Per candidate: one index read of that one row's value (IDBIndex.get, not
 * the cheaper getKey — the payload is exactly what getKey does not fetch),
 * one decompress and one hash recompute. The same per-record work
 * `verifyChainIntegrity` already spends on every record in the whole active
 * chain on every dashboard load. Here it runs only over `bucket`, the
 * eviction pass's own overflow slice, never the month behind it, so it does
 * not reintroduce the whole-month decompression cost the id index was added
 * to remove (archive-naming.ts). A month with thousands of records costs
 * this function nothing beyond the handful actually up for deletion today.
 *
 * A row that fails to decompress, parses to a different id than requested,
 * or hashes to anything other than the record's own pre-eviction
 * `integrityHash` is left out — never guessed into the confirmed set.
 */
async function verifiedIdsInMonth(db: IDBDatabase, bucket: readonly StoredEntry[]): Promise<Set<string>> {
  const verified = new Set<string>();
  if (bucket.length === 0 || !db.objectStoreNames.contains(ARCHIVE_RECORDS_STORE)) return verified;
  const tx = db.transaction(ARCHIVE_RECORDS_STORE, 'readonly');
  const store = tx.objectStore(ARCHIVE_RECORDS_STORE);
  const index = store.indexNames.contains(ARCHIVE_ID_INDEX) ? store.index(ARCHIVE_ID_INDEX) : null;

  async function readBack(id: string): Promise<unknown> {
    if (index && typeof index.get === 'function') {
      return new Promise<unknown>((resolve, reject) => {
        const req = index.get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    // No usable index (test double, or a month opened without one, per the
    // comment on presentIdsInMonth above) — the only way to find the id is
    // to scan, same as that function's own fallback.
    const entries: unknown[] = await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    for (const raw of entries) {
      try {
        if ((await unwrapStoredEntry(raw)).id === id) return raw;
      } catch {
        // A row that will not decode is matched by the id on its envelope, the
        // way the index matches it, and the caller confirms it by its bytes or not at all.
        if (storedEntryIndexFields(raw).id === id) return raw;
        // Corrupt and not the row we are looking for by construction — the
        // caller below applies the same "cannot confirm" treatment to the
        // row actually named by `id` once found.
      }
    }
    return undefined;
  }

  await Promise.all(bucket.map(async (item) => {
    try {
      const id = itemId(item);
      if (id === undefined) return;
      const raw = await readBack(id);
      if (raw === undefined) return;
      if (!item.record) {
        // There is no record to hash, so the copy is confirmed by being the
        // same bytes as the row it replaces.
        if (sameStoredBytes(raw, item.entry)) verified.add(id);
        return;
      }
      const record = await unwrapStoredEntry(raw);
      // What the delete depends on is that the ARCHIVE HOLDS THIS RECORD, so
      // that is what is checked: the payload decompresses, and the record it
      // decompresses to carries the same id, the same integrity hash and the
      // same signature as the copy about to be deleted. A truncated or
      // unreadable payload fails the first, and a row that is some other
      // record fails the rest.
      if (record.id !== item.record.id) return;
      if (record.integrityHash !== item.record.integrityHash) return;
      if (record.signature !== item.record.signature) return;
      // The content itself, compared between the two COPIES rather than
      // against a stored value. Comparing each side's canonical hash to the
      // hash written on the record would also refuse a record that never
      // recomputed for some older reason, and refusing there would stop the
      // prune for good on any install holding one, letting the active chain
      // grow without limit. Comparing the two sides to each other asks only
      // the question the delete depends on: is the copy that will survive the
      // same record as the copy about to be deleted. A payload swapped for
      // different content fails this while carrying the same id, hash and
      // signature, which is the case that made the metadata check alone too
      // weak (found by the archive read-back test, 2026-09-18).
      const [archivedContent, sourceContent] = await Promise.all([
        computeRecordIntegrityHash(record),
        computeRecordIntegrityHash(item.record),
      ]);
      if (archivedContent !== sourceContent) return;
      verified.add(item.record.id);
    } catch {
      // Decompression or parsing threw — a truncated or otherwise unreadable
      // payload. Exactly the row this check exists to catch: indexed, not
      // readable. Not confirmed.
    }
  }));
  return verified;
}

/**
 * Append evicted records into their month archives and confirm they are
 * readable afterwards.
 *
 * Returns the active-DB keys the caller may now delete — and only those. A
 * month that fails to write or fails its read-back contributes no keys, so
 * its records stay in the active chain and the next pass retries them. A
 * partial success is reported as `ok: true` with a short key list rather than
 * a blanket failure: moving what can be moved beats moving nothing.
 */
export async function archiveEvictedRecords(items: StoredEntry[]): Promise<ArchiveOutcome> {
  if (items.length === 0) return { ok: true, archivedKeys: [], months: [] };

  const byMonth = new Map<string, StoredEntry[]>();
  for (const item of items) {
    const month = archiveMonthForRecord(item);
    const bucket = byMonth.get(month);
    if (bucket) bucket.push(item);
    else byMonth.set(month, [item]);
  }

  const archivedKeys: IDBValidKey[] = [];
  const months: string[] = [];
  let lastError: string | undefined;

  for (const [month, bucket] of byMonth) {
    let db: IDBDatabase | undefined;
    try {
      db = await openArchiveDb(month);
      const wanted = bucket.map(itemId).filter((id): id is string => id !== undefined);
      const present = await presentIdsInMonth(db, wanted);
      const toWrite = bucket.filter(i => {
        const id = itemId(i);
        return id !== undefined && !present.has(id);
      });
      // For the month summary: what the store held before this append.
      const countBefore = await new Promise<number>((resolve, reject) => {
        const req = db!.transaction(ARCHIVE_RECORDS_STORE, 'readonly').objectStore(ARCHIVE_RECORDS_STORE).count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      if (toWrite.length > 0) {
        await new Promise<void>((resolve, reject) => {
          const tx = db!.transaction(ARCHIVE_RECORDS_STORE, 'readwrite');
          const store = tx.objectStore(ARCHIVE_RECORDS_STORE);
          for (const item of toWrite) store.add(item.entry);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          // An abort at commit fires neither oncomplete nor onerror; without
          // this the promise never settles and the caller holds the chain
          // write lock for the rest of the worker's life.
          tx.onabort = () => reject(tx.error ?? new Error(`archive ${month} write aborted`));
        });
      }

      // Read back before authorizing any deletion. "The write resolved" is
      // not the same claim as "the record is in the archive", and the second
      // is the one the delete depends on: not that an id resolves
      // (presentIdsInMonth, used above only to decide what still needed
      // writing), but that the archive can produce the record back and it
      // hashes to what was evicted. See verifiedIdsInMonth's docblock for
      // the defect this replaced and its cost.
      const after = await verifiedIdsInMonth(db, bucket);
      const confirmed = bucket.filter(i => after.has(itemId(i) ?? ''));
      if (confirmed.length !== bucket.length) {
        lastError = `archive ${month} confirmed ${confirmed.length}/${bucket.length} records`;
        console.warn(`[FeelingWise] archive-on-evict: ${lastError}; leaving the rest in the active chain`);
      }
      for (const item of confirmed) archivedKeys.push(item.key);
      if (confirmed.length > 0) months.push(month);
      // The month's summary follows the append (item 7): added to when it
      // described the store exactly, dropped for recomputation otherwise.
      if (toWrite.length > 0) {
        const summarised = toWrite.flatMap(i => (i.record && after.has(i.record.id) ? [i.record] : []));
        await noteAppendedRecords(db, month, summarised, countBefore);
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.warn(`[FeelingWise] archive-on-evict: month ${month} failed (${lastError}); its records stay in the active chain`);
    } finally {
      db?.close();
    }
  }

  if (archivedKeys.length === 0) {
    return { ok: false, reason: lastError ?? 'no records could be archived' };
  }
  return { ok: true, archivedKeys, months };
}
