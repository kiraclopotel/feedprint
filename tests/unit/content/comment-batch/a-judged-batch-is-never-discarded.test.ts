/** @vitest-environment jsdom */
// A batch that went stale after the model answered must still be accounted for.
//
// flushBatch removes the bucket from pendingBatches before it calls the model
// (comment-batch/queue.ts: takePendingBatchForFlush), so the bucket exists only
// in that call's locals. Every `if (!batchIsCurrent()) return;` after that point
// was a bare return: no record, no gap, and no un-marking for re-extraction, so
// the elements kept their seen stamp and were never read again. The finally
// block then settled every post as `{ record: 'batch' }`, which
// content/protection/settle-protection.ts defines as "the comment flush wrote
// this comment's record before reaching here" — so the Child cover came off on
// the strength of a record that was never written.
//
// The window is the model's own latency, 500 to 1400 ms, and the trigger is a
// route change or a mode change inside it. The error branch beside it
// (the encounter-builder throw, pinned by
// tests/unit/content/record/comment-batch-encounter-throw.test.ts) already did
// all three things; that branch is what established the shape of the fix.

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

// The model answers normally; the surface changes underneath while it does.
const goesStaleDuringTheCall = { current: false };
// The same, one stage later: the surface changes while the per-comment rewrite
// call is in flight, after the batch verdict is in hand.
const goesStaleDuringTheRewrite = { current: false };
// 'hide' routes the comment straight to the hide terminal; anything else sends
// it down the deferred rewrite path, which is where the flag records live.
const verdictAction = { current: 'hide' as string | undefined };

