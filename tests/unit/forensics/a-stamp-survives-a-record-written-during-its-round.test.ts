// F68, the cause (6 Oct 2026): his console at 00:24 said "Chain anchor skipped: chain_head_changed". The heartbeat alarm
// (every 15 min) and the stamp alarm (every 6 h, first after 15 min) are armed in the same second, so at every stamp tick
// the heartbeat writes a signed record while the authorities are being asked. The store then refused the tokens because
// the stamped record was no longer the head, and threw away a true stamp four times a day on every install armed that way.
// A stamp on a record that is still in the chain is a true stamp, one record old or not. A stamp on a record that left
// the chain (reset, restore, rotation during the round) is still refused. Harness copied from
// a-failed-stamp-keeps-every-authoritys-answer.test.ts; only the round differs.

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
vi.mock('../../../src/forensics/tsa-client', () => ({ requestVerifiedTimestamps: vi.fn() }));

import { openDB } from '../../../src/forensics/store';
import { requestVerifiedTimestamps } from '../../../src/forensics/tsa-client';
import { getAnchors, anchorChainHead } from '../../../src/forensics/chain-anchor-store';
import { CHAIN_GENESIS_HASH } from '../../../src/forensics/chain-integrity';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import type { ForensicRecord } from '../../../src/types/forensic';

const ACTIVE_DB = 'feelingwise-forensics';

// The shape requestVerifiedTimestamps returns after each token was checked against the head hash.
const answered = {
  anchors: [{
    ok: true,
    tsaProvider: 'freetsa',
    route: 'direct',
    response: 'resp-b64',
    tst: 'tst-b64',
    generalizedTime: '2026-10-06T00:24:20.000Z',
    verification: {
      ok: true,
      genTime: '2026-10-06T00:24:20.000Z',
      messageImprintHex: null,
      messageImprintAlgorithm: null,
      serialNumber: null,
      policyOid: null,
      nonceHex: null,
      signerSubject: 'CN=www.freetsa.org',
      signerCertSha256: null,
      rootCertSha256: null,
      knownRootName: 'FreeTSA (freetsa.org) Root CA',
      checks: [{ name: 'message-imprint', ok: true, detail: 'stub' }],
      error: null,
    },
  }],
  reasons: [],
};

async function record(position: number, prevHash: string, text: string): Promise<ForensicRecord> {
  const partial: Omit<ForensicRecord, 'integrityHash' | 'signature'> = {
    id: `fr-${text}-${position}`,
    timestamp: new Date(Date.UTC(2026, 9, 5, 0, position)).toISOString(),
    platform: 'twitter',
    originalText: `${text} ${position}`,
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

async function chain(count: number, text: string): Promise<ForensicRecord[]> {
  const out: ForensicRecord[] = [];
  let prev = CHAIN_GENESIS_HASH;
  for (let i = 0; i < count; i++) {
    const r = await record(i, prev, text);
    prev = r.integrityHash;
    out.push(r);
  }
  return out;
}

async function put(records: ForensicRecord[], clearFirst = false): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['records'], 'readwrite');
    const store = tx.objectStore('records');
    if (clearFirst) store.clear();
    for (const r of records) store.add(r);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('put aborted'));
  });
  db.close();
}

beforeEach(async () => { await deleteDb(ACTIVE_DB); vi.mocked(requestVerifiedTimestamps).mockReset(); });
afterEach(async () => { await deleteDb(ACTIVE_DB); });

describe('a stamp whose record is still in the chain is kept', () => {
  it('a heartbeat record written while the authorities answer does not throw the stamp away', async () => {
    const first = await chain(60, 'feed');
    await put(first);
    vi.mocked(requestVerifiedTimestamps).mockImplementationOnce(async () => {
      // The heartbeat tick of the same second: one more signed record lands on the head.
      await put([await record(60, first[59].integrityHash, 'heartbeat')]);
      return answered as never;
    });

    const result = await anchorChainHead();

    expect(result.status, JSON.stringify(result)).toBe('anchored');
    if (result.status === 'anchored') expect(result.anchoredChainPosition).toBe(59);
    const anchors = await getAnchors();
    expect(anchors).toHaveLength(1);
    expect(anchors[0].anchoredIntegrityHash).toBe(first[59].integrityHash);
  });

  it('a stamp whose record left the chain during the round (a reset) is still refused', async () => {
    await put(await chain(60, 'feed'));
    vi.mocked(requestVerifiedTimestamps).mockImplementationOnce(async () => {
      // A reset during the round: a new chain at the same positions, other records.
      await put(await chain(61, 'after-reset'), true);
      return answered as never;
    });

    const result = await anchorChainHead();

    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') expect(result.reason).toBe('chain_head_changed');
    expect(await getAnchors()).toHaveLength(0);
  });
});
