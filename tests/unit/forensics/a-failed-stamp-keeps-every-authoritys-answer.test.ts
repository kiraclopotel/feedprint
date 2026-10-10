// F68 (6 Oct 2026): when no authority answers, the stamp result named only the first authority's
// reason, so a record whose stamps had stopped could never say why. His export: 12,000 entries and
// eight days with no stamp, all three authorities answering this machine. The skipped result now
// carries every authority's answer and the head it tried to stamp, so the maintenance record and the
// console can show them. Harness copied from anchor-cadence-light-reader.test.ts; only the round differs.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteDb } from '../../helpers/indexeddb';

// store.ts's external imports — mirror forensic-delivery-outbox.test.ts so the
// module graph loads without chrome / real signing side effects.
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

// chain-rotation reads pending-delivery status before it acts. Force it to a
// clean zero so the cutover always proceeds under test.
vi.mock('../../../src/forensics/delivery-outbox', () => ({
  getForensicDeliveryStatus: vi.fn(async () => ({ pendingCount: 0 })),
}));

vi.mock('../../../src/forensics/tsa-client', () => ({
  requestVerifiedTimestamps: vi.fn(async () => ({
    anchors: [],
    reasons: ['freetsa_network_error', 'digicert_http_503', 'sectigo_no_host_permission'],
  })),
}));

import { openDB } from '../../../src/forensics/store';
import { getAnchors, anchorChainHead } from '../../../src/forensics/chain-anchor-store';
import { CHAIN_GENESIS_HASH } from '../../../src/forensics/chain-integrity';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import type { ForensicRecord } from '../../../src/types/forensic';

const ACTIVE_DB = 'feelingwise-forensics';

async function record(position: number, prevHash: string): Promise<ForensicRecord> {
  const partial: Omit<ForensicRecord, 'integrityHash' | 'signature'> = {
    id: `fr-${position}`,
    timestamp: new Date(Date.UTC(2026, 8, 17, position)).toISOString(),
    platform: 'twitter',
    originalText: `record ${position}`,
    originalHash: 'a'.repeat(64),
    originalLength: 12,
    neutralizedText: '',
    author: 'tester',
    postUrl: 'https://x.com/t/1',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'adult',
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
  return { ...partial, integrityHash };
}

async function seed(count: number): Promise<void> {
  const records: ForensicRecord[] = [];
  let prev = CHAIN_GENESIS_HASH;
  for (let i = 0; i < count; i++) {
    const r = await record(i, prev);
    prev = r.integrityHash;
    records.push(r);
  }
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['records'], 'readwrite');
    const store = tx.objectStore('records');
    for (const r of records) store.add(r);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('seed aborted'));
  });
  db.close();
}

beforeEach(async () => { await deleteDb(ACTIVE_DB); });
afterEach(async () => { await deleteDb(ACTIVE_DB); });

describe('a stamp that no authority answered says what each one said', () => {
  it('carries every reason and the head it tried, and stores no anchor', async () => {
    await seed(60);

    const result = await anchorChainHead();

    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') {
      expect(result.reason, 'the first reason stays the headline, as before').toBe('tsa_freetsa_network_error');
      expect(result.reasons).toEqual(['freetsa_network_error', 'digicert_http_503', 'sectigo_no_host_permission']);
      expect(result.headPosition).toBe(59);
    }
    expect(await getAnchors()).toHaveLength(0);
  });
});
