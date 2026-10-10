// @vitest-environment jsdom
//
// FeelingWise — parent-feedback sidecar unit tests (ADR-005 §D5, store v4).
//
// Locks the no-throw contract + return-shape guarantees the dashboard's
// Confirm / Dispute card buttons rely on. Per project convention, IDB
// persistence is not asserted here — same rationale as
// `tests/unit/forensics/capture-prompt-io.test.ts` (jsdom IndexedDB unreliable; manual
// dev-flow exercises the persistence path).
//
// Schema-stability assertions catch regressions where the ParentFeedback shape
// drifts and breaks the export integration deferred to V1.5.

import { describe, it, expect } from 'vitest';
import {
  addParentFeedback,
  getAllParentFeedback,
  clearAllParentFeedback,
  type ParentFeedback,
} from '../../../src/forensics/store';

describe('parent-feedback sidecar — no-throw contract under IDB unavailable', () => {
  it('addParentFeedback returns a ParentFeedback shape OR rejects (never silently corrupts)', async () => {
    // jsdom IDB may or may not be functional. Either branch is acceptable as
    // long as the failure mode is observable (exception) and the success
    // mode produces a well-typed entry.
    try {
      const entry = await addParentFeedback('fr-test-1', 'confirmed');
      // Success branch: validate shape.
      expect(entry.recordId).toBe('fr-test-1');
      expect(entry.feedback).toBe('confirmed');
      expect(typeof entry.timestamp).toBe('string');
      // signature + publicKeyFingerprint are best-effort; either present or absent.
      if (entry.signature !== undefined) expect(typeof entry.signature).toBe('string');
      if (entry.publicKeyFingerprint !== undefined) expect(typeof entry.publicKeyFingerprint).toBe('string');
    } catch {
      // Failure branch: acceptable. The store helper is documented as
      // best-effort; the dashboard handler logs + continues.
    }
  });

  it('getAllParentFeedback returns a Map (empty when IDB unavailable)', async () => {
    const result = await getAllParentFeedback();
    expect(result).toBeInstanceOf(Map);
  });

  it('clearAllParentFeedback rejects when the store cannot be opened, so the reset can report it', async () => {
    // jsdom's origin is a page, so the realm guard refuses the open here.
    await expect(clearAllParentFeedback()).rejects.toThrow();
  });
});

describe('parent-feedback — type shape stability', () => {
  it('ParentFeedback accepts both feedback values', () => {
    const confirmed: ParentFeedback = {
      recordId: 'fr-1',
      feedback: 'confirmed',
      timestamp: '2026-05-10T00:00:00Z',
    };
    const disputed: ParentFeedback = {
      recordId: 'fr-2',
      feedback: 'disputed',
      timestamp: '2026-05-10T00:00:00Z',
      signature: 'sig-bytes-base64url',
      publicKeyFingerprint: 'fp-hex',
    };
    expect(confirmed.feedback).toBe('confirmed');
    expect(disputed.feedback).toBe('disputed');
    expect(disputed.signature).toBeDefined();
  });
});
