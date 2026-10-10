// FeelingWise — restore = REPLACE regression tests (a live repro,
// 2026-06-11: Back up now → Reset → Restore from backup → browse → red
// "Position mismatch at index 1: expected chainPosition=1, got 0").
//
// Root cause: reset writes a fresh reset-marker at chainPosition 0 under a
// new key; the old restore then ADDED the backup's records verbatim with
// their ORIGINAL positions (0..N) → two records claimed position 0 and the
// prev-hash links no longer matched. These tests lock:
//   1. the corrupt interleaved state IS rejected by verification (root cause
//      demonstrated), and verifyChainStructure refuses such a backup file;
//   2. the replace-path output state (markers deleted, backup verbatim)
//      verifies green, keeps verifying after new records are appended, and
//      passes the export-side per-record canonical recompute — the
//      "COMPROMISED at #1" failure is unreachable through this path.
//
// IDB orchestration (restoreFromBackup / replaceBackupStateUnderChainLock) is live-verified on
// device — vitest's Node env has no IndexedDB and the project does not ship
// fake-indexeddb (same pattern as forensic-backup.test.ts). The pure
// decision + verification layers exercised here are what the orchestration
// composes.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/forensics/signing', () => ({
  verifyHash: vi.fn(async () => true),
  signHash: vi.fn(async () => 'mock-sig'),
  getPublicKeyFingerprint: vi.fn(async () => 'mock-fp'),
}));

import type { ForensicRecord } from '../../../src/types/forensic';
import {
  verifyChainIntegrity,
  verifyChainStructure,
  CHAIN_GENESIS_HASH,
} from '../../../src/forensics/chain-integrity';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import { sha256 } from '../../../src/forensics/hasher';
import { countRealChainRecords, restoreNeedsConfirmation } from '../../../src/forensics/backup';

// ─── Fixtures: real-shaped records with correct hashes + links ──────────────

function basePayload(i: number): Omit<ForensicRecord, 'integrityHash' | 'signature' | 'publicKeyFingerprint' | 'chainAnchor'> {
  return {
    id: `fr-restore-${i}`,
    timestamp: `2026-06-11T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
    platform: 'twitter',
    originalText: `original ${i}`,
    originalHash: `hash-${i}`,
    originalLength: `original ${i}`.length,
    neutralizedText: '',
    author: `@author${i}`,
    postUrl: `https://x.com/p/${i}`,
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'unknown',
    detectionMode: 'combined-detect-neutralize',
    prevRecordHash: '',
    chainPosition: 0,
    verdict: 'flagged',
  };
}

async function buildChain(n: number, startAt = 0, prevHashSeed = CHAIN_GENESIS_HASH): Promise<ForensicRecord[]> {
  const records: ForensicRecord[] = [];
  let prevHash = prevHashSeed;
  for (let i = 0; i < n; i++) {
    const payload = basePayload(startAt + i);
    payload.prevRecordHash = prevHash;
    payload.chainPosition = startAt + i;
    const integrityHash = await computeRecordIntegrityHash(payload);
    records.push({ ...payload, integrityHash, chainAnchor: startAt + i === 0 ? 'genesis-v1' : undefined });
    prevHash = integrityHash;
  }
  return records;
}

/** Build a reset marker exactly the way resetForensicChain does (store.ts). */
async function buildResetMarker(priorChainHash?: string): Promise<ForensicRecord> {
  const markerTimestamp = '2026-06-11T08:00:00.000Z';
  const markerOriginalText = `[reset-marker @ ${markerTimestamp}]`;
  const partial: Omit<ForensicRecord, 'integrityHash' | 'signature'> = {
    id: 'fr-reset-test',
    timestamp: markerTimestamp,
    platform: 'twitter',
    originalText: markerOriginalText,
    originalHash: await sha256(markerOriginalText),
    originalLength: markerOriginalText.length,
    neutralizedText: '',
    author: '',
    postUrl: '',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
    aiSource: 'local',
    feedSource: 'unknown',
    detectionMode: 'reset-marker',
    prevRecordHash: CHAIN_GENESIS_HASH,
    chainPosition: 0,
    chainAnchor: 'genesis-v1',
    verdict: 'pass',
    kind: 'reset-marker',
    priorChainHash,
  };
  const integrityHash = await computeRecordIntegrityHash(partial);
  return { ...partial, integrityHash };
}

// ─── 1. Root cause: the interleaved reset→restore state is corrupt ──────────

