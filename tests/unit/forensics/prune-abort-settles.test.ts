// A transaction that aborts at commit fires neither oncomplete nor onerror.
// Before tx.onabort was wired, the prune promise never settled, the shared
// chain lock was never released, and every later record write waited for the
// rest of the worker's life (audit EVIDENCE-PATH-7). This drives the real
// prune under fake-indexeddb with the commit replaced by an abort and checks
// that the prune settles (to 0, its failure value) and the lock moves on.

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
vi.mock('../../../src/forensics/scan-log', () => ({ clearScanLog: vi.fn(async () => undefined) }));
vi.mock('../../../src/forensics/author-store', () => ({ clearAuthorProfiles: vi.fn(async () => undefined) }));
vi.mock('../../../src/forensics/neutralizer-diagnostics', () => ({ resetNeutralizerDiagnostics: vi.fn(async () => undefined) }));
vi.mock('../../../src/storage/cache', () => ({ processingCache: { clear: vi.fn() } }));
vi.mock('../../../src/analysis/comment-batch-scorer', () => ({ clearBatchCache: vi.fn() }));

import { openDB, pruneRecordsToCap } from '../../../src/forensics/store';
import { sharedChainWriteLock } from '../../../src/forensics/chain-write-lock';
import { deleteDb } from '../../helpers/indexeddb';

const DB = 'feelingwise-forensics';

async function seed(count: number): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite');
    for (let i = 0; i < count; i++) {
      tx.objectStore('records').add({ id: `r${i}`, chainPosition: i, integrityHash: `h${i}`, originalText: `t${i}` });
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

const realTransaction = IDBDatabase.prototype.transaction;

/**
 * Make the next readwrite transaction on `records` behave as if it aborted at
 * commit: every request still succeeds, but instead of `complete` the
 * transaction delivers only `abort`. This is the event sequence a quota
 * failure at commit produces.
 */
function abortNextPruneAtCommit(): void {
  let armed = true;
  IDBDatabase.prototype.transaction = function (this: IDBDatabase, stores: string | string[], mode?: IDBTransactionMode, options?: IDBTransactionOptions) {
    const tx = realTransaction.call(this, stores, mode, options);
    if (armed && mode === 'readwrite' && (stores === 'records' || (Array.isArray(stores) && stores.includes('records')))) {
      armed = false;
      let userComplete: ((ev: Event) => unknown) | null = null;
      Object.defineProperty(tx, 'oncomplete', {
        configurable: true,
        get: () => userComplete,
        set: (fn) => { userComplete = fn; },
      });
      tx.addEventListener('complete', () => {
        const abortHandler = tx.onabort;
        if (abortHandler) abortHandler.call(tx, new Event('abort'));
      });
    }
    return tx;
  };
}

beforeEach(async () => {
  await deleteDb(DB);
});

afterEach(async () => {
  IDBDatabase.prototype.transaction = realTransaction;
  await deleteDb(DB);
});

describe('prune under an aborted commit', () => {
  it('settles to 0 and releases the shared chain lock for the next caller', async () => {
    await seed(6);
    abortNextPruneAtCommit();

    const pruned = await Promise.race([
      pruneRecordsToCap(3),
      new Promise<'hung'>(resolve => setTimeout(() => resolve('hung'), 2000)),
    ]);
    expect(pruned).toBe(0);

    const next = await Promise.race([
      sharedChainWriteLock(async () => 'ran'),
      new Promise<'hung'>(resolve => setTimeout(() => resolve('hung'), 2000)),
    ]);
    expect(next).toBe('ran');
  });
});
