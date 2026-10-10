// SKELETON 3a — Chain A integrity verification tests.
// Acceptance F1: 50-record fixture verifies clean. Delete record N → broken at N.
// Modify record N's text → broken at N+1 (next record's prevRecordHash mismatch).
//
// Phase 1.6.1: brokenKind discrimination (tampered vs key-mismatch vs
// position-mismatch vs chain-link-mismatch). A matching-current-key signature
// failure stays broken; an unavailable legacy fingerprint stays unverified.
// Phase 1.6.E2: preRekeyCount bucketing for records retired from the active
// chain by a previous re-anchor action.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The signing module is spied on, not replaced (known-issues M120): by default
// every call reaches the real Web Crypto implementation, and only the tests
// that need a deterministic failure override one call. The fingerprint is
// pinned to 'mock-fp' so the key-mismatch fixtures can name the current key
// without a keypair; the real-crypto test at the end of this file restores
// the real fingerprint for its run.
const actualSigning = await vi.importActual<typeof import('../../../src/forensics/signing')>('../../../src/forensics/signing');
vi.mock('../../../src/forensics/signing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/forensics/signing')>();
  return {
    ...actual,
    verifyHash: vi.fn(actual.verifyHash),
    signHash: vi.fn(actual.signHash),
    getPublicKeyFingerprint: vi.fn(async () => 'mock-fp'),
  };
});

import type { ForensicRecord } from '../../../src/types/forensic';
import {
  verifyChainIntegrity,
  CHAIN_GENESIS_HASH,
} from '../../../src/forensics/chain-integrity';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import { verifyHash, getPublicKeyFingerprint } from '../../../src/forensics/signing';

const mockedVerifyHash = vi.mocked(verifyHash);

beforeEach(() => {
  // A test that forced a verdict must not leak it: back to real ECDSA.
  mockedVerifyHash.mockReset();
  mockedVerifyHash.mockImplementation(actualSigning.verifyHash);
});

// ─── Fixture builder ─────────────────────────────────────────────────────────
// Builds a chain of N synthetic records with correct prevRecordHash links and
// recomputed integrityHash. No signing — verifyChainIntegrity skips the
// signature check when `signature` is absent (best-effort path).

function basePayload(i: number): Omit<ForensicRecord, 'integrityHash' | 'signature' | 'publicKeyFingerprint' | 'chainAnchor'> {
  return {
    id: `fr-test-${i}`,
    timestamp: `2026-04-25T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
    platform: 'twitter',
    originalText: `original ${i}`,
    originalHash: `hash-${i}`,
    originalLength: `original ${i}`.length,
    neutralizedText: `neutralized ${i}`,
    author: `@author${i}`,
    postUrl: `https://x.com/p/${i}`,
    techniques: [{ name: 'fear-appeal', severity: 7, confidence: 0.9 }],
    overallScore: 7,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'unknown',
    aiModel: 'llama-3.1-8b-instant',
    aiProvider: 'groq',
    detectionMode: 'combined-detect-neutralize',
    configSnapshot: { mode: 'teen', threshold: 0.4, dailyCap: 5000 },
    prevRecordHash: '',
    chainPosition: 0,
  };
}

async function buildChain(n: number): Promise<ForensicRecord[]> {
  const records: ForensicRecord[] = [];
  let prevHash = CHAIN_GENESIS_HASH;
  for (let i = 0; i < n; i++) {
    const payload = basePayload(i);
    payload.prevRecordHash = prevHash;
    payload.chainPosition = i;
    const integrityHash = await computeRecordIntegrityHash(payload);
    const record: ForensicRecord = {
      ...payload,
      integrityHash,
      chainAnchor: i === 0 ? 'genesis-v1' : undefined,
    };
    records.push(record);
    prevHash = integrityHash;
  }
  return records;
}

// ─── F1 acceptance ──────────────────────────────────────────────────────────

