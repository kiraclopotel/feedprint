// One stored row whose payload will not decode must not stop the jobs that
// keep the record: the prune, the month rotation, the reset and the restore.
// Each of them used to decode every row it moved and give up at the first that
// failed, so the live record grew past its cap and nothing could be retired.
// The row is carried forward as the bytes it was stored as, never dropped, and
// Verify reports it as damaged instead of calling the whole record broken.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteDb } from '../../helpers/indexeddb';

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
vi.mock('../../../src/forensics/delivery-outbox', () => ({
  getForensicDeliveryStatus: vi.fn(async () => ({ pendingCount: 0 })),
}));

import {
  addRecord,
  getRecords,
  getRecordsDetailed,
  openDB,
  pruneRecordsToCap,
  replaceBackupStateUnderChainLock,
  resetForensicChain,
} from '../../../src/forensics/store';
import { rotateChainAtMonthFlip } from '../../../src/forensics/chain-rotation';
import { loadArchivesOldestFirst } from '../../../src/forensics/archive-reader';
import { archiveDbName, openArchiveDb } from '../../../src/forensics/archive-naming';
import {
  CHAIN_GENESIS_HASH,
  verifyChainIntegrity,
  verifyChainIntegrityAcrossMonths,
} from '../../../src/forensics/chain-integrity';
import { integrityVerificationState } from '../../../src/forensics/integrity-summary';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import { isCompressedEnvelope } from '../../../src/forensics/record-compression';
import type { ForensicRecord } from '../../../src/types/forensic';

const ACTIVE_DB = 'feelingwise-forensics';
const MONTHS = ['2026-08', '2026-09'];

async function buildRecord(
  id: string,
  position: number,
  prevHash: string,
  timestamp: string,
): Promise<ForensicRecord> {
  const partial: Omit<ForensicRecord, 'integrityHash' | 'signature'> = {
    id,
    timestamp,
    platform: 'twitter',
    originalText: `record ${id}`,
    originalHash: 'a'.repeat(64),
    originalLength: 12,
    neutralizedText: '',
    author: 'tester',
    postUrl: 'https://x.com/t/1',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'unknown',
    prevRecordHash: prevHash,
    chainPosition: position,
    chainAnchor: position === 0 ? 'genesis-v1' : undefined,
    verdict: 'pass',
    kind: 'post',
    publicKeyFingerprint: 'mock-fingerprint',
  };
  const integrityHash = await computeRecordIntegrityHash(partial);
  return { ...partial, integrityHash, signature: 'signed' };
}

/** Four August records, fr-0..fr-3 at positions 0..3, stored compressed as the logger stores them. */
async function seedAugustChain(): Promise<void> {
  let prev = CHAIN_GENESIS_HASH;
  for (let p = 0; p < 4; p++) {
    const r = await buildRecord(`fr-${p}`, p, prev, new Date(Date.UTC(2026, 7, 2 + p, 12)).toISOString());
    await addRecord(r);
    prev = r.integrityHash;
  }
}

