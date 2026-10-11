/** @vitest-environment jsdom */
// A route, mode or strict-language change bumps the classification generation
// but used to leave the queue alone: stale posts were still paid for, their
// results were discarded at the generation check with no record, and the new
// surface's Child covers waited behind them (audit PROTECTION-PATH-2). Each
// bump now invalidates the queue. Every invalidated post leaves a
// cancelled-stale CANCEL_LOG; a Child post still on screen keeps its cover and
// is re-enqueued at the top of the visible tier under the new generation.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/storage/settings')>();
  return {
    ...actual,
    getSettings: vi.fn(async () => ({ mode: 'child', uiLanguage: 'en', dailyCap: 200, features: {} })),
  };
});
vi.mock('../../../src/content/record/forensic-retry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/content/record/forensic-retry')>();
  return {
    ...actual,
    sendHighStakesForensicLog: vi.fn(async () => 'accepted' as const),
  };
});
vi.mock('../../../src/core/calibration', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/core/calibration')>()),
  getEffectiveThreshold: vi.fn(async () => 0.45),
}));

import {
  _onProcessingResultForTesting as onProcessingResult,
  _onQueueDropForTesting as onQueueDrop,
  _setQueueForTesting,
  _setChildProtectionModeForTesting,
  _mountProtectionForTesting,
  _stampClassificationForTesting,
  _isCurrentClassificationForTesting,
  _childProtectionActiveCountForTesting,
  _applyRuntimeStrictLanguageChangeForTesting,
  _applyRuntimeModeChangeForTesting,
  clearPendingBatchesForRouteChange,
} from '../../../src/content/index';
import { ProcessingQueue, MAX_CONCURRENT } from '../../../src/content/post-path/post-queue';
import { _resetForensicDedupForTesting } from '../../../src/content/record/forensic-gate';
import { sendHighStakesForensicLog } from '../../../src/content/record/forensic-retry';
import type { PipelineResult } from '../../../src/analysis/pipeline';
import type { PostContent } from '../../../src/types/post';

function makePost(id: string, text: string, onScreen: boolean): { post: PostContent; article: HTMLElement } {
  const article = document.createElement('article');
  article.setAttribute('role', 'article');
  const textEl = document.createElement('div');
  textEl.dataset.testid = 'tweetText';
  textEl.textContent = text;
  article.appendChild(textEl);
  document.body.appendChild(article);
  const rect = onScreen
    ? { top: 100, bottom: 300, left: 0, right: 500, width: 500, height: 200, x: 0, y: 100, toJSON: () => ({}) }
    : { top: -900, bottom: -700, left: 0, right: 500, width: 500, height: 200, x: 0, y: -900, toJSON: () => ({}) };
  textEl.getBoundingClientRect = () => rect as DOMRect;
  const post = {
    id, text, author: '@someone', timestamp: '2026-08-23T00:00:00Z',
    platform: 'twitter', domRef: new WeakRef(textEl), kind: 'post',
  } as unknown as PostContent;
  return { post, article };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 5));
}

function cancelLogs(): Array<{ verdict?: string; originalText?: string }> {
  return vi.mocked(sendHighStakesForensicLog).mock.calls
    .map((c) => c[0] as { type: string; payload: { verdict?: string; originalText?: string } })
    .filter((m) => m.type === 'CANCEL_LOG')
    .map((m) => m.payload);
}

interface Harness {
  queue: ProcessingQueue;
  dispatched: PostContent[];
  resolvers: Map<PostContent, (r: PipelineResult) => void>;
}

function buildQueue(): Harness {
  const dispatched: PostContent[] = [];
  const resolvers = new Map<PostContent, (r: PipelineResult) => void>();
  const queue = new ProcessingQueue(
    (post) => {
      dispatched.push(post);
      return new Promise<PipelineResult>((resolve) => { resolvers.set(post, resolve); });
    },
    onProcessingResult,
    onQueueDrop,
  );
  _setQueueForTesting(queue);
  return { queue, dispatched, resolvers };
}

const bumps: Array<[string, () => void]> = [
  ['strict-language change', () => _applyRuntimeStrictLanguageChangeForTesting()],
  ['mode change', () => _applyRuntimeModeChangeForTesting('child')],
  ['route change', () => clearPendingBatchesForRouteChange('route')],
];

