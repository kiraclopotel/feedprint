/** @vitest-environment jsdom */
// A comment the batch flagged and a model rewrote carries the page's AI mark once the rewrite is on
// the page, naming the model that wrote it: the batch's own reply when the rewrite came inline (the
// retry's, when a cut reply was asked again), the rewrite call's reply when it did not. The record
// of that comment names the same model. The flush runs for real; only the two model calls and the
// record's delivery are stubbed.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return {
    ...actual,
    getSettings: vi.fn(async () => ({ mode: 'teen', outputLanguage: 'auto', dailyCap: 200 })),
    isFeatureEnabled: vi.fn(() => true),
    isCommentRewriteEnabled: vi.fn(() => true),
  };
});
vi.mock('../../../../src/content/record/forensic-retry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/content/record/forensic-retry')>();
  return { ...actual, sendHighStakesForensicLog: vi.fn(async () => 'accepted' as const) };
});
vi.mock('../../../../src/core/lang-detect', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/core/lang-detect')>();
  return { ...actual, resolvePromptLanguage: vi.fn(async () => 'English') };
});

const ORIGINAL = 'You are completely useless and everyone here knows it, just stop posting.';
const REWRITE = 'I do not think this is working, and I would rather you posted less of it.';
const BATCH_MODEL = 'openai/gpt-oss-20b';
const REWRITER_MODEL = 'openai/gpt-oss-20b-rewriter';
const RETRY_MODEL = 'openai/gpt-oss-120b-second-rung';
const inline = { current: true };
/** The models that answered the batch's calls, in order: one, or a cut reply and its retry. */
const batchAnswers = { current: [BATCH_MODEL] };

vi.mock('../../../../src/ai/neutralize-only', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/ai/neutralize-only')>();
  return {
    ...actual,
    neutralizeText: vi.fn(async (input: { onWriter?: (model: string) => void }) => {
      input.onWriter?.(REWRITER_MODEL);
      return REWRITE;
    }),
  };
});
vi.mock('../../../../src/analysis/comment-batch-scorer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/analysis/comment-batch-scorer')>();
  const { noteCallProvenance } = await import('../../../../src/ai/call-provenance');
  return {
    ...actual,
    scoreBatch: vi.fn(async (_encounter: unknown, _mode: unknown, signal?: AbortSignal) => {
      for (const model of batchAnswers.current) noteCallProvenance(signal, { model, provider: 'deepinfra' });
      return {
        comments: [{
          index: 1,
          technique: 'shame-attack',
          severity: 6,
          sentiment: 'negative',
          confidence: 0.9,
          ...(inline.current ? { neutralizedText: REWRITE } : {}),
        }],
        environment: {
          label: 'hostile-crowd', negativePct: 100, positivePct: 0, neutralPct: 0,
          dominantTechnique: 'shame-attack', toxicityScore: 6, slurPrevalencePct: 0,
          authorRecidivism: 'none', discourseQuality: 'poor', algorithmicAmplification: 'unknown',
        },
        batchSize: 1,
        failed: false,
        generationTimeMs: 900,
        truncatedIndices: [],
      } as unknown as import('../../../../src/analysis/comment-batch-scorer').BatchScoreResult;
    }),
    scoreRoom: vi.fn(async () => null),
  };
});

import {
  _enqueueCommentForBatchForTesting as enqueueComment,
  _setChildProtectionModeForTesting as setMode,
  _stampClassificationForTesting as stampClassification,
} from '../../../../src/content/index';
import { _resetViewportTrackerForTesting } from '../../../../src/content/post-path/viewport-tracker';
import { clearPendingCommentBatchState } from '../../../../src/content/comment-batch/queue';
import { _resetForensicDedupForTesting } from '../../../../src/content/record/forensic-gate';
import { sendHighStakesForensicLog } from '../../../../src/content/record/forensic-retry';
import { AI_MODEL_ATTR, AI_TEXT_ATTR } from '../../../../src/content/markers/ai-mark';
import type { FWMessage } from '../../../../src/types/messages';
import type { PostContent } from '../../../../src/types/post';

function makeComment(id: string, parentVideoId: string): { post: PostContent; textEl: HTMLElement } {
  const host = document.createElement('ytd-comment-view-model');
  const textEl = document.createElement('div');
  textEl.id = 'content-text';
  textEl.textContent = ORIGINAL;
  host.appendChild(textEl);
  document.body.appendChild(host);
  const post = {
    id, text: ORIGINAL, author: 'hostile-user', timestamp: '', platform: 'youtube',
    kind: 'top-comment', parentVideoId, depth: 1, domRef: new WeakRef(textEl),
  } as PostContent;
  return { post, textEl };
}

function rewriteRecord(): Record<string, unknown> | undefined {
  return vi.mocked(sendHighStakesForensicLog).mock.calls
    .map((c) => c[0] as FWMessage)
    .filter((m): m is Extract<FWMessage, { type: 'FORENSIC_LOG' }> => m.type === 'FORENSIC_LOG')
    .map((m) => m.payload as unknown as Record<string, unknown>)
    .find((p) => p.originalText === ORIGINAL);
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.useFakeTimers();
  _resetViewportTrackerForTesting();
  _resetForensicDedupForTesting();
  clearPendingCommentBatchState();
  setMode('teen');
  batchAnswers.current = [BATCH_MODEL];
});

afterEach(() => {
  setMode('adult');
  clearPendingCommentBatchState();
  _resetViewportTrackerForTesting();
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('a comment a model rewrote carries the AI mark', () => {
  it.each([
    ['inline in the batch reply', true, BATCH_MODEL],
    ['from the rewrite call', false, REWRITER_MODEL],
  ] as const)('a rewrite %s names the model that wrote it, on the page and in the record', async (_label, isInline, writer) => {
    inline.current = isInline;
    const { post, textEl } = makeComment(`yt-mark-${String(isInline)}`, `parent-mark-${String(isInline)}`);
    stampClassification(post);
    enqueueComment(post);
    await vi.advanceTimersByTimeAsync(2600);

    expect(textEl.textContent).toContain(REWRITE);
    expect(textEl.getAttribute(AI_TEXT_ATTR)).toBe('rewrite');
    expect(textEl.getAttribute(AI_MODEL_ATTR)).toBe(writer);

    const record = rewriteRecord();
    expect(record).toBeDefined();
    expect(record!.neutralizedText).toBe(REWRITE);
    const decision = record!.decision as { applied: string; rewrite: Record<string, unknown> } | undefined;
    expect(decision).toBeDefined();
    expect(decision!.applied).toBe('soften');
    expect(decision!.rewrite).toEqual({ attempted: true, outcome: 'applied', model: writer });
  });

  it('an inline rewrite from a retried batch names the model of the retry, not of the cut reply', async () => {
    inline.current = true;
    batchAnswers.current = [BATCH_MODEL, RETRY_MODEL];
    const { post, textEl } = makeComment('yt-mark-retry', 'parent-mark-retry');
    stampClassification(post);
    enqueueComment(post);
    await vi.advanceTimersByTimeAsync(2600);

    expect(textEl.textContent).toContain(REWRITE);
    expect(textEl.getAttribute(AI_MODEL_ATTR)).toBe(RETRY_MODEL);
    const decision = rewriteRecord()!.decision as { rewrite: Record<string, unknown> };
    expect(decision.rewrite).toEqual({ attempted: true, outcome: 'applied', model: RETRY_MODEL });
  });
});
