/** @vitest-environment jsdom */
// PROTECTION-PATH-4: an encounter-builder (or scoreBatch) throw inside
// flushBatch's outer try must not silently uncover the whole Child bucket.
//
// Before the fix (src/content/comment-batch/flush.ts:356-395, comment at
// 358-364), this branch unmarked nothing, recorded nothing and let the
// unconditional finally-block release run — the raw, harmful comment
// re-appeared in Child with no chain record and no way to re-score it later
// (the extraction stamp was never cleared). The fix: unmark the bucket for
// re-extraction, retain the Child covers (add every post to
// protectionsToRetain so the finally block's release loop skips them), and
// emit one CANCEL_LOG per comment with verdict='cancelled-batch-llm-failure',
// failureKind='internal-error'.
//
// The only prior lock (tests/unit/content/comment-batch/comment-hide-terminal-wiring.source.test.ts) reads
// flush.ts as TEXT and regexes for the pattern; it never imports or executes
// the function, so a regression that keeps the strings nearby but breaks the
// control flow (e.g. the catch stops running, or protectionsToRetain stops
// being populated) would not be caught. This test drives the REAL flushBatch
// through the production debounce timer and the real FlushDeps wired in
// content/index.ts, so it reacts to the actual runtime behavior.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return {
    ...actual,
    getSettings: vi.fn(async () => ({
      mode: 'child',
      outputLanguage: 'auto',
      dailyCap: 200,
    })),
    isFeatureEnabled: vi.fn(() => true),
    isCommentRewriteEnabled: vi.fn(() => true),
  };
});

vi.mock('../../../../src/content/record/encounter-builder', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/content/record/encounter-builder')>();
  return {
    ...actual,
    buildEncounterForFlushBatch: vi.fn(() => {
      throw new Error('simulated encounter-builder throw (PROTECTION-PATH-4 test)');
    }),
  };
});

vi.mock('../../../../src/content/record/forensic-retry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/content/record/forensic-retry')>();
  return {
    ...actual,
    sendHighStakesForensicLog: vi.fn(async () => 'accepted' as const),
  };
});

vi.mock('../../../../src/core/lang-detect', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/core/lang-detect')>();
  return {
    ...actual,
    resolvePromptLanguage: vi.fn(async () => 'English'),
  };
});

import {
  _enqueueCommentForBatchForTesting as enqueueComment,
  _setChildProtectionModeForTesting as setMode,
  _mountProtectionForTesting as mountProtection,
  _childProtectionActiveCountForTesting as activeCount,
  _releaseProtectionForTesting as releaseProtection,
} from '../../../../src/content/index';
import { _resetViewportTrackerForTesting } from '../../../../src/content/post-path/viewport-tracker';
import { clearPendingCommentBatchState } from '../../../../src/content/comment-batch/queue';
import { sendHighStakesForensicLog } from '../../../../src/content/record/forensic-retry';
import type { FWMessage } from '../../../../src/types/messages';
import type { PostContent } from '../../../../src/types/post';

// A YouTube-shaped comment: `ytd-comment-view-model` is the protection host
// (resolveProtectionHost) and the shell viewport-tracker's unmark walk looks
// for; the text element is the mutation anchor — mirrors
// tests/unit/content/comment-resolution-cache.test.ts's fixture, which is proven
// against this same production admission path.
function makeComment(id: string, parentVideoId: string, text: string): { post: PostContent; textEl: HTMLElement } {
  const host = document.createElement('ytd-comment-view-model');
  const textEl = document.createElement('div');
  textEl.id = 'content-text';
  textEl.textContent = text;
  host.appendChild(textEl);
  document.body.appendChild(host);
  const post: PostContent = {
    id,
    text,
    author: 'hostile-user',
    timestamp: '',
    platform: 'youtube',
    kind: 'top-comment',
    parentVideoId,
    depth: 1,
    domRef: new WeakRef(textEl),
  } as PostContent;
  return { post, textEl };
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.useFakeTimers();
  _resetViewportTrackerForTesting();
  clearPendingCommentBatchState();
});

afterEach(() => {
  setMode('adult');
  clearPendingCommentBatchState();
  _resetViewportTrackerForTesting();
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('PROTECTION-PATH-4 — encounter-builder throw inside flushBatch', () => {
  it('retains the Child cover and records a CANCEL_LOG instead of silently uncovering the bucket', async () => {
    setMode('child');
    const { post } = makeComment('yt-throw-1', 'parent-throw-1', 'a harmful comment awaiting a verdict');
    mountProtection(post, performance.now());
    expect(activeCount()).toBe(1);

    enqueueComment(post);
    // COMMENT_BATCH_DEBOUNCE_MS is 1500; advance past it so the real
    // flushBatch (bound with the real FlushDeps) actually runs.
    await vi.advanceTimersByTimeAsync(1600);

    // The throw must NOT release the cover: the raw text stays hidden.
    expect(activeCount()).toBe(1);

    // A CANCEL_LOG records the failure instead of the pre-fix silence.
    const cancelCall = vi
      .mocked(sendHighStakesForensicLog)
      .mock.calls.map((c) => c[0] as FWMessage)
      .find((m): m is Extract<FWMessage, { type: 'CANCEL_LOG' }> => m.type === 'CANCEL_LOG');
    expect(cancelCall).toBeDefined();
    expect(cancelCall!.payload.verdict).toBe('cancelled-batch-llm-failure');
    expect(cancelCall!.payload.failureKind).toBe('internal-error');
    expect(cancelCall!.payload.originalText).toBe(post.text);

    releaseProtection(post);
    expect(activeCount()).toBe(0);
  });
});
