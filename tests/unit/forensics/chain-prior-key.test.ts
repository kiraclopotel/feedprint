// Chain walker prior-key attribution. A signature failing under the CURRENT
// key, with a recomputed stored hash and a stamped fingerprint naming a
// DIFFERENT key, may be a restored earlier-key record. The walker keeps it in
// the chain as non-failing 'prior-key' instead of calling it tampered, but the
// unavailable earlier public key means its signature remains UNVERIFIED and
// presentation must be amber/partial rather than green.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/forensics/signing', () => ({
  verifyHash: vi.fn(async () => true),
  signHash: vi.fn(async () => 'mock-sig'),
  getPublicKeyFingerprint: vi.fn(async () => 'current-fp'),
}));

import type { ForensicRecord } from '../../../src/types/forensic';
import { verifyChainIntegrity, CHAIN_GENESIS_HASH } from '../../../src/forensics/chain-integrity';
import { integrityVerificationState } from '../../../src/forensics/integrity-summary';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import { verifyHash, getPublicKeyFingerprint } from '../../../src/forensics/signing';

const mockedVerifyHash = vi.mocked(verifyHash);
const mockedFingerprint = vi.mocked(getPublicKeyFingerprint);

async function buildChain(n: number, fingerprint?: string): Promise<ForensicRecord[]> {
  const records: ForensicRecord[] = [];
  let prevHash = CHAIN_GENESIS_HASH;
  for (let i = 0; i < n; i++) {
    const payload: Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'> = {
      id: `fr-pk-${i}`,
      timestamp: `2026-06-11T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
      platform: 'twitter',
      originalText: `original ${i}`,
      originalHash: `hash-${i}`,
      originalLength: 10,
      neutralizedText: '',
      author: `@a${i}`,
      postUrl: `https://x.com/p/${i}`,
      techniques: [],
      overallScore: 0,
      userAgeCategory: 'teen',
      aiSource: 'cloud',
      feedSource: 'unknown',
      prevRecordHash: prevHash,
      chainPosition: i,
      publicKeyFingerprint: fingerprint,
    };
    const integrityHash = await computeRecordIntegrityHash(payload);
    records.push({ ...payload, integrityHash, signature: 'sig' });
    prevHash = integrityHash;
  }
  return records;
}

describe('chain-integrity — prior-key attribution', () => {
  it('intact records stamped with an EARLIER key stay in the chain as prior-key (valid chain)', async () => {
    mockedVerifyHash.mockResolvedValue(false); // current key cannot verify them
    mockedFingerprint.mockResolvedValue('current-fp');
    const records = await buildChain(3, 'old-fp');
    const result = await verifyChainIntegrity(records);
    expect(result.valid).toBe(true);
    expect(result.chainLength).toBe(3);
    expect(result.priorKeyCount).toBe(3);
    expect(integrityVerificationState(result)).toBe('partial');
    for (const r of records) expect(result.perRecord?.get(r.id)).toBe('prior-key');
  });

  it('a mixed chain (earlier-key records + current-key records) verifies end to end', async () => {
    mockedFingerprint.mockResolvedValue('current-fp');
    const restored = await buildChain(2, 'old-fp');
    // Continue the chain under the current key from the restored head.
    let prevHash = restored[1].integrityHash;
    const payload: Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'> = {
      id: 'fr-pk-new',
      timestamp: '2026-06-11T01:00:00.000Z',
      platform: 'twitter',
      originalText: 'new record',
      originalHash: 'h-new',
      originalLength: 10,
      neutralizedText: '',
      author: '@n',
      postUrl: 'https://x.com/p/new',
      techniques: [],
      overallScore: 0,
      userAgeCategory: 'teen',
      aiSource: 'cloud',
      feedSource: 'unknown',
      prevRecordHash: prevHash,
      chainPosition: 2,
      publicKeyFingerprint: 'current-fp',
    };
    const integrityHash = await computeRecordIntegrityHash(payload);
    const fresh: ForensicRecord = { ...payload, integrityHash, signature: 'sig' };
    // Old-key signatures fail, current-key signature verifies.
    mockedVerifyHash.mockImplementation(async (_hash, _sig) => false);
    mockedVerifyHash
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const result = await verifyChainIntegrity([...restored, fresh]);
    expect(result.valid).toBe(true);
    expect(result.priorKeyCount).toBe(2);
    expect(integrityVerificationState(result)).toBe('partial');
    expect(result.perRecord?.get('fr-pk-new')).toBe('verified');
  });

  it('a failing signature stamped with the CURRENT fingerprint is still a key-mismatch break', async () => {
    mockedVerifyHash.mockResolvedValue(false);
    mockedFingerprint.mockResolvedValue('current-fp');
    const records = await buildChain(2, 'current-fp');
    const result = await verifyChainIntegrity(records);
    expect(result.valid).toBe(false);
    expect(result.brokenKind).toBe('key-mismatch');
  });

  it('a failing signature with NO stamped fingerprint stays non-failing but unverified', async () => {
    mockedVerifyHash.mockResolvedValue(false);
    mockedFingerprint.mockResolvedValue('current-fp');
    const records = await buildChain(2, undefined);
    const result = await verifyChainIntegrity(records);
    expect(result.valid).toBe(true);
    expect(result.brokenKind).toBeUndefined();
    expect(integrityVerificationState(result)).toBe('partial');
    expect(result.perRecord?.get(records[0].id)).toBe('unsigned');
  });

  it('when the current fingerprint is UNRESOLVABLE in this realm, the chain is NOT broken (H3)', async () => {
    // Dashboard realm after a restore: the verifying key isn't loaded, so
    // getPublicKeyFingerprint throws → currentFingerprint stays undefined. We
    // cannot attribute the signature failure (can't compare keys), and the
    // stored hash recomputed cleanly, so the chain must NOT report tampering —
    // that would falsely tell the parent a restored chain is broken. The
    // record falls back to a non-failing 'unsigned' verdict (hash/link consistent,
    // signature unverifiable here).
    mockedVerifyHash.mockResolvedValue(false);
    mockedFingerprint.mockRejectedValue(new Error('no key yet'));
    const records = await buildChain(2, 'old-fp');
    const result = await verifyChainIntegrity(records);
    expect(result.valid).toBe(true);
    expect(result.brokenKind).toBeUndefined();
    for (const r of records) expect(result.perRecord?.get(r.id)).toBe('unsigned');
  });
});
