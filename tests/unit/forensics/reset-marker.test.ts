// G1.3 / R-6 — Reset Marker canonical-payload coverage tests.
//
// Per DELTA-4 Section A R-6: pre-fix, a chain that had been reset was
// indistinguishable from a fresh-install chain — silent evidence-destruction
// vector. Fix: every reset writes a Reset Marker as chainPosition 0 of the
// new chain, recording (a) the prior chain's last integrityHash (when known)
// and (b) an optional user-supplied reason. Both fields are part of the
// canonical hash, so any tampering with the marker (e.g., stripping
// priorChainHash to make it look like a fresh install) breaks recomputed-hash
// verification.
//
// These tests cover the canonical-payload coverage of the new fields.
// Live-verification of the actual reset → marker-written flow is gated by
// G1.5 on a real browser (chrome.storage required).

import { describe, it, expect } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';

function baseMarker(): Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'> {
  return {
    id: 'fr-reset-test-001',
    timestamp: '2026-04-30T23:42:00.000Z',
    platform: 'twitter',
    originalText: '[reset-marker @ 2026-04-30T23:42:00.000Z]',
    originalHash: 'h-reset-marker',
    originalLength: 40,
    neutralizedText: '',
    author: '',
    postUrl: '',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
    aiSource: 'local',
    feedSource: 'unknown',
    detectionMode: 'reset-marker',
    prevRecordHash: 'feelingwise-chain-genesis-v1',
    chainPosition: 0,
    verdict: 'pass',
    kind: 'reset-marker',
  };
}

describe('canonical-payload — G1.3 / R-6 Reset Marker coverage', () => {
  it('marker without priorChainHash hashes byte-stably (fresh-install reset case)', async () => {
    // Genesis-only reset (chain was empty before the reset): priorChainHash
    // stays undefined. Hash should be deterministic across calls.
    const a = baseMarker();
    const h1 = await computeRecordIntegrityHash(a);
    const h2 = await computeRecordIntegrityHash(a);
    expect(h1).toBe(h2);
  });

  it('marker WITH priorChainHash hashes DIFFERENTLY than a marker without one', async () => {
    // The whole point of priorChainHash: opposing counsel can demand "produce
    // the prior chain that ended with hash X." Stripping the field to hide
    // the prior chain MUST break recomputed-hash verification.
    const without = baseMarker();
    const withHash = { ...baseMarker(), priorChainHash: 'h-old-chain-last-record' };
    const hWithout = await computeRecordIntegrityHash(without);
    const hWith = await computeRecordIntegrityHash(withHash);
    expect(hWithout).not.toBe(hWith);
  });

  it('mutating priorChainHash produces a different hash (closes attack vector)', async () => {
    // Attacker substitutes a fake priorChainHash to point at a chain they
    // can produce on demand. The substitution changes payload bytes →
    // recomputed hash diverges from stored hash → tampered banner.
    const a = { ...baseMarker(), priorChainHash: 'h-real-prior-chain' };
    const b = { ...baseMarker(), priorChainHash: 'h-fake-prior-chain' };
    const [hA, hB] = await Promise.all([
      computeRecordIntegrityHash(a),
      computeRecordIntegrityHash(b),
    ]);
    expect(hA).not.toBe(hB);
  });

  it('resetReason is part of the hash — mutating produces different hashes', async () => {
    // The user's stated reason is part of the cryptographic record. Tampering
    // with the reason text to (e.g.) substitute "sold device" with "data
    // contradicted my narrative" breaks the recomputed hash. Honest semantics.
    const a = { ...baseMarker(), resetReason: 'sold this device' };
    const b = { ...baseMarker(), resetReason: 'starting fresh' };
    const [hA, hB] = await Promise.all([
      computeRecordIntegrityHash(a),
      computeRecordIntegrityHash(b),
    ]);
    expect(hA).not.toBe(hB);
  });

  it('marker with no resetReason hashes the same whether absent or explicitly undefined', async () => {
    // Back-compat: if the user provided no reason, the field is omitted from
    // JSON.stringify (undefined). A marker with the field explicitly absent
    // and one with the field set to undefined should produce identical bytes.
    const absent = baseMarker();
    const explicitlyUndefined: typeof absent & { resetReason?: string } = {
      ...baseMarker(),
      resetReason: undefined,
    };
    const h1 = await computeRecordIntegrityHash(absent);
    const h2 = await computeRecordIntegrityHash(explicitlyUndefined);
    expect(h1).toBe(h2);
  });

  it('non-reset-marker records (legacy, kind!="reset-marker") with priorChainHash undefined hash unchanged from pre-G1.3', async () => {
    // Back-compat invariant: every record in the chain other than the marker
    // has priorChainHash + resetReason undefined. JSON.stringify omits both.
    // This mirrors the verdict + skipReason back-compat trick from Phase 1.6.2.
    // Test by computing hash with the new fields explicitly undefined vs.
    // absent — must be byte-identical.
    const a: Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'> = {
      ...baseMarker(),
      kind: 'post', // not a reset-marker
      // priorChainHash + resetReason absent (the legacy shape)
    };
    const b: typeof a & { priorChainHash?: string; resetReason?: string } = {
      ...a,
      priorChainHash: undefined,
      resetReason: undefined,
    };
    const h1 = await computeRecordIntegrityHash(a);
    const h2 = await computeRecordIntegrityHash(b);
    expect(h1).toBe(h2);
  });

  it('kind="reset-marker" hashes differently than kind="post" with otherwise-identical fields', async () => {
    // Kind is already part of the canonical hash (pre-G1.3, per Phase 1.6.2).
    // Sanity: switching kind to/from 'reset-marker' produces different hashes.
    // Belt-and-suspenders: even if priorChainHash + resetReason are both
    // undefined, the kind field alone distinguishes a marker from a post.
    const marker = { ...baseMarker(), kind: 'reset-marker' as const };
    const post = { ...baseMarker(), kind: 'post' as const };
    const [hM, hP] = await Promise.all([
      computeRecordIntegrityHash(marker),
      computeRecordIntegrityHash(post),
    ]);
    expect(hM).not.toBe(hP);
  });
});
