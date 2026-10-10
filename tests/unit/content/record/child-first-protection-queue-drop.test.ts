/** @vitest-environment jsdom */
// A queued post the queue gives up on (stale by age, evicted by the size cap)
// used to be uncovered with no record and no counter (audit PROTECTION-PATH-1).
// The queue's drop callback now writes a cancelled-stale CANCEL_LOG, mirrors
// the pipeline's own stale bookkeeping, and then releases the cover.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return {
    ...actual,
    getSettings: vi.fn(async () => ({ mode: 'child', uiLanguage: 'en', dailyCap: 200 })),
  };
});
vi.mock('../../../../src/content/record/forensic-retry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/content/record/forensic-retry')>();
  return {
    ...actual,
    sendHighStakesForensicLog: vi.fn(async () => 'accepted' as const),
  };
});
vi.mock('../../../../src/core/calibration', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/core/calibration')>()),
  getEffectiveThreshold: vi.fn(async () => 0.45),
}));

import {
  _onQueueDropForTesting as onQueueDrop,
  _setChildProtectionModeForTesting,
  _mountProtectionForTesting,
  _stampClassificationForTesting,
  _childProtectionActiveCountForTesting,
} from '../../../../src/content/index';
import { _resetForensicDedupForTesting } from '../../../../src/content/record/forensic-gate';
import { _resetDiagnosticsForTesting, _getDiagnosticCountersForTesting } from '../../../../src/diagnostics/diagnostics';
import { sendHighStakesForensicLog } from '../../../../src/content/record/forensic-retry';
import type { PostContent } from '../../../../src/types/post';

function makePost(id: string, text: string): { post: PostContent; article: HTMLElement } {
  const article = document.createElement('article');
  article.setAttribute('role', 'article');
  const textEl = document.createElement('div');
  textEl.dataset.testid = 'tweetText';
  textEl.textContent = text;
  article.appendChild(textEl);
  document.body.appendChild(article);
  const post = {
    id, text, author: '@someone', timestamp: '2026-08-23T00:00:00Z',
    platform: 'twitter', domRef: new WeakRef(textEl), kind: 'post',
  } as unknown as PostContent;
  return { post, article };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 5));
}

beforeEach(() => {
  _resetForensicDedupForTesting();
  _resetDiagnosticsForTesting();
  vi.mocked(sendHighStakesForensicLog).mockClear();
  document.body.innerHTML = '';
  _setChildProtectionModeForTesting('child');
});

describe('queue drop of a covered Child post', () => {
  it.each(['cancelled-stale', 'evicted-size-cap'] as const)('%s writes a cancelled-stale record, bumps the counter, releases the cover', async (reason) => {
    const { post, article } = makePost(`drop-${reason}`, `a post the queue gave up on: ${reason}`);
    _stampClassificationForTesting(post);
    _mountProtectionForTesting(post, performance.now());
    expect(_childProtectionActiveCountForTesting()).toBe(1);

    onQueueDrop(post, reason);
    await settle();

    expect(_childProtectionActiveCountForTesting()).toBe(0);
    expect(article.querySelector('.fw-provisional-shield')).toBeNull();
    const msg = vi.mocked(sendHighStakesForensicLog).mock.calls
      .map((c) => c[0] as { type: string; payload: { verdict?: string; originalText?: string; mode?: string } })
      .find((m) => m.type === 'CANCEL_LOG');
    expect(msg).toBeDefined();
    expect(msg?.payload.verdict).toBe('cancelled-stale');
    expect(msg?.payload.originalText).toBe(post.text);
    expect(msg?.payload.mode).toBe('child');
    expect(_getDiagnosticCountersForTesting().firstEncounterCancelStale).toBe(1);
  });

  it('failed and context-stop drops release the cover without a stale record', async () => {
    const { post } = makePost('drop-failed', 'a post whose processing rejected');
    _stampClassificationForTesting(post);
    _mountProtectionForTesting(post, performance.now());
    onQueueDrop(post, 'failed');
    await settle();
    expect(_childProtectionActiveCountForTesting()).toBe(0);
    expect(vi.mocked(sendHighStakesForensicLog)).not.toHaveBeenCalled();
  });

  it('the same item is not cancel-stamped twice; a second item with the same words is its own record (C5, 2026-09-13)', async () => {
    const a = makePost('dup-a', 'identical dropped text');
    const b = makePost('dup-b', 'identical dropped text');
    _stampClassificationForTesting(a.post);
    _stampClassificationForTesting(b.post);
    onQueueDrop(a.post, 'cancelled-stale');
    onQueueDrop(a.post, 'cancelled-stale');
    await settle();
    expect(vi.mocked(sendHighStakesForensicLog)).toHaveBeenCalledTimes(1);
    onQueueDrop(b.post, 'cancelled-stale');
    await settle();
    expect(vi.mocked(sendHighStakesForensicLog)).toHaveBeenCalledTimes(2);
  });
});
