// G1.2 / R-4 — canonical-payload publicKeyFingerprint binding tests.
//
// DELTA-4 Section A R-4: pre-fix the publicKeyFingerprint field was stamped on
// records but excluded from the canonical hash. An attacker with IDB write
// access could mutate ONLY the fingerprint field without breaking integrityHash
// → signature verification → recomputed-hash equality. R-4 fix moves the
// fingerprint into the canonical payload (with the verdict/skipReason back-
// compat trick: undefined keys omitted by JSON.stringify so legacy records
// hash byte-identically).
//
// These tests pin the invariants:
//   1. Legacy records (publicKeyFingerprint undefined) hash byte-identically
//      pre/post fix. Required for back-compat — pre-G1.2 records remain
//      verifiable in chain integrity walks.
//   2. New records with stamped fingerprint hash differently than legacy.
//      Confirms fingerprint is now part of the canonical bytes.
//   3. Mutating fingerprint alone produces a different hash. Closes the
//      attack vector R-4 names.

import { describe, it, expect } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';

function baseRecord(): Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'> {
  return {
    id: 'fr-test-fp-001',
    timestamp: '2026-04-30T12:00:00.000Z',
    platform: 'twitter',
    originalText: 'sample post text long enough to be eligible',
    originalHash: 'h-original',
    originalLength: 44,
    neutralizedText: 'neutralized version',
    author: '@author',
    postUrl: 'https://x.com/author/status/1',
    techniques: [{ name: 'fear-appeal', severity: 7, confidence: 0.9 }],
    overallScore: 7,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'unknown',
    aiModel: 'llama-3.1-8b-instant',
    aiProvider: 'groq',
    detectionMode: 'combined-detect-neutralize',
    configSnapshot: { mode: 'teen', threshold: 0.4, dailyCap: 5000 },
    prevRecordHash: 'h-prev',
    chainPosition: 5,
    verdict: 'flagged',
  };
}

describe('canonical-payload — G1.2 / R-4 fingerprint binding', () => {
  it('legacy record (publicKeyFingerprint undefined) hashes byte-stably across calls', async () => {
    // Determinism check — same legacy record produces the same hash. Guards
    // against non-deterministic JSON.stringify ordering, accidental Date.now()
    // leakage, etc. Required for chain-integrity verifier to recompute reliably.
    const a = baseRecord();
    const h1 = await computeRecordIntegrityHash(a);
    const h2 = await computeRecordIntegrityHash(a);
    expect(h1).toBe(h2);
  });

  it('legacy record hash matches whether publicKeyFingerprint is absent or explicitly undefined', async () => {
    // Back-compat invariant: pre-G1.2 records had no fingerprint stamped.
    // The Omit<> input type allows the field to be missing. Both should
    // produce the SAME hash bytes (JSON.stringify omits undefined keys).
    const absent = baseRecord();
    const explicitlyUndefined: typeof absent & { publicKeyFingerprint?: string } = {
      ...baseRecord(),
      publicKeyFingerprint: undefined,
    };
    const h1 = await computeRecordIntegrityHash(absent);
    const h2 = await computeRecordIntegrityHash(explicitlyUndefined);
    expect(h1).toBe(h2);
  });

  it('record WITH fingerprint stamped hashes DIFFERENTLY than legacy (fingerprint undefined)', async () => {
    // The R-4 fix's whole point: stamped fingerprint is part of the hash.
    // A legacy record (no fingerprint) and a new record (with fingerprint)
    // for otherwise-identical content MUST produce different hashes —
    // otherwise stamping fingerprint wouldn't be tamper-evident.
    const legacy = baseRecord();
    const stamped = { ...baseRecord(), publicKeyFingerprint: 'a3f9c2e10b5d4c01' };
    const hL = await computeRecordIntegrityHash(legacy);
    const hS = await computeRecordIntegrityHash(stamped);
    expect(hL).not.toBe(hS);
  });

  it('mutating publicKeyFingerprint alone produces a different hash (closes R-4 attack vector)', async () => {
    // The attack R-4 closes: attacker mutates ONLY the fingerprint to make
    // a record appear to come from a different install. Pre-fix, recomputed
    // hash would equal stored hash (fingerprint not in payload), so chain
    // verification would still pass. Post-fix, recomputed hash diverges.
    const a = { ...baseRecord(), publicKeyFingerprint: 'a3f9c2e10b5d4c01' };
    const b = { ...baseRecord(), publicKeyFingerprint: 'b4f8d3e10b5d4c01' };
    const [hA, hB] = await Promise.all([
      computeRecordIntegrityHash(a),
      computeRecordIntegrityHash(b),
    ]);
    expect(hA).not.toBe(hB);
  });

  it('mutating fingerprint to undefined on a stamped record breaks the integrity check', async () => {
    // Variant of the above: attacker STRIPS the fingerprint (sets to
    // undefined) on a stamped record. Recomputed hash should equal the
    // legacy-no-fingerprint hash (different from the stamped hash).
    const stamped = { ...baseRecord(), publicKeyFingerprint: 'a3f9c2e10b5d4c01' };
    const stripped = { ...stamped, publicKeyFingerprint: undefined };
    const hStamped = await computeRecordIntegrityHash(stamped);
    const hStripped = await computeRecordIntegrityHash(stripped);
    expect(hStamped).not.toBe(hStripped);
  });

  it('two records with the SAME fingerprint hash byte-identically (idempotence per install)', async () => {
    // Sanity: records signed by the same install carry the same fingerprint.
    // Two structurally-identical records with the same fingerprint must
    // produce the same hash; otherwise re-signing under the same install
    // would produce diverging hashes and break chain continuity.
    const a = { ...baseRecord(), publicKeyFingerprint: 'a3f9c2e10b5d4c01' };
    const b = { ...baseRecord(), publicKeyFingerprint: 'a3f9c2e10b5d4c01' };
    const hA = await computeRecordIntegrityHash(a);
    const hB = await computeRecordIntegrityHash(b);
    expect(hA).toBe(hB);
  });
});
