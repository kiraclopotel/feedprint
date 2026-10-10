// FeelingWise — month-rotation must dispose of the RFC 3161 anchor sidecar at
// cutover (FOR-1, audit docs/audits/swarm-2026-07-13/11-forensics-chain.md).
//
// The rotation cutover transaction historically opened only [records, meta] and
// never touched the `chainAnchors` sidecar, unlike reset (clearChainAnchors,
// store.ts:856-864,1104) and restore (anchorStore.clear(), store.ts:467). The
// stale prior-month max-position anchor then:
//   (a) starves the fresh chain via anchorChainHead's `head - latest < 50` gap
//       gate (chain-anchor-store.ts:196-206), so anchoring never resumes;
//   (b) lingers as an orphan referencing archived-and-removed records;
//   (c) is embedded verbatim by post-rotation exports (getAnchors()), covering
//       records absent from the exported active set.
//
// These tests drive the real IDB rotation path under fake-indexeddb (now a repo
// dependency; the pure-logic-only note in chain-rotation.test.ts predates it).
//
// Added 2026-09-04: clearing the sidecar was right, destroying the evidence in
// it was not. Rotation now copies the outgoing month's anchors into that
// month's archive before clearing the active sidecar, so a retired month keeps
// the one thing in it that neither FeelingWise nor the person holding the
// computer produced. Before this, every independent timestamp had a maximum
// life of one calendar month, and disputes are not litigated inside the month
// they happen.

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

import { openDB, getRecords } from '../../../src/forensics/store';
import { rotateChainAtMonthFlip } from '../../../src/forensics/chain-rotation';
import { getAnchors, anchorChainHead, type ChainAnchor } from '../../../src/forensics/chain-anchor-store';
import { readArchiveAnchors } from '../../../src/forensics/archive-reader';
import { CHAIN_GENESIS_HASH } from '../../../src/forensics/chain-integrity';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import type { ForensicRecord } from '../../../src/types/forensic';

const ACTIVE_DB = 'feelingwise-forensics';
const ARCHIVE_DB = 'feelingwise-forensics-2026-05';

/** A valid, chain-linked prior-month (May 2026) record. */
async function mayRecord(position: number, prevHash: string): Promise<ForensicRecord> {
  const partial: Omit<ForensicRecord, 'integrityHash' | 'signature'> = {
    id: `fr-may-${position}`,
    timestamp: new Date(Date.UTC(2026, 4, 2 + position)).toISOString(),
    platform: 'twitter',
    originalText: `may record ${position}`,
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
  return { ...partial, integrityHash };
}

/**
 * Seed the active DB with a valid 4-record May chain (positions 0..3) plus a
 * stale anchor at the terminal position 3. Returns the terminal record so tests
 * can reason about the archived-epoch hash.
 */
async function seedPriorMonthChainWithAnchor(): Promise<ForensicRecord> {
  const r0 = await mayRecord(0, CHAIN_GENESIS_HASH);
  const r1 = await mayRecord(1, r0.integrityHash);
  const r2 = await mayRecord(2, r1.integrityHash);
  const r3 = await mayRecord(3, r2.integrityHash);

  const staleAnchor: ChainAnchor = {
    id: 'anchor-stale-may',
    anchoredChainPosition: 3,
    anchoredIntegrityHash: r3.integrityHash,
    tsaProvider: 'freetsa',
    responseB64: 'resp',
    tstB64: 'tst',
    generalizedTime: '2026-05-31T00:00:00.000Z',
    requestedAt: '2026-05-31T00:00:00.000Z',
  };

  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['records', 'chainAnchors'], 'readwrite');
    const records = tx.objectStore('records');
    for (const r of [r0, r1, r2, r3]) records.add(r);
    tx.objectStore('chainAnchors').add(staleAnchor);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('seed aborted'));
  });
  db.close();
  return r3;
}

beforeEach(async () => {
  await deleteDb(ACTIVE_DB);
  await deleteDb(ARCHIVE_DB);
});
afterEach(async () => {
  await deleteDb(ACTIVE_DB);
  await deleteDb(ARCHIVE_DB);
});

