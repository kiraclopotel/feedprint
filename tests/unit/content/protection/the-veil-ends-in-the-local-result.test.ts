/** @vitest-environment jsdom */
// The Silent veil end to end (12 Oct 2026): a post whose reading has not come back by the deadline is lifted as what the local
// rules make of it. The person's own list hides it, and so does the profanity rule that Silent keeps (the swear mask that stars
// a word is Calm's and Open's, not Silent's), and a post the rules leave alone is lifted as it is. The real page script, the real pipeline's rules and the real hide and mask terminals; the model is
// never asked (the pipeline is told to stop where the reading would start) and the later completion of the queue is dropped.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const WORDS = vi.hoisted(() => ({ list: ['sunset'] as string[], strict: false }));

vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  const settings = () => ({
    mode: 'child', uiLanguage: 'en', locale: 'en', outputLanguage: 'auto', dailyCap: 0, totalChecksToday: 0, totalTokensThisMonth: 0,
    monthlyUsdCapOverride: null, strictLanguage: WORDS.strict, levelChosen: true,
    features: {
      'parent-blocklist': { enabled: true, value: { words: WORDS.list, phrases: [], accounts: [] } },
      'show-reframe-markers': { enabled: false },
    },
  });
  return {
    ...actual,
    getSettings: vi.fn(async () => settings()),
    isFeatureEnabled: vi.fn((_s: unknown, feature: string) => feature === 'parent-blocklist' ? true : false),
  };
});
vi.mock('../../../../src/storage/license', () => ({
  getLicense: vi.fn(async () => ({ tier: 'family', secret: '' })),
  dailyCapForTier: () => 2000,
  effectiveMonthlyTokenCap: () => 1e12,
  isUncappedTier: (tier: string) => tier === 'dev',
}));
vi.mock('../../../../src/forensics/hasher', () => ({ sha256: vi.fn(async () => 'hash') }));
vi.mock('../../../../src/storage/cache', () => ({
  processingCache: { getPersistent: vi.fn(async () => null), get: vi.fn(() => null), set: vi.fn() },
}));
vi.mock('../../../../src/content/record/forensic-retry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/content/record/forensic-retry')>();
  return { ...actual, sendHighStakesForensicLog: vi.fn(async () => 'accepted' as const) };
});
vi.mock('../../../../src/core/calibration', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/core/calibration')>()),
  getEffectiveThreshold: vi.fn(async () => 0.45),
}));
// A page with no extension behind it: the first message that cannot be sent would otherwise mark the extension as gone and
// strand every cover on the page for the rest of the file (M68).
vi.mock('../../../../src/storage/context-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/context-guard')>();
  return { ...actual, safeSendMessage: vi.fn(() => undefined) };
});
const callAIMock = vi.hoisted(() => vi.fn());
vi.mock('../../../../src/ai/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/ai/client')>()),
  callAI: callAIMock,
  readingAllowed: vi.fn(async () => true),
}));

import {
  _setChildProtectionModeForTesting,
  _mountProtectionForTesting,
  _stampClassificationForTesting,
  _childProtectionActiveCountForTesting,
  _setActiveAdapterForTesting,
} from '../../../../src/content/index';
import { _resetForensicDedupForTesting } from '../../../../src/content/record/forensic-gate';
import { sendHighStakesForensicLog } from '../../../../src/content/record/forensic-retry';
import type { PostContent } from '../../../../src/types/post';
import type { PlatformAdapter } from '../../../../src/content/platforms/adapter';

function makePost(id: string, text: string): { post: PostContent; article: HTMLElement; textEl: HTMLElement } {
  const cell = document.createElement('div');
  cell.setAttribute('data-testid', 'cellInnerDiv');
  const article = document.createElement('article');
  article.setAttribute('role', 'article');
  const textEl = document.createElement('div');
  textEl.dataset.testid = 'tweetText';
  textEl.textContent = text;
  article.appendChild(textEl);
  cell.appendChild(article);
  document.body.appendChild(cell);
  const post = {
    id, text, author: '@someone', timestamp: '2026-10-12T00:00:00Z',
    platform: 'twitter', domRef: new WeakRef(textEl), kind: 'post',
  } as unknown as PostContent;
  return { post, article, textEl };
}

