// Eviction against a STORE that lies, not against a mocked writer.
//
// Two tests already guard this invariant from either side:
// eviction-archive-failure-blocks-delete.test.ts mocks archive-writer wholesale
// and asserts store.ts believes its report, and
// archive-confirm-reads-back-the-payload.test.ts hand-builds one corrupt
// envelope and hands it to the writer directly. Neither can ask the question
// the suite audit of 2026-09-18 said nothing here could ask: what happens when
// the archive database itself accepts a write, resolves it, indexes it, and
// then cannot give the record back. Both halves of the path run for real here,
// store.ts and archive-writer.ts, and the only thing that is not honest is the
// storage underneath them (tests/helpers/faulty-indexeddb.ts).
//
// What a real person loses if this is wrong: the active copy of a record is
// deleted on the strength of an archived copy that cannot be read, and the loss
// only announces itself months later when the export tries to open that month,
// throws on the bad row, and quietly narrows to the active chain that no longer
// holds it.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/forensics/signing', () => ({
  signHash: vi.fn(async () => 'signed'),
  verifyHash: vi.fn(async () => true),
  getPublicKeyFingerprint: vi.fn(async () => 'mock-fingerprint'),
}));
vi.mock('../../../src/storage/settings', () => ({
  getSettings: vi.fn(async () => ({ mode: 'adult' })),
  getSettingsForAttestation: vi.fn(async () => ({ mode: 'adult', readFailed: false })),
  resetUsageStats: vi.fn(async () => undefined),
}));

import type { ForensicRecord } from '../../../src/types/forensic';
import { openDB, pruneRecordsToCap } from '../../../src/forensics/store';
import { compressRecord } from '../../../src/forensics/record-compression';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import { archiveDbName, ARCHIVE_RECORDS_STORE } from '../../../src/forensics/archive-naming';
import { readArchiveRecords } from '../../../src/forensics/archive-reader';
import { deleteDb } from '../../helpers/indexeddb';
import { installFaultyIndexedDB, storageTestRecord, type FaultyIndexedDB } from '../../helpers/faulty-indexeddb';

const DB = 'feelingwise-forensics';
/** Every seeded record is stamped inside August 2026, so one month archive takes them all. */
const MONTH = '2026-08';
const ARCHIVE_DB = archiveDbName(MONTH);

let idb: FaultyIndexedDB;

/**
 * Seed the active chain with real compressed envelopes, not hand-built ones:
 * the confirmation under test decompresses what it finds and recomputes the
 * canonical hash over it, so a seed that skipped compression would exercise the
 * fallback path instead of the one that ships.
 */
async function seed(count: number): Promise<ForensicRecord[]> {
  const records: ForensicRecord[] = [];
  for (let i = 0; i < count; i++) {
    const partial = storageTestRecord({
      id: `r${i}`,
      chainPosition: i,
      timestamp: new Date(Date.UTC(2026, 7, 10, 12, i)).toISOString(),
      originalText: `post number ${i} as it appeared in the feed`,
    });
    const integrityHash = await computeRecordIntegrityHash(partial);
    records.push({ ...partial, integrityHash, signature: 'signed' } as ForensicRecord);
  }
  const db = await openDB();
  const envelopes = await Promise.all(records.map(r => compressRecord(r)));
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite');
    for (const envelope of envelopes) tx.objectStore('records').add(envelope);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('seed aborted'));
  });
  db.close();
  return records;
}