describe('month-rotation anchor-sidecar cutover (FOR-1)', () => {
  it('(a) resumes anchoring on the fresh chain instead of being starved by the pre-rotation max-position anchor', async () => {
    await seedPriorMonthChainWithAnchor();

    const result = await rotateChainAtMonthFlip(new Date(Date.UTC(2026, 5, 15)), 'force');
    expect(result.rotated).toBe(true);
    expect(result.archivedMonth).toBe('2026-05');

    // The fresh chain starts with the rotation marker at position 0. A marker alone is not stamped, so the
    // first June post follows it; with the stale pos-3 anchor still present, its position 1 would never pass
    // the May anchor and the head would wait forever.
    const [marker] = (await getRecords()).filter((r) => r.chainPosition === 0);
    const june = await mayRecord(1, marker.integrityHash);
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite');
      tx.objectStore('records').add(june);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();

    const anchored = await anchorChainHead();
    expect(anchored.status).toBe('anchored');
    if (anchored.status === 'anchored') {
      expect(anchored.anchoredChainPosition).toBe(1);
    }
  });

  it('(b) disposes of the outgoing epoch\'s anchors at cutover (mirrors reset\'s clearChainAnchors) — no orphans linger in the active sidecar', async () => {
    const terminal = await seedPriorMonthChainWithAnchor();

    await rotateChainAtMonthFlip(new Date(Date.UTC(2026, 5, 15)), 'force');

    const anchors = await getAnchors();
    // The stale anchor bound the now-archived terminal; it must not survive in
    // the active sidecar pointing at a record no longer present there.
    expect(anchors.some(a => a.id === 'anchor-stale-may')).toBe(false);
    expect(anchors.some(a => a.anchoredIntegrityHash === terminal.integrityHash)).toBe(false);
    expect(anchors).toHaveLength(0);
  });

  it('(d) the retired month keeps its independent timestamps in its own archive', async () => {
    const terminal = await seedPriorMonthChainWithAnchor();

    await rotateChainAtMonthFlip(new Date(Date.UTC(2026, 5, 15)), 'force');

    const archived = await readArchiveAnchors('2026-05');
    expect(archived).toHaveLength(1);
    expect(archived[0].id).toBe('anchor-stale-may');
    // The anchor is still true about a record that is still there, in the
    // archive it was moved to.
    expect(archived[0].anchoredIntegrityHash).toBe(terminal.integrityHash);
    expect(archived[0].generalizedTime).toBe('2026-05-31T00:00:00.000Z');
  });

  it('(e) a rotation that runs twice does not duplicate the archived anchor', async () => {
    await seedPriorMonthChainWithAnchor();
    await rotateChainAtMonthFlip(new Date(Date.UTC(2026, 5, 15)), 'force');
    // A second forced pass on an already-archived month: the anchors store is
    // keyed by anchor id, so the copy overwrites rather than accumulating.
    await rotateChainAtMonthFlip(new Date(Date.UTC(2026, 5, 16)), 'force');

    const archived = await readArchiveAnchors('2026-05');
    const ids = archived.map(a => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('(f) a month archived before the anchors store existed reads as no anchors, not as an error', async () => {
    // Months retired under archive schema v1 have no anchors store at all.
    const archived = await readArchiveAnchors('2019-01');
    expect(archived).toEqual([]);
  });

  it('(c) leaves no export-embeddable anchor referencing a record absent from the active set', async () => {
    await seedPriorMonthChainWithAnchor();
    await rotateChainAtMonthFlip(new Date(Date.UTC(2026, 5, 15)), 'force');

    // Re-anchor the fresh chain, then assert the export source (getAnchors) is
    // clean: every anchor maps to a present record's position + integrityHash.
    await anchorChainHead();

    const [records, anchors] = await Promise.all([getRecords(), getAnchors()]);
    for (const anchor of anchors) {
      const covered = records.some(
        r => r.chainPosition === anchor.anchoredChainPosition
          && r.integrityHash === anchor.anchoredIntegrityHash,
      );
      expect(covered).toBe(true);
    }
  });
});

// ROTATION LATCHED OFF FOR GOOD once the position-0 rotation marker left.
//
// The epoch's month came from the marker when one existed and otherwise from
// the NEWEST record. The cap prune deletes oldest-first, so on any install that
// reaches the cap the marker is the first thing to go — and the test then
// becomes "is the newest record from this month?", which on a live install is
// always yes. Rotation never fires again and nothing says so; the active chain
// just grows across every month boundary from then on.
//
// The OLDEST active record answers the question rotation actually asks: does
// the active chain still hold records from a month that is over?
describe('rotation without a marker to read the epoch from', () => {
  it('still fires in auto mode when the oldest active record is from a past month', async () => {
    // A May chain with NO rotation marker at position 0, plus a June record —
    // the shape an install has after the prune evicted its marker and it kept
    // recording into a new month.
    const r0 = await mayRecord(0, CHAIN_GENESIS_HASH);
    const r1 = await mayRecord(1, r0.integrityHash);
    const june: ForensicRecord = {
      ...r1,
      id: 'fr-jun-2',
      chainPosition: 2,
      prevRecordHash: r1.integrityHash,
      timestamp: new Date(Date.UTC(2026, 5, 14)).toISOString(),
    };
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite');
      for (const r of [r0, r1, june]) tx.objectStore('records').add(r);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();

    // Auto mode, mid-June. The newest record is June, so the old rule said
    // "nothing to do"; the oldest is May, so there is.
    const result = await rotateChainAtMonthFlip(new Date(Date.UTC(2026, 5, 15)), 'auto');
    expect(result.reason).not.toBe('no-rotation-needed');
  });
});
