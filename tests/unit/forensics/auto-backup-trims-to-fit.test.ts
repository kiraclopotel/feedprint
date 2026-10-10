// Over the size ceiling used to mean no backup at all.
//
// The service worker has no createObjectURL, so the automatic copy inlines its
// whole payload as a data URL under AUTO_BACKUP_MAX_BYTES. A 10000-record
// active chain seals to roughly 28 MB against a 30 MB ceiling, so this install
// sits one busy day away from the branch that wrote nothing and left the
// parent with no automatic copy for as long as the chain stayed large.
//
// A copy of the newest records beats no copy, provided the file says which it
// is. The older records are also the cheaper end to drop: they are already in
// yesterday's backups and in the month archives.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';

// Seal is the identity here, plus a fixed envelope cost, so "size" is a clean
// function of record count and the halving loop can be reasoned about exactly.
vi.mock('../../../src/forensics/backup-envelope', () => ({
  sealBackupJson: vi.fn(async (plaintext: string) => ({ fwSealedBackup: 1, ciphertext: plaintext })),
  unsealBackupJson: vi.fn(),
  isSealedBackup: vi.fn(() => false),
}));
vi.mock('../../../src/forensics/store', () => ({
  getRecordsOrThrow: vi.fn(async () => []),
  getAllParentFeedback: vi.fn(async () => new Map()),
  replaceBackupStateUnderChainLock: vi.fn(),
  getRecords: vi.fn(async () => []),
  FORENSIC_DB_VERSION: 5,
}));
vi.mock('../../../src/forensics/signing', () => ({
  getPublicKeyJWK: vi.fn(async () => ({ kty: 'EC' })),
  getPublicKeyFingerprint: vi.fn(async () => 'fp0000000000abcd'),
  getSigningKeyCreatedAt: vi.fn(async () => null),
  exportWrappedPrivateKey: vi.fn(),
  clearSigningKeyCache: vi.fn(),
  prepareSigningKeyRestore: vi.fn(),
}));
vi.mock('../../../src/forensics/chain-anchor-store', () => ({ getAnchors: vi.fn(async () => []) }));
vi.mock('../../../src/forensics/archive-reader', () => ({
  loadArchivesOldestFirst: vi.fn(async () => []),
  countArchivedRecords: vi.fn(async () => 0),
}));
vi.mock('../../../src/forensics/salvage-store', () => ({
  readSalvagedRecords: vi.fn(async () => []),
  importSalvagedRecords: vi.fn(),
}));
vi.mock('../../../src/forensics/archive-writer', () => ({ archiveEvictedRecords: vi.fn() }));

import { trimBackupToFit, AUTO_BACKUP_MAX_BYTES, type ForensicBackup } from '../../../src/forensics/backup';

/** Each record carries ~1 KB of padding, so N records ≈ N KB of payload. */
function bulkyRecord(i: number): ForensicRecord {
  return {
    id: `r${i}`,
    timestamp: '2026-08-01T00:00:00.000Z',
    platform: 'twitter',
    originalText: 'x'.repeat(1024),
    originalHash: 'h',
    originalLength: 1024,
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'adult',
    integrityHash: `ih-${i}`,
    chainPosition: i,
  } as unknown as ForensicRecord;
}

function backupOf(n: number): ForensicBackup {
  return {
    schemaVersion: 2,
    exportedAt: '2026-09-01T00:00:00.000Z',
    publicKeyJwk: { kty: 'EC' },
    fingerprint: 'fp0000000000abcd',
    records: Array.from({ length: n }, (_, i) => bulkyRecord(i)),
    anchors: [],
    parentFeedback: [],
    historyCoverage: 'active-chain-only',
  };
}

beforeEach(() => vi.clearAllMocks());

describe('trimBackupToFit', () => {
  it('returns a payload that actually fits the ceiling', async () => {
    const oversized = backupOf(60_000); // ~60 MB against a 30 MB ceiling

    const result = await trimBackupToFit(oversized, 'secret');

    expect(result).not.toBeNull();
    expect(result!.bytes).toBeLessThanOrEqual(AUTO_BACKUP_MAX_BYTES);
  });

  it('keeps the NEWEST records and says how many older ones it dropped', async () => {
    const oversized = backupOf(60_000);

    const result = await trimBackupToFit(oversized, 'secret');

    const kept = result!.backup.records;
    // Newest end retained: the last original record is still present.
    expect(kept[kept.length - 1].id).toBe('r59999');
    expect(result!.backup.trimmedOlderRecords).toBe(60_000 - kept.length);
    expect(kept.length).toBeLessThan(60_000);
  });

  it('labels the result so a trimmed copy cannot pass as a whole one', async () => {
    const result = await trimBackupToFit(backupOf(60_000), 'secret');

    expect(result!.backup.historyCoverage).toBe('recent-records-only');
  });

  it('gives up rather than shipping a token backup when record count is not the problem', async () => {
    // One record, already far over the ceiling: halving cannot help, and a
    // near-empty file reported as a backup is worse than an honest failure.
    const huge = backupOf(1);
    huge.records[0] = {
      ...huge.records[0],
      originalText: 'x'.repeat(AUTO_BACKUP_MAX_BYTES * 2),
    } as ForensicRecord;

    expect(await trimBackupToFit(huge, 'secret')).toBeNull();
  });
});
