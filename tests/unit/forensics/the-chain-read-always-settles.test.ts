// A read that never settles stops every forensic write in the realm, silently.
//
// `getChainState` is called by the logger before each write, to learn the next
// chain position and the previous record's hash, and it is awaited WHILE THE
// SHARED CHAIN WRITE LOCK IS HELD. So a promise that never settles there does
// not lose one record. It stops the recorder for the rest of the worker's life,
// with nothing in the console and nothing on screen: the extension goes on
// looking like it is recording, and the export made afterwards is short by
// however many hours that worker lived.
//
// Found 2026-09-19 by a scout, and the mechanism it named was not quite the one
// that bites. A PENDING request does get an error event when a transaction
// aborts, so an ordinary abort was already handled. The hole is a cursor
// request that has ALREADY fired `success`: it is not pending any more, and an
// exception thrown inside that handler aborts the transaction by itself. Then
// nothing is left that can settle the promise. Reading `c.value` is where a
// throw can come from, because it deserializes whatever survived on disk.
//
// archive-writer.ts:269 and the prune path in store.ts both carry the fix and
// say why in their own comments. This read did not.
//
// The first case below forces exactly that throw. Before the fix it hung until
// vitest killed the file; the timeout race is there so a regression reads as
// "it never came back" rather than as a suite that stops.

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

import { getChainState, openDB } from '../../../src/forensics/store';

// The object store's name, as the neighbouring tests write it: store.ts keeps
// STORE_NAME to itself.
const STORE_NAME = 'records';
import { compressRecord } from '../../../src/forensics/record-compression';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import { deleteDb } from '../../helpers/indexeddb';
import { installChromeStorageStub, type ChromeStorageStub } from '../../helpers/chrome-storage';
import { storageTestRecord } from '../../helpers/faulty-indexeddb';

const DB = 'feelingwise-forensics';
let storage: ChromeStorageStub;

async function seedOneRecord(over: Record<string, unknown> = {}): Promise<void> {
  const partial = storageTestRecord({ id: 'r0', chainPosition: 0, timestamp: '2026-08-10T12:00:00.000Z', ...over } as never);
  const record = { ...partial, integrityHash: await computeRecordIntegrityHash(partial) };
  const envelope = await compressRecord(record as never);
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add(envelope);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}

/**
 * Make the walk's own `continue()` throw, which is a throw INSIDE the cursor's
 * success handler at the moment nothing is pending: the request has already
 * fired, and `continue` never ran, so the transaction aborts with no request
 * left to carry an error. That is the shape the fix is for. The prototype is
 * taken off a live cursor rather than imported, so this keeps working whatever
 * fake-indexeddb calls its classes.
 */
async function breakCursorContinue(): Promise<() => void> {
  const db = await openDB();
  const proto = await new Promise<object>((resolve, reject) => {
    const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) { reject(new Error('no cursor to learn the prototype from')); return; }
      resolve(Object.getPrototypeOf(c) as object);
    };
    req.onerror = () => reject(req.error);
  });
  db.close();
  const original = Object.getOwnPropertyDescriptor(proto, 'continue');
  Object.defineProperty(proto, 'continue', {
    configurable: true,
    writable: true,
    value: () => { throw new Error('cursor walk failed'); },
  });
  return () => {
    if (original) Object.defineProperty(proto, 'continue', original);
    else delete (proto as Record<string, unknown>).continue;
  };
}

/** Settles either way within the budget, or says plainly that it never came back. */
async function within<T>(ms: number, p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; err: unknown } | 'never-settled'> {
  let timer: ReturnType<typeof setTimeout>;
  const guard = new Promise<'never-settled'>((resolve) => { timer = setTimeout(() => resolve('never-settled'), ms); });
  try {
    return await Promise.race([
      p.then((value) => ({ ok: true as const, value }), (err) => ({ ok: false as const, err })),
      guard,
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

beforeEach(async () => {
  storage = installChromeStorageStub();
  await deleteDb(DB);
});

afterEach(async () => {
  storage.restore();
  await deleteDb(DB);
  vi.clearAllMocks();
});

describe('the chain read always settles (2026-09-19)', () => {
  it('rejects rather than hanging when reading a stored entry throws', async () => {
    // A relegated record is the one shape that makes the walk call `continue`
    // rather than resolving on the first hit, which is where the throw lands.
    await seedOneRecord({ chainAnchor: 'pre-rekey' });
    const restore = await breakCursorContinue();
    try {
      const outcome = await within(2000, getChainState());
      expect(outcome, 'a read that never comes back holds the chain write lock for ever')
        .not.toBe('never-settled');
      expect(typeof outcome === 'object' && outcome.ok, 'and it must not claim a position it could not read')
        .toBe(false);
    } finally {
      restore();
    }
  });

  it('still answers genesis on an empty chain, which is a success and not an error', async () => {
    // The distinction the function's own catch exists for: an empty chain is
    // position 0 by the success path, and an IDB error must never be turned
    // into position 0, because that forks the chain at genesis.
    const outcome = await within(2000, getChainState());
    expect(outcome).not.toBe('never-settled');
    expect(typeof outcome === 'object' && outcome.ok).toBe(true);
    if (typeof outcome === 'object' && outcome.ok) {
      expect(outcome.value.nextPosition).toBe(0);
    }
  });

  it('reads the head of a seeded chain', async () => {
    // The control: the fix must not have changed what the walk answers.
    await seedOneRecord();
    const outcome = await within(2000, getChainState());
    expect(typeof outcome === 'object' && outcome.ok).toBe(true);
    if (typeof outcome === 'object' && outcome.ok) {
      expect(outcome.value.nextPosition).toBe(1);
      expect(outcome.value.prevRecordHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
