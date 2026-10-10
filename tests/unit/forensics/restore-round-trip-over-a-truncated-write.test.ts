// A restore is a round trip through storage, so test it as one.
//
// backup-round-trip.test.ts builds a backup, serializes it and restores it
// against an in-memory fake of the archive contract: "append by id, read back
// what is there". That fake cannot be wrong, which is exactly the problem the
// suite audit of 2026-09-18 named. chain-read-failure.test.ts covers the other
// side, mocking store.ts wholesale to prove the READ refuses to treat a damaged
// chain as an empty one. Between them, the actual IDB swap that a restore
// performs, `replaceBackupStateUnderChainLock`, has never run against a store
// that does anything other than accept every write perfectly.
//
// Here it runs against one that does not: the same records go in, one of them
// lands smaller than it was written (the audit's third defect shape, a write
// that resolves while the value that lands is not the value that was sent), and
// the round trip is read back through the real reader.
//
// What a person loses if this is wrong: they reinstall after a disk problem,
// restore the backup that holds their whole record, and are told how many
// records came back. The number is the number they sent to the database, not
// the number the database kept.

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
import {
  getRecords,
  getRecordsOrThrow,
  lastRecordReadFailed,
  openDB,
  replaceBackupStateUnderChainLock,
} from '../../../src/forensics/store';
import { compressRecord } from '../../../src/forensics/record-compression';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import { archiveDbName } from '../../../src/forensics/archive-naming';
import { readArchiveRecords } from '../../../src/forensics/archive-reader';
import { readChainHeightWitness } from '../../../src/forensics/chain-height-witness';
import { verifyChainIntegrity } from '../../../src/forensics/chain-integrity';
import { deleteDbs } from '../../helpers/indexeddb';
import { installChromeStorageStub, type ChromeStorageStub } from '../../helpers/chrome-storage';
import { installFaultyIndexedDB, storageTestRecord, type FaultyIndexedDB } from '../../helpers/faulty-indexeddb';

const DB = 'feelingwise-forensics';
/** The outgoing chain is stamped in July and the backup's records in August, so the two never share an archive. */
const OUTGOING_MONTH = '2026-07';
const BACKUP_MONTH = '2026-08';

let idb: FaultyIndexedDB;
let storage: ChromeStorageStub;

async function makeRecords(count: number, month: 6 | 7, prefix: string): Promise<ForensicRecord[]> {
  const out: ForensicRecord[] = [];
  for (let i = 0; i < count; i++) {
    const partial = storageTestRecord({
      id: `${prefix}${i}`,
      chainPosition: i,
      timestamp: new Date(Date.UTC(2026, month, 10, 12, i)).toISOString(),
      originalText: `${prefix} post ${i}, long enough that compression has something to do`,
    });
    const integrityHash = await computeRecordIntegrityHash(partial);
    out.push({ ...partial, integrityHash, signature: 'signed' } as ForensicRecord);
  }
  return out;
}

/** Put a chain in the active store the way the install would already hold one. */
async function seedActive(records: ForensicRecord[]): Promise<void> {
  const envelopes = await Promise.all(records.map(r => compressRecord(r)));
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite');
    for (const envelope of envelopes) tx.objectStore('records').add(envelope);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('seed aborted'));
  });
  db.close();
}

beforeEach(async () => {
  idb = installFaultyIndexedDB();
  storage = installChromeStorageStub();
  await deleteDbs(DB, archiveDbName(OUTGOING_MONTH), archiveDbName(BACKUP_MONTH));
});

afterEach(async () => {
  idb.clearFaults();
  await deleteDbs(DB, archiveDbName(OUTGOING_MONTH), archiveDbName(BACKUP_MONTH));
  storage.restore();
  idb.restore();
});

