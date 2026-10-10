/** @vitest-environment jsdom */
// Day 4 Tier 2.2 — `logCancelEvent` chain-stamp.
//
// Asserts the cancel-record contract per VISION §1.1 forensic completeness:
//   • cancelled-stale: no analysis, empty techniques, aiSource='none'
//     (nobody produced a verdict; 'local' until 2026-09-05, known-issues M131)
//   • cancelled-batch-llm-failure: no analysis, aiSource='none', the model
//     that was asked kept on aiModel / aiProvider
//   • cancelled-mid-flight: analysis preserved, techniques carried over,
//     aiSource='cloud'
//   • verdict label round-trips into ForensicRecord.verdict
//   • detectionMode embeds the cancel reason ("cancel:<verdict>")
//   • addRecord is called via the same chain-write-lock path as flagged/pass
//
// Mocks the forensic store so the test exercises the canonical-payload + record
// shape without IDB. Mirrors the pattern in forensic-coverage.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/forensics/store', () => ({
  addRecord: vi.fn(async () => undefined),
  getChainState: vi.fn(async () => ({
    nextPosition: 5,
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

import { logCancelEvent } from '../../../src/forensics/logger';
import { addRecord } from '../../../src/forensics/store';
import type { AnalysisResult } from '../../../src/types/analysis';

const mockedAddRecord = vi.mocked(addRecord);

beforeEach(() => {
  mockedAddRecord.mockReset();
});

describe('logCancelEvent — Tier 2.2 chain-stamp contract', () => {
  it('cancelled-stale: no analysis, empty techniques, aiSource=none', async () => {
    await logCancelEvent({
      originalText: 'a post the user scrolled past',
      verdict: 'cancelled-stale',
      mode: 'teen',
      platform: 'twitter',
      author: '@u',
      postUrl: 'https://x.com/u/status/1',
    });

    expect(mockedAddRecord).toHaveBeenCalledTimes(1);
    const rec = mockedAddRecord.mock.calls[0][0];
    expect(rec.verdict).toBe('cancelled-stale');
    expect(rec.techniques).toEqual([]);
    expect(rec.overallScore).toBe(0);
    expect(rec.aiSource).toBe('none');
    expect(rec.neutralizedText).toBe('');
    expect(rec.detectionMode).toBe('cancel:cancelled-stale');
    expect(rec.id).toMatch(/^fr-cancel-/);
    expect(rec.chainPosition).toBe(5);
    expect(rec.prevRecordHash).toBe('prev-hash-stub');
    expect(rec.publicKeyFingerprint).toBe('stub-fp');
  });

  it('cancelled-mid-flight: analysis preserved (VISION §1.1 invariant)', async () => {
    const analysis: AnalysisResult = {
      postId: 'p1',
      techniques: [
        { technique: 'fear-appeal', present: true, confidence: 0.85, severity: 7, evidence: ['DEADLINE'] },
        { technique: 'shame-attack', present: false, confidence: 0, severity: 0, evidence: [] },
      ],
      overallScore: 7,
      overallConfidence: 0.85,
      isManipulative: true,
      processingTimeMs: 250,
    };

    await logCancelEvent({
      originalText: 'a post user scrolled past after AI returned',
      verdict: 'cancelled-mid-flight',
      analysis,
      mode: 'teen',
      platform: 'tiktok',
      aiModel: 'llama-3.1-8b-instant',
      aiProvider: 'groq',
    });

    expect(mockedAddRecord).toHaveBeenCalledTimes(1);
    const rec = mockedAddRecord.mock.calls[0][0];
    expect(rec.verdict).toBe('cancelled-mid-flight');
    // Only confirmed techniques (confidence>0) carry into the chain — same
    // contract as logForensicEvent / logPassEvent.
    expect(rec.techniques.length).toBe(1);
    expect(rec.techniques[0].name).toBe('fear-appeal');
    expect(rec.techniques[0].severity).toBe(7);
    expect(rec.techniques[0].confidence).toBeCloseTo(0.85);
    expect(rec.overallScore).toBe(7);
    expect(rec.aiSource).toBe('cloud');
    expect(rec.aiModel).toBe('llama-3.1-8b-instant');
    expect(rec.aiProvider).toBe('groq');
    expect(rec.detectionMode).toBe('cancel:cancelled-mid-flight');
  });

  it('cancelled-batch-llm-failure: the provider was asked and did not answer, so nobody produced the verdict', async () => {
    // The owner's 2026-09-05 export: 18 YouTube comments whose batch call
    // failed at 02:00 said aiSource 'local' and named gpt-oss-20b, which the
    // record type reads as an on-device model's verdict (known-issues M131).
    // The model that was asked stays on the record; the source says 'none'.
    await logCancelEvent({
      originalText: 'a comment in a batch the provider never answered',
      verdict: 'cancelled-batch-llm-failure',
      analysis: undefined,
      mode: 'adult',
      platform: 'youtube',
      kind: 'comment',
      parentVideoId: 'yt-vid-1',
      aiModel: 'openai/gpt-oss-20b',
      aiProvider: 'groq',
      failureKind: 'network',
    });

    const rec = mockedAddRecord.mock.calls[0][0];
    expect(rec.verdict).toBe('cancelled-batch-llm-failure');
    expect(rec.aiSource).toBe('none');
    expect(rec.aiModel).toBe('openai/gpt-oss-20b');
    expect(rec.aiProvider).toBe('groq');
    expect(rec.failureKind).toBe('network');
    expect(rec.techniques).toEqual([]);
    expect(rec.overallScore).toBe(0);
  });

  it('cancelled-batch-truncated: the provider answered with no slot for this item, so nobody produced its verdict', async () => {
    await logCancelEvent({
      originalText: 'the last comment of a batch whose answer stopped early',
      verdict: 'cancelled-batch-truncated',
      mode: 'teen',
      platform: 'tiktok',
      kind: 'comment',
      aiModel: 'openai/gpt-oss-20b',
      aiProvider: 'groq',
    });

    const rec = mockedAddRecord.mock.calls[0][0];
    expect(rec.aiSource).toBe('none');
    expect(rec.aiModel).toBe('openai/gpt-oss-20b');
  });

  it('cancelled-dom-recycled: future T2.3 verdict supported by the same path', async () => {
    // T2.3 (anchor-revalidation render-gate) emits cancelled-dom-recycled when
    // the platform's virtualizer recycles a DOM node mid-flight. Same logger
    // path; this test pins the verdict-string round-trip so T2.3 lands cleanly.
    await logCancelEvent({
      originalText: 'recycled-DOM victim post',
      verdict: 'cancelled-dom-recycled',
      mode: 'child',
      platform: 'instagram',
    });

    const rec = mockedAddRecord.mock.calls[0][0];
    expect(rec.verdict).toBe('cancelled-dom-recycled');
    expect(rec.detectionMode).toBe('cancel:cancelled-dom-recycled');
  });

  it('cancelled-dom-gone: future T2.3 verdict supported by the same path', async () => {
    await logCancelEvent({
      originalText: 'GC-collected DOM post',
      verdict: 'cancelled-dom-gone',
      mode: 'child',
      platform: 'facebook',
    });

    const rec = mockedAddRecord.mock.calls[0][0];
    expect(rec.verdict).toBe('cancelled-dom-gone');
    expect(rec.detectionMode).toBe('cancel:cancelled-dom-gone');
  });

  it('chain anchor stamped on first record (chainPosition=0 path)', async () => {
    const { getChainState } = await import('../../../src/forensics/store');
    vi.mocked(getChainState).mockResolvedValueOnce({
      nextPosition: 0,
      prevRecordHash: 'feelingwise-chain-genesis-v1',
    });

    await logCancelEvent({
      originalText: 'first record after a fresh install',
      verdict: 'cancelled-stale',
      mode: 'teen',
      platform: 'twitter',
    });

    const rec = mockedAddRecord.mock.calls[0][0];
    expect(rec.chainAnchor).toBe('genesis-v1');
    expect(rec.chainPosition).toBe(0);
  });

  it('non-genesis records omit chainAnchor (chainPosition>0 path)', async () => {
    await logCancelEvent({
      originalText: 'record 5 of an existing chain',
      verdict: 'cancelled-stale',
      mode: 'teen',
      platform: 'twitter',
    });

    const rec = mockedAddRecord.mock.calls[0][0];
    expect(rec.chainAnchor).toBeUndefined();
    expect(rec.chainPosition).toBe(5);
  });

  it('kind + parentVideoId carry into the chain record', async () => {
    await logCancelEvent({
      originalText: 'caption record',
      verdict: 'cancelled-mid-flight',
      analysis: {
        postId: 'p1',
        techniques: [],
        overallScore: 0,
        overallConfidence: 0.5,
        isManipulative: false,
        processingTimeMs: 100,
      },
      mode: 'teen',
      platform: 'tiktok',
      kind: 'video',
      parentVideoId: 'video-42',
    });

    const rec = mockedAddRecord.mock.calls[0][0];
    expect(rec.kind).toBe('video');
    expect(rec.parentVideoId).toBe('video-42');
  });
});