describe('chain-integrity — F1 acceptance (SKELETON 3a)', () => {
  it('a clean 50-record chain verifies', async () => {
    const records = await buildChain(50);
    const result = await verifyChainIntegrity(records);
    expect(result.valid).toBe(true);
    expect(result.chainLength).toBe(50);
    expect(result.preChainCount).toBe(0);
    expect(result.brokenAt).toBeUndefined();
  });

  it('unsigned-but-hash-valid records are marked "unsigned", not "verified" (regression F-2)', async () => {
    // Best-effort signing means a record can be stored unsigned (SW evicted
    // mid-write, key cache cleared). The chain is still structurally valid
    // (stored hashes + links internally consistent), but an unsigned record
    // must NOT be labelled "verified" — the
    // exported HTML verifier treats a missing signature as a distinct
    // "unsigned" state, and the dashboard must agree (it previously said
    // "verified", contradicting the export which said "tampered").
    const records = await buildChain(3); // buildChain produces UNSIGNED records
    const result = await verifyChainIntegrity(records);
    expect(result.valid).toBe(true); // unsigned chain is still valid
    for (const r of records) {
      expect(result.perRecord?.get(r.id)).toBe('unsigned');
    }
  });

  it('signed records that verify are marked "verified"', async () => {
    mockedVerifyHash.mockResolvedValue(true);
    const records = await buildChain(2);
    // Stamp signatures so the signature branch runs.
    for (const r of records) r.signature = 'mock-sig';
    const result = await verifyChainIntegrity(records);
    expect(result.valid).toBe(true);
    for (const r of records) {
      expect(result.perRecord?.get(r.id)).toBe('verified');
    }
  });

  it('deleting record N (middle) reports brokenAt at N (position mismatch on what was N+1)', async () => {
    const records = await buildChain(50);
    // Splice out record 23. Records 24+ now have chainPosition 24+ but sit
    // at array indices 23+, so the position check fails first.
    records.splice(23, 1);
    const result = await verifyChainIntegrity(records);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(23);
    expect(result.reason).toMatch(/Position mismatch/);
  });

  it('deleting record N AND renumbering reports brokenAt via chain link mismatch', async () => {
    // Simulate a more sophisticated tamper: delete record 23 AND renumber
    // records 24+ down so chainPosition stays sequential. The chain link
    // check catches this: record 23 (originally 24) has prevRecordHash
    // referencing the deleted record 22's hash chain — wait, originally
    // record 24's prevRecordHash was record 23's integrityHash. After
    // renumbering, record 23 (was 24) still has that same prevRecordHash
    // but the actual previous record (was 22) has a different integrityHash.
    const records = await buildChain(50);
    records.splice(23, 1);
    // Renumber positions to fill the gap (an attacker trying to cover tracks).
    for (let i = 23; i < records.length; i++) {
      records[i].chainPosition = i;
    }
    const result = await verifyChainIntegrity(records);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(23);
    // After renumbering, position check passes; chain-link check fails.
    expect(result.reason).toMatch(/Chain link broken/);
  });

  it("modifying record N's text reports brokenAt at N (integrity hash mismatch)", async () => {
    const records = await buildChain(50);
    // Tamper: change originalText. The stored integrityHash no longer
    // matches the recomputed one.
    records[15].originalText = 'TAMPERED';
    const result = await verifyChainIntegrity(records);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(15);
    expect(result.reason).toMatch(/Integrity hash mismatch/);
  });

  it('an empty chain is vacuously valid', async () => {
    const result = await verifyChainIntegrity([]);
    expect(result.valid).toBe(true);
    expect(result.chainLength).toBe(0);
    expect(result.preChainCount).toBe(0);
  });

  it('pre-chain (legacy) records are counted but skipped in the walk', async () => {
    const chainRecords = await buildChain(10);
    const legacy: ForensicRecord = {
      id: 'fr-legacy-1',
      timestamp: '2026-04-19T12:00:00.000Z',
      platform: 'twitter',
      originalText: 'legacy',
      originalHash: 'h',
      originalLength: 6,
      neutralizedText: 'n',
      author: '@l',
      postUrl: 'u',
      techniques: [],
      overallScore: 5,
      userAgeCategory: 'teen',
      aiSource: 'cloud',
      feedSource: 'unknown',
      integrityHash: 'legacy-hash',
      chainPosition: -1,
      chainAnchor: 'pre-chain',
    };
    const result = await verifyChainIntegrity([legacy, ...chainRecords]);
    expect(result.valid).toBe(true);
    expect(result.chainLength).toBe(10);
    expect(result.preChainCount).toBe(1);
  });

  it('records arrive out of insertion order but verify after sort by chainPosition', async () => {
    const records = await buildChain(20);
    // Shuffle (deterministic for the test).
    const shuffled = [
      records[5], records[19], records[0], records[12], records[3],
      records[1], records[7], records[14], records[9], records[2],
      records[18], records[6], records[10], records[4], records[8],
      records[16], records[11], records[15], records[13], records[17],
    ];
    const result = await verifyChainIntegrity(shuffled);
    expect(result.valid).toBe(true);
    expect(result.chainLength).toBe(20);
  });

  it('reordering with mismatched positions fails (anti-replay)', async () => {
    const records = await buildChain(10);
    // Swap records[3] and records[7] WITHOUT updating their chainPositions.
    // After the verifier sorts by chainPosition the original order returns
    // and verification passes — that's actually correct: if positions are
    // intact, the chain is intact regardless of array order. To force
    // failure we tamper with positions.
    records[3].chainPosition = 7;
    records[7].chainPosition = 3;
    const result = await verifyChainIntegrity(records);
    // After sort, the records at positions 3 and 7 carry payloads originally
    // computed for positions 7 and 3. The integrityHash was computed over
    // the original (correct) chainPosition, so it now mismatches the new
    // position embedded in the payload.
    expect(result.valid).toBe(false);
    // Position check catches it first at index 3.
    expect(result.brokenAt).toBeDefined();
  });
});