describe('restore round trip', () => {
  // The control, and the honest round trip in its own right: what the backup
  // holds is what the chain reads back afterwards, and the chain it replaced
  // went to its month archive rather than to nothing.
  it('puts back exactly what the backup held, and retires the chain it replaced', async () => {
    const outgoing = await makeRecords(4, 6, 'old');
    const fromBackup = await makeRecords(6, 7, 'bak');
    await seedActive(outgoing);

    const result = await replaceBackupStateUnderChainLock(fromBackup, [], []);

    expect(result.recordsAdded).toBe(6);
    expect((await getRecordsOrThrow()).map(r => r.id)).toEqual(['bak0', 'bak1', 'bak2', 'bak3', 'bak4', 'bak5']);
    expect((await readArchiveRecords(OUTGOING_MONTH)).map(r => r.id)).toEqual(['old0', 'old1', 'old2', 'old3']);
    expect(idb.log).toEqual([]);
    // The drop in height is a restore, not a loss, so the note is re-based.
    expect((await readChainHeightWitness())?.rebase?.reason).toBe('restore');
  });

  // THE FAULT. One restored record lands with its payload cut in half while its
  // lifted index fields are untouched, so nothing about the write, the
  // transaction or the indexes reports anything wrong.
  it('reports a full restore over a write that landed truncated', async () => {
    const outgoing = await makeRecords(4, 6, 'old');
    const fromBackup = await makeRecords(6, 7, 'bak');
    await seedActive(outgoing);
    idb.truncateOnWrite({ db: DB, store: 'records', recordId: 'bak3' });

    const result = await replaceBackupStateUnderChainLock(fromBackup, [], []);

    // The fault bit, and the restore said nothing about it.
    expect(idb.log.some(e => e.kind === 'truncate-write' && e.recordId === 'bak3')).toBe(true);
    // FINDING (see this file's closing note): the count is what was handed to
    // IndexedDB, never what IndexedDB kept. Nothing on this path reads the
    // chain back, although the eviction path next door refuses to delete a
    // single record without doing exactly that (archive-writer.ts,
    // verifiedIdsInMonth).
    expect(result.recordsAdded).toBe(6);

    // And this is what the person actually has afterwards: not five records out
    // of six, but a chain that will not read at all.
    await expect(getRecordsOrThrow()).rejects.toThrow();
    expect(await getRecords()).toEqual([]);
    expect(lastRecordReadFailed()).toBe(true);
  });

  // The counterexample that makes the finding above a finding rather than a
  // grumble: a read-back is affordable here, and it does distinguish the two
  // states. The restore has every record in hand at the moment it writes them.
  it('a read-back after the same restore does see the damage', async () => {
    const fromBackup = await makeRecords(6, 7, 'bak');
    idb.truncateOnWrite({ db: DB, store: 'records', recordId: 'bak3' });

    await replaceBackupStateUnderChainLock(fromBackup, [], []);

    // One getAll and one unwrap per record, the same per-record work the
    // dashboard already spends on every load.
    await expect(getRecordsOrThrow()).rejects.toThrow();
  });

  // And this is the read-back the restore ACTUALLY performs, reproduced with
  // the two calls backup.ts makes in the order it makes them
  // (restoreFromBackupUnderChainLock, "Re-verify for reporting"). It reads
  // through `getRecords`, which answers a failed read with an empty list by
  // design, and the walker calls an empty chain valid. So the one check placed
  // after the swap to catch exactly this reports green over it.
  it('the post-restore integrity re-verification reports green over the damage', async () => {
    const fromBackup = await makeRecords(6, 7, 'bak');
    idb.truncateOnWrite({ db: DB, store: 'records', recordId: 'bak3' });

    await replaceBackupStateUnderChainLock(fromBackup, [], []);

    const asRestoreSeesIt = await getRecords();
    expect(asRestoreSeesIt).toEqual([]);
    // The flag that would have told it apart from a genuinely empty chain is
    // set, and the re-verification never asks.
    expect(lastRecordReadFailed()).toBe(true);
    expect((await verifyChainIntegrity(asRestoreSeesIt)).valid).toBe(true);
  });

  // The honest failure, for contrast with the silent one above: when the swap
  // ABORTS instead of landing a bad value, everything behaves. Nothing is
  // reported as restored, the outgoing chain is untouched in the active store,
  // and its copy is already safe in the month archive.
  it('leaves the old chain in place when the restore transaction aborts at commit', async () => {
    const outgoing = await makeRecords(4, 6, 'old');
    const fromBackup = await makeRecords(6, 7, 'bak');
    await seedActive(outgoing);
    idb.failCommit({ db: DB, store: 'records' });

    await expect(replaceBackupStateUnderChainLock(fromBackup, [], [])).rejects.toThrow();

    expect(idb.log.some(e => e.kind === 'commit-abort')).toBe(true);
    // The clear() in that transaction rolled back with everything else.
    expect((await getRecordsOrThrow()).map(r => r.id)).toEqual(['old0', 'old1', 'old2', 'old3']);
    expect((await readArchiveRecords(OUTGOING_MONTH)).map(r => r.id)).toHaveLength(4);
  });

  // The whole reason the restore path archives first. A restore that replaced a
  // chain and then could not produce the replacement would be the worst outcome
  // in the product, and it is survivable only because the outgoing records went
  // somewhere first.
  it('still holds the replaced chain in the archive after a truncated restore', async () => {
    const outgoing = await makeRecords(4, 6, 'old');
    const fromBackup = await makeRecords(6, 7, 'bak');
    await seedActive(outgoing);
    idb.truncateOnWrite({ db: DB, store: 'records', recordId: 'bak3' });

    await replaceBackupStateUnderChainLock(fromBackup, [], []);

    expect((await readArchiveRecords(OUTGOING_MONTH)).map(r => r.id)).toEqual(['old0', 'old1', 'old2', 'old3']);
  });
});

// WHAT THESE TESTS ESTABLISHED, recorded here rather than in a report nobody
// reads with the code. `replaceBackupStateUnderChainLock` (src/forensics/
// store.ts) returns `recordsAdded: envelopes.length` on the strength of
// `tx.oncomplete` alone. A commit that completes means the transaction did not
// abort; it does not mean the values that landed are the values that were sent,
// which is the whole premise of the read-back that `archiveEvictedRecords`
// performs three functions away before it deletes anything. The damage is
// bounded rather than fatal because the outgoing chain is archived first.
//
// The second half is worse, and the last test above pins it.
// `restoreFromBackupUnderChainLock` (src/forensics/backup.ts, the block
// commented "Re-verify for reporting") is the one check placed after the swap
// to catch exactly this, and it reads the chain with `getRecords()`. That call
// answers a failed read with an empty list on purpose, and it sets
// `lastRecordReadFailed()` precisely so a caller can tell the two apart; the
// re-verification never asks. An empty list walks clean, so `chainVerified`
// comes back true over a chain that will not read. store.ts's own docblock on
// `getRecordsOrThrow` names this path in its list of callers that must use the
// throwing read: "restore, backup, anchoring, relegation repair".
