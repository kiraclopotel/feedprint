/** @vitest-environment jsdom */
// B7 unit 3 (P32), site 3 (S5): a throw in the comment flush, outside its two inner try blocks. The flush takes the
// bucket out of the pending map before its first await and runs the rest inside one try whose only clause was a finally:
// it settled every comment it was handed as released, so a throw left a Child cover off and the raw text on the page,
// and the rejection was unhandled (queue.ts starts the flush with `void flush(key)`). Now a throw keeps every cover the
// flush held, puts the comments back in the extraction pool like the two throw branches above it do, counts once and
// leaves nothing unhandled.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const state = vi.hoisted(() => ({
  breakEnvironment: false,
  added: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return {
    ...actual,
    getSettings: vi.fn(async () => ({ mode: 'child', outputLanguage: 'auto', dailyCap: 200, strictLanguage: true, features: {} })),
    isFeatureEnabled: vi.fn(() => true),
    isCommentRewriteEnabled: vi.fn(() => true),
  };
});
vi.mock('../../../../src/core/lang-detect', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/core/lang-detect')>()),
  resolvePromptLanguage: vi.fn(async () => 'English'),
}));
vi.mock('../../../../src/ai/neutralize-only', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/ai/neutralize-only')>()),
  neutralizeText: vi.fn(async () => 'a calmer way of saying it'),
}));
// The one place the test makes the flush throw: the batch result comes back without its environment, which the flush
// reads after scoring, outside the try that guards the scoring call.
vi.mock('../../../../src/analysis/comment-batch-scorer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/analysis/comment-batch-scorer')>();
  return {
    ...actual,
    scoreBatch: vi.fn(async () => ({
      comments: [{ index: 1, technique: 'none', severity: 0, sentiment: 'neutral', confidence: 0.9, reason: '' }],
      environment: state.breakEnvironment ? undefined : {
        label: 'healthy-discussion', negativePct: 0, positivePct: 50, neutralPct: 50, dominantTechnique: null, toxicityScore: 0,
        slurPrevalencePct: 0, authorRecidivism: 'none', discourseQuality: 'good', algorithmicAmplification: 'unknown', summary: '',
      },
      batchSize: 1, failed: false, generationTimeMs: 100, truncatedIndices: [],
    } as unknown as import('../../../../src/analysis/comment-batch-scorer').BatchScoreResult)),
    scoreRoom: vi.fn(async () => null),
  };
});
vi.mock('../../../../src/forensics/store', () => ({
  addRecord: vi.fn(async (r: Record<string, unknown>) => { state.added.push(r); }),
  getChainState: vi.fn(async () => ({ nextPosition: 0, prevRecordHash: '' })),
}));
vi.mock('../../../../src/forensics/hasher', () => ({ sha256: vi.fn(async (s: string) => `hash-of-len-${s.length}`) }));
vi.mock('../../../../src/forensics/signing', () => ({
  signHash: vi.fn(async () => 'stub-signature'),
  getPublicKeyFingerprint: vi.fn(async () => 'stub-fp'),
}));
vi.mock('../../../../src/content/record/forensic-retry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/content/record/forensic-retry')>();
  return { ...actual, sendHighStakesForensicLog: vi.fn(async () => 'accepted' as const) };
});

import {
  _enqueueCommentForBatchForTesting as enqueueComment,
  _setChildProtectionModeForTesting as setMode,
  _mountProtectionForTesting as mountProtection,
  _stampClassificationForTesting as stampClassification,
  _childProtectionActiveCountForTesting as coverCount,
} from '../../../../src/content/index';
import { _resetViewportTrackerForTesting } from '../../../../src/content/post-path/viewport-tracker';
import { clearPendingCommentBatchState, flushBatchWhenBudgetReady, pendingBatches, type PendingBatch } from '../../../../src/content/comment-batch/queue';
import { _resetForensicDedupForTesting } from '../../../../src/content/record/forensic-gate';
import { _resetDiagnosticsForTesting, _getDiagnosticCountersForTesting } from '../../../../src/diagnostics/diagnostics';
import type { PostContent } from '../../../../src/types/post';

