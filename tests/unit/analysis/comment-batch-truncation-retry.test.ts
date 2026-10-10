// Comment-batch: naming the fail-closed state, and the one retry a confirmed
// max_tokens cut earns (2026-09-02).
//
// The owner's 2026-09-01 diagnostics carried repeated
// `[FW comment-batch] scoreBatch failed [class=provider-unparseable-json]`
// lines. That label was a console DEFAULT, not a measurement: `scoreBatch`
// called `failClosed` with no failureKind on both the unparseable path and
// the zero-verdicts path, so three different states printed one name and the
// chain record carried nothing. These tests pin:
//
//   1. a cut confirmed by `finish_reason: 'length'` with nothing salvageable
//      is retried ONCE with a doubled budget (the first call is otherwise a
//      total loss and every comment in the batch loses its judgement);
//   2. any other unparseable reply is NOT retried — a refusal or a shape
//      fault is reproduced by a repeat call, not fixed by it;
//   3. the retry is spent at most once;
//   4. both fail-closed states stamp their own failureKind, so the chain
//      record says which one happened.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/ai/client', () => ({
  callAI: vi.fn(),
}));

import {
  scoreBatch,
  encounterFromLegacyBatchInput,
  __resetBatchCacheForTests,
  BATCH_MAX_TOKENS,
  BATCH_TRUNCATION_RETRY_MAX_TOKENS,
} from '../../../src/analysis/comment-batch-scorer';
import { callAI, type GroqCallOutcome } from '../../../src/ai/client';
import { Ok } from '../../../src/ai/ai-error';
import { _resetForTests as resetFlushBudget } from '../../../src/ai/global-flush-budget';

const mockCallAI = callAI as unknown as ReturnType<typeof vi.fn>;

const input = {
  comments: [
    { author: 'alice', text: 'this is the first sample comment' },
    { author: 'bob', text: 'this is the second sample comment' },
  ],
  videoCaption: 'caption',
  language: 'English',
};

/** A reply cut mid-array before any verdict object closed — salvage recovers nothing. */
const CUT_BEFORE_ANY_VERDICT = '{"comments":[{"index":1,"technique":"mock';

function wellFormedReply(): string {
  return JSON.stringify({
    comments: [
      { index: 1, technique: 'mockery', sentiment: 'negative', severity: 6, confidence: 0.8, reason: 'r1', action: 'flag' },
      { index: 2, technique: 'supportive', sentiment: 'positive', severity: 0, confidence: 0.8, reason: 'r2', action: 'none' },
    ],
    environment: { label: 'healthy-discussion', summary: 'civil' },
  });
}

/**
 * Answer one `callAI` with `raw`, reporting `finishReason` through the
 * per-call `onCallMeta` sink the way the real client does.
 */
function reply(raw: string, finishReason: string, maxTokens: number) {
  return (_s: string, _u: string, _f: boolean, opts: { onCallMeta?: (m: GroqCallOutcome) => void }) => {
    opts?.onCallMeta?.({
      finishReason,
      truncated: finishReason === 'length',
      completionTokens: maxTokens,
      maxTokens,
    });
    return Promise.resolve(Ok(raw));
  };
}

beforeEach(() => {
  resetFlushBudget();
  mockCallAI.mockReset();
  __resetBatchCacheForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('confirmed max_tokens cut with nothing salvageable', () => {
  it('retries once with a bigger budget and uses the retry verdicts', async () => {
    mockCallAI
      .mockImplementationOnce(reply(CUT_BEFORE_ANY_VERDICT, 'length', BATCH_MAX_TOKENS))
      .mockImplementationOnce(reply(wellFormedReply(), 'stop', BATCH_TRUNCATION_RETRY_MAX_TOKENS));

    const result = await scoreBatch(encounterFromLegacyBatchInput(input));

    expect(mockCallAI).toHaveBeenCalledTimes(2);
    expect(mockCallAI.mock.calls[0][3].maxTokens).toBe(BATCH_MAX_TOKENS);
    expect(mockCallAI.mock.calls[1][3].maxTokens).toBe(BATCH_TRUNCATION_RETRY_MAX_TOKENS);
    expect(BATCH_TRUNCATION_RETRY_MAX_TOKENS).toBeGreaterThan(BATCH_MAX_TOKENS);
    expect(result.failed).toBe(false);
    expect(result.comments[0].technique).toBe('mockery');
    expect(result.truncatedIndices).toEqual([]);
  });

  it('spends the retry at most once — a second cut fails closed', async () => {
    mockCallAI.mockImplementation(reply(CUT_BEFORE_ANY_VERDICT, 'length', BATCH_MAX_TOKENS));

    const result = await scoreBatch(encounterFromLegacyBatchInput(input));

    expect(mockCallAI).toHaveBeenCalledTimes(2);
    expect(result.failed).toBe(true);
    expect(result.failureKind).toBe('provider-unparseable-json');
    expect(result.comments).toHaveLength(2);
  });

  it('does not retry when the cut left a complete verdict to salvage', async () => {
    const partial =
      '{"comments":[{"index":1,"technique":"mockery","sentiment":"negative","severity":6,'
      + '"confidence":0.8,"reason":"r1","action":"flag"},{"index":2,"technique":"sup';
    mockCallAI.mockImplementation(reply(partial, 'length', BATCH_MAX_TOKENS));

    const result = await scoreBatch(encounterFromLegacyBatchInput(input));

    expect(mockCallAI).toHaveBeenCalledTimes(1);
    expect(result.failed).toBe(false);
    expect(result.truncatedIndices).toEqual([2]);
  });
});

describe('an unparseable reply that was NOT cut', () => {
  it('is not retried and is stamped provider-unparseable-json', async () => {
    mockCallAI.mockImplementation(reply('I cannot help with that request.', 'stop', BATCH_MAX_TOKENS));

    const result = await scoreBatch(encounterFromLegacyBatchInput(input));

    expect(mockCallAI).toHaveBeenCalledTimes(1);
    expect(result.failed).toBe(true);
    expect(result.failureKind).toBe('provider-unparseable-json');
  });
});

describe('a well-formed reply carrying nothing', () => {
  it('is stamped provider-empty-verdicts, not unparseable', async () => {
    mockCallAI.mockImplementation(reply('{"comments":[]}', 'stop', BATCH_MAX_TOKENS));

    const result = await scoreBatch(encounterFromLegacyBatchInput(input));

    expect(mockCallAI).toHaveBeenCalledTimes(1);
    expect(result.failed).toBe(true);
    expect(result.failureKind).toBe('provider-empty-verdicts');
    expect(result.comments).toHaveLength(2);
  });
});
