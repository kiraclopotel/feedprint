// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _deferConsumedBatchForBudgetHoldForTesting as deferConsumedBatch,
  _enqueueCommentForBatchForTesting as enqueueComment,
  _peekPendingBatchPostIdsForTesting as pendingPostIds,
  _resetPendingBatchesForTesting as resetPendingBatches,
} from '../../../src/content/index';
import { _resetForTests as resetFlushBudget, recordFailure } from '../../../src/ai/global-flush-budget';
import type { PostContent } from '../../../src/types/post';

const FLUSH_PATH = 'src/content/comment-batch/flush.ts';
const QUEUE_PATH = 'src/content/comment-batch/queue.ts';
const source = readFileSync(resolve(process.cwd(), FLUSH_PATH), 'utf8');
const queueSource = readFileSync(resolve(process.cwd(), QUEUE_PATH), 'utf8');

// This file had no chrome stub, so every storage read inside the paths it
// drives rejected. That was invisible until 2026-09-19, when the settings read
// started going through getLocalWithRetry like every other reader: a rejected
// read now schedules a retry delay, and under fake timers that shows up in
// getTimerCount(). The count below is meant to be the batch's own debounce, so
// the fix is to stop the unrelated read from failing rather than to loosen the
// assertion.
beforeEach(() => {
  vi.stubGlobal('chrome', {
    storage: {
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      session: { get: async () => ({}), set: async () => {} },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
    runtime: { id: 'test' },
  });
});

afterEach(() => {
  resetPendingBatches();
  resetFlushBudget();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('M45 comment-batch hold wiring', () => {
  it('routes every debounce callback through the hold-aware flush scheduler', () => {
    expect(queueSource).toContain('function flushBatchWhenBudgetReady');
    expect(queueSource).not.toMatch(/setTimeout\(\(\) => \{ void flushBatch\(key\); \}/);
    expect(queueSource).toMatch(/function flushBatchWhenBudgetReady[\s\S]{0,500}isFlushBudgetHolding\(\)/);
  });

  it('rechecks the hold before removing the pending bucket', () => {
    expect(source).toMatch(
      /async function flushBatch[\s\S]{0,500}isFlushBudgetHolding\(\)[\s\S]{0,500}takePendingBatchForFlush/,
    );
  });

  it('requeues a consumed batch when the hold arms after flush entry', () => {
    vi.useFakeTimers();
    const makePost = (id: string): PostContent => ({
      id,
      platform: 'twitter',
      kind: 'comment',
      text: id,
      author: '',
      timestamp: '',
      parentVideoId: 'room-1',
      domRef: new WeakRef({} as HTMLElement),
    });
    const consumedPost = makePost('consumed');
    const newlyQueuedPost = makePost('newly-queued');
    expect(enqueueComment(newlyQueuedPost)).toBe(true);
    recordFailure(); recordFailure(); recordFailure();

    deferConsumedBatch('room-1', {
      posts: [consumedPost],
      caption: '',
      timer: null,
      videoUrl: '',
      feedSource: undefined,
      platform: 'twitter',
      videoAuthor: 'unknown',
    });

    expect(pendingPostIds('room-1')).toEqual(['consumed', 'newly-queued']);
    expect(vi.getTimerCount()).toBe(1);
    expect(source).toMatch(
      /failureKind === 'pre-llm-circuit-breaker'[\s\S]{0,300}deferConsumedBatchForBudgetHold[\s\S]{0,300}protectionsToRetain/,
    );
  });
});
