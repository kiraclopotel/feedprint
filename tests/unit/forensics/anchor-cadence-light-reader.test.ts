// The head is stamped when the hours pass, not only when the volume does.
//
// The site and the letters say the record is "anchored with independent RFC
// 3161 timestamp services every few hours". The only rule for stamping the
// head again was a rule about volume: 50 new chain positions. A household that
// reads a little never adds 50 between two six-hour alarm ticks, so its head
// could sit unstamped for days while the sentence stood. The rule about time
// now sits beside it (MAX_HOURS_BETWEEN_ANCHORS).
//
// This drives the real IDB path under fake-indexeddb with the timestamp
// authorities stubbed, so the question it answers is the product's: given this
// chain and this last anchor, does a tick ask for a token or not.

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

// anchorChainHead reaches public time-stamp authorities over the network. Stub
// a deterministic verified round so "did anchoring resume?" is observable
// offline. The shape matches what requestVerifiedTimestamps returns after the
// token has already been checked against the head hash (src/forensics/rfc3161.ts):
// an unverified token never reaches this point in production.
const stubVerification = {
  ok: true,
  genTime: '2026-06-15T00:00:00.000Z',
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
};
vi.mock('../../../src/forensics/tsa-client', () => ({
  requestVerifiedTimestamps: vi.fn(async () => ({
    anchors: [{
      ok: true,
      tsaProvider: 'freetsa',
      route: 'direct',
      response: 'resp-b64',
      tst: 'tst-b64',
      generalizedTime: '2026-06-15T00:00:00.000Z',
      verification: stubVerification,
    }],
    reasons: [],
  })),
}));

import { openDB } from '../../../src/forensics/store';
import { getAnchors, anchorChainHead, type ChainAnchor } from '../../../src/forensics/chain-anchor-store';
import { CHAIN_GENESIS_HASH } from '../../../src/forensics/chain-integrity';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import type { ForensicRecord } from '../../../src/types/forensic';

const ACTIVE_DB = 'feelingwise-forensics';

async function record(position: number, prevHash: string, kind: ForensicRecord['kind'] = 'post'): Promise<ForensicRecord> {
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
    kind,
    publicKeyFingerprint: 'mock-fingerprint',
  };
  const integrityHash = await computeRecordIntegrityHash(partial);
  return { ...partial, integrityHash };
}

/** A light reader's day: `count` records, and one anchor taken `hoursAgo` at `anchoredAt`. */
async function seed(count: number, anchoredAt: number | null, hoursAgo: number, kindAt: (i: number) => ForensicRecord['kind'] = () => 'post'): Promise<void> {
  const records: ForensicRecord[] = [];
  let prev = CHAIN_GENESIS_HASH;
  for (let i = 0; i < count; i++) {
    const r = await record(i, prev, kindAt(i));
    prev = r.integrityHash;
    records.push(r);
  }
  const anchor: ChainAnchor | null = anchoredAt === null ? null : {
    id: 'anchor-seed',
    anchoredChainPosition: anchoredAt,
    anchoredIntegrityHash: records[anchoredAt].integrityHash,
    tsaProvider: 'freetsa',
    responseB64: 'resp',
    tstB64: 'tst',
    generalizedTime: new Date(Date.now() - hoursAgo * 3600_000).toISOString(),
    requestedAt: new Date(Date.now() - hoursAgo * 3600_000).toISOString(),
  };

  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['records', 'chainAnchors'], 'readwrite');
    const store = tx.objectStore('records');
    for (const r of records) store.add(r);
    if (anchor) tx.objectStore('chainAnchors').add(anchor);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('seed aborted'));
  });
  db.close();
}

beforeEach(async () => { await deleteDb(ACTIVE_DB); });
afterEach(async () => { await deleteDb(ACTIVE_DB); });

describe('a light reader gets a time stamp too', () => {
  it('stamps a head twelve positions on from a day-old anchor', async () => {
    // Twelve new records is nowhere near the volume gap of fifty. Before the
    // rule about time, this chain was never stamped again.
    await seed(13, 0, 24);

    const result = await anchorChainHead();

    expect(result.status).toBe('anchored');
    if (result.status === 'anchored') expect(result.anchoredChainPosition).toBe(12);
    expect(await getAnchors()).toHaveLength(2);
  });

  it('leaves a head alone when the last anchor is an hour old', async () => {
    await seed(13, 0, 1);

    const result = await anchorChainHead();

    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') expect(result.reason).toBe('recent_anchor_covers_head');
    expect(await getAnchors()).toHaveLength(1);
  });

  it('leaves an idle install alone however old its anchor is', async () => {
    // Nothing has been read since the anchor was taken, so a second token over
    // the same head would say nothing the reader does not already hold.
    await seed(5, 4, 72);

    const result = await anchorChainHead();

    expect(result.status).toBe('skipped');
    expect(await getAnchors()).toHaveLength(1);
  });

  it('does not stamp on volume alone inside the hours, so a heavy reader keeps the same floor', async () => {
    // Sixty new records an hour after the last stamp. The old rule stamped at fifty positions whatever the hour,
    // which made "never sooner than five and a half hours" untrue for a heavy reader.
    await seed(60, 0, 1);

    const result = await anchorChainHead();

    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') expect(result.reason).toBe('recent_anchor_covers_head');
    expect(await getAnchors()).toHaveLength(1);
  });
});

describe('only what the feed showed counts as growth', () => {
  it('sends nothing for a browser left open on no site for seven hours, its heartbeat markers notwithstanding', async () => {
    // Position 0 was stamped seven hours ago; every record since is the heartbeat's own marker.
    await seed(29, 0, 7, (i) => (i === 0 ? 'post' : 'heartbeat-marker'));

    const result = await anchorChainHead();

    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') expect(result.reason).toBe('no_feed_entry_since_last_anchor');
    expect(await getAnchors()).toHaveLength(1);
  });

  it('sends no first stamp for an install whose record holds only markers', async () => {
    await seed(8, null, 0, () => 'heartbeat-marker');

    const result = await anchorChainHead();

    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') expect(result.reason).toBe('no_feed_entry_since_last_anchor');
    expect(await getAnchors()).toHaveLength(0);
  });

  it('stamps once one post was recorded among the markers and the hours have passed', async () => {
    await seed(29, 0, 7, (i) => (i === 14 || i === 0 ? 'post' : 'heartbeat-marker'));

    const result = await anchorChainHead();

    expect(result.status).toBe('anchored');
    if (result.status === 'anchored') expect(result.anchoredChainPosition).toBe(28);
  });
});
