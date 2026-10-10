// A failed chain read is not an empty chain. Every path that mutates the
// store or signs something about its contents must refuse when the read
// rejects, instead of treating [] as "nothing there" (audit EVIDENCE-PATH-1:
// one damaged gzip envelope plus a restore of an old backup replaced the
// whole chain and reported ok; "Back up now" wrote a zero-record file).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => ({
  getRecords: vi.fn(async () => [] as unknown[]),
  getRecordsOrThrow: vi.fn(async () => [] as unknown[]),
  replaceBackupStateUnderChainLock: vi.fn(async () => ({ recordsAdded: 0, recordsSkipped: 0, anchorsAdded: 0, feedbackRestored: 0 })),
  getAllParentFeedback: vi.fn(async () => new Map()),
  rewriteRecordsInPlace: vi.fn(async () => undefined),
}));

vi.mock('../../../src/forensics/store', () => store);
vi.mock('../../../src/forensics/signing', () => ({
  getPublicKeyJWK: vi.fn(async () => ({ kty: 'EC' })),
  getPublicKeyFingerprint: vi.fn(async () => 'fp'),
  exportWrappedPrivateKey: vi.fn(),
  getSigningKeyCreatedAt: vi.fn(async () => undefined),
  prepareSigningKeyRestore: vi.fn(),
  commitSigningKeyRestore: vi.fn(),
  signHash: vi.fn(async () => 'sig'),
  verifyHash: vi.fn(async () => true),
}));
vi.mock('../../../src/forensics/delivery-outbox', () => ({
  getForensicDeliveryStatus: vi.fn(async () => ({ pendingCount: 0 })),
}));
vi.mock('../../../src/forensics/tsa-client', () => ({
  fetchTimeStampToken: vi.fn(async () => ({ ok: false, reason: 'offline' })),
}));
vi.mock('../../../src/forensics/backup-folder-wire', () => ({
  getBackupFolderWireStatus: vi.fn(async () => ({ state: 'none' })),
  writeBackupToWiredFolder: vi.fn(),
  LATEST_BACKUP_FILENAME: 'feelingwise-latest.json',
  RESTORE_KEY_FILENAME: 'feelingwise-restore.key',
  restoreKeyFileContents: vi.fn((s: string) => s),
}));

import { restoreFromBackup, buildBackupBlob, BACKUP_SCHEMA_VERSION } from '../../../src/forensics/backup';
import { anchorChainHead } from '../../../src/forensics/chain-anchor-store';
import { repairRelegatedPositions } from '../../../src/forensics/auto-heal';
import { CHAIN_GENESIS_HASH } from '../../../src/forensics/chain-integrity';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';

const READ_ERROR = new Error('gzip envelope damaged');

async function validRecord() {
  const partial = {
    id: 'fr-in-0',
    timestamp: '2026-08-01T00:00:00.000Z',
    platform: 'twitter',
    originalText: 'incoming 0',
    originalHash: 'a'.repeat(64),
    originalLength: 10,
    neutralizedText: '',
    author: 'tester',
    postUrl: 'https://x.com/t/1',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'unknown',
    prevRecordHash: CHAIN_GENESIS_HASH,
    chainPosition: 0,
    chainAnchor: 'genesis-v1',
    verdict: 'pass',
    kind: 'post',
    publicKeyFingerprint: 'fp',
  } as const;
  const integrityHash = await computeRecordIntegrityHash(partial as never);
  return { ...partial, integrityHash, signature: 'sig' };
}

beforeEach(() => {
  vi.clearAllMocks();
  store.getRecordsOrThrow.mockRejectedValue(READ_ERROR);
  store.getRecords.mockResolvedValue([]);
  (globalThis as { chrome?: unknown }).chrome = {
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) } },
    runtime: { id: 'test' },
  };
});

describe('restoreFromBackup', () => {
  it('refuses with store-read-failed and never touches the store when the chain read rejects', async () => {
    const backup = JSON.stringify({ schemaVersion: BACKUP_SCHEMA_VERSION, records: [], anchors: [], parentFeedback: [] });
    const result = await restoreFromBackup(backup, undefined, true);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('store-read-failed');
    expect(result.detail?.cause).toContain('gzip envelope damaged');
    expect(store.replaceBackupStateUnderChainLock).not.toHaveBeenCalled();
  });
});

describe('restoreFromBackup safety copy', () => {
  it('treats an interrupted safety download as not saved and leaves the store untouched', async () => {
    const existing = [{ id: 'r0', chainPosition: 0, integrityHash: 'h0', originalText: 'x', kind: 'post', verdict: 'flagged' }];
    store.getRecordsOrThrow.mockResolvedValue(existing);
    const downloads = {
      download: vi.fn(async () => 7),
      search: vi.fn(async () => [{ id: 7, state: 'interrupted' }]),
    };
    (globalThis as { chrome: Record<string, unknown> }).chrome.downloads = downloads;

    const incoming = JSON.stringify({
      schemaVersion: BACKUP_SCHEMA_VERSION,
      records: [],
      anchors: [],
      parentFeedback: [],
    });
    // A records-only backup against a real chain: stage 3 runs only when the
    // incoming set has records, so give it one structurally valid record.
    const withRecord = JSON.parse(incoming);
    withRecord.records = [await validRecord()];
    const result = await restoreFromBackup(JSON.stringify(withRecord), undefined, true);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('safety-backup-failed');
    expect(result.detail?.cause).toContain('interrupted');
    expect(downloads.download).toHaveBeenCalledTimes(1);
    expect(store.replaceBackupStateUnderChainLock).not.toHaveBeenCalled();
  });
});

describe('buildBackupBlob', () => {
  it('rejects instead of producing a zero-record backup when the chain read rejects', async () => {
    await expect(buildBackupBlob()).rejects.toThrow('gzip envelope damaged');
  });
});

describe('anchorChainHead', () => {
  it('rejects instead of answering no_chained_records when the chain read rejects', async () => {
    await expect(anchorChainHead()).rejects.toThrow('gzip envelope damaged');
  });
});

describe('repairRelegatedPositions', () => {
  it('does not stamp the repair as done when the chain read rejects', async () => {
    const result = await repairRelegatedPositions();
    expect(result.attempted).toBe(true);
    expect('error' in result && result.error).toContain('gzip envelope damaged');
    const set = (globalThis as unknown as { chrome: { storage: { local: { set: ReturnType<typeof vi.fn> } } } }).chrome.storage.local.set;
    const stamped = set.mock.calls.some((call) =>
      Object.keys((call as unknown[])[0] as Record<string, unknown>).includes('fw_relegation_repair_done_at'),
    );
    expect(stamped).toBe(false);
  });
});
