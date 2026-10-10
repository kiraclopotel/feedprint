// M186's shape, reproduced instead of described.
//
// chain-height-witness.test.ts drives the PURE planner: it hands
// `assessChainHeight` a witness note and a nextPosition and checks the verdict.
// That is the right test for the planner and it cannot touch the premise the
// whole module rests on, which the module's own docblock states as a fact about
// storage: "when that database goes, the next write re-opens it EMPTY and every
// read of it SUCCEEDS". Nothing in the suite had ever made a database go. The
// audit of 2026-09-18 named that exact gap: `fake-indexeddb` never evicts, so no
// test here could ask what the product does when the store comes back empty.
//
// These tests destroy the database under the running code
// (tests/helpers/faulty-indexeddb.ts `wipe`) and then run the real
// `checkChainHeight` over the real store, the real archive reader and the real
// gap marker writer. What a person loses if this is wrong: their record is gone,
// every screen reads zero incidents, and nothing anywhere says the difference
// between a quiet month and a destroyed chain.

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
import { checkChainHeight } from '../../../src/background/chain-height';
import { getChainState, openDB, getRecords } from '../../../src/forensics/store';
import { compressRecord } from '../../../src/forensics/record-compression';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import {
  CHAIN_HEIGHT_WITNESS_KEY,
  readChainHeightWitness,
} from '../../../src/forensics/chain-height-witness';
import { archiveDbName, ARCHIVE_RECORDS_STORE, openArchiveDb } from '../../../src/forensics/archive-naming';
import { deleteDb, deleteDbs } from '../../helpers/indexeddb';
import { installChromeStorageStub, type ChromeStorageStub } from '../../helpers/chrome-storage';
import { installFaultyIndexedDB, storageTestRecord, type FaultyIndexedDB } from '../../helpers/faulty-indexeddb';

const DB = 'feelingwise-forensics';
const MONTH = '2026-08';

let idb: FaultyIndexedDB;
let storage: ChromeStorageStub;

async function seedChain(count: number): Promise<void> {
  const envelopes: unknown[] = [];
  for (let i = 0; i < count; i++) {
    const partial = storageTestRecord({
      id: `r${i}`,
      chainPosition: i,
      timestamp: new Date(Date.UTC(2026, 7, 10, 12, i)).toISOString(),
    });
    const integrityHash = await computeRecordIntegrityHash(partial);
    envelopes.push(await compressRecord({ ...partial, integrityHash, signature: 'signed' } as ForensicRecord));
  }
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

/** One more record at the head of the chain, so a write-time fault can hit exactly it. */
async function seedOneAt(position: number): Promise<void> {
  const partial = storageTestRecord({
    id: `r${position}`,
    chainPosition: position,
    timestamp: new Date(Date.UTC(2026, 7, 11, 12)).toISOString(),
  });
  const integrityHash = await computeRecordIntegrityHash(partial);
  const envelope = await compressRecord({ ...partial, integrityHash, signature: 'signed' } as ForensicRecord);
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite');
    tx.objectStore('records').add(envelope);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('seed aborted'));
  });
  db.close();
}

/** One archived month with one row in it, so the archive dimension has something to lose. */
async function seedArchiveMonth(): Promise<void> {
  const partial = storageTestRecord({ id: 'a0', chainPosition: 0 });
  const integrityHash = await computeRecordIntegrityHash(partial);
  const envelope = await compressRecord({ ...partial, integrityHash, signature: 'signed' } as ForensicRecord);
  const db = await openArchiveDb(MONTH);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ARCHIVE_RECORDS_STORE, 'readwrite');
    tx.objectStore(ARCHIVE_RECORDS_STORE).add(envelope);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('archive seed aborted'));
  });
  db.close();
}

beforeEach(async () => {
  idb = installFaultyIndexedDB();
  storage = installChromeStorageStub();
  await deleteDbs(DB, archiveDbName(MONTH));
});

afterEach(async () => {
  idb.clearFaults();
  await deleteDbs(DB, archiveDbName(MONTH));
  storage.restore();
  idb.restore();
});

describe('the premise M186 rests on', () => {
  // Stated as its own test because everything else here depends on it, and
  // because it is the sentence the module's docblock asserts about Chrome
  // without anything in the tree ever having exercised it.
  it('an evicted database re-opens empty, upgrading from oldVersion 0, and every read succeeds', async () => {
    await seedChain(40);
    expect((await getChainState()).nextPosition).toBe(40);

    await idb.wipe(DB);

    let sawOldVersion: number | undefined;
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(DB, 6);
      req.onupgradeneeded = (event) => {
        sawOldVersion = event.oldVersion;
        const db = req.result;
        if (!db.objectStoreNames.contains('records')) {
          const store = db.createObjectStore('records', { autoIncrement: true });
          store.createIndex('chainPosition', 'chainPosition', { unique: false });
        }
      };
      req.onsuccess = () => { req.result.close(); resolve(); };
      req.onerror = () => reject(req.error);
    });

    // The whole defect in three assertions: the database that held forty
    // records now says it is brand new, the read does not fail, and the chain
    // reads as genesis.
    expect(sawOldVersion).toBe(0);
    expect(await getRecords()).toEqual([]);
    expect((await getChainState()).nextPosition).toBe(0);
  });
});

