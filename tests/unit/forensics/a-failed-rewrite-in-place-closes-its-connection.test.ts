// The in-place rewrite that repairs record positions must close its database
// connection when its transaction fails, not only when it completes. A handle
// left open blocks the next thing that asks for this database, which is how a
// deletion or an upgrade of the record ends up waiting on nobody.

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

import { rewriteRecordsInPlace } from '../../../src/forensics/store';
import { deleteDb } from '../../helpers/indexeddb';
import { installFaultyIndexedDB, storageTestRecord, type FaultyIndexedDB } from '../../helpers/faulty-indexeddb';

const DB = 'feelingwise-forensics';

let idb: FaultyIndexedDB;

beforeEach(() => {
  idb = installFaultyIndexedDB();
});

afterEach(() => {
  idb.clearFaults();
  idb.restore();
});

describe('a rewrite in place', () => {
  it('closes its connection when it succeeds', async () => {
    await expect(rewriteRecordsInPlace([storageTestRecord({ id: 'r0' })])).resolves.toBe(0);

    await expect(deleteDb(DB)).resolves.toBeUndefined();
  });

  it('whose transaction fails rejects and leaves no connection holding the record open', async () => {
    idb.failCommit({ db: DB, store: 'records' });

    await expect(rewriteRecordsInPlace([storageTestRecord({ id: 'r0' })])).rejects.toBeDefined();

    await expect(deleteDb(DB), 'the database can be deleted, so nothing still holds it').resolves.toBeUndefined();
  });
});
