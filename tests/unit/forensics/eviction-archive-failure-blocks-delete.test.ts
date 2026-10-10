// The other half of the eviction invariant, tested at the seam.
//
// eviction-never-deletes-unarchived.test.ts covers the happy path: overflow
// is moved, and every record is still findable afterwards. This file covers
// the path that actually loses data if it is wrong — the archive write FAILS
// (disk full, quota, a corrupt archive database, an interrupted worker) and
// prune must then delete nothing at all and leave the active chain over cap.
//
// Mocked at the module boundary rather than by breaking IndexedDB, because
// the contract under test belongs to store.ts: "when the writer reports it
// could not archive, do not delete". How the writer came to fail is the
// writer's business and is covered by its own read-back check.

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

// The writer reports total failure, the way it does when no month could be
// opened or nothing survived its read-back check.
vi.mock('../../../src/forensics/archive-writer', () => ({
  archiveEvictedRecords: vi.fn(async () => ({ ok: false, reason: 'archive unavailable (test)' })),
}));

import { openDB, pruneRecordsToCap } from '../../../src/forensics/store';
import { archiveEvictedRecords } from '../../../src/forensics/archive-writer';
import { deleteDb } from '../../helpers/indexeddb';

const DB = 'feelingwise-forensics';

async function seed(count: number): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite');
    for (let i = 0; i < count; i++) {
      tx.objectStore('records').add({
        id: `r${i}`,
        chainPosition: i,
        integrityHash: `h${i}`,
        originalText: `t${i}`,
        timestamp: new Date(Date.UTC(2026, 7, 1 + i, 12)).toISOString(),
      });
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function countRecords(): Promise<number> {
  const db = await openDB();
  const n = await new Promise<number>((resolve, reject) => {
    const req = db.transaction('records', 'readonly').objectStore('records').count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return n;
}

beforeEach(async () => {
  await deleteDb(DB);
  vi.mocked(archiveEvictedRecords).mockClear();
});

afterEach(async () => {
  await deleteDb(DB);
});

describe('eviction when the archive cannot be written', () => {
  it('deletes nothing and reports zero', async () => {
    await seed(20);

    const deleted = await pruneRecordsToCap(5);

    expect(deleted).toBe(0);
    expect(await countRecords()).toBe(20);
  });

  it('did attempt the archive first, rather than skipping eviction entirely', async () => {
    await seed(20);

    await pruneRecordsToCap(5);

    // The distinction matters: "eviction is switched off" and "eviction tried
    // to archive and could not" look identical from the record count alone,
    // and only the second one should retry on the next alarm.
    expect(archiveEvictedRecords).toHaveBeenCalledTimes(1);
    expect(vi.mocked(archiveEvictedRecords).mock.calls[0][0]).toHaveLength(15);
  });

  it('leaves the chain over cap so the next run retries the same records', async () => {
    await seed(20);

    await pruneRecordsToCap(5);
    await pruneRecordsToCap(5);

    expect(await countRecords()).toBe(20);
    expect(archiveEvictedRecords).toHaveBeenCalledTimes(2);
  });
});

// A PARTIAL ARCHIVE MUST NOT PUNCH A HOLE IN THE MIDDLE. archiveEvictedRecords
// may return ok with a SHORT key list, and the prune deleted whatever it had
// taken — a non-contiguous set, so positions 0,1,3,4 could go while 2 stayed.
// Two things break at once: the chain gets an interior hole, the shape a reader
// cannot tell from deletion; and the prune marker records first/last deleted as
// a RANGE, so it would sign "0 through 4 removed" with 2 still sitting there.
describe('eviction when the archive takes only some of the overflow', () => {
  it('deletes the contiguous oldest run and leaves the rest for the next prune', async () => {
    await seed(20);
    // Archive everything except one record in the middle of the overflow.
    vi.mocked(archiveEvictedRecords).mockImplementationOnce(async (items) => ({
      ok: true,
      archivedKeys: (items as Array<{ key: IDBValidKey }>)
        .map(i => i.key)
        .filter((_k, idx) => idx !== 5),
      months: ['2026-08'],
    } as never));

    const deleted = await pruneRecordsToCap(5);

    // Only the five before the gap go, not the fourteen the archive took.
    expect(deleted).toBe(5);
    // 20 seeded, 5 removed, plus the signed prune marker the prune appends.
    expect(await countRecords()).toBe(16);

    // The property that matters: what survives has NO interior hole. Position 5
    // — the one the archive refused — must still be there, and every step from
    // the lowest survivor to the highest must be by one.
    const positions = await allPositions();
    expect(positions).toContain(5);
    const seeded = positions.filter(p => p < 20);
    expect(seeded[0]).toBe(5);
    for (let i = 1; i < seeded.length; i++) {
      expect(seeded[i]).toBe(seeded[i - 1] + 1);
    }
  });
});

async function allPositions(): Promise<number[]> {
  const db = await openDB();
  const out = await new Promise<number[]>((resolve, reject) => {
    const req = db.transaction('records', 'readonly').objectStore('records').getAll();
    req.onsuccess = () => resolve(
      (req.result as Array<{ chainPosition?: number; kind?: string }>)
        .filter(r => typeof r.chainPosition === 'number' && r.kind !== 'prune-marker')
        .map(r => r.chainPosition as number)
        .sort((a, b) => a - b),
    );
    req.onerror = () => reject(req.error);
  });
  db.close();
  return out;
}
