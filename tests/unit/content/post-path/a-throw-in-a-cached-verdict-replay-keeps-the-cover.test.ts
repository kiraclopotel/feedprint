/** @vitest-environment jsdom */
// B7 unit 3 (P32), site 1c (S3, named by critic 1 on site 1 and by the maker on site 1b): a throw while a cached verdict is
// replayed on a re-detected post. The detection door starts applyCachedVerdictDirect (a neutralize verdict seen earlier this
// session) and applyCachedHideCollapseDirect (a hide or collapse verdict) without waiting for them. Both have a try with only a
// finally, and the finally settles the cover as released, so a throw in either left the post uncovered, stamped as processed
// and with an unhandled rejection. Now the cover is put back, the stamp is removed so a later pass reads the post again, one
// counter moves and nothing is left unhandled.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const inject = vi.hoisted(() => ({ throwOnSettingsRead: false }));

vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return {
    ...actual,
    getSettings: vi.fn(async () => {
      if (inject.throwOnSettingsRead) throw new Error('injected: the settings read threw');
      return { mode: 'child', uiLanguage: 'en', dailyCap: 200 };
    }),
    isFeatureEnabled: vi.fn(() => true),
  };
});
vi.mock('../../../../src/content/record/forensic-retry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/content/record/forensic-retry')>();
  return { ...actual, sendHighStakesForensicLog: vi.fn(async () => 'accepted' as const) };
});
vi.mock('../../../../src/storage/context-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/context-guard')>();
  return { ...actual, safeSendMessage: vi.fn(() => undefined) };
});
vi.mock('../../../../src/content/injector', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/content/injector')>();
  return {
    ...actual,
    injectIntoElement: vi.fn(),
    injectCollapseOrHide: vi.fn(),
    injectAdHide: vi.fn(() => false),
    injectHardHide: vi.fn(() => true),
    markOnlyElement: vi.fn(),
  };
});

import {
  _onPostDetectedForTesting,
  _setQueueForTesting,
  _setChildProtectionModeForTesting,
  _childProtectionActiveCountForTesting,
  _setActiveAdapterForTesting,
} from '../../../../src/content/index';
import {
  sessionVerdictByPostId,
  sessionHideCollapseByPostId,
  sessionVerdictKey,
  _clearSessionVerdictCachesOnModeChangeForTesting,
} from '../../../../src/content/post-path/late-verdict-cache';
import { _resetDiagnosticsForTesting, _getDiagnosticCountersForTesting } from '../../../../src/diagnostics/diagnostics';
import type { AnalysisResult } from '../../../../src/types/analysis';
import type { NeutralizedContent } from '../../../../src/types/neutralization';
import type { PlatformAdapter } from '../../../../src/content/platforms/adapter';
import type { PostContent } from '../../../../src/types/post';
import type { ProcessingQueue } from '../../../../src/content/post-path/post-queue';

function makeAnalysis(): AnalysisResult {
  return {
    postId: 'cached',
    techniques: [{ technique: 'shame-attack' as never, present: true, confidence: 1, severity: 8, evidence: ['e'] }],
    overallScore: 8,
    overallConfidence: 1,
    isManipulative: true,
    processingTimeMs: 10,
    action: 'hide',
  };
}

function makePost(id: string): { post: PostContent; textEl: HTMLElement } {
  const article = document.createElement('article');
  article.setAttribute('role', 'article');
  const textEl = document.createElement('div');
  textEl.dataset.testid = 'tweetText';
  textEl.textContent = `a post seen before: ${id}`;
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

type Path = 'neutralize' | 'hide';

function makePostWithCachedVerdict(path: Path, id: string): { post: PostContent; textEl: HTMLElement } {
  const made = makePost(id);
  const key = sessionVerdictKey(made.post);
  if (path === 'neutralize') {
    sessionVerdictByPostId.set(key, {
      postId: id, originalHash: 'hash', rewrittenText: 'a calmer version', analysis: makeAnalysis(), aiSource: 'cloud', processingTimeMs: 10,
    } as unknown as NeutralizedContent);
  } else {
    sessionHideCollapseByPostId.set(key, { kind: 'hide', analysis: makeAnalysis(), originalText: made.post.text });
  }
  return made;
}

const unhandled: unknown[] = [];
const onUnhandled = (e: unknown): void => { unhandled.push(e); };
const enqueue = vi.fn(() => true);

const COUNTER: Record<Path, string> = { neutralize: 'cachedVerdictApplyThrew', hide: 'cachedHideCollapseApplyThrew' };

beforeEach(() => {
  inject.throwOnSettingsRead = false;
  unhandled.length = 0;
  enqueue.mockClear();
  document.body.innerHTML = '';
  _clearSessionVerdictCachesOnModeChangeForTesting();
  _resetDiagnosticsForTesting();
  _setChildProtectionModeForTesting('child');
  _setActiveAdapterForTesting({ platform: 'twitter' } as unknown as PlatformAdapter);
  _setQueueForTesting({ enqueue } as unknown as ProcessingQueue);
  process.removeListener('unhandledRejection', onUnhandled);
  process.on('unhandledRejection', onUnhandled);
});

for (const path of ['neutralize', 'hide'] as const) {
  describe(`a throw while a cached ${path} verdict is replayed on a re-detected post`, () => {
    it('control: with nothing throwing, the replay runs, the post stays stamped and no throw counter moves', async () => {
      const { post, textEl } = makePostWithCachedVerdict(path, `ok-${path}`);
      await _onPostDetectedForTesting(post, performance.now());
      await new Promise((r) => setTimeout(r, 30));
      const counters = _getDiagnosticCountersForTesting();
      expect(counters[COUNTER[path]]).toBeUndefined();
      expect(counters.postPrepareThrew).toBeUndefined();
      expect(textEl.dataset.fwProcessed, 'it stays stamped').toBe('true');
      expect(unhandled).toEqual([]);
    });

    it('keeps the post covered, removes the processed stamp, counts once and leaves nothing unhandled', async () => {
      inject.throwOnSettingsRead = true;
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { post, textEl } = makePostWithCachedVerdict(path, `throw-${path}`);
      await _onPostDetectedForTesting(post, performance.now());
      await new Promise((r) => setTimeout(r, 30));
      expect(_childProtectionActiveCountForTesting(), 'the post is covered').toBe(1);
      expect(textEl.dataset.fwProcessed, 'the stamp is removed').toBeUndefined();
      const counters = _getDiagnosticCountersForTesting();
      expect(counters[COUNTER[path]], 'one counter moved, once').toBe(1);
      expect(counters.postPrepareThrew, 'the throw came from the replay, not from the preparation').toBeUndefined();
      expect(unhandled, 'nothing is left unhandled').toEqual([]);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });
}

describe('outside Strict', () => {
  it('there is no cover to keep, but the stamp still goes and the count still moves', async () => {
    _setChildProtectionModeForTesting('teen');
    inject.throwOnSettingsRead = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { post, textEl } = makePostWithCachedVerdict('hide', 'throw-teen');
    await _onPostDetectedForTesting(post, performance.now());
    await new Promise((r) => setTimeout(r, 30));
    expect(_childProtectionActiveCountForTesting()).toBe(0);
    expect(textEl.dataset.fwProcessed).toBeUndefined();
    expect(_getDiagnosticCountersForTesting().cachedHideCollapseApplyThrew).toBe(1);
    expect(unhandled).toEqual([]);
    warn.mockRestore();
  });
});
