// A backup must cover the record, or say which part of it it covers.
//
// `buildBackupBlob` read the ACTIVE chain and nothing else. That was complete
// while the cap prune destroyed the overflow, because the active chain WAS
// everything the install still held. Archive-on-evict changed that fact and
// not this function: most of the record moved into the month archives, and the
// daily backup went on protecting the newest 10000 records while reporting
// itself saved. The archives would have died with the profile.
//
// The Downloads auto-backup genuinely cannot carry them: it inlines the whole
// payload as a data URL under a size ceiling the active chain alone already
// approaches. So the rule is not "always carry everything" — it is carry
// everything the transport allows, and declare the coverage either way.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';

function rec(id: string, pos: number): ForensicRecord {
  return {
    id,
    timestamp: '2026-08-01T00:00:00.000Z',
    platform: 'twitter',
    originalText: 'x',
    originalHash: 'h',
    originalLength: 1,
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'adult',
    integrityHash: `ih-${id}`,
    chainPosition: pos,
  } as unknown as ForensicRecord;
}

vi.mock('../../../src/forensics/store', () => ({
  getRecordsOrThrow: vi.fn(async () => [rec('active-0', 0), rec('active-1', 1)]),
  getAllParentFeedback: vi.fn(async () => new Map()),
  replaceBackupStateUnderChainLock: vi.fn(),
  getRecords: vi.fn(async () => []),
  FORENSIC_DB_VERSION: 5,
}));
vi.mock('../../../src/forensics/chain-anchor-store', () => ({ getAnchors: vi.fn(async () => []) }));
vi.mock('../../../src/forensics/signing', () => ({
  getPublicKeyJWK: vi.fn(async () => ({ kty: 'EC' })),
  getPublicKeyFingerprint: vi.fn(async () => 'fp0000000000abcd'),
  getSigningKeyCreatedAt: vi.fn(async () => null),
  exportWrappedPrivateKey: vi.fn(),
  clearSigningKeyCache: vi.fn(),
  prepareSigningKeyRestore: vi.fn(),
}));
vi.mock('../../../src/forensics/archive-reader', () => ({
  loadArchivesOldestFirst: vi.fn(async () => [
    { monthKey: '2026-07', records: [rec('jul-0', 0), rec('jul-1', 1)] },
    { monthKey: '2026-08', records: [rec('aug-0', 0)] },
  ]),
  countArchivedRecords: vi.fn(async () => 3),
}));
vi.mock('../../../src/forensics/salvage-store', () => ({
  readSalvagedRecords: vi.fn(async () => [rec('salv-0', 0)]),
  importSalvagedRecords: vi.fn(async () => ({ imported: 0, alreadyPresent: 0, rejectedUnverified: 0, epochs: [] })),
}));
vi.mock('../../../src/forensics/archive-writer', () => ({ archiveEvictedRecords: vi.fn() }));

import { buildBackupBlob } from '../../../src/forensics/backup';

beforeEach(() => vi.clearAllMocks());

describe('buildBackupBlob', () => {
  it('carries the archived months and the salvage store by default', async () => {
    const backup = await buildBackupBlob();

    expect(backup.historyCoverage).toBe('full');
    expect(Object.keys(backup.archives ?? {})).toEqual(['2026-07', '2026-08']);
    expect(backup.archives?.['2026-07'].map(r => r.id)).toEqual(['jul-0', 'jul-1']);
    expect(backup.salvage?.map(r => r.id)).toEqual(['salv-0']);
  });

  it('still carries the active chain, which is what a restore rebuilds', async () => {
    const backup = await buildBackupBlob();

    expect(backup.records.map(r => r.id)).toEqual(['active-0', 'active-1']);
  });

  it('declares the narrower coverage when the transport cannot carry history', async () => {
    const backup = await buildBackupBlob(undefined, false);

    expect(backup.historyCoverage).toBe('active-chain-only');
    expect(backup.archives).toBeUndefined();
    expect(backup.salvage).toBeUndefined();
    // The point of the field: a reader never has to infer coverage from a
    // key that simply is not there.
    expect(backup.records.map(r => r.id)).toEqual(['active-0', 'active-1']);
  });

  it('drops to the narrower claim rather than overstating when archives are unreadable', async () => {
    const { loadArchivesOldestFirst } = await import('../../../src/forensics/archive-reader');
    vi.mocked(loadArchivesOldestFirst).mockRejectedValueOnce(new Error('archive unreadable'));

    const backup = await buildBackupBlob();

    expect(backup.historyCoverage).toBe('active-chain-only');
    expect(backup.archives).toBeUndefined();
  });
});