function makeComment(id: string, parentVideoId: string, text: string): { post: PostContent; textEl: HTMLElement } {
  const host = document.createElement('ytd-comment-view-model');
  const textEl = document.createElement('div');
  textEl.id = 'content-text';
  textEl.textContent = text;
  host.appendChild(textEl);
  document.body.appendChild(host);
  host.dataset.fwCommentSeen = 'true';
  textEl.dataset.fwCommentSeen = 'true';
  const post = {
    id, text, author: 'some-user', timestamp: '', platform: 'youtube', kind: 'top-comment', parentVideoId, depth: 1, domRef: new WeakRef(textEl),
  } as unknown as PostContent;
  return { post, textEl };
}

const unhandled: unknown[] = [];
const onUnhandled = (e: unknown): void => { unhandled.push(e); };
let n = 0;

/** One ordinary comment, covered at Strict, through the real flush; returns after the flush has had its turns. */
async function runOne(): Promise<{ textEl: HTMLElement }> {
  state.added.length = 0;
  setMode('child');
  _resetForensicDedupForTesting();
  clearPendingCommentBatchState();
  document.body.innerHTML = '';
  const id = `yt-${++n}`;
  const { post, textEl } = makeComment(id, `parent-${id}`, `an ordinary remark about the video number ${n}`);
  mountProtection(post, performance.now());
  stampClassification(post);
  enqueueComment(post);
  for (let i = 0; i < 40; i++) await vi.advanceTimersByTimeAsync(250);
  await vi.advanceTimersByTimeAsync(500);
  return { textEl };
}

beforeEach(() => {
  state.breakEnvironment = false;
  unhandled.length = 0;
  _resetDiagnosticsForTesting();
  vi.useFakeTimers();
  _resetViewportTrackerForTesting();
  process.removeListener('unhandledRejection', onUnhandled);
  process.on('unhandledRejection', onUnhandled);
});
afterEach(() => {
  setMode('adult');
  clearPendingCommentBatchState();
  _resetViewportTrackerForTesting();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('a throw in the comment flush', () => {
  it('control: an ordinary flush judges the comment benign, lifts the cover and counts nothing', async () => {
    await runOne();
    await vi.advanceTimersByTimeAsync(10);
    expect(coverCount(), 'the cover is lifted').toBe(0);
    expect(_getDiagnosticCountersForTesting().commentFlushThrew).toBeUndefined();
    expect(unhandled).toEqual([]);
  });

  it('keeps the cover on, puts the comment back in the pool, counts once and leaves nothing unhandled', async () => {
    state.breakEnvironment = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { textEl } = await runOne();
    vi.useRealTimers();
    await new Promise((r) => setTimeout(r, 5));
    expect(coverCount(), 'the cover stays on').toBe(1);
    expect(_getDiagnosticCountersForTesting().commentFlushThrew, 'one counter moved, once').toBe(1);
    expect(textEl.dataset.fwCommentSeen, 'the comment is back in the extraction pool').toBeUndefined();
    expect(unhandled, 'nothing is left unhandled').toEqual([]);
    warn.mockRestore();
    err.mockRestore();
  });

  it('the queue that starts the flush without waiting counts a rejection that gets past the flush, and leaves nothing unhandled', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    pendingBatches.set('k', { posts: [], caption: '', timer: null, videoUrl: '', feedSource: undefined, platform: 'youtube', videoAuthor: '' } as unknown as PendingBatch);
    flushBatchWhenBudgetReady('k', () => Promise.reject(new Error('injected: the flush rejected')));
    await vi.advanceTimersByTimeAsync(10);
    vi.useRealTimers();
    await new Promise((r) => setTimeout(r, 5));
    expect(_getDiagnosticCountersForTesting().commentFlushRejected, 'one counter moved, once').toBe(1);
    expect(unhandled, 'nothing is left unhandled').toEqual([]);
    warn.mockRestore();
  });
});
