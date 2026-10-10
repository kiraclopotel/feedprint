/** @vitest-environment jsdom */
// `logForensicEvent` / `logPassEvent` source-label threading contract.
//
// Asserts the WHO-posted labels (accountType + sourceContainer) survive the
// input → chain-record mapping, and that omitting them leaves the fields
// undefined on the record (so legacy + person records hash byte-identically per
// canonical-payload's omit-when-undefined back-compat). Mocks store + signing +
// hasher so the test exercises record-shape mapping without IDB. Mirrors the
// pattern in logger-flagged-hidden.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/forensics/store', () => ({
  addRecord: vi.fn(async () => undefined),
  getChainState: vi.fn(async () => ({ nextPosition: 3, prevRecordHash: 'prev-hash-stub' })),
}));
vi.mock('../../../src/forensics/signing', () => ({
  signHash: vi.fn(async () => 'stub-signature'),
  getPublicKeyFingerprint: vi.fn(async () => 'stub-fp'),
}));
vi.mock('../../../src/forensics/hasher', () => ({
  sha256: vi.fn(async (s: string) => `hash-of-len-${s.length}`),
}));

import { logForensicEvent, logPassEvent } from '../../../src/forensics/logger';
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

describe('logForensicEvent — source labels', () => {
  it('threads accountType + sourceContainer onto the chain record', async () => {
    await logForensicEvent({
      originalText: 'group post text',
      neutralizedText: 'rewritten',
      analysis,
      mode: 'teen',
      platform: 'facebook',
      aiSource: 'cloud',
      accountType: 'group',
      sourceContainer: 'Example Hobby Group',
    });
    const record = mockedAddRecord.mock.calls[0][0];
    expect(record.accountType).toBe('group');
    expect(record.sourceContainer).toBe('Example Hobby Group');
  });

  it('leaves both fields undefined when not provided (hash back-compat)', async () => {
    await logForensicEvent({
      originalText: 'plain post',
      neutralizedText: 'rewritten',
      analysis,
      mode: 'teen',
      platform: 'twitter',
      aiSource: 'cloud',
    });
    const record = mockedAddRecord.mock.calls[0][0];
    expect(record.accountType).toBeUndefined();
    expect(record.sourceContainer).toBeUndefined();
  });
});

describe('logPassEvent — source labels', () => {
  it('threads accountType (advertiser) onto a pass record', async () => {
    await logPassEvent({
      originalText: 'sponsored copy',
      analysis,
      mode: 'adult',
      platform: 'instagram',
      aiSource: 'cloud',
      passReason: 'below-threshold',
      accountType: 'advertiser',
    });
    const record = mockedAddRecord.mock.calls[0][0];
    expect(record.accountType).toBe('advertiser');
    expect(record.sourceContainer).toBeUndefined();
  });
});
