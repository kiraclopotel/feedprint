// The month archives gain an id index (archive v3, 14 Sep 2026).
//
// Before it, the eviction writer answered "is this record already in its
// month" by reading and decompressing the whole month archive, twice per
// pass. The scale scout of 14 Sep put that read first among the daily
// alarm's costs: at ~87,000 records a month, ~174,000 decompressions to move
// ~2,900. With the index the same question is one key lookup per id.
//
// What this file holds the line on:
//   1. a month archived under v2 (no index) gains the index the first time
//      the writer opens it, and its existing records stay readable;
//   2. the writer still never appends an id the month already holds, index
//      or not;
//   3. a retried pass (the interrupted-move case) is idempotent.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';
import { ARCHIVE_ID_INDEX, ARCHIVE_RECORDS_STORE, archiveDbName, openArchiveDb } from '../../../src/forensics/archive-naming';
import { archiveEvictedRecords, type StoredEntry } from '../../../src/forensics/archive-writer';
import { readArchiveRecords } from '../../../src/forensics/archive-reader';
import { deleteDb } from '../../helpers/indexeddb';

const MONTH = '2026-08';

function rec(i: number): ForensicRecord {
  return {
    id: `r${i}`,
    timestamp: new Date(Date.UTC(2026, 7, 1 + (i % 27), 12)).toISOString(),
    platform: 'twitter',
    originalText: `text ${i}`,
    originalHash: `h${i}`,
    originalLength: 6,
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'adult',
    chainPosition: i,
    integrityHash: `ih${i}`,
  } as unknown as ForensicRecord;
}

/** A raw (uncompressed) stored entry, the way legacy months hold them. */
function entry(i: number): StoredEntry {
  const record = rec(i);
  return { key: i, entry: record, record };
}

/** Create the month at schema v2: records + anchors, no id index. */
function seedV2(records: ForensicRecord[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(archiveDbName(MONTH), 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      const store = db.createObjectStore(ARCHIVE_RECORDS_STORE, { autoIncrement: true });
      store.createIndex('timestamp', 'timestamp', { unique: false });
      store.createIndex('platform', 'platform', { unique: false });
      store.createIndex('chainPosition', 'chainPosition', { unique: false });
      db.createObjectStore('anchors', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(ARCHIVE_RECORDS_STORE, 'readwrite');
      for (const r of records) tx.objectStore(ARCHIVE_RECORDS_STORE).add(r);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
    req.onerror = () => reject(req.error);
  });
}

async function describeMonth(): Promise<{ version: number; hasIndex: boolean; count: number }> {
  const db = await openArchiveDb(MONTH);
  try {
    const store = db.transaction(ARCHIVE_RECORDS_STORE, 'readonly').objectStore(ARCHIVE_RECORDS_STORE);
    const count = await new Promise<number>((resolve, reject) => {
      const req = store.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return { version: db.version, hasIndex: store.indexNames.contains(ARCHIVE_ID_INDEX), count };
  } finally {
    db.close();
  }
}

describe('archive id index (v3)', () => {
  beforeEach(async () => { await deleteDb(archiveDbName(MONTH)); });
  afterEach(async () => { await deleteDb(archiveDbName(MONTH)); });

  it('a v2 month gains the index on first open and keeps its records', async () => {
    await seedV2([rec(0), rec(1), rec(2)]);
    const before = await new Promise<number>((resolve, reject) => {
      const req = indexedDB.open(archiveDbName(MONTH));
      req.onsuccess = () => { const v = req.result.version; req.result.close(); resolve(v); };
      req.onerror = () => reject(req.error);
    });
    expect(before).toBe(2);

    const after = await describeMonth();
    expect(after.version).toBe(3);
    expect(after.hasIndex).toBe(true);
    expect(after.count).toBe(3);
    const ids = (await readArchiveRecords(MONTH)).map(r => r.id).sort();
    expect(ids).toEqual(['r0', 'r1', 'r2']);
  });

  it('the writer appends only the ids the month does not hold, through the index', async () => {
    await seedV2([rec(0), rec(1)]);
    const outcome = await archiveEvictedRecords([entry(1), entry(2), entry(3)]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // Every one of the three is confirmed present, so all three keys may be deleted.
    expect([...outcome.archivedKeys].sort()).toEqual([1, 2, 3]);
    expect(outcome.months).toEqual([MONTH]);
    const ids = (await readArchiveRecords(MONTH)).map(r => r.id).sort();
    expect(ids).toEqual(['r0', 'r1', 'r2', 'r3']);
    expect((await describeMonth()).count).toBe(4);
  });

  it('a retried pass writes nothing twice', async () => {
    const first = await archiveEvictedRecords([entry(5), entry(6)]);
    expect(first.ok).toBe(true);
    const second = await archiveEvictedRecords([entry(5), entry(6), entry(7)]);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect([...second.archivedKeys].sort()).toEqual([5, 6, 7]);
    expect((await describeMonth()).count).toBe(3);
    const ids = (await readArchiveRecords(MONTH)).map(r => r.id).sort();
    expect(ids).toEqual(['r5', 'r6', 'r7']);
  });

  it('the index answers the presence question without a scan: a probe of an absent id is empty', async () => {
    await archiveEvictedRecords([entry(9)]);
    const db = await openArchiveDb(MONTH);
    try {
      const index = db.transaction(ARCHIVE_RECORDS_STORE, 'readonly').objectStore(ARCHIVE_RECORDS_STORE).index(ARCHIVE_ID_INDEX);
      const hit = await new Promise<IDBValidKey | undefined>((resolve, reject) => {
        const req = index.getKey('r9');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const miss = await new Promise<IDBValidKey | undefined>((resolve, reject) => {
        const req = index.getKey('r10');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      expect(hit).toBeDefined();
      expect(miss).toBeUndefined();
    } finally {
      db.close();
    }
  });
});