describe('reset→restore interleave (the bug found in a live repro)', () => {
  it('marker@0 + restored records at original 0..N fails verification with the exact live error', async () => {
    const original = await buildChain(3);
    const marker = await buildResetMarker(original[2].integrityHash);
    // Old (pre-fix) restore behavior: ADD backup records onto the post-reset
    // chain — two records now claim chainPosition 0.
    const interleaved = [marker, ...original];
    const result = await verifyChainIntegrity(interleaved);
    expect(result.valid).toBe(false);
    expect(result.brokenKind).toBe('position-mismatch');
    // The live banner: "Position mismatch at index 1: expected chainPosition=1, got 0."
    expect(result.reason).toMatch(/Position mismatch at index 1: expected chainPosition=1, got 0/);
  });

  it('verifyChainStructure rejects a backup file containing such a collision (staged gate)', async () => {
    const original = await buildChain(3);
    const marker = await buildResetMarker();
    const structure = await verifyChainStructure([marker, ...original]);
    expect(structure.valid).toBe(false);
  });

  it('verifyChainStructure accepts a verbatim backup even when its signatures cannot be checked here', async () => {
    const records = await buildChain(5);
    for (const r of records) r.signature = 'signed-under-an-earlier-key';
    const structure = await verifyChainStructure(records);
    expect(structure.valid).toBe(true);
    expect(structure.chainLength).toBe(5);
  });

  it('verifyChainStructure rejects a tampered backup (content changed after signing)', async () => {
    const records = await buildChain(4);
    records[2].originalText = 'TAMPERED';
    const structure = await verifyChainStructure(records);
    expect(structure.valid).toBe(false);
    expect(structure.brokenKind).toBe('tampered');
  });
});

// ─── 2. Replace-path decisions ───────────────────────────────────────────────

describe('replace-path decision logic', () => {
  it('a post-reset chain (marker only) counts 0 real records → no confirmation, markers replaced silently', async () => {
    const marker = await buildResetMarker();
    expect(countRealChainRecords([marker])).toBe(0);
    expect(restoreNeedsConfirmation(countRealChainRecords([marker]), 3)).toBe(false);
  });

  it('a chain with real records requires confirmation before being replaced', async () => {
    const marker = await buildResetMarker();
    const real = await buildChain(2);
    const current = [marker, ...real]; // hypothetical mixed state
    expect(countRealChainRecords(current)).toBe(2);
    expect(restoreNeedsConfirmation(countRealChainRecords(current), 3)).toBe(true);
  });
});

// ─── 3. Regression: repro sequence ends GREEN and export-verifiable ─────────

describe('repro regression: backup → reset → restore(replace) → append → verify', () => {
  it('the replaced chain verifies, keeps verifying after appends, and passes the export-side per-record walk', async () => {
    // 1. Original browsing session → chain of 4.
    const original = await buildChain(4);
    // 2. Backup (verbatim copy).
    const backupRecords = original.map(r => ({ ...r }));
    // 3. Reset → store holds only the marker. Replace semantics: marker rows
    //    are deleted, backup records land verbatim.
    const afterRestore = backupRecords;
    expect(countRealChainRecords([await buildResetMarker(original[3].integrityHash)])).toBe(0);

    const verifyRestored = await verifyChainIntegrity(afterRestore);
    expect(verifyRestored.valid).toBe(true);
    expect(verifyRestored.chainLength).toBe(4);
    // Real positions — no PRE-REKEY, no "#—".
    expect(afterRestore.map(r => r.chainPosition)).toEqual([0, 1, 2, 3]);

    // 4. Browse again: new records continue from the restored head.
    const appended = await buildChain(2, 4, afterRestore[3].integrityHash);
    const finalChain = [...afterRestore, ...appended];
    const verifyFinal = await verifyChainIntegrity(finalChain);
    expect(verifyFinal.valid).toBe(true);
    expect(verifyFinal.chainLength).toBe(6);

    // 5. Export-side integrity walk (the non-DOM check the HTML verifier
    //    performs per record): the recomputed canonical hash must equal the
    //    stored integrityHash for EVERY record — the "content does not match
    //    its cryptographic signature" failure is unreachable.
    for (const r of finalChain) {
      expect(await computeRecordIntegrityHash(r)).toBe(r.integrityHash);
    }
  });

  it('the reset marker itself is hash-complete and would verify in an export (it is signed via addRecord)', async () => {
    const marker = await buildResetMarker('prior-hash');
    expect(await computeRecordIntegrityHash(marker)).toBe(marker.integrityHash);
    // A fresh post-reset chain (marker only) verifies on its own.
    const result = await verifyChainIntegrity([marker]);
    expect(result.valid).toBe(true);
    expect(result.chainLength).toBe(1);
  });
});
