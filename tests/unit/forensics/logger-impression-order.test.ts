/** @vitest-environment jsdom */
// `logForensicEvent` / `logPassEvent` / `logCancelEvent` impression-order
// threading contract (see IMPRESSION_LAYER_V1.md).
//
// Asserts the local observed-order fields (observedSequence + viewportSeenAt +
// surfaceSessionId) survive the input → chain-record mapping, and that omitting
// them leaves the fields undefined on the record (so legacy records + records
// where capture didn't fire hash byte-identically per canonical-payload's
// omit-when-undefined back-compat). Mocks store + signing + hasher so the test
// exercises record-shape mapping without IDB. Mirrors logger-source-labels.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/forensics/store', () => ({
  addRecord: vi.fn(async () => undefined),
  getChainState: vi.fn(async () => ({ nextPosition: 5, prevRecordHash: 'prev-hash-stub' })),
}));
vi.mock('../../../src/forensics/signing', () => ({
  signHash: vi.fn(async () => 'stub-signature'),
  getPublicKeyFingerprint: vi.fn(async () => 'stub-fp'),
}));
vi.mock('../../../src/forensics/hasher', () => ({
  sha256: vi.fn(async (s: string) => `hash-of-len-${s.length}`),
}));

import { logForensicEvent, logPassEvent, logCancelEvent, logEnvironmentEvent } from '../../../src/forensics/logger';
import { addRecord } from '../../../src/forensics/store';
import type { AnalysisResult } from '../../../src/types/analysis';

const mockedAddRecord = vi.mocked(addRecord);

const analysis: AnalysisResult = {
  postId: 'p-1',
  techniques: [{ technique: 'fear-appeal', present: true, confidence: 0.8, severity: 7, evidence: [] }],
  overallScore: 7,
  overallConfidence: 0.8,
  isManipulative: true,
  processingTimeMs: 0,
};

beforeEach(() => mockedAddRecord.mockReset());

describe('logForensicEvent — impression order', () => {
  it('threads observedSequence + viewportSeenAt + surfaceSessionId onto the record', async () => {
    await logForensicEvent({
      originalText: 'video caption',
      neutralizedText: 'rewritten',
      analysis,
      mode: 'teen',
      platform: 'tiktok',
      aiSource: 'cloud',
      observedSequence: 3,
      viewportSeenAt: '2026-06-25T10:00:00.000Z',
      surfaceSessionId: 'ss-abc-123',
    });
    const record = mockedAddRecord.mock.calls[0][0];
    expect(record.observedSequence).toBe(3);
    expect(record.viewportSeenAt).toBe('2026-06-25T10:00:00.000Z');
    expect(record.surfaceSessionId).toBe('ss-abc-123');
  });

  it('leaves the fields undefined when not provided (hash back-compat)', async () => {
    await logForensicEvent({
      originalText: 'plain post',
      neutralizedText: 'rewritten',
      analysis,
      mode: 'teen',
      platform: 'twitter',
      aiSource: 'cloud',
    });
    const record = mockedAddRecord.mock.calls[0][0];
    expect(record.observedSequence).toBeUndefined();
    expect(record.viewportSeenAt).toBeUndefined();
    expect(record.surfaceSessionId).toBeUndefined();
  });
});

describe('logPassEvent — impression order', () => {
  it('threads the fields onto a pass record', async () => {
    await logPassEvent({
      originalText: 'benign caption',
      analysis,
      mode: 'adult',
      platform: 'tiktok',
      aiSource: 'cloud',
      passReason: 'below-threshold',
      observedSequence: 7,
      viewportSeenAt: '2026-06-25T10:05:00.000Z',
      surfaceSessionId: 'ss-abc-123',
    });
    const record = mockedAddRecord.mock.calls[0][0];
    expect(record.observedSequence).toBe(7);
    expect(record.viewportSeenAt).toBe('2026-06-25T10:05:00.000Z');
    expect(record.surfaceSessionId).toBe('ss-abc-123');
  });
});

describe('logEnvironmentEvent — surface session', () => {
  const environment = {
    label: 'pile-on' as const,
    summary: 'pile-on room',
    dominantTechnique: null,
    negativePct: 70,
    positivePct: 10,
    neutralPct: 20,
    sampled: 12,
  };

  it('threads surfaceSessionId onto the environment record', async () => {
    await logEnvironmentEvent({
      platform: 'tiktok',
      mode: 'teen',
      parentVideoId: '123',
      videoCaption: 'caption',
      environment,
      surfaceSessionId: 'ss-abc-123',
    });
    const record = mockedAddRecord.mock.calls[0][0];
    expect(record.kind).toBe('environment');
    expect(record.surfaceSessionId).toBe('ss-abc-123');
    // Aggregate record — no single observed order applies.
    expect(record.observedSequence).toBeUndefined();
    expect(record.viewportSeenAt).toBeUndefined();
  });

  it('leaves surfaceSessionId undefined when not provided (hash back-compat)', async () => {
    await logEnvironmentEvent({
      platform: 'tiktok',
      mode: 'teen',
      parentVideoId: '123',
      videoCaption: 'caption',
      environment,
    });
    const record = mockedAddRecord.mock.calls[0][0];
    expect(record.surfaceSessionId).toBeUndefined();
  });
});

describe('logCancelEvent — impression order', () => {
  it('threads the fields onto a cancelled record', async () => {
    await logCancelEvent({
      originalText: 'scrolled-past video',
      verdict: 'cancelled-stale',
      mode: 'teen',
      platform: 'tiktok',
      observedSequence: 9,
      viewportSeenAt: '2026-06-25T10:06:00.000Z',
      surfaceSessionId: 'ss-abc-123',
    });
    const record = mockedAddRecord.mock.calls[0][0];
    expect(record.observedSequence).toBe(9);
    expect(record.viewportSeenAt).toBe('2026-06-25T10:06:00.000Z');
    expect(record.surfaceSessionId).toBe('ss-abc-123');
  });
});
