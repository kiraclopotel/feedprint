/** @vitest-environment jsdom */
// B7 unit 3 (P32), site 1 (S3): a throw while a detected post is prepared. The interceptor stamps the element as
// processed and hands the post to onPostDetected without waiting for it (`void onPostDetected(...)`), so a throw in the
// preparation (the wire fill, the stamps, the caches, the queue) was an unhandled rejection with nothing else: the element
// stayed stamped, so no later pass looked at it again, and at Strict its raw text stayed uncovered on the page. Now the
// post keeps (or gets) its cover, the stamp is removed so a later pass picks it up again, one counter moves and nothing
// is left unhandled.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const wire = vi.hoisted(() => ({ throwOnFill: false }));

vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return { ...actual, getSettings: vi.fn(async () => ({ mode: 'child', uiLanguage: 'en', dailyCap: 200 })) };
});
vi.mock('../../../../src/content/record/forensic-retry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/content/record/forensic-retry')>();
  return { ...actual, sendHighStakesForensicLog: vi.fn(async () => 'accepted' as const) };
});
vi.mock('../../../../src/storage/context-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/context-guard')>();
  return { ...actual, safeSendMessage: vi.fn(() => undefined) };
});
// The one place the test makes the preparation throw: the first thing onPostDetected does with the post.
vi.mock('../../../../src/content/page-world/wire-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/content/page-world/wire-store')>();
  return {
    ...actual,
    enrichPostFromWire: vi.fn((post: Parameters<typeof actual.enrichPostFromWire>[0]) => {
      if (wire.throwOnFill) throw new Error('injected: the wire fill threw');
      return actual.enrichPostFromWire(post);
    }),
  };
});

import {
  _onPostDetectedForTesting,
  _setQueueForTesting,
  _setChildProtectionModeForTesting,
  _childProtectionActiveCountForTesting,
} from '../../../../src/content/index';
import { _resetDiagnosticsForTesting, _getDiagnosticCountersForTesting } from '../../../../src/diagnostics/diagnostics';
import type { PostContent } from '../../../../src/types/post';
import type { ProcessingQueue } from '../../../../src/content/post-path/post-queue';

function makePost(id: string): { post: PostContent; textEl: HTMLElement } {
  const article = document.createElement('article');
  article.setAttribute('role', 'article');
  const textEl = document.createElement('div');
  textEl.dataset.testid = 'tweetText';
  textEl.textContent = `a post a moment ago: ${id}`;
  article.appendChild(textEl);
  document.body.appendChild(article);
  // What the interceptor does before it hands the post over.
  textEl.dataset.fwProcessed = 'true';
  const post = {
    id, text: textEl.textContent, author: '@someone', timestamp: '2026-09-30T00:00:00Z',
    platform: 'twitter', domRef: new WeakRef(textEl), kind: 'post',
  } as unknown as PostContent;
  return { post, textEl };
}

const unhandled: unknown[] = [];
const onUnhandled = (e: unknown): void => { unhandled.push(e); };

beforeEach(() => {
  wire.throwOnFill = false;
  unhandled.length = 0;
  document.body.innerHTML = '';
  _resetDiagnosticsForTesting();
  _setChildProtectionModeForTesting('child');
  _setQueueForTesting({ enqueue: vi.fn(() => true) } as unknown as ProcessingQueue);
  process.removeListener('unhandledRejection', onUnhandled);
  process.on('unhandledRejection', onUnhandled);
});

describe('a throw while a detected post is prepared', () => {
  it('control: with nothing throwing, the post is covered, stays stamped and no counter moves', async () => {
    const { post, textEl } = makePost('ok-1');
    await _onPostDetectedForTesting(post, performance.now());
    expect(_childProtectionActiveCountForTesting(), 'the post is covered').toBe(1);
    expect(textEl.dataset.fwProcessed, 'it stays stamped').toBe('true');
    expect(_getDiagnosticCountersForTesting().postPrepareThrew).toBeUndefined();
  });

  it('keeps the post covered, removes the processed stamp so a later pass picks it up, and counts once', async () => {
    wire.throwOnFill = true;
    const { post, textEl } = makePost('throw-1');
    await expect(_onPostDetectedForTesting(post, performance.now()), 'the call settles, it does not reject').resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 5));
    expect(_childProtectionActiveCountForTesting(), 'the post is covered').toBe(1);
    expect(textEl.dataset.fwProcessed, 'the stamp is removed').toBeUndefined();
    expect(_getDiagnosticCountersForTesting().postPrepareThrew, 'one counter moved, once').toBe(1);
    expect(unhandled, 'nothing is left unhandled').toEqual([]);
  });

  it('a throw from the queue itself does the same: the cover is back, the stamp is gone, one count', async () => {
    _setQueueForTesting({ enqueue: vi.fn(() => { throw new Error('injected: the queue threw'); }) } as unknown as ProcessingQueue);
    const { post, textEl } = makePost('throw-2');
    await expect(_onPostDetectedForTesting(post, performance.now())).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 5));
    expect(_childProtectionActiveCountForTesting(), 'the post is covered').toBe(1);
    expect(textEl.dataset.fwProcessed, 'the stamp is removed').toBeUndefined();
    expect(_getDiagnosticCountersForTesting().postPrepareThrew).toBe(1);
    expect(unhandled).toEqual([]);
  });

  it('outside Strict there is no cover to keep, but the stamp still goes and the count still moves', async () => {
    _setChildProtectionModeForTesting('teen');
    wire.throwOnFill = true;
    const { post, textEl } = makePost('throw-3');
    await expect(_onPostDetectedForTesting(post, performance.now())).resolves.toBeUndefined();
    expect(_childProtectionActiveCountForTesting()).toBe(0);
    expect(textEl.dataset.fwProcessed).toBeUndefined();
    expect(_getDiagnosticCountersForTesting().postPrepareThrew).toBe(1);
  });
});