describe('checkChainHeight over a database that came back empty', () => {
  it('arms on a chain that holds records and claims no loss', async () => {
    await seedChain(40);

    const outcome = await checkChainHeight();

    expect(outcome).toEqual({ status: 'ok', nextPosition: 40 });
    const witness = await readChainHeightWitness();
    expect(witness?.highestNextPosition).toBe(40);
    expect(witness?.stated).toBeUndefined();
  });

  // THE DEFECT. Before the witness module the answer here was silence.
  it('states the loss on the chain when the record is destroyed under it', async () => {
    await seedChain(40);
    await checkChainHeight();

    await idb.wipe(DB);

    const outcome = await checkChainHeight();

    expect(outcome.status).toBe('stated-loss');
    if (outcome.status !== 'stated-loss') throw new Error('unreachable');
    expect(outcome.heldPositions).toBe(40);

    // The statement is a signed record on the chain that replaced the one that
    // went, not a console line and not a flag in settings storage.
    const onChain = await getRecords();
    expect(onChain).toHaveLength(1);
    expect(onChain[0].kind).toBe('gap-marker');
    expect(onChain[0].originalText).toContain('chain-lost');
    expect(onChain[0].chainPosition).toBe(0);
  });

  // The heartbeat case the module's docblock calls the reason "is the chain
  // empty" was not enough: by the time anything looks, a destroyed record reads
  // as a chain of one rather than a chain of none.
  it('still states the loss when a fresh record has already landed on the new chain', async () => {
    await seedChain(40);
    await checkChainHeight();

    await idb.wipe(DB);
    // One post captured, or one heartbeat tick, before the check runs.
    await seedChain(1);

    const outcome = await checkChainHeight();

    expect(outcome.status).toBe('stated-loss');
    if (outcome.status !== 'stated-loss') throw new Error('unreachable');
    expect(outcome.heldPositions).toBe(40);
  });

  it('says it once, not on every wake', async () => {
    await seedChain(40);
    await checkChainHeight();
    await idb.wipe(DB);

    expect((await checkChainHeight()).status).toBe('stated-loss');
    expect((await checkChainHeight()).status).toBe('ok');
    expect((await checkChainHeight()).status).toBe('ok');

    const markers = (await getRecords()).filter(r => r.kind === 'gap-marker');
    expect(markers).toHaveLength(1);
    // And the fact that it happened outlives the wake that found it.
    expect((await readChainHeightWitness())?.stated?.heldPositions).toBe(40);
  });

  // The second dimension. The active chain is re-based to 1 at every month
  // flip, so its height can never describe more than the current month; a note
  // watching only the chain would say "three positions" while the archived
  // months went with them.
  it('counts the archived months that went with the chain', async () => {
    await seedChain(5);
    await seedArchiveMonth();
    await checkChainHeight(true);
    expect((await readChainHeightWitness())?.highestArchives?.months).toBe(1);

    await idb.wipe(DB);
    await idb.wipe(archiveDbName(MONTH));

    const outcome = await checkChainHeight(true);

    expect(outcome.status).toBe('stated-loss');
    if (outcome.status !== 'stated-loss') throw new Error('unreachable');
    expect(outcome.heldPositions).toBe(5);
    expect(outcome.heldArchivedMonths).toBe(1);
  });

  // An unreadable reading is never a zero. This is the false-alarm side, and it
  // is the one that would put a signed "your record was destroyed" on the chain
  // of an install whose record is fine.
  it('says nothing about a chain it could not read', async () => {
    await seedChain(40);
    await checkChainHeight();

    // Not destroyed: present, indexed, unreadable. The next record lands with
    // an undecodable payload, so it wins the chainPosition cursor and
    // getChainState throws decompressing it. store.ts's own comment says why
    // that must not read as genesis: returning zero on a transient failure
    // forks the chain at position 0.
    idb.corruptOnWrite({ db: DB, store: 'records' });
    await seedOneAt(40);

    const outcome = await checkChainHeight();

    // Whatever it is, it is not a stated loss over a store nobody could read.
    expect(outcome.status).toBe('failed');
    expect(idb.log.some(e => e.kind === 'corrupt-write')).toBe(true);
    expect((await readChainHeightWitness())?.stated).toBeUndefined();
    expect(storage.state[CHAIN_HEIGHT_WITNESS_KEY]).toBeDefined();
  });
});
