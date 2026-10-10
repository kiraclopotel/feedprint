// Upkeep now carries a stored row that will not decode into its month archive
// as the bytes it was stored as. Every reader of that month must then lose that
// one row and nothing else: the month's summary, the tabs' walk window, the
// restore's read-back and the backup all used to read the month all or nothing,
// so one carried row cost the whole month. Verify must place the row in the
// chain it belongs to, so it cannot excuse a record missing from another chain
// that shares the month. And the dashboard's passive refresh must hand the
// live-chain walk the rows it could not decode, as the boot read already does.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteDb } from '../../helpers/indexeddb';
import { installChromeStorageStub, type ChromeStorageStub } from '../../helpers/chrome-storage';
import { readSource } from '../../helpers/read-source';

vi.mock('../../../src/forensics/signing', () => ({
  signHash: vi.fn(async () => 'signed'),
  verifyHash: vi.fn(async () => true),
  getPublicKeyFingerprint: vi.fn(async () => 'mock-fingerprint'),
  getPublicKeyJWK: vi.fn(async () => ({ kty: 'EC', crv: 'P-256', x: 'x', y: 'y' })),
  getSigningKeyCreatedAt: vi.fn(async () => null),
  exportWrappedPrivateKey: vi.fn(),
  prepareSigningKeyRestore: vi.fn(),
  commitSigningKeyRestore: vi.fn(),
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
vi.mock('../../../src/forensics/chain-anchor-store', () => ({ getAnchors: vi.fn(async () => []) }));
vi.mock('../../../src/forensics/known-keys', () => ({ rememberPublicKeys: vi.fn(async () => undefined) }));
vi.mock('../../../src/forensics/key-genesis', () => ({
  getKeyGenesis: vi.fn(async () => null),
  restoreKeyGenesis: vi.fn(async () => undefined),
}));
vi.mock('../../../src/forensics/backup-folder-wire', () => ({
  getBackupFolderWireStatus: vi.fn(async () => ({ state: 'none' })),
  writeBackupToWiredFolder: vi.fn(),
  LATEST_BACKUP_FILENAME: 'feelingwise-latest.json',
  RESTORE_KEY_FILENAME: 'feelingwise-restore.key',
  restoreKeyFileContents: vi.fn((s: string) => s),
}));

import { addRecord, getRecords, openDB, pruneRecordsToCap, resetForensicChain } from '../../../src/forensics/store';
import { loadArchivesOldestFirst } from '../../../src/forensics/archive-reader';
import { archiveDbName, openArchiveDb } from '../../../src/forensics/archive-naming';
import { readMonthSummaries } from '../../../src/forensics/archive-summary-store';
import { loadArchiveMonths } from '../../../src/forensics/archive-window';
import { assembleBackup, buildBackupBlob, restoreFromBackup } from '../../../src/forensics/backup';
import { CHAIN_GENESIS_HASH, verifyChainIntegrityAcrossMonths } from '../../../src/forensics/chain-integrity';
import { integrityVerificationState } from '../../../src/forensics/integrity-summary';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import type { ForensicRecord } from '../../../src/types/forensic';

const ACTIVE_DB = 'feelingwise-forensics';
const MONTH = '2026-08';

let storage: ChromeStorageStub;

async function buildRecord(id: string, position: number, prevHash: string, timestamp: string): Promise<ForensicRecord> {
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

function augustDay(day: number): string {
  return new Date(Date.UTC(2026, 7, day, 12)).toISOString();
}

/** Records at positions from..to-1, linked from `prev`, appended to the live chain. */
async function appendChain(prefix: string, from: number, to: number, prev: string): Promise<void> {
  for (let p = from; p < to; p++) {
    const r = await buildRecord(`${prefix}-${p}`, p, prev, augustDay(2 + p));
    await addRecord(r);
    prev = r.integrityHash;
  }
}

/** Cut one live row's gzip payload short, the shape a partial write leaves. */
async function damageRow(id: string): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    let found = false;
    const tx = db.transaction('records', 'readwrite');
    const req = tx.objectStore('records').openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return;
      if (c.value.id === id) {
        found = true;
        c.update({ ...c.value, payload: (c.value.payload as Uint8Array).slice(0, 8) });
      }
      c.continue();
    };
    tx.oncomplete = () => (found ? resolve() : reject(new Error(`no stored row ${id}`)));
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/** Delete one row outright from a month archive, the shape of a record removed after the fact. */
async function deleteArchivedRow(month: string, id: string): Promise<void> {
  const db = await openArchiveDb(month);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite');
    const req = tx.objectStore('records').openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return;
      if (c.value.id === id) c.delete();
      c.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/** fr-0..fr-3 in August, fr-1 damaged, and the prune carries fr-0, fr-1 and fr-2 into the August archive. */
async function monthHoldingACarriedDamagedRow(): Promise<void> {
  await appendChain('fr', 0, 4, CHAIN_GENESIS_HASH);
  await damageRow('fr-1');
  expect(await pruneRecordsToCap(1)).toBe(3);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-08-20T12:00:00.000Z'));
  storage = installChromeStorageStub();
  await deleteDb(ACTIVE_DB);
  await deleteDb(archiveDbName(MONTH));
});

afterEach(async () => {
  vi.useRealTimers();
  await deleteDb(ACTIVE_DB);
  await deleteDb(archiveDbName(MONTH));
  storage.restore();
});

describe('a month archive holding one carried row that will not decode', () => {
  it('still has a summary, so the all-time figures are not marked short', async () => {
    await monthHoldingACarriedDamagedRow();

    const read = await readMonthSummaries();

    expect(read.unreadableMonths).toEqual([]);
    expect(read.complete).toBe(true);
    const august = read.summaries.find(s => s.monthKey === MONTH);
    // The freshness count is the rows the store holds, so the summary is not recomputed on every read.
    expect(august?.recordCount).toBe(3);
  });

  it('still loads into the tabs, less that one row', async () => {
    await monthHoldingACarriedDamagedRow();

    const loaded = await loadArchiveMonths([MONTH]);

    expect(loaded.unreadableMonths).toEqual([]);
    expect(loaded.months.map(m => m.monthKey)).toEqual([MONTH]);
    expect(loaded.months[0].records.map(r => r.id)).toEqual(['fr-0', 'fr-2']);
  });

  it('does not make a restore report the history it put into that month as missing', async () => {
    await monthHoldingACarriedDamagedRow();
    // A fresh live store, so the restore needs no confirmation and no safety copy.
    await deleteDb(ACTIVE_DB);
    const live = await buildRecord('bk-live-0', 0, CHAIN_GENESIS_HASH, augustDay(19));
    const old0 = await buildRecord('bk-old-0', 0, CHAIN_GENESIS_HASH, augustDay(10));
    const old1 = await buildRecord('bk-old-1', 1, old0.integrityHash, augustDay(11));
    const file = JSON.stringify(assembleBackup({
      exportedAt: new Date().toISOString(),
      publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
      fingerprint: 'mock-fingerprint',
      records: [live],
      anchors: [],
      parentFeedback: [],
      archives: { [MONTH]: [old0, old1] },
      historyCoverage: 'full',
    }));

    const result = await restoreFromBackup(file, undefined, true);

    expect(result.ok).toBe(true);
    expect(result.archivedExpected).toBe(2);
    expect(result.archivedRestored).toBe(2);
    expect(result.historyRestored).toBe(true);
  });

  it('is counted in a backup that carries the rest of the month', async () => {
    await monthHoldingACarriedDamagedRow();

    const backup = await buildBackupBlob(undefined, true);

    expect(backup.archives?.[MONTH]?.map(r => r.id)).toEqual(['fr-0', 'fr-2']);
    expect(backup.historyCoverage).toBe('full');
    expect(backup.unreadableArchivedRows).toBe(1);
  });
});

describe('Verify over a month that holds two chains', () => {
  // Chain A (fr-0..fr-3, fr-2 damaged) is retired by a reset; chain B (the
  // reset marker, b-1..b-3) is retired by a second reset into the same month.
  async function twoChainsInOneMonth(): Promise<void> {
    await appendChain('fr', 0, 4, CHAIN_GENESIS_HASH);
    await damageRow('fr-2');
    expect((await resetForensicChain('test')).recordsCarriedUndecoded).toBe(1);
    const [marker] = await getRecords();
    expect(marker.kind).toBe('reset-marker');
    await appendChain('b', 1, 4, marker.integrityHash);
    expect((await resetForensicChain('test')).resetMarkerWritten).toBe(true);
  }

  it('reports the damaged row of one chain as damaged and the month as whole', async () => {
    await twoChainsInOneMonth();

    const cross = await verifyChainIntegrityAcrossMonths(await getRecords(), await loadArchivesOldestFirst());

    expect(cross.reason).toBeUndefined();
    expect(cross.valid).toBe(true);
    expect(cross.damagedCount).toBe(1);
    expect(integrityVerificationState(cross)).toBe('partial');
  });

  it('does not let that row excuse a record missing at the same position in the other chain', async () => {
    await twoChainsInOneMonth();
    await deleteArchivedRow(MONTH, 'b-2');

    const cross = await verifyChainIntegrityAcrossMonths(await getRecords(), await loadArchivesOldestFirst());

    expect(cross.valid).toBe(false);
    expect(cross.brokenKind).toBe('position-mismatch');
    expect(integrityVerificationState(cross)).toBe('failed');
  });
});

describe('the dashboard hands the live-chain walk the rows it could not decode', () => {
  const shell = readSource('src/ui/dashboard/Dashboard.tsx');
  const panel = readSource('src/ui/dashboard/components/OperationalEventsPanel.tsx');

  it('the passive refresh reads with the detailed reader and keeps its unreadable rows', () => {
    expect(shell).toContain('void Promise.all([getRecordsDetailed(), getAllParentFeedback()])');
    expect(shell).not.toContain('void Promise.all([getRecords(), getAllParentFeedback()])');
    const refresh = shell.slice(shell.indexOf('void Promise.all([getRecordsDetailed(), getAllParentFeedback()])'));
    expect(refresh.slice(0, 1500)).toContain('unreadableRowsRef.current = read.unreadable;');
  });

  it('the refresh fallback walk passes them', () => {
    expect(shell).toContain('(ext ? Promise.resolve(ext) : verifyChainIntegrity(rawRecs, unreadableRowsRef.current))');
  });

  it('the Issues panel walks the chain with them too', () => {
    expect(panel).toContain('getRecordsDetailed()');
    expect(panel).toContain('verifyChainIntegrity(read.records, read.unreadable)');
  });
});