beforeEach(() => {
  // A live extension: with no runtime at all, the queue's first message send
  // reads the extension as gone and every Child cover is stranded.
  (globalThis as unknown as { chrome: unknown }).chrome = { runtime: { id: 'fw-test', sendMessage: vi.fn(async () => undefined) } };
  _resetForensicDedupForTesting();
  vi.mocked(sendHighStakesForensicLog).mockClear();
  document.body.innerHTML = '';
  _setChildProtectionModeForTesting('child');
});

describe.each(bumps)('%s invalidates the queue', (_label, bump) => {
  it('drops queued stale posts with a cancelled-stale record and keeps the visible Child cover by re-enqueueing it', async () => {
    const { queue, dispatched, resolvers } = buildQueue();
    // Fill every slot with unstamped work so the posts under test stay queued.
    const fillers: PostContent[] = [];
    for (let i = 0; i < MAX_CONCURRENT; i++) {
      const filler = makePost(`filler-${i}`, `filler text ${i}`, false).post;
      fillers.push(filler);
      queue.enqueue(filler, { state: 'visible', velocityPxPerSec: 0 });
    }
    expect(queue.active).toBe(MAX_CONCURRENT);

    const visible = makePost('visible-stale', 'a covered post still on screen', true);
    const offScreen = makePost('offscreen-stale', 'a post the reader scrolled past', false);
    for (const { post } of [visible, offScreen]) {
      _stampClassificationForTesting(post);
      _mountProtectionForTesting(post, performance.now());
      queue.enqueue(post, { state: 'scrolled-past', velocityPxPerSec: 0 }, { surfaceIdentity: 'classification-generation:old' });
    }
    expect(queue.pending).toBe(2);
    expect(_childProtectionActiveCountForTesting()).toBe(2);

    bump();
    await settle();

    // Both stale entries left the queue and left a record.
    expect(cancelLogs().map((p) => p.verdict)).toEqual(['cancelled-stale', 'cancelled-stale']);
    expect(cancelLogs().map((p) => p.originalText).sort()).toEqual([offScreen.post.text, visible.post.text].sort());
    // The visible post was re-stamped for the new generation and re-queued;
    // the off-screen one was not.
    expect(_isCurrentClassificationForTesting(visible.post)).toBe(true);
    expect(_isCurrentClassificationForTesting(offScreen.post)).toBe(false);
    expect(queue.pending).toBe(1);
    expect(visible.article.querySelector('.fw-provisional-shield')).not.toBeNull();

    // Once a slot frees, the re-enqueued visible post is dispatched ahead of
    // anything else, and its fresh result lands on the still-current post.
    resolvers.get(fillers[0])!({ action: 'pass' });
    await settle();
    expect(dispatched[dispatched.length - 1]).toBe(visible.post);
    expect(queue.pending).toBe(0);
  });

  it('flags in-flight stale posts: the paid result is discarded with a cancelled-stale record', async () => {
    const { queue, dispatched, resolvers } = buildQueue();
    const visible = makePost('inflight-visible', 'an in-flight post still on screen', true);
    _stampClassificationForTesting(visible.post);
    _mountProtectionForTesting(visible.post, performance.now());
    queue.enqueue(visible.post, { state: 'visible', velocityPxPerSec: 0 }, { surfaceIdentity: 'classification-generation:old' });
    expect(queue.active).toBe(1);
    expect(dispatched).toEqual([visible.post]);

    bump();
    // The stale call returns a hide that must never be applied under the new
    // generation; it is dropped, recorded, and the post re-queued.
    resolvers.get(visible.post)!({ action: 'hide', analysis: { techniques: [], overallConfidence: 1 } as never });
    await settle();

    expect(cancelLogs().map((p) => p.verdict)).toEqual(['cancelled-stale']);
    expect(visible.article.querySelector('.fw-provisional-shield')).not.toBeNull();
    expect(visible.article.querySelector('.fw-collapsed, .fw-hidden')).toBeNull();
    // Re-dispatched under the new generation: the same post object is the
    // second dispatch, on a fresh call.
    expect(dispatched).toEqual([visible.post, visible.post]);
    expect(_isCurrentClassificationForTesting(visible.post)).toBe(true);
  });
});
