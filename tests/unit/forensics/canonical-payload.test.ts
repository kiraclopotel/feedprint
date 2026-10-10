// Phase 1.6.2 — canonical-payload backwards compatibility lock.
//
// The verdict + skipReason fields were added to ForensicRecord in 1.6.2.
// To avoid invalidating every pre-1.6 signature, the canonicalization uses
// JSON.stringify's undefined-omission behavior: when verdict is undefined,
// the payload bytes are byte-identical to the pre-1.6.2 shape. When
// verdict is defined, the payload includes it and the hash differs.
//
// These tests pin that invariant. If anyone changes the canonical payload
// to coalesce verdict/skipReason (`?? null`, `?? ''`), or moves them above
// existing fields, legacy records will start failing integrity walks —
// these tests fail first.

import { describe, it, expect } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';

function baseRecord(): Omit<ForensicRecord, 'integrityHash' | 'signature' | 'publicKeyFingerprint' | 'chainAnchor'> {
  return {
    id: 'fr-test-001',
    timestamp: '2026-04-25T12:00:00.000Z',
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
    // Legacy vocab kept VERBATIM: real pre-narrowing records carry
    // 'timeline', and canonical hashing must stay byte-stable for them.
    feedSource: 'timeline' as unknown as ForensicRecord['feedSource'],
    aiModel: 'llama-3.1-8b-instant',
    aiProvider: 'groq',
    detectionMode: 'combined-detect-neutralize',
    configSnapshot: { mode: 'teen', threshold: 0.4, dailyCap: 5000 },
    prevRecordHash: 'h-prev',
    chainPosition: 5,
  };
}

describe('canonical-payload — Phase 1.6.2 verdict back-compat invariants', () => {
  it('legacy record (verdict undefined) produces same hash as a record with verdict explicitly omitted', async () => {
    const a = baseRecord();
    const b = { ...baseRecord() };
    delete (b as Record<string, unknown>).verdict; // explicitly absent vs. undefined-by-omission
    const hashA = await computeRecordIntegrityHash(a);
    const hashB = await computeRecordIntegrityHash(b);
    expect(hashA).toBe(hashB);
  });

  it('legacy record (verdict undefined) hash is byte-stable across calls', async () => {
    // Determinism check — guards against any non-deterministic hashing
    // (Date.now() leaking in, Map iteration, etc.).
    const a = baseRecord();
    const h1 = await computeRecordIntegrityHash(a);
    const h2 = await computeRecordIntegrityHash(a);
    expect(h1).toBe(h2);
  });

  it('record with verdict=flagged hashes DIFFERENTLY from legacy (verdict undefined)', async () => {
    const legacy = baseRecord();
    const flagged = { ...baseRecord(), verdict: 'flagged' as const };
    const hashLegacy = await computeRecordIntegrityHash(legacy);
    const hashFlagged = await computeRecordIntegrityHash(flagged);
    // Critical: if these came out equal, undefined would be hashing the
    // same as 'flagged' — which would mean tampering by ADDING verdict
    // wouldn't change the hash. The protection only works if they differ.
    expect(hashLegacy).not.toBe(hashFlagged);
  });

  it('verdict=pass and verdict=skipped produce distinct hashes from each other and from flagged', async () => {
    const flagged = { ...baseRecord(), verdict: 'flagged' as const };
    const pass = { ...baseRecord(), verdict: 'pass' as const };
    const skipped = { ...baseRecord(), verdict: 'skipped' as const, skipReason: 'too-short' };
    const [hF, hP, hS] = await Promise.all([
      computeRecordIntegrityHash(flagged),
      computeRecordIntegrityHash(pass),
      computeRecordIntegrityHash(skipped),
    ]);
    const distinct = new Set([hF, hP, hS]);
    expect(distinct.size).toBe(3);
  });

  it('skipReason is part of the hash — changing it produces a different hash', async () => {
    const a = { ...baseRecord(), verdict: 'skipped' as const, skipReason: 'too-short' };
    const b = { ...baseRecord(), verdict: 'skipped' as const, skipReason: 'cap-exhausted' };
    const [hA, hB] = await Promise.all([
      computeRecordIntegrityHash(a),
      computeRecordIntegrityHash(b),
    ]);
    expect(hA).not.toBe(hB);
  });

  it('legacy record hash equals the value computed under the pre-1.6.2 algorithm (golden hash)', async () => {
    const legacy = baseRecord();
    const hash = await computeRecordIntegrityHash(legacy);
    expect(hash).toBe('f1dc44d48a9b97e55c89ba185bd158c9eaf8bec669026545dda2965a5fc0a649');
  });
});

