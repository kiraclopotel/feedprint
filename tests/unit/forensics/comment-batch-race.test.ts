/** @vitest-environment node */
// G1.6 — chain-write serialization lock tests.
//
// Per .brain/COMMENT_BATCH_RACE_BRIEF.md: pre-fix, 10 parallel
// logForensicEvent calls (the comment-batch flush path) all read getChainState
// concurrently, all observed the same nextPosition, all stamped duplicate
// chainPositions. The chain-integrity walker tripped on the duplicates —
// VISION §1.1 violation ("Concurrency-safe across all execution contexts.
// No race conditions").
//
// Fix (chain-write-lock factory + per-chain instance in logger.ts +
// verifier.ts): serialize the getChainState → computeIntegrityHash →
// addRecord sequence per chain. Chain A (logger.ts) and Chain B
// (verifier.ts) own separate locks so they don't block each other.
//
// These tests exercise the lock at the logger.ts seam by mocking the store
// with a getChainState that reads the simulated committed records (advances
// nextPosition as records get pushed) plus a one-tick delay to make the
// race observable. Without a lock, parallel callers all see the same
// committed-records snapshot and all stamp the same chainPosition. With
// the lock, each caller sees the prior commit before reading.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';
import type { AnalysisResult } from '../../../src/types/analysis';

interface CommittedRecord {
  id: string;
  chainPosition: number;
  prevRecordHash: string;
  integrityHash: string;
}

const committedRecords: CommittedRecord[] = [];

vi.mock('../../../src/forensics/store', () => ({
  addRecord: vi.fn(async (rec: ForensicRecord) => {
    // Small async delay simulates a real IDB write so the lock has work
    // to serialize. Without this, the synchronous push would close the race
    // window before parallel callers could interleave.
    await new Promise<void>((r) => setTimeout(r, 1));
    committedRecords.push({
      id: rec.id,
      chainPosition: rec.chainPosition!,
      prevRecordHash: rec.prevRecordHash!,
      integrityHash: rec.integrityHash,
    });
  }),
  getChainState: vi.fn(async () => {
    // One-tick yield mirrors the real getChainState (which awaits an IDB
    // read). The yield is what gives parallel callers an opportunity to
    // race under the unlocked code path.
    await new Promise<void>((r) => setTimeout(r, 0));
    let max = -1;
    let maxHash = 'feelingwise-chain-genesis-v1';
    for (const r of committedRecords) {
      if (r.chainPosition > max) {
        max = r.chainPosition;
        maxHash = r.integrityHash;
      }
    }
    return { nextPosition: max + 1, prevRecordHash: maxHash };
  }),
}));

vi.mock('../../../src/forensics/signing', () => ({
  signHash: vi.fn(async () => 'stub-sig'),
  getPublicKeyFingerprint: vi.fn(async () => 'stub-fp'),
}));

vi.mock('../../../src/forensics/hasher', () => ({
  // Use a salt so distinct text inputs produce distinct hashes — needed for
  // the prev-hash-chain assertion (each record's integrityHash must be
  // unique enough that prevHash linkage is meaningful).
  sha256: vi.fn(async (s: string) => `h-${s.length}-${s.slice(0, 4)}`),
}));

import { logForensicEvent } from '../../../src/forensics/logger';
import { addRecord } from '../../../src/forensics/store';

function mockAnalysis(overallScore = 7): AnalysisResult {
  return {
    postId: 'test',
    techniques: [
      { technique: 'fear-appeal', present: true, confidence: 0.9, severity: overallScore, evidence: [] },
    ],
    overallScore,
    overallConfidence: 0.9,
    isManipulative: true,
    processingTimeMs: 0,
  };
}

