/** @vitest-environment jsdom */
// When the reading is off by the person's own choice (the AI switch off, the Strict level, or no level chosen yet),
// the AI client answers 'cap-exhausted' with cap 'master-off'. The comment flush said "the master-off usage cap is
// reached" as a warning, so every install with the reading off showed it in the extension's Errors list. It is an
// info line now, with words that say what happened, and never a warning.

import { describe, it, expect, vi, afterEach } from 'vitest';

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

vi.mock('../../../../src/analysis/comment-batch-scorer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/analysis/comment-batch-scorer')>();
  return {
    ...actual,
    scoreBatch: vi.fn(async () => ({
      comments: [],
      environment: null,
      batchSize: 1,
      failed: true,
      failureKind: 'cap-exhausted',
      cap: 'master-off',
      generationTimeMs: 0,
      truncatedIndices: [],
    }) as unknown as import('../../../../src/analysis/comment-batch-scorer').BatchScoreResult),
    scoreRoom: vi.fn(async () => null),
  };
});

import {
  _enqueueCommentForBatchForTesting as enqueueComment,
  _stampClassificationForTesting as stampClassification,
} from '../../../../src/content/index';
import { clearPendingCommentBatchState } from '../../../../src/content/comment-batch/queue';
import type { PostContent } from '../../../../src/types/post';

function makeComment(id: string, parentVideoId: string, text: string): PostContent {
  const host = document.createElement('ytd-comment-view-model');
  const textEl = document.createElement('div');
  textEl.id = 'content-text';
  textEl.textContent = text;
  host.appendChild(textEl);
  document.body.appendChild(host);
  return {
    id, text, author: 'someone', timestamp: '', platform: 'youtube', kind: 'top-comment', parentVideoId, depth: 1,
    domRef: new WeakRef(textEl),
  } as PostContent;
}

afterEach(() => {
  clearPendingCommentBatchState();
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the reading off by the person\'s choice', () => {
  it('logs one info line that says so, and no warning about a usage cap', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const post = makeComment('yt-off-1', 'parent-off-1', 'an ordinary comment');
    stampClassification(post);
    enqueueComment(post);
    await vi.advanceTimersByTimeAsync(2600);

    const warned = warn.mock.calls.map((c) => String(c[0]));
    expect(warned.filter((w) => w.includes('[FW comment-batch]'))).toEqual([]);
    expect(warned.some((w) => /master-off usage cap/.test(w))).toBe(false);
    const said = info.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('[class=master-off]'));
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/the AI switch is off, the level is Strict, or no level is chosen yet/);
  });
});