describe('canonical-payload — metrics field back-compat (forensic-export step 2)', () => {
  it('record with metrics undefined hashes identically to one where metrics is absent', async () => {
    const a = baseRecord();
    const b = { ...baseRecord(), metrics: undefined };
    const [hA, hB] = await Promise.all([
      computeRecordIntegrityHash(a),
      computeRecordIntegrityHash(b),
    ]);
    expect(hA).toBe(hB);
  });

  it('record WITH metrics hashes differently from a metric-less record (tamper-evident counts)', async () => {
    const legacy = baseRecord();
    const withMetrics = { ...baseRecord(), metrics: { likes: 1280, reply_count: 7 } };
    const [hLegacy, hWith] = await Promise.all([
      computeRecordIntegrityHash(legacy),
      computeRecordIntegrityHash(withMetrics),
    ]);
    expect(hLegacy).not.toBe(hWith);
  });

  it('mutating a captured count changes the hash', async () => {
    const a = { ...baseRecord(), metrics: { likes: 1280 } };
    const b = { ...baseRecord(), metrics: { likes: 9999 } };
    const [hA, hB] = await Promise.all([
      computeRecordIntegrityHash(a),
      computeRecordIntegrityHash(b),
    ]);
    expect(hA).not.toBe(hB);
  });
});

describe('canonical-payload — videoContext field back-compat (video understanding)', () => {
  const sampleVideoContext = {
    overlayText: 'Doctors HATE this trick',
    scene: 'A person holds a pill bottle toward the camera.',
    contentType: 'ad-promo',
    techniques: ['urgency', 'miracle/health claims'],
    severity: 7,
    model: 'gemini-3.1-flash-lite',
    frameCount: 3,
  };

  it('record with videoContext undefined hashes identically to one where the field is absent', async () => {
    const a = baseRecord();
    const b = { ...baseRecord(), videoContext: undefined };
    const [hA, hB] = await Promise.all([
      computeRecordIntegrityHash(a),
      computeRecordIntegrityHash(b),
    ]);
    expect(hA).toBe(hB);
  });

  it('record WITH videoContext hashes differently from a context-less record (tamper-evident evidence)', async () => {
    const legacy = baseRecord();
    const withCtx = { ...baseRecord(), videoContext: sampleVideoContext };
    const [hLegacy, hWith] = await Promise.all([
      computeRecordIntegrityHash(legacy),
      computeRecordIntegrityHash(withCtx),
    ]);
    expect(hLegacy).not.toBe(hWith);
  });

  it('mutating the captured overlay transcript changes the hash', async () => {
    const a = { ...baseRecord(), videoContext: sampleVideoContext };
    const b = { ...baseRecord(), videoContext: { ...sampleVideoContext, overlayText: 'totally innocent text' } };
    const [hA, hB] = await Promise.all([
      computeRecordIntegrityHash(a),
      computeRecordIntegrityHash(b),
    ]);
    expect(hA).not.toBe(hB);
  });

  it('mutating the captured severity changes the hash', async () => {
    const a = { ...baseRecord(), videoContext: sampleVideoContext };
    const b = { ...baseRecord(), videoContext: { ...sampleVideoContext, severity: 0 } };
    const [hA, hB] = await Promise.all([
      computeRecordIntegrityHash(a),
      computeRecordIntegrityHash(b),
    ]);
    expect(hA).not.toBe(hB);
  });
});