describe('G1.6 — chain-write serialization lock', () => {
  beforeEach(() => {
    committedRecords.length = 0;
    // Restore the default addRecord mock between tests (one test overrides
    // it to throw).
    vi.mocked(addRecord).mockImplementation(async (rec: ForensicRecord) => {
      await new Promise<void>((r) => setTimeout(r, 1));
      committedRecords.push({
        id: rec.id,
        chainPosition: rec.chainPosition!,
        prevRecordHash: rec.prevRecordHash!,
        integrityHash: rec.integrityHash,
      });
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('10 parallel logForensicEvent calls produce chainPositions 0..9 with no duplicates', async () => {
    // The G1.5 verification scenario: comment-batch flush of 10 comments under
    // a single Facebook post. Pre-G1.6 the JSON export showed 3 records each
    // at chainPosition 40 / 41 / 42 with identical prevRecordHashes — this
    // test would FAIL on the unlocked code path with all 10 records at
    // chainPosition 0.
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        logForensicEvent({
          originalText: `comment ${i} text`,
          neutralizedText: `neut ${i}`,
          analysis: mockAnalysis(),
          mode: 'teen',
          platform: 'facebook',
          aiSource: 'cloud',
          kind: 'comment',
          parentVideoId: 'pfbid0wvm-test-parent',
        }),
      ),
    );

    expect(committedRecords).toHaveLength(10);
    const positions = committedRecords.map((r) => r.chainPosition).sort((a, b) => a - b);
    expect(positions).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // No two records share a chainPosition.
    expect(new Set(positions).size).toBe(10);
  });

  it('prevRecordHash chain is intact: each record points at its predecessor', async () => {
    // Stronger invariant than just sequential positions. The walker in
    // chain-integrity.ts checks `record.prevRecordHash === predecessor.integrityHash`.
    // Pre-G1.6 all 10 callers had prevRecordHash equal to the same
    // CHAIN_GENESIS_HASH because none had committed yet when the others read.
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        logForensicEvent({
          originalText: `text-${i}`,
          neutralizedText: 'neut',
          analysis: mockAnalysis(),
          mode: 'teen',
          platform: 'facebook',
          aiSource: 'cloud',
        }),
      ),
    );

    const byPos = [...committedRecords].sort((a, b) => a.chainPosition - b.chainPosition);
    expect(byPos[0].prevRecordHash).toBe('feelingwise-chain-genesis-v1');
    for (let i = 1; i < byPos.length; i++) {
      expect(byPos[i].prevRecordHash).toBe(byPos[i - 1].integrityHash);
    }
  });

  it('next caller proceeds after a prior caller throws inside the lock', async () => {
    // Lock recovery via try/finally release. If a logger call throws (e.g.,
    // addRecord IDB failure), the lock must release so the next caller can
    // acquire it. Without try/finally, the next caller would deadlock
    // forever waiting on the never-resolved lock promise.
    let callCount = 0;
    vi.mocked(addRecord).mockImplementation(async (rec: ForensicRecord) => {
      callCount++;
      if (callCount === 1) {
        throw new Error('simulated IDB write failure');
      }
      await new Promise<void>((r) => setTimeout(r, 1));
      committedRecords.push({
        id: rec.id,
        chainPosition: rec.chainPosition!,
        prevRecordHash: rec.prevRecordHash!,
        integrityHash: rec.integrityHash,
      });
    });

    // logForensicEvent now re-throws on persistence failure so the SW
    // handler's `.catch` can sendResponse({ ok: false }) to the caller
    // (pre-CYCLE-N+27 the logger swallowed the error silently). Use
    // `allSettled` so the pending second call still drains before we
    // assert on committedRecords.
    const results = await Promise.allSettled([
      logForensicEvent({ originalText: 'first', neutralizedText: 'n', analysis: mockAnalysis(), mode: 'teen', platform: 'facebook', aiSource: 'cloud' }),
      logForensicEvent({ originalText: 'second', neutralizedText: 'n', analysis: mockAnalysis(), mode: 'teen', platform: 'facebook', aiSource: 'cloud' }),
    ]);

    // First call's addRecord threw → first promise rejected. Second
    // call's addRecord succeeded → second promise fulfilled and committed
    // at chainPosition 0 (first committed record on an otherwise empty
    // store). The KEY assertion: the second call ran at all. If the lock
    // had deadlocked on the thrown work, this would hang and timeout
    // (or land 0 records).
    expect(results[0].status).toBe('rejected');
    expect(results[1].status).toBe('fulfilled');
    expect(committedRecords).toHaveLength(1);
    expect(committedRecords[0].chainPosition).toBe(0);
    expect(callCount).toBe(2);
  });

  it('mixed parallel calls (50 concurrent) still produce a contiguous, collision-free chain', async () => {
    // Stress the lock with a wider parallel batch. Catches any subtle
    // ordering issue (e.g., if the lock pattern dropped a release in some
    // edge case, a later position would be missing or duplicated).
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        logForensicEvent({
          originalText: `batch-${i}`,
          neutralizedText: 'n',
          analysis: mockAnalysis(),
          mode: 'teen',
          platform: 'facebook',
          aiSource: 'cloud',
        }),
      ),
    );

    expect(committedRecords).toHaveLength(50);
    const positions = committedRecords.map((r) => r.chainPosition).sort((a, b) => a - b);
    // Contiguous 0..49.
    for (let i = 0; i < 50; i++) {
      expect(positions[i]).toBe(i);
    }
  });

  it('multi-platform parallel calls (FB + IG + TT + X mixed) all serialize correctly on the same chain', async () => {
    // Multi-platform scroll scenario from G1.5 verification. The same
    // logger handles all platforms — they share one chain, one lock.
    await Promise.all([
      logForensicEvent({ originalText: 'fb-1', neutralizedText: 'n', analysis: mockAnalysis(), mode: 'teen', platform: 'facebook', aiSource: 'cloud' }),
      logForensicEvent({ originalText: 'ig-1', neutralizedText: 'n', analysis: mockAnalysis(), mode: 'teen', platform: 'instagram', aiSource: 'cloud' }),
      logForensicEvent({ originalText: 'tt-1', neutralizedText: 'n', analysis: mockAnalysis(), mode: 'teen', platform: 'tiktok', aiSource: 'cloud' }),
      logForensicEvent({ originalText: 'x-1', neutralizedText: 'n', analysis: mockAnalysis(), mode: 'teen', platform: 'twitter', aiSource: 'cloud' }),
      logForensicEvent({ originalText: 'fb-2', neutralizedText: 'n', analysis: mockAnalysis(), mode: 'teen', platform: 'facebook', aiSource: 'cloud' }),
    ]);

    expect(committedRecords).toHaveLength(5);
    const positions = committedRecords.map((r) => r.chainPosition).sort((a, b) => a - b);
    expect(positions).toEqual([0, 1, 2, 3, 4]);
  });
});