// ─── Phase 1.6.1 — brokenKind discrimination ─────────────────────────────────

describe('chain-integrity — Phase 1.6.1 brokenKind discrimination', () => {
  it('clean chain has no brokenKind, preRekeyCount: 0', async () => {
    const records = await buildChain(5);
    const result = await verifyChainIntegrity(records);
    expect(result.valid).toBe(true);
    expect(result.brokenKind).toBeUndefined();
    expect(result.preRekeyCount).toBe(0);
  });

  it('content tampering surfaces as brokenKind: tampered', async () => {
    const records = await buildChain(5);
    records[2].originalText = 'TAMPERED';
    const result = await verifyChainIntegrity(records);
    expect(result.valid).toBe(false);
    expect(result.brokenKind).toBe('tampered');
    expect(result.brokenAt).toBe(2);
  });

  it('chain link broken (renumbered after delete) surfaces as brokenKind: chain-link-mismatch', async () => {
    const records = await buildChain(5);
    records.splice(2, 1);
    for (let i = 2; i < records.length; i++) records[i].chainPosition = i;
    const result = await verifyChainIntegrity(records);
    expect(result.valid).toBe(false);
    expect(result.brokenKind).toBe('chain-link-mismatch');
  });

  it('position gap surfaces as brokenKind: position-mismatch', async () => {
    const records = await buildChain(5);
    records.splice(2, 1);
    // No renumber — positions 0,1,3,4 cause position check to fail at index 2.
    const result = await verifyChainIntegrity(records);
    expect(result.valid).toBe(false);
    expect(result.brokenKind).toBe('position-mismatch');
  });

  it('matching-current-key signature failure surfaces as brokenKind: key-mismatch', async () => {
    const records = await buildChain(1);
    records[0].publicKeyFingerprint = 'mock-fp';
    records[0].integrityHash = await computeRecordIntegrityHash(records[0]);
    records[0].signature = 'mock-sig';
    mockedVerifyHash.mockResolvedValueOnce(false);
    const result = await verifyChainIntegrity(records);
    expect(result.valid).toBe(false);
    expect(result.brokenKind).toBe('key-mismatch');
    expect(result.brokenAt).toBe(0);
    // Reason copy must NOT include the word "tampered" or "modified" — the
    // pre-1.6.1 banner copy lied to parents who had simply reinstalled.
    expect(result.reason).not.toMatch(/tampered/i);
    expect(result.reason).not.toMatch(/modified/i);
    expect(result.reason).not.toMatch(/keypair was regenerated|reinstall|storage clear/i);
    expect(result.reason).toMatch(/record|signature|key data|file damage/i);
  });

  it('unstamped legacy signature failure remains non-failing but unverified', async () => {
    const records = await buildChain(1);
    records[0].signature = 'mock-sig';
    mockedVerifyHash.mockResolvedValueOnce(false);

    const result = await verifyChainIntegrity(records);

    expect(result.valid).toBe(true);
    expect(result.brokenKind).toBeUndefined();
    expect(result.perRecord?.get(records[0].id)).toBe('unsigned');
  });

  it('malformed matching-key signature bytes become a red failure instead of aborting verification', async () => {
    const records = await buildChain(1);
    records[0].publicKeyFingerprint = 'mock-fp';
    records[0].integrityHash = await computeRecordIntegrityHash(records[0]);
    records[0].signature = '%%%not-base64url%%%';
    mockedVerifyHash.mockRejectedValueOnce(new Error('malformed signature'));

    await expect(verifyChainIntegrity(records)).resolves.toMatchObject({
      valid: false,
      brokenKind: 'key-mismatch',
      brokenAt: 0,
    });
  });

  it('preRekeyCount counts records with chainAnchor=pre-rekey separately from preChainCount', async () => {
    const chainRecords = await buildChain(3);
    const legacy: ForensicRecord = {
      ...chainRecords[0],
      id: 'fr-legacy',
      chainPosition: -1,
      chainAnchor: 'pre-chain',
    };
    const preRekey: ForensicRecord = {
      ...chainRecords[0],
      id: 'fr-rekey-1',
      chainPosition: undefined,
      chainAnchor: 'pre-rekey',
    };
    const preRekey2: ForensicRecord = {
      ...chainRecords[0],
      id: 'fr-rekey-2',
      chainPosition: undefined,
      chainAnchor: 'pre-rekey',
    };
    const result = await verifyChainIntegrity([
      legacy, preRekey, preRekey2, ...chainRecords,
    ]);
    expect(result.valid).toBe(true);
    expect(result.chainLength).toBe(3);
    expect(result.preChainCount).toBe(1);
    expect(result.preRekeyCount).toBe(2);
  });
});