vi.mock('../../../../src/ai/neutralize-only', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/ai/neutralize-only')>();
  return {
    ...actual,
    neutralizeText: vi.fn(async () => {
      if (goesStaleDuringTheRewrite.current) bumpGeneration();
      return 'a calmer way of saying it';
    }),
  };
});
vi.mock('../../../../src/analysis/comment-batch-scorer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/analysis/comment-batch-scorer')>();
  return {
    ...actual,
    scoreBatch: vi.fn(async () => {
      if (goesStaleDuringTheCall.current) bumpGeneration();
      return {
        comments: [{
          index: 1,
          technique: 'shame-attack',
          severity: 8,
          sentiment: 'negative',
          confidence: 0.9,
          action: verdictAction.current,
        }],
        environment: {
          label: 'hostile-crowd',
          negativePct: 100,
          positivePct: 0,
          neutralPct: 0,
          dominantTechnique: 'shame-attack',
          toxicityScore: 9,
          slurPrevalencePct: 0,
          authorRecidivism: 'none',
          discourseQuality: 'poor',
          algorithmicAmplification: 'unknown',
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
  _mountProtectionForTesting as mountProtection,
  _childProtectionActiveCountForTesting as activeCount,
  _stampClassificationForTesting as stampClassification,
  _applyRuntimeStrictLanguageChangeForTesting as bumpGeneration,
} from '../../../../src/content/index';
import { _resetViewportTrackerForTesting } from '../../../../src/content/post-path/viewport-tracker';
import { clearPendingCommentBatchState } from '../../../../src/content/comment-batch/queue';
import { _resetForensicDedupForTesting } from '../../../../src/content/record/forensic-gate';
import { sendHighStakesForensicLog } from '../../../../src/content/record/forensic-retry';
import type { FWMessage } from '../../../../src/types/messages';
import type { PostContent } from '../../../../src/types/post';

// A YouTube-shaped comment, the same fixture the encounter-throw lock uses:
// `ytd-comment-view-model` is the protection host and the shell the
// viewport-tracker's unmark walk looks for; the text element is the anchor.
function makeComment(id: string, parentVideoId: string, text: string): { post: PostContent; host: HTMLElement; textEl: HTMLElement } {
  const host = document.createElement('ytd-comment-view-model');
  const textEl = document.createElement('div');
  textEl.id = 'content-text';
  textEl.textContent = text;
  host.appendChild(textEl);
  document.body.appendChild(host);
  // What the adapter leaves behind: without un-marking, these stamps keep the
  // comment out of every later extraction pass.
  host.dataset.fwCommentSeen = 'true';
  textEl.dataset.fwCommentSeen = 'true';
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
  return { post, host, textEl };
}

function messagesSent(): FWMessage[] {
  return vi.mocked(sendHighStakesForensicLog).mock.calls.map((c) => c[0] as FWMessage);
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.useFakeTimers();
  _resetViewportTrackerForTesting();
  _resetForensicDedupForTesting();
  clearPendingCommentBatchState();
  goesStaleDuringTheCall.current = false;
  goesStaleDuringTheRewrite.current = false;
  verdictAction.current = 'hide';
});

afterEach(() => {
  setMode('adult');
  clearPendingCommentBatchState();
  _resetViewportTrackerForTesting();
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('a comment batch that goes stale while the model is answering', () => {
  it('records every comment in the bucket instead of dropping it', async () => {
    setMode('child');
    const { post } = makeComment('yt-stale-1', 'parent-stale-1', 'a comment the model judged harmful');
    mountProtection(post, performance.now());
    stampClassification(post);

    goesStaleDuringTheCall.current = true;
    enqueueComment(post);
    await vi.advanceTimersByTimeAsync(1600);

    const written = messagesSent();
    expect(written.length).toBeGreaterThan(0);
    const cancel = written.find(
      (m): m is Extract<FWMessage, { type: 'CANCEL_LOG' }> => m.type === 'CANCEL_LOG',
    );
    expect(cancel).toBeDefined();
    expect(cancel!.payload.originalText).toBe('a comment the model judged harmful');
    // The model DID answer, so the honest verdict is the one the chain already
    // defines for a verdict that arrived and was never applied.
    expect(cancel!.payload.verdict).toBe('cancelled-mid-flight');
  });

  it('un-stamps the bucket so the comment is read again on the next pass', async () => {
    setMode('child');
    const { post, host, textEl } = makeComment('yt-stale-2', 'parent-stale-2', 'another comment the model judged');
    mountProtection(post, performance.now());
    stampClassification(post);

    goesStaleDuringTheCall.current = true;
    enqueueComment(post);
    await vi.advanceTimersByTimeAsync(1600);

    expect(textEl.dataset.fwCommentSeen).toBeUndefined();
    expect(host.dataset.fwCommentSeen).toBeUndefined();
  });

  it('keeps the Child cover rather than uncovering on a record nobody wrote', async () => {
    setMode('child');
    const { post } = makeComment('yt-stale-3', 'parent-stale-3', 'a third comment the model judged');
    mountProtection(post, performance.now());
    stampClassification(post);
    expect(activeCount()).toBe(1);

    goesStaleDuringTheCall.current = true;
    enqueueComment(post);
    await vi.advanceTimersByTimeAsync(1600);

    expect(activeCount()).toBe(1);
  });

  it('still does the ordinary thing when nothing goes stale', async () => {
    setMode('child');
    const { post } = makeComment('yt-fresh-1', 'parent-fresh-1', 'a comment judged on a surface that stayed put');
    mountProtection(post, performance.now());
    stampClassification(post);

    enqueueComment(post);
    await vi.advanceTimersByTimeAsync(2600);

    const written = messagesSent();
    // The comment was judged and acted on: its record is a verdict, not a cancel.
    expect(written.some((m) => m.type === 'FORENSIC_LOG')).toBe(true);
    expect(written.some((m) => m.type === 'CANCEL_LOG')).toBe(false);
  });
});

describe('a comment batch that goes stale while the rewrite is in flight', () => {
  // The flagged comments are the ones whose record is DEFERRED to the rewrite
  // pass, so the stale check after that pass was the one that dropped exactly
  // the harmful half of the bucket: the passes and the truncations already had
  // their records, the flags had none. Their verdict exists and the page showed
  // the original, so the honest record is the flag with the rewrite marked
  // failed — the shape the empty-rewrite branch beside it already writes.
  it('writes the deferred flag record rather than dropping it', async () => {
    setMode('teen');
    const { post } = makeComment('yt-rewrite-1', 'parent-rewrite-1', 'a flagged comment awaiting its reframe');
    stampClassification(post);

    verdictAction.current = undefined;
    goesStaleDuringTheRewrite.current = true;
    enqueueComment(post);
    await vi.advanceTimersByTimeAsync(2600);

    const flagged = messagesSent().find(
      (m): m is Extract<FWMessage, { type: 'FORENSIC_LOG' }> =>
        m.type === 'FORENSIC_LOG'
        && (m.payload as { originalText?: string }).originalText === 'a flagged comment awaiting its reframe',
    );
    expect(flagged).toBeDefined();
    // The reframe never reached the page, so the record must not carry it.
    expect((flagged!.payload as { neutralizedText?: string }).neutralizedText).toBe('');
  });
});
