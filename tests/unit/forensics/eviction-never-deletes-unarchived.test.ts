// EVICTION INVARIANT: eviction may never delete a record it has not archived.
//
// The forensic store enforced its 10000-record cap by deleting the oldest
// records outright. The archive that was supposed to preserve them
// (chain-rotation.ts) only fires at a UTC month flip, and at real write
// volume (~3000 records/day) the cap is reached in three days — so rotation
// never had a month to archive and history was destroyed instead of moved.
// On a real install this cost 27017 of 38834 chain positions.
//
// These tests assert CONSERVATION, not stasis: prune is allowed to move a
// record out of the active chain, and is never allowed to lose it. Asserting
// on where the records are (rather than on the feature flag) is what makes
// this survive both the hotfix and archive-on-evict.

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
import { loadArchivesOldestFirst } from '../../../src/forensics/archive-reader';
import { archiveDbName } from '../../../src/forensics/archive-naming';
import { deleteDb } from '../../helpers/indexeddb';

const DB = 'feelingwise-forensics';
/** Seeded records straddle two UTC months on purpose — eviction must fan out. */
const SEED_MONTHS = ['2026-07', '2026-08'];

/** 20 records: ids r0..r19, the first 10 in July 2026, the rest in August. */
async function seed(count: number): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite');
    for (let i = 0; i < count; i++) {
      const month = i < count / 2 ? 6 : 7; // 0-indexed: June+1=July, July+1=August
      tx.objectStore('records').add({
        id: `r${i}`,
        chainPosition: i,
        integrityHash: `h${i}`,
        originalText: `t${i}`,
        timestamp: new Date(Date.UTC(2026, month, 1 + (i % 10), 12)).toISOString(),
      });
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function activeIds(): Promise<string[]> {
  const db = await openDB();
  const rows: Array<{ id: string }> = await new Promise((resolve, reject) => {
    const req = db.transaction('records', 'readonly').objectStore('records').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return rows.map(r => r.id);
}

async function archivedIds(): Promise<string[]> {
  const archives = await loadArchivesOldestFirst();
  return archives.flatMap(a => a.records.map(r => r.id));
}

beforeEach(async () => {
  await deleteDb(DB);
  for (const m of SEED_MONTHS) await deleteDb(archiveDbName(m));
});

afterEach(async () => {
  await deleteDb(DB);
  for (const m of SEED_MONTHS) await deleteDb(archiveDbName(m));
});

describe('eviction invariant', () => {
  it('conserves every record across the active chain and the archives', async () => {
    await seed(20);

    await pruneRecordsToCap(5);

    const active = await activeIds();
    const archived = await archivedIds();
    const seeded = Array.from({ length: 20 }, (_, i) => `r${i}`);

    // The union must still contain all 20. A record present in neither is
    // exactly the failure this whole change exists to make impossible.
    const union = new Set([...active, ...archived]);
    for (const id of seeded) {
      expect(union.has(id), `record ${id} exists in neither the active chain nor any archive`).toBe(true);
    }
  });

  it('routes evicted records into the archive for their own month', async () => {
    await seed(20);

    await pruneRecordsToCap(5);

    const archives = await loadArchivesOldestFirst();
    for (const { monthKey, records } of archives) {
      for (const r of records) {
        expect(r.timestamp.slice(0, 7)).toBe(monthKey);
      }
    }
  });

  it('is idempotent — a second pass does not duplicate what it already archived', async () => {
    await seed(20);

    await pruneRecordsToCap(5);
    const afterFirst = (await archivedIds()).sort();

    await pruneRecordsToCap(5);
    const afterSecond = (await archivedIds()).sort();

    expect(new Set(afterSecond).size).toBe(afterSecond.length); // no duplicate ids
    for (const id of afterFirst) expect(afterSecond).toContain(id);
  });
});