const records = () => vi.mocked(sendHighStakesForensicLog).mock.calls
  .map((c) => c[0] as { type: string; payload: Record<string, unknown> })
  .filter((m) => m.type === 'FORENSIC_LOG')
  .map((m) => m.payload);

/** A hide, whichever way the platform's terminal carries it out. */
function isHidden(article: HTMLElement, textEl: HTMLElement): boolean {
  return textEl.closest('[data-fw-hard-hidden="true"]') !== null
    || article.querySelector('[data-fw-hard-hidden="true"]') !== null
    || getComputedStyle(textEl).display === 'none'
    || textEl.dataset.fwHiddenFallback === 'true';
}

async function pastTheDeadline(): Promise<void> {
  await vi.advanceTimersByTimeAsync(15_000);
  await vi.advanceTimersByTimeAsync(500);
}

beforeEach(() => {
  vi.useFakeTimers();
  WORDS.list = ['sunset'];
  WORDS.strict = false;
  _resetForensicDedupForTesting();
  vi.mocked(sendHighStakesForensicLog).mockClear();
  callAIMock.mockReset();
  document.body.innerHTML = '';
  _setActiveAdapterForTesting({ platform: 'twitter' } as unknown as PlatformAdapter);
  _setChildProtectionModeForTesting('child');
});
afterEach(() => { vi.useRealTimers(); _setChildProtectionModeForTesting('adult'); });

describe('the Silent veil ends in the local result', () => {
  it('a veiled post on the person\'s own list is hidden at the deadline, not shown as it was', async () => {
    const { post, article, textEl } = makePost('listed', 'I really enjoyed the sunset at the beach today with my family');
    _stampClassificationForTesting(post);
    _mountProtectionForTesting(post, performance.now());
    expect(article.querySelector('.fw-provisional-shield')).not.toBeNull();

    await vi.advanceTimersByTimeAsync(14_000);
    expect(article.querySelector('.fw-provisional-shield'), 'still veiled before the deadline').not.toBeNull();

    await pastTheDeadline();

    expect(_childProtectionActiveCountForTesting()).toBe(0);
    expect(isHidden(article, textEl), `the raw post is not what the person is left looking at: ${article.outerHTML}`).toBe(true);
    expect(callAIMock, 'no model was asked').not.toHaveBeenCalled();
    const written = records();
    expect(written).toHaveLength(1);
    expect(String(written[0].detectionMode)).toContain('blocklist:');
  });

  it('a veiled post with a swear word is hidden at the deadline by the profanity rule Silent keeps', async () => {
    WORDS.list = [];
    const { post, article, textEl } = makePost('swearing', 'well that was a shit game last night');
    _stampClassificationForTesting(post);
    _mountProtectionForTesting(post, performance.now());
    expect(article.querySelector('.fw-provisional-shield')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(14_000);
    expect(article.querySelector('.fw-provisional-shield'), 'still veiled before the deadline').not.toBeNull();

    await pastTheDeadline();

    expect(article.querySelector('.fw-provisional-shield')).toBeNull();
    expect(isHidden(article, textEl), article.outerHTML).toBe(true);
    expect(_childProtectionActiveCountForTesting()).toBe(0);
    expect(callAIMock).not.toHaveBeenCalled();
    const written = records();
    expect(written).toHaveLength(1);
    expect(String(written[0].detectionMode)).toContain('profanity:');
  });

  it('a veiled post the rules leave alone is lifted as it is, with no record and no model asked', async () => {
    WORDS.list = [];
    const { post, article, textEl } = makePost('quiet', 'I really enjoyed the walk by the river today with my family');
    _stampClassificationForTesting(post);
    _mountProtectionForTesting(post, performance.now());
    expect(article.querySelector('.fw-provisional-shield'), 'veiled to begin with').not.toBeNull();

    await pastTheDeadline();

    expect(article.querySelector('.fw-provisional-shield')).toBeNull();
    expect(_childProtectionActiveCountForTesting()).toBe(0);
    expect(textEl.textContent).toBe('I really enjoyed the walk by the river today with my family');
    expect(records()).toHaveLength(0);
    expect(callAIMock).not.toHaveBeenCalled();
  });
});
