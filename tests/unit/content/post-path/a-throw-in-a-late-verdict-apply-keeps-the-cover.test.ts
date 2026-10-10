/** @vitest-environment jsdom */
// B7 unit 3 (P32), site 1b (S3, named by critic 1 on site 1): a throw while a stored late verdict is applied to a
// re-detected post. The detection door starts applyLateVerdictDirect without waiting for it (`void applyLateVerdictDirect`),
// the cover is already up, and the function has no catch: a throw in it was an unhandled rejection with nothing else, on
// an element stamped as processed that no later pass would read again. Now the post keeps its cover, the stamp is removed
// so a later pass reads it again, one counter moves and nothing is left unhandled.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const inject = vi.hoisted(() => ({ throwOnRecovered: false }));

vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return {
    ...actual,
    getSettings: vi.fn(async () => ({ mode: 'child', uiLanguage: 'en', dailyCap: 200 })),
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
// The one place the test makes the apply throw: the first thing applyLateVerdictDirect does (the recovery count).
vi.mock('../../../../src/diagnostics/diagnostics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/diagnostics/diagnostics')>();
  return {
    ...actual,
    bumpCounter: vi.fn((name: string, n?: number): void => {
      if (inject.throwOnRecovered && name === 'firstEncounterRecovered') throw new Error('injected: the late apply threw');
      actual.bumpCounter(name, n);
    }),
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
  lateVerdictFromCancelledAnalysis,
  _storeLateVerdictRealForTesting,
  _peekLateVerdictForTesting,
  _sessionVerdictKeyForTesting,
  _clearSessionVerdictCachesOnModeChangeForTesting,
} from '../../../../src/content/post-path/late-verdict-cache';
import { _resetDiagnosticsForTesting, _getDiagnosticCountersForTesting } from '../../../../src/diagnostics/diagnostics';
import type { AnalysisResult } from '../../../../src/types/analysis';
import type { PlatformAdapter } from '../../../../src/content/platforms/adapter';
import type { PostContent } from '../../../../src/types/post';
import type { ProcessingQueue } from '../../../../src/content/post-path/post-queue';

function makeAnalysis(): AnalysisResult {
  return {
    postId: 'late',
    techniques: [{ technique: 'shame-attack' as never, present: true, confidence: 1, severity: 8, evidence: ['e'] }],
    overallScore: 8,
    overallConfidence: 1,
    isManipulative: true,
    processingTimeMs: 10,
    action: 'hide',
  };
}

function makePostWithLateVerdict(id: string): { post: PostContent; textEl: HTMLElement } {
  const article = document.createElement('article');
  article.setAttribute('role', 'article');
  const textEl = document.createElement('div');
  textEl.dataset.testid = 'tweetText';
  textEl.textContent = `a post that came back: ${id}`;
  article.appendChild(textEl);
  document.body.appendChild(article);
  // What the interceptor does before it hands the post over.
  textEl.dataset.fwProcessed = 'true';
  const post = {
    id, text: textEl.textContent, author: '@someone', timestamp: '2026-09-30T00:00:00Z',
    platform: 'twitter', domRef: new WeakRef(textEl), kind: 'post',
  } as unknown as PostContent;
  const late = lateVerdictFromCancelledAnalysis(makeAnalysis());
  if (!late) throw new Error('the test verdict must be actionable');
  _storeLateVerdictRealForTesting(post, late);
  return { post, textEl };
}

const unhandled: unknown[] = [];
const onUnhandled = (e: unknown): void => { unhandled.push(e); };
const enqueue = vi.fn(() => true);

beforeEach(() => {
  inject.throwOnRecovered = false;
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

describe('a throw while a stored late verdict is applied to a re-detected post', () => {
  it('control: with nothing throwing, the verdict is used once, the recovery is counted and no throw counter moves', async () => {
    const { post, textEl } = makePostWithLateVerdict('ok-1');
    await _onPostDetectedForTesting(post, performance.now());
    await new Promise((r) => setTimeout(r, 30));
    const counters = _getDiagnosticCountersForTesting();
    expect(counters.firstEncounterRecovered, 'the stored verdict was applied').toBe(1);
    expect(counters.lateVerdictApplyThrew).toBeUndefined();
    expect(_peekLateVerdictForTesting(_sessionVerdictKeyForTesting(post)), 'it is consulted once').toBeUndefined();
    expect(textEl.dataset.fwProcessed, 'it stays stamped').toBe('true');
    expect(unhandled).toEqual([]);
  });

  it('keeps the post covered, removes the processed stamp, counts once and leaves nothing unhandled', async () => {
    inject.throwOnRecovered = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { post, textEl } = makePostWithLateVerdict('throw-1');
    await _onPostDetectedForTesting(post, performance.now());
    await new Promise((r) => setTimeout(r, 30));
    expect(_childProtectionActiveCountForTesting(), 'the post is covered').toBe(1);
    expect(textEl.dataset.fwProcessed, 'the stamp is removed').toBeUndefined();
    expect(_getDiagnosticCountersForTesting().lateVerdictApplyThrew, 'one counter moved, once').toBe(1);
    expect(unhandled, 'nothing is left unhandled').toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('a later pass reads the post again from the start: the used-up late verdict is gone, so the queue gets it', async () => {
    inject.throwOnRecovered = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { post } = makePostWithLateVerdict('throw-2');
    await _onPostDetectedForTesting(post, performance.now());
    await new Promise((r) => setTimeout(r, 30));
    expect(enqueue, 'the first pass did not queue it').not.toHaveBeenCalled();
    await _onPostDetectedForTesting(post, performance.now());
    expect(enqueue, 'the second pass sends it to the normal pipeline').toHaveBeenCalledTimes(1);
    expect(_getDiagnosticCountersForTesting().lateVerdictApplyThrew).toBe(1);
    warn.mockRestore();
  });

  it('outside Strict there is no cover to keep, but the stamp still goes and the count still moves', async () => {
    _setChildProtectionModeForTesting('teen');
    inject.throwOnRecovered = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { post, textEl } = makePostWithLateVerdict('throw-3');
    await _onPostDetectedForTesting(post, performance.now());
    await new Promise((r) => setTimeout(r, 30));
    expect(_childProtectionActiveCountForTesting()).toBe(0);
    expect(textEl.dataset.fwProcessed).toBeUndefined();
    expect(_getDiagnosticCountersForTesting().lateVerdictApplyThrew).toBe(1);
    expect(unhandled).toEqual([]);
    warn.mockRestore();
  });
});
