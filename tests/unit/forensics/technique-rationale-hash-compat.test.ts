// The per-technique `why` (the judging model's own rationale) is additive.
//
// It exists because 'combined' is the single most common technique in real
// exports — 101 of the 206 explicitly flagged records in the 2026-08-22
// 5,365-record chain, every one of them carrying exactly one technique entry
// and no components. 'combined' is the UNCATEGORISED RESIDUAL: the judge's
// free-text primary_concern matched no technique enum, so mapConcernToTechnique
// (core/neutralizer.ts) fell back to it. It does NOT mean "2+ distinct
// techniques present, severity = max of components" — that reading was written
// into three source files and both lock headers, and was corrected 2026-08-24
// against the producing code (see tests/unit/ai/combined-technique-meaning.test.ts).
// An auditor reading "combined, severity 8" could not tell group-blame from
// doxxing from a sexual reference. The rationale was already produced by the
// judge and dropped on the floor in logger.ts when the record was built.
//
// The contract this file locks: adding it must not invalidate a single
// existing signature. Records without a rationale must hash byte-identically
// to how they hashed before the field existed.

import { describe, it, expect } from 'vitest';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import type { ForensicRecord } from '../../../src/types/forensic';

type Payload = Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'>;

function base(techniques: ForensicRecord['techniques']): Payload {
  return {
    id: 'r-1',
    timestamp: '2026-08-22T10:00:00Z',
    platform: 'twitter',
    originalText: 'sample',
    originalHash: 'h',
    originalLength: 6,
    neutralizedText: '',
    author: '@a',
    postUrl: 'https://x.com/a/status/1',
    techniques,
    overallScore: 8,
    userAgeCategory: 'adult',
    aiSource: 'cloud',
    feedSource: 'for-you',
    prevRecordHash: 'prev',
    chainPosition: 7,
    verdict: 'flagged',
    kind: 'post',
    publicKeyFingerprint: 'fp',
  } as Payload;
}

describe('per-technique rationale — additive, signature-safe', () => {
  it('hashes byte-identically to a pre-field record when no rationale is present', async () => {
    // The literal below is the shape the field did NOT exist in. If adding
    // `why?` had changed serialization for rationale-less records, these two
    // would differ and every historical signature in the chain would break.
    const withoutField = await computeRecordIntegrityHash(
      base([{ name: 'combined', severity: 8, confidence: 0.9 }]),
    );
    const withUndefined = await computeRecordIntegrityHash(
      base([{ name: 'combined', severity: 8, confidence: 0.9, why: undefined }]),
    );
    expect(withUndefined).toBe(withoutField);
  });

  it('is inside the signed payload — a repainted rationale breaks the hash', async () => {
    const honest = await computeRecordIntegrityHash(
      base([{ name: 'combined', severity: 8, confidence: 0.9, why: 'group blame + fear appeal' }]),
    );
    const repainted = await computeRecordIntegrityHash(
      base([{ name: 'combined', severity: 8, confidence: 0.9, why: 'mild sarcasm' }]),
    );
    expect(repainted).not.toBe(honest);
  });

  it('a rationale changes the hash relative to no rationale at all', async () => {
    const bare = await computeRecordIntegrityHash(
      base([{ name: 'combined', severity: 8, confidence: 0.9 }]),
    );
    const annotated = await computeRecordIntegrityHash(
      base([{ name: 'combined', severity: 8, confidence: 0.9, why: 'group blame + fear appeal' }]),
    );
    expect(annotated).not.toBe(bare);
  });
});
