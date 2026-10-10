/** @vitest-environment jsdom */
// `logForensicEvent` slur-tier hide chain-stamp contract.
//
// Asserts that records with `analysis.action === 'hide'` (slur-tier identity-
// slur comments removed from the kid's view via `display:none`) carry an
// explicit `verdict: 'flagged-hidden'` in the chain so a parent reviewing the
// dashboard or running an export can filter "show me the slurs FW hid" apart
// from "show me the manipulation FW rewrote." Per the 2026-05-08 forensic-
// completeness mandate: even hidden slurs must be on record, with the original
// verbatim slur text preserved as evidence the kid was exposed.
//
// Mocks the forensic store + signing + hasher so the test exercises the
// canonical-payload + record-shape mapping without IDB. Mirrors the pattern in
// logger-cancel.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/forensics/store', () => ({
  addRecord: vi.fn(async () => undefined),
  getChainState: vi.fn(async () => ({
    nextPosition: 7,
    prevRecordHash: 'prev-hash-stub',
  })),
}));
vi.mock('../../../src/forensics/signing', () => ({
  signHash: vi.fn(async () => 'stub-signature'),
  getPublicKeyFingerprint: vi.fn(async () => 'stub-fp'),
}));
vi.mock('../../../src/forensics/hasher', () => ({
  sha256: vi.fn(async (s: string) => `hash-of-len-${s.length}`),
}));

import { logForensicEvent } from '../../../src/forensics/logger';
import { addRecord } from '../../../src/forensics/store';
import type { AnalysisResult } from '../../../src/types/analysis';

const mockedAddRecord = vi.mocked(addRecord);

beforeEach(() => {
  mockedAddRecord.mockReset();
});

describe('logForensicEvent — slur-tier hide verdict mapping', () => {
  it('analysis.action="hide" → verdict="flagged-hidden" in chain record', async () => {
    const analysis: AnalysisResult = {
      postId: 'cmt-1',
      techniques: [
        { technique: 'shame-attack', present: true, confidence: 0.9, severity: 9, evidence: [] },
      ],
      overallScore: 9,
      overallConfidence: 0.9,
      isManipulative: true,
      processingTimeMs: 0,
      action: 'hide',
    };

    await logForensicEvent({
      originalText: 'BROKE NIGGA you trash mf', // slur preserved verbatim — evidence
      neutralizedText: '',                       // empty for hides
      analysis,
      mode: 'teen',
      platform: 'twitter',
      aiSource: 'cloud',
      author: '@synthetic_child_b',
      postUrl: 'https://x.com/.../status/123',
    });

    expect(mockedAddRecord).toHaveBeenCalledTimes(1);
    const record = mockedAddRecord.mock.calls[0][0];
    expect(record.verdict).toBe('flagged-hidden');
    // Original slur text MUST be preserved verbatim — it's the evidence.
    expect(record.originalText).toBe('BROKE NIGGA you trash mf');
    expect(record.author).toBe('@synthetic_child_b');
    expect(record.techniques).toEqual([
      { name: 'shame-attack', severity: 9, confidence: 0.9 },
    ]);
    expect(record.neutralizedText).toBe('');
  });

  it('analysis.action="rewrite" → verdict="flagged" (existing path unchanged)', async () => {
    const analysis: AnalysisResult = {
      postId: 'cmt-2',
      techniques: [
        { technique: 'shame-attack', present: true, confidence: 0.85, severity: 8, evidence: [] },
      ],
      overallScore: 8,
      overallConfidence: 0.85,
      isManipulative: true,
      processingTimeMs: 0,
      action: 'rewrite',
    };

    await logForensicEvent({
      originalText: 'Trash like you needs to get taken out',
      neutralizedText: 'You should consider changing your behavior.',
      analysis,
      mode: 'teen',
      platform: 'twitter',
      aiSource: 'cloud',
      author: '@synthetic_child_f',
      postUrl: 'https://x.com/.../status/456',
    });

    const record = mockedAddRecord.mock.calls[0][0];
    expect(record.verdict).toBe('flagged');
    expect(record.neutralizedText).toBe('You should consider changing your behavior.');
  });

  it('analysis.action undefined → verdict="flagged" (legacy + non-hide-action paths unchanged)', async () => {
    const analysis: AnalysisResult = {
      postId: 'cmt-3',
      techniques: [
        { technique: 'fear-appeal', present: true, confidence: 0.7, severity: 7, evidence: [] },
      ],
      overallScore: 7,
      overallConfidence: 0.7,
      isManipulative: true,
      processingTimeMs: 0,
      // action intentionally undefined
    };

    await logForensicEvent({
      originalText: 'You will never recover from this',
      neutralizedText: '',
      analysis,
      mode: 'teen',
      platform: 'twitter',
      aiSource: 'cloud',
    });

    const record = mockedAddRecord.mock.calls[0][0];
    expect(record.verdict).toBe('flagged');
  });
});