/** Ids still in the ACTIVE chain, markers excluded, in chain order. */
async function activeIds(): Promise<string[]> {
  const db = await openDB();
  const entries = await new Promise<Array<{ id?: string }>>((resolve, reject) => {
    const req = db.transaction('records', 'readonly').objectStore('records').getAll();
    req.onsuccess = () => resolve(req.result as Array<{ id?: string }>);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return entries.map(e => e.id ?? '').filter(id => id.startsWith('r'));
}

beforeEach(async () => {
  idb = installFaultyIndexedDB();
  await deleteDb(DB);
  await deleteDb(ARCHIVE_DB);
});

afterEach(async () => {
  idb.clearFaults();
  await deleteDb(DB);
  await deleteDb(ARCHIVE_DB);
  idb.restore();
});

describe('eviction against an archive that cannot read its own rows back', () => {
  // The control. Without it the three fault tests below prove nothing: a prune
  // that deletes nothing because the harness is broken looks exactly like a
  // prune that deletes nothing because it refused to.
  it('moves the overflow when the archive is honest', async () => {
    await seed(12);

    const deleted = await pruneRecordsToCap(4);

    expect(deleted).toBe(8);
    expect(await activeIds()).toEqual(['r8', 'r9', 'r10', 'r11']);
    expect((await readArchiveRecords(MONTH)).map(r => r.id)).toEqual(
      ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'],
    );
    // No fault was declared, so the double must have done nothing at all.
    expect(idb.log).toEqual([]);
  });

  // DEFECT SHAPE 2 from the audit, at the storage layer: the id index resolves
  // and the payload behind it does not.
  it('deletes nothing when every archived row indexes but none reads back', async () => {
    await seed(12);
    idb.dropValueOnRead({ db: ARCHIVE_DB, store: ARCHIVE_RECORDS_STORE });

    const deleted = await pruneRecordsToCap(4);

    expect(deleted).toBe(0);
    // All twelve still here, over cap, waiting for a pass that can confirm.
    expect(await activeIds()).toHaveLength(12);
    // And the fault really bit: the double refused at least one value read.
    expect(idb.log.some(e => e.kind === 'drop-read')).toBe(true);
  });

  // The same lie told about ONE row in the middle of the overflow. The refusal
  // has to be surgical: the contiguous oldest run before the bad row may go,
  // and nothing past it, or the chain gets an interior hole that no reader can
  // tell from a deletion (store.ts's own note on `evictable`).
  it('stops at the first row the archive cannot produce, leaving a front truncation', async () => {
    await seed(12);
    idb.dropValueOnRead({ db: ARCHIVE_DB, store: ARCHIVE_RECORDS_STORE, recordId: 'r3' });

    const deleted = await pruneRecordsToCap(4);

    expect(deleted).toBe(3);
    const survivors = await activeIds();
    expect(survivors[0]).toBe('r3');
    expect(survivors).toHaveLength(9);
    // Contiguous from the lowest survivor. An interior hole is the shape the
    // verifier cannot distinguish from tampering.
    for (let i = 1; i < survivors.length; i++) {
      expect(survivors[i]).toBe(`r${Number(survivors[i - 1].slice(1)) + 1}`);
    }
  });

  // DEFECT SHAPE 3: the write resolves and the value that lands is smaller than
  // the one written. The envelope's lifted `id` is untouched, so every index in
  // the archive still answers for this row; only the payload is short.
  it('refuses a row whose archived payload landed truncated', async () => {
    await seed(12);
    idb.truncateOnWrite({ db: ARCHIVE_DB, store: ARCHIVE_RECORDS_STORE, recordId: 'r0' });

    const deleted = await pruneRecordsToCap(4);

    expect(deleted).toBe(0);
    expect(await activeIds()).toHaveLength(12);
    expect(idb.log.some(e => e.kind === 'truncate-write' && e.recordId === 'r0')).toBe(true);

    // The row IS in the archive and IS indexed. That is what makes this the
    // dangerous case rather than an obvious failure: nothing except reading the
    // payload back tells it from a good row.
    await expect(readArchiveRecords(MONTH)).rejects.toThrow();
  });

  // The same again with the payload replaced rather than shortened, because the
  // two failures decode differently: a truncated gzip stream ends early, a
  // corrupt one never starts.
  it('refuses a row whose archived payload landed corrupt', async () => {
    await seed(12);
    idb.corruptOnWrite({ db: ARCHIVE_DB, store: ARCHIVE_RECORDS_STORE, recordId: 'r2' });

    const deleted = await pruneRecordsToCap(4);

    // r0 and r1 archived cleanly and form the contiguous oldest run; r2 is the
    // stop point.
    expect(deleted).toBe(2);
    expect((await activeIds())[0]).toBe('r2');
    expect(idb.log.some(e => e.kind === 'corrupt-write' && e.recordId === 'r2')).toBe(true);
  });

  // The third of the audit's write shapes: not smaller, not corrupt, a
  // DIFFERENT record. The row decompresses cleanly and carries the right id, so
  // every cheap check passes; only comparing the two copies' content catches
  // it. archive-writer.ts's own note says this is the case that made the
  // metadata check alone too weak.
  it('refuses a row that reads back clean but holds different content', async () => {
    const seeded = await seed(12);
    const impostor = await compressRecord({
      ...seeded[1],
      originalText: 'a completely different sentence than the one recorded',
    } as ForensicRecord);
    idb.swapOnWrite({ db: ARCHIVE_DB, store: ARCHIVE_RECORDS_STORE, recordId: 'r1' }, impostor);

    const deleted = await pruneRecordsToCap(4);

    // r0 archived cleanly; r1 is the stop point.
    expect(deleted).toBe(1);
    expect((await activeIds())[0]).toBe('r1');
    expect(idb.log.some(e => e.kind === 'swap-write' && e.recordId === 'r1')).toBe(true);
    // And the proof that no cheap check would have caught it: the row is there,
    // it decompresses, and it says it is r1.
    expect((await readArchiveRecords(MONTH)).map(r => r.id)).toContain('r1');
  });

  // The transaction that resolves nowhere. archive-writer.ts's `tx.onabort`
  // line exists because an abort at commit fires neither oncomplete nor
  // onerror, and without it the chain write lock is held for the rest of the
  // worker's life. Nothing in the suite has ever driven that line.
  it('survives an archive write that aborts at commit, and deletes nothing', async () => {
    await seed(12);
    idb.failCommit({ db: ARCHIVE_DB, store: ARCHIVE_RECORDS_STORE });

    const deleted = await pruneRecordsToCap(4);

    expect(deleted).toBe(0);
    expect(await activeIds()).toHaveLength(12);
    expect(idb.log.some(e => e.kind === 'commit-abort')).toBe(true);

    // The lock was released: a second prune runs rather than hanging. The
    // assertion that matters is that this line is reached at all.
    idb.clearFaults();
    expect(await pruneRecordsToCap(4)).toBe(8);
  });
});