describe('canonical-payload — full-field golden hash (Phase 3A integrity guardrail)', () => {
  function fullRecord(): Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'> {
    return {
      id: 'golden-hash-test-001',
      timestamp: '2026-01-15T10:30:00.000Z',
      platform: 'twitter',
      originalText: 'This is a test post for golden hash verification.',
      originalHash: 'abc123def456',
      originalLength: 50,
      neutralizedText: 'This is a softened test post.',
      author: '@testauthor',
      postUrl: 'https://x.com/testauthor/status/123456789',
      techniques: [{ name: 'shame-attack', severity: 6, confidence: 0.6 }],
      overallScore: 6,
      userAgeCategory: 'child',
      aiSource: 'cloud',
      feedSource: 'for-you',
      aiModel: 'llama-3.1-8b-instant',
      aiProvider: 'groq',
      detectionMode: 'comment-batch:negative',
      configSnapshot: { mode: 'child', threshold: 0.4, dailyCap: 2000 },
      prevRecordHash: 'prev-hash-abc',
      chainPosition: 42,
      verdict: 'flagged',
      kind: 'comment',
      parentVideoId: 'video-001',
      publicKeyFingerprint: 'a1b2c3d4e5f67890',
      sourceCategory: 'algorithm',
      parentRecordId: 'parent-record-001',
      commentDepth: 1,
      roomAuthor: '@videoauthor',
      roomCaption: 'A viral video about test content',
      roomUrl: 'https://x.com/videoauthor/status/987654321',
      // Legacy topCategory vocab kept VERBATIM (see feedSource note above).
      harmFloor: { score: 45, topCategory: 'profanity-density', topEvidence: 'test', identitySlurMatch: false, language: 'en' } as unknown as ForensicRecord['harmFloor'],
      metrics: { likes: 150, reply_count: 3 },
      anchorUrl: 'https://x.com/testauthor/status/123456789/comment/1',
      videoContext: { overlayText: 'overlay', scene: 'test scene', contentType: 'promo', techniques: ['urgency'], severity: 5, model: 'gemini-2.0-flash', frameCount: 2 },
      accountType: 'person',
      observedSequence: 7,
      viewportSeenAt: '2026-01-15T10:30:05.000Z',
      surfaceSessionId: 'session-abc-123',
    };
  }

  it('full-field record produces pinned golden hash', async () => {
    const hash = await computeRecordIntegrityHash(fullRecord());
    expect(hash).toBe('a40d840f9db05b849c4cd10359b12b516fd817c84034ae3c335dc24687edf476');
  });

  it('changing any single field produces a different hash', async () => {
    const golden = await computeRecordIntegrityHash(fullRecord());
    const mutations: Array<Partial<ReturnType<typeof fullRecord>>> = [
      { id: 'different-id' },
      { originalText: 'different text' },
      { overallScore: 9 },
      { chainPosition: 43 },
      { verdict: 'pass' as const },
      { publicKeyFingerprint: 'ffffffffffffffff' },
      { accountType: 'advertiser' as const },
      { observedSequence: 99 },
    ];
    for (const mutation of mutations) {
      const mutated = { ...fullRecord(), ...mutation };
      const hash = await computeRecordIntegrityHash(mutated);
      expect(hash).not.toBe(golden);
    }
  });
});

describe('canonical-payload — anchorUrl field back-compat (per-comment deep-link)', () => {
  it('record with anchorUrl undefined hashes identically to one where anchorUrl is absent', async () => {
    const a = baseRecord();
    const b = { ...baseRecord(), anchorUrl: undefined };
    const [hA, hB] = await Promise.all([
      computeRecordIntegrityHash(a),
      computeRecordIntegrityHash(b),
    ]);
    expect(hA).toBe(hB);
  });

  it('record WITH anchorUrl hashes differently from one without (tamper-evident address)', async () => {
    const legacy = baseRecord();
    const withAnchor = { ...baseRecord(), anchorUrl: 'https://x.com/u/status/9' };
    const [hLegacy, hWith] = await Promise.all([
      computeRecordIntegrityHash(legacy),
      computeRecordIntegrityHash(withAnchor),
    ]);
    expect(hLegacy).not.toBe(hWith);
  });

  it('mutating the captured comment address changes the hash', async () => {
    const a = { ...baseRecord(), anchorUrl: 'https://x.com/u/status/9' };
    const b = { ...baseRecord(), anchorUrl: 'https://x.com/u/status/666' };
    const [hA, hB] = await Promise.all([
      computeRecordIntegrityHash(a),
      computeRecordIntegrityHash(b),
    ]);
    expect(hA).not.toBe(hB);
  });
});