// M120: the signature branch checked against real ECDSA P-256, not a stub.
// A field dropped from the canonical hash before signing, or a verifier that
// stopped checking bytes, turns this red where the forced-verdict tests above
// could not.
describe('signature branch against real Web Crypto (M120)', () => {
  const mockedFingerprint = vi.mocked(getPublicKeyFingerprint);

  beforeEach(() => {
    const store: Record<string, unknown> = {};
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: async (keys: string[]) => {
            const out: Record<string, unknown> = {};
            for (const k of keys) if (k in store) out[k] = store[k];
            return out;
          },
          set: async (obj: Record<string, unknown>) => { Object.assign(store, obj); },
        },
      },
    } as unknown as typeof chrome);
    actualSigning.clearSigningKeyCache();
    mockedFingerprint.mockImplementation(actualSigning.getPublicKeyFingerprint);
  });

  afterEach(() => {
    actualSigning.clearSigningKeyCache();
    mockedFingerprint.mockImplementation(async () => 'mock-fp');
    vi.unstubAllGlobals();
  });

  async function signedChain(n: number): Promise<ForensicRecord[]> {
    await actualSigning.ensureSigningKey();
    const fingerprint = await actualSigning.getPublicKeyFingerprint();
    const records: ForensicRecord[] = [];
    let prevHash = CHAIN_GENESIS_HASH;
    for (let i = 0; i < n; i++) {
      const payload = basePayload(i);
      payload.prevRecordHash = prevHash;
      payload.chainPosition = i;
      const stamped = { ...payload, publicKeyFingerprint: fingerprint, chainAnchor: i === 0 ? 'genesis-v1' : undefined };
      const integrityHash = await computeRecordIntegrityHash(stamped);
      const signature = await actualSigning.signHash(integrityHash);
      records.push({ ...stamped, integrityHash, signature } as ForensicRecord);
      prevHash = integrityHash;
    }
    return records;
  }

  it('a chain signed with the real current key verifies, every record "verified"', async () => {
    const records = await signedChain(3);
    const result = await verifyChainIntegrity(records);
    expect(result.valid).toBe(true);
    expect(mockedVerifyHash).toHaveBeenCalledTimes(3);
    for (const r of records) expect(result.perRecord?.get(r.id)).toBe('verified');
  });

  it('a real signature moved onto another record fails as key-mismatch at that record', async () => {
    const records = await signedChain(3);
    // Record 1 carries record 2's genuine signature: the bytes are a valid
    // ECDSA signature under the current key, just not over this hash.
    records[1].signature = records[2].signature;
    const result = await verifyChainIntegrity(records);
    expect(result.valid).toBe(false);
    expect(result.brokenKind).toBe('key-mismatch');
    expect(result.brokenAt).toBe(1);
  });

  it('a byte changed in a signed record fails the hash before the signature is consulted', async () => {
    const records = await signedChain(2);
    records[1].originalText = 'original 1 with one word changed';
    const result = await verifyChainIntegrity(records);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
    expect(result.brokenKind).toBe('tampered');
  });
});
