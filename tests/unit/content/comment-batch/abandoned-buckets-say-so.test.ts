/** @vitest-environment jsdom */
// A pending comment bucket that is thrown away must leave a record behind.
//
// Comments sit in a 1500 ms debounce before the bucket is scored. Two things
// throw the bucket away inside that window and neither said anything:
//
//   • a route change or a mode change, through
//     clearPendingCommentBatchState() (comment-batch/queue.ts), which cleared
//     the map and noted nothing; and
//   • the tab closing, which had no pagehide handler for the buckets at all.
//
// These items are further along than anything the interceptor drops: already
// extracted, already stamped, already attributed to an author and a room. The
// interceptor notes a gap for every backlog of raw DOM nodes it drops
// (dom-interceptor.ts, backlog-overflow / backlog-hidden); this larger and more
// specific loss vanished.
//
// The statement is per comment, not a bound: the content realm still holds each
// item, so the chain can name it. 'cancelled-stale' is the verdict the chain
// already defines for exactly this — "FW observed this post but didn't classify
// it before the user scrolled past" (types/forensic.ts).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../../src/content/record/forensic-retry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/content/record/forensic-retry')>();
  return {
    ...actual,
    sendHighStakesForensicLog: vi.fn(async () => 'accepted' as const),
  };
});

vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return {
    ...actual,
    getSettings: vi.fn(async () => ({
      mode: 'child',
      outputLanguage: 'auto',
      dailyCap: 200,
      features: {},
    })),
    isFeatureEnabled: vi.fn(() => true),
    isCommentRewriteEnabled: vi.fn(() => true),
  };
});

import {
  enqueueCommentForBatch,
  clearPendingCommentBatchState,
  installCommentBatchUnloadStatement,
  _statePendingCommentBatchesOnUnloadForTesting,
} from '../../../../src/content/comment-batch/queue';
import { _resetViewportTrackerForTesting } from '../../../../src/content/post-path/viewport-tracker';
import { _resetForensicDedupForTesting } from '../../../../src/content/record/forensic-gate';
import { sendHighStakesForensicLog } from '../../../../src/content/record/forensic-retry';
import type { FWMessage } from '../../../../src/types/messages';
import type { PostContent } from '../../../../src/types/post';

function makeComment(id: string, text: string): PostContent {
  const host = document.createElement('ytd-comment-view-model');
  const textEl = document.createElement('div');
  textEl.id = 'content-text';
  textEl.textContent = text;
  host.appendChild(textEl);
  document.body.appendChild(host);
  return {
    id,
    text,
    author: 'someone',
    timestamp: '',
    platform: 'youtube',
    kind: 'top-comment',
    parentVideoId: 'parent-abandoned',
    depth: 1,
    domRef: new WeakRef(textEl),
  } as PostContent;
}

function cancelsSent(): Array<Extract<FWMessage, { type: 'CANCEL_LOG' }>> {
  return vi.mocked(sendHighStakesForensicLog).mock.calls
    .map((c) => c[0] as FWMessage)
    .filter((m): m is Extract<FWMessage, { type: 'CANCEL_LOG' }> => m.type === 'CANCEL_LOG');
}

const noFlush = async (): Promise<void> => {};

/** Let the one-shot settings read the queue kicks off on a new bucket land. */
async function settleModeRead(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(async () => {
  document.body.innerHTML = '';
  _resetViewportTrackerForTesting();
  _resetForensicDedupForTesting();
  clearPendingCommentBatchState();
  vi.clearAllMocks();
});

afterEach(() => {
  clearPendingCommentBatchState();
  _resetViewportTrackerForTesting();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('a pending bucket dropped on a route or mode change', () => {
  it('records every comment that was waiting in it', async () => {
    enqueueCommentForBatch(makeComment('yt-c1', 'the first comment still waiting'), noFlush);
    enqueueCommentForBatch(makeComment('yt-c2', 'the second comment still waiting'), noFlush);
    await settleModeRead();

    clearPendingCommentBatchState();

    const texts = cancelsSent().map((m) => m.payload.originalText).sort();
    expect(texts).toEqual([
      'the first comment still waiting',
      'the second comment still waiting',
    ]);
    expect(cancelsSent().every((m) => m.payload.verdict === 'cancelled-stale')).toBe(true);
  });

  it('says nothing when there was nothing pending', () => {
    clearPendingCommentBatchState();
    expect(cancelsSent()).toHaveLength(0);
  });

  it('does not write the same comment twice when the state is cleared again', async () => {
    enqueueCommentForBatch(makeComment('yt-c3', 'a comment cleared twice over'), noFlush);
    await settleModeRead();

    clearPendingCommentBatchState();
    clearPendingCommentBatchState();

    expect(cancelsSent()).toHaveLength(1);
  });
});

describe('a pending bucket on a closing tab', () => {
  it('records every comment that was waiting in it', async () => {
    installCommentBatchUnloadStatement();
    enqueueCommentForBatch(makeComment('yt-c4', 'a comment the tab closed on'), noFlush);
    await settleModeRead();

    _statePendingCommentBatchesOnUnloadForTesting();

    const cancels = cancelsSent();
    expect(cancels).toHaveLength(1);
    expect(cancels[0].payload.originalText).toBe('a comment the tab closed on');
    expect(cancels[0].payload.verdict).toBe('cancelled-stale');
  });

  it('is wired to pagehide by the first bucket, not only by a test hook', async () => {
    // No explicit install here: opening a bucket is what arms the handler.
    enqueueCommentForBatch(makeComment('yt-c5', 'a comment the real event closed on'), noFlush);
    await settleModeRead();

    window.dispatchEvent(new Event('pagehide'));

    expect(cancelsSent().map((m) => m.payload.originalText)).toEqual([
      'a comment the real event closed on',
    ]);
  });
});