/** Cut one stored row's gzip payload short, the shape a partial write leaves. Returns the bytes left. */
async function damageRow(id: string): Promise<number[]> {
  const db = await openDB();
  const left = await new Promise<Uint8Array>((resolve, reject) => {
    let cut: Uint8Array | undefined;
    const tx = db.transaction('records', 'readwrite');
    const req = tx.objectStore('records').openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return;
      if (c.value.id === id) {
        cut = (c.value.payload as Uint8Array).slice(0, 8);
        c.update({ ...c.value, payload: cut });
      }
      c.continue();
    };
    tx.oncomplete = () => (cut ? resolve(cut) : reject(new Error(`no stored row ${id}`)));
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return Array.from(left);
}

async function storedRows(db: IDBDatabase): Promise<Array<{ id: string; payload?: Uint8Array }>> {
  return new Promise((resolve, reject) => {
    const req = db.transaction('records', 'readonly').objectStore('records').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function activeIds(): Promise<string[]> {
  const db = await openDB();
  try {
    return (await storedRows(db)).map(r => r.id);
  } finally {
    db.close();
  }
}

/** The one row a month archive holds under `id`, as stored. */
async function archivedRow(month: string, id: string): Promise<{ id: string; payload?: Uint8Array } | undefined> {
  const db = await openArchiveDb(month);
  try {
    return (await storedRows(db)).find(r => r.id === id);
  } finally {
    db.close();
  }
}

async function expectCarriedAsStored(month: string, id: string, bytes: number[]): Promise<void> {
  const row = await archivedRow(month, id);
  expect(row, `${id} is in the ${month} archive`).toBeDefined();
  expect(isCompressedEnvelope(row)).toBe(true);
  expect(Array.from(row!.payload!)).toEqual(bytes);
}

/** The Dashboard's Verify: every archived month, then the live chain. */
async function verifyWholeRecord() {
  return verifyChainIntegrityAcrossMonths(await getRecords(), await loadArchivesOldestFirst());
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-08-20T12:00:00.000Z'));
  await deleteDb(ACTIVE_DB);
  for (const m of MONTHS) await deleteDb(archiveDbName(m));
});

afterEach(async () => {
  vi.useRealTimers();
  await deleteDb(ACTIVE_DB);
  for (const m of MONTHS) await deleteDb(archiveDbName(m));
});

describe('one stored row that will not decode', () => {
  it('is really undecodable here, and named as such by the detailed read', async () => {
    await seedAugustChain();
    await damageRow('fr-1');

    const read = await getRecordsDetailed();

    expect(read.records.map(r => r.id)).toEqual(['fr-0', 'fr-2', 'fr-3']);
    expect(read.unreadable).toMatchObject([{ id: 'fr-1', chainPosition: 1 }]);
  });

  it('does not stop the prune: it moves with its neighbours, as the bytes it was stored as', async () => {
    await seedAugustChain();
    const bytes = await damageRow('fr-1');

    const deleted = await pruneRecordsToCap(1);

    expect(deleted).toBe(3);
    const active = await activeIds();
    for (const id of ['fr-0', 'fr-1', 'fr-2']) expect(active).not.toContain(id);
    expect(active).toContain('fr-3');
    await expectCarriedAsStored('2026-08', 'fr-1', bytes);
  });

  it('does not stop the month rotation, and the result counts it', async () => {
    await seedAugustChain();
    const bytes = await damageRow('fr-1');

    const result = await rotateChainAtMonthFlip(new Date('2026-09-01T00:30:00.000Z'), 'auto');

    expect(result.reason).toBeUndefined();
    expect(result).toMatchObject({ rotated: true, archivedMonth: '2026-08', archivedCount: 4, undecodedCarried: 1 });
    const active = await getRecords();
    expect(active).toHaveLength(1);
    expect(active[0].kind).toBe('month-rotation-marker');
    await expectCarriedAsStored('2026-08', 'fr-1', bytes);
  });

  it('carried into a month by the prune, it does not stop that month from rotating', async () => {
    await seedAugustChain();
    const bytes = await damageRow('fr-1');
    expect(await pruneRecordsToCap(1)).toBe(3);

    const result = await rotateChainAtMonthFlip(new Date('2026-09-01T00:30:00.000Z'), 'auto');

    expect(result.reason).toBeUndefined();
    expect(result).toMatchObject({ rotated: true, archivedMonth: '2026-08' });
    await expectCarriedAsStored('2026-08', 'fr-1', bytes);
  });

  it('does not stop the reset, and the result counts it', async () => {
    await seedAugustChain();
    const bytes = await damageRow('fr-1');

    const reset = await resetForensicChain('test');

    expect(reset.archiveFailedReason).toBeUndefined();
    expect(reset).toMatchObject({ resetMarkerWritten: true, recordsArchived: 4, recordsCarriedUndecoded: 1 });
    const active = await getRecords();
    expect(active).toHaveLength(1);
    expect(active[0].kind).toBe('reset-marker');
    // The marker names the newest record, which read.
    expect(active[0].priorChainHash).toBeDefined();
    await expectCarriedAsStored('2026-08', 'fr-1', bytes);
  });

  it('does not stop a restore from replacing the chain', async () => {
    await seedAugustChain();
    const bytes = await damageRow('fr-1');
    const incoming = await buildRecord('fr-restored-0', 0, CHAIN_GENESIS_HASH, '2026-08-19T12:00:00.000Z');

    const restored = await replaceBackupStateUnderChainLock([incoming], [], []);

    expect(restored.recordsAdded).toBe(1);
    expect(await activeIds()).toEqual(['fr-restored-0']);
    await expectCarriedAsStored('2026-08', 'fr-1', bytes);
  });

  it('in the live chain, Verify reports it as damaged and not the chain as broken', async () => {
    await seedAugustChain();
    await damageRow('fr-1');
    const read = await getRecordsDetailed();

    const result = await verifyChainIntegrity(read.records, read.unreadable);

    expect(result.reason).toBeUndefined();
    expect(result.valid).toBe(true);
    expect(result.damagedCount).toBe(1);
    expect(integrityVerificationState(result)).toBe('partial');
  });

  it('a gap the damaged rows do not explain is still a break', async () => {
    await seedAugustChain();
    await damageRow('fr-1');
    const read = await getRecordsDetailed();

    const result = await verifyChainIntegrity(read.records.filter(r => r.id !== 'fr-2'), read.unreadable);

    expect(result.valid).toBe(false);
    expect(result.brokenKind).toBe('position-mismatch');
    expect(result.brokenAtPosition).toBe(2);
  });

  it('after it is retired, Verify reports it as damaged and not the record as broken', async () => {
    await seedAugustChain();
    await damageRow('fr-1');
    expect(await pruneRecordsToCap(1)).toBe(3);
    expect((await rotateChainAtMonthFlip(new Date('2026-09-01T00:30:00.000Z'), 'auto')).rotated).toBe(true);

    const cross = await verifyWholeRecord();

    expect(cross.reason).toBeUndefined();
    expect(cross.valid).toBe(true);
    expect(cross.damagedCount).toBe(1);
    expect(integrityVerificationState(cross)).toBe('partial');
    for (const id of ['fr-0', 'fr-2', 'fr-3']) expect(cross.perRecord?.get(id)).toBe('verified');
    expect(cross.perMonth.find(m => m.monthKey === 'current')!.linkToPreviousOk).toBe(true);
  });
});
