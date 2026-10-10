// The reset dialog names every part whose flag is not true, so each flag has to
// come from what that clear actually did. The failures here are transaction
// aborts and storage rejections under the real helpers, not mocked results.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFaultyIndexedDB, type FaultyIndexedDB } from '../../helpers/faulty-indexeddb';
import { installChromeStorageStub, type ChromeStorageStub } from '../../helpers/chrome-storage';

vi.mock('../../../src/forensics/signing', () => ({
  signHash: vi.fn(async () => 'signed'),
  verifyHash: vi.fn(async () => true),
  getPublicKeyFingerprint: vi.fn(async () => 'mock-fingerprint'),
}));
vi.mock('../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/storage/settings')>();
  return {
    ...actual,
    getSettingsForAttestation: vi.fn(async () => ({ mode: 'adult', readFailed: false })),
  };
});
vi.mock('../../../src/storage/cache', () => ({ processingCache: { clear: vi.fn() } }));
vi.mock('../../../src/analysis/comment-batch-scorer', () => ({ clearBatchCache: vi.fn() }));
vi.mock('../../../src/forensics/delivery-outbox', () => ({
  getForensicDeliveryStatus: vi.fn(async () => ({ pendingCount: 0 })),
}));

import { resetForensicChain } from '../../../src/forensics/store';
import { incompleteResetParts } from '../../../src/ui/dashboard/reset-modal-status';

let idb: FaultyIndexedDB;
let chromeStub: ChromeStorageStub;

/** chrome.storage.local.set refuses any write that carries one of these keys, the way a full quota does. */
function refuseStorageWritesOf(keys: string[]): void {
  const local = (globalThis as unknown as { chrome: { storage: { local: { set: (o: Record<string, unknown>) => Promise<void> } } } })
    .chrome.storage.local;
  const honest = local.set;
  local.set = (obj) => (Object.keys(obj).some((k) => keys.includes(k))
    ? Promise.reject(new Error('QUOTA_BYTES quota exceeded'))
    : honest(obj));
}

/**
 * The next clear on this database succeeds and then its transaction aborts
 * before it commits, the way a disk or commit failure does: only the
 * transaction's abort event fires, and no request error reaches onerror.
 */
function abortAtCommitAfterClear(dbName: string): void {
  const honestClear = IDBObjectStore.prototype.clear;
  vi.spyOn(IDBObjectStore.prototype, 'clear').mockImplementation(function (this: IDBObjectStore) {
    const req = honestClear.call(this);
    if (this.transaction.db.name === dbName) {
      req.addEventListener('success', () => this.transaction.abort(), { once: true });
    }
    return req;
  });
}

/** A reset that never settles would leave the dialog waiting forever; fail with that instead of the suite timeout. */
async function settledWithin<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`the reset had not settled after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

beforeEach(() => {
  idb = installFaultyIndexedDB();
  chromeStub = installChromeStorageStub();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  idb.clearFaults();
  idb.restore();
  chromeStub.restore();
  vi.restoreAllMocks();
});

describe('a reset reports the side stores it could not empty', () => {
  it('reports every part cleared when every part was', async () => {
    const result = await resetForensicChain('clean');

    expect(result.resetMarkerWritten).toBe(true);
    expect(incompleteResetParts(result)).toEqual([]);
  });

  it('names each store whose clear failed, and only those', async () => {
    idb.failCommit({ db: 'feelingwise-scans', store: 'events' });
    idb.failCommit({ db: 'feelingwise-authors', store: 'profiles' });
    idb.failCommit({ db: 'feelingwise-forensics', store: 'parentFeedback' });
    refuseStorageWritesOf(['neutralizerDiagnostics', 'totalChecksToday']);

    const result = await resetForensicChain('side stores refuse');

    // The chain itself was reset: the marker and the clear are one transaction.
    expect(result.resetMarkerWritten).toBe(true);
    expect(result).toMatchObject({
      scanLogCleared: false,
      authorProfilesCleared: false,
      verdictsCleared: false,
      diagnosticsCleared: false,
      usageStatsCleared: false,
      parentFeedbackCleared: false,
      chainAnchorsCleared: true,
    });
    // What the dialog is handed to name for the parent.
    expect(incompleteResetParts(result)).toEqual([
      'scanLogCleared',
      'authorProfilesCleared',
      'verdictsCleared',
      'diagnosticsCleared',
      'usageStatsCleared',
      'parentFeedbackCleared',
    ]);
  });

  it('reads the verdicts part off the store that holds the verdicts a parent gave', async () => {
    // The dialog promises to clear "the verdicts you gave", and those are the
    // Confirm / Dispute entries in the parent-feedback sidecar.
    idb.failCommit({ db: 'feelingwise-forensics', store: 'parentFeedback' });

    const result = await resetForensicChain('parent feedback refuses');

    expect(incompleteResetParts(result)).toEqual(['verdictsCleared', 'parentFeedbackCleared']);
  });
});

describe('a clear whose commit aborts after the clear itself succeeded', () => {
  it('names the scan log instead of leaving the reset unsettled', async () => {
    abortAtCommitAfterClear('feelingwise-scans');

    const result = await settledWithin(resetForensicChain('scan log commit aborts'), 2000);

    expect(result.resetMarkerWritten).toBe(true);
    expect(incompleteResetParts(result)).toEqual(['scanLogCleared']);
  });

  it('names the author profiles instead of leaving the reset unsettled', async () => {
    abortAtCommitAfterClear('feelingwise-authors');

    const result = await settledWithin(resetForensicChain('author profiles commit aborts'), 2000);

    expect(result.resetMarkerWritten).toBe(true);
    expect(incompleteResetParts(result)).toEqual(['authorProfilesCleared']);
  });
});
