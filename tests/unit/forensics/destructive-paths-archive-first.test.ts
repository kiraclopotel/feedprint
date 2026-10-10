// THE RULE: no code path may remove a record from the active chain without
// first placing it somewhere the export can still reach.
//
// Three paths clear records, and only one of them was ever examined:
//
//   1. pruneRecordsToCap    — a timer, so it was noticed (27017 records lost)
//   2. resetForensicChain   — user-initiated, so it was never questioned
//   3. replaceBackupState…  — user-initiated, so it was never questioned
//
// "The user asked for it" is not the same permission as "destroy the record".
// A reset asks for a clean dashboard and a fresh chain; a restore asks to
// recover data. Neither asks for the existing history to stop existing, and
// this app's entire claim is a record that can be checked afterwards.
//
// This file covers paths 2 and 3. Path 1 has its own two files.

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

import {
  openDB,
  resetForensicChain,
  replaceBackupStateUnderChainLock,
} from '../../../src/forensics/store';
import { loadArchivesOldestFirst, countArchivedRecords } from '../../../src/forensics/archive-reader';
import { archiveDbName } from '../../../src/forensics/archive-naming';
import { deleteDb } from '../../helpers/indexeddb';

const DB = 'feelingwise-forensics';
const MONTHS = ['2026-07', '2026-08'];

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
        timestamp: new Date(Date.UTC(2026, 7, 1 + (i % 10), 12)).toISOString(),
      });
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function archivedIds(): Promise<string[]> {
  const archives = await loadArchivesOldestFirst();
  return archives.flatMap(a => a.records.map(r => r.id));
}

beforeEach(async () => {
  await deleteDb(DB);
  for (const m of MONTHS) await deleteDb(archiveDbName(m));
});

afterEach(async () => {
  await deleteDb(DB);
  for (const m of MONTHS) await deleteDb(archiveDbName(m));
});

describe('chain reset', () => {
  it('retires every record to the archive instead of destroying it', async () => {
    await seed(12);

    const result = await resetForensicChain('test');

    expect(result.recordsArchived).toBe(12);
    const archived = await archivedIds();
    for (let i = 0; i < 12; i++) expect(archived).toContain(`r${i}`);
  });

  it('still gives the user what a reset is for: a fresh, empty active chain', async () => {
    await seed(12);

    await resetForensicChain('test');

    // Only the reset marker survives in the active store.
    const db = await openDB();
    const rows: unknown[] = await new Promise((resolve, reject) => {
      const req = db.transaction('records', 'readonly').objectStore('records').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    expect(rows.length).toBe(1);
  });
});

describe('backup restore', () => {
  it('retires the outgoing chain before replacing it', async () => {
    await seed(8);

    await replaceBackupStateUnderChainLock(
      [{
        id: 'restored-0',
        chainPosition: 0,
        integrityHash: 'rh0',
        originalText: 'restored',
        timestamp: new Date(Date.UTC(2026, 6, 1, 12)).toISOString(),
      }] as never,
      [],
      [],
    );

    // The eight records the restore overwrote are still reachable.
    const archived = await archivedIds();
    for (let i = 0; i < 8; i++) expect(archived).toContain(`r${i}`);
  });
});

describe('the record count the user is shown', () => {
  it('counts the archives, so the total cannot fall when records are retired', async () => {
    await seed(12);
    const before = 12;

    await resetForensicChain('test');

    // The header adds the archived count to the active chain. After a reset
    // the active chain holds only the marker, so without the archive figure
    // the user would watch the number collapse and read it as data loss.
    expect((await countArchivedRecords()).count).toBe(before);
  });
});
