/** @vitest-environment jsdom */
// A stored verdict is replayed on a post that was just detected, but the replay waits once for the
// settings before it writes. A feed that reuses its boxes (X, Instagram, TikTok) can refill the
// same element with another post in that wait, and a live element handle then proves nothing. The
// replay must look at what the box holds now, as the live path does, and write only on the post
// the verdict was made for.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ mode: 'teen' as 'child' | 'teen' | 'adult' }));

vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return {
    ...actual,
    getSettings: vi.fn(async () => ({ mode: state.mode, uiLanguage: 'en' })),
    isFeatureEnabled: vi.fn(() => true),
  };
});

// The live path sends the scan tally and the record; with no extension behind it a send reads as a
// replaced extension, which would stop any cover from mounting in the tests after it.
vi.mock('../../../../src/storage/context-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/context-guard')>();
  return { ...actual, safeSendMessage: vi.fn(() => undefined) };
});
vi.mock('../../../../src/content/record/forensic-retry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/content/record/forensic-retry')>();
  return { ...actual, sendHighStakesForensicLog: vi.fn(async () => 'accepted' as const) };
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
  _peekLateVerdictForTesting,
  _clearSessionVerdictCachesOnModeChangeForTesting,
  _sessionVerdictKeyForTesting,
  type LateVerdict,
} from '../../../../src/content/post-path/late-verdict-cache';
import {
  _applyLateVerdictDirectForTesting,
  _setActiveAdapterForTesting,
  _mountProtectionForTesting,
  _setChildProtectionModeForTesting,
} from '../../../../src/content/index';
import { injectIntoElement, injectHardHide, injectCollapseOrHide, markOnlyElement } from '../../../../src/content/injector';
import type { AnalysisResult } from '../../../../src/types/analysis';
import type { PlatformAdapter } from '../../../../src/content/platforms/adapter';
import type { PostContent } from '../../../../src/types/post';

function analysis(action?: 'hide' | 'collapse'): AnalysisResult {
  return {
    postId: 'p1',
    techniques: [{ technique: 'shame-attack' as never, present: true, confidence: 1, severity: 8, evidence: ['e'] }],
    overallScore: 8,
    overallConfidence: 1,
    isManipulative: true,
    processingTimeMs: 10,
    ...(action ? { action } : {}),
  };
}

const neutralize: LateVerdict = {
  kind: 'neutralize',
  neutralized: { rewrittenText: 'a calmer version', analysis: analysis(), aiSource: 'cloud' } as never,
};
const hide: LateVerdict = { kind: 'hide', analysis: analysis('hide') };
const collapse: LateVerdict = { kind: 'collapse', analysis: analysis('collapse') };
const mark: LateVerdict = { kind: 'mark', analysis: analysis() };

let postCount = 0;

function postIn(el: HTMLElement, text: string, platform = 'twitter'): PostContent {
  return {
    id: `reused-box-${++postCount}`,
    text,
    author: 'tester',
    timestamp: '2026-09-26T00:00:00Z',
    platform,
    domRef: new WeakRef(el),
    kind: 'post',
  } as unknown as PostContent;
}

function plainBox(text: string): HTMLElement {
  const el = document.createElement('article');
  el.textContent = text;
  document.body.appendChild(el);
  return el;
}

function writesMade(): number {
  return [injectIntoElement, injectHardHide, injectCollapseOrHide, markOnlyElement]
    .reduce((n, fn) => n + vi.mocked(fn).mock.calls.length, 0);
}

function nothingWasWritten(): void {
  expect(injectIntoElement).not.toHaveBeenCalled();
  expect(injectHardHide).not.toHaveBeenCalled();
  expect(injectCollapseOrHide).not.toHaveBeenCalled();
  expect(markOnlyElement).not.toHaveBeenCalled();
}

beforeEach(() => {
  _setActiveAdapterForTesting({ platform: 'twitter' } as unknown as PlatformAdapter);
  state.mode = 'teen';
  _setChildProtectionModeForTesting('teen');
  _clearSessionVerdictCachesOnModeChangeForTesting();
  vi.mocked(injectIntoElement).mockClear();
  vi.mocked(injectHardHide).mockClear();
  vi.mocked(injectCollapseOrHide).mockClear();
  vi.mocked(markOnlyElement).mockClear();
  document.body.innerHTML = '';
});

/** The apply runs the live path, whose visual and record land after a settings read. */
const afterTheApply = (): Promise<void> => new Promise((r) => setTimeout(r, 30));

describe('a replayed verdict is written only where its post still is', () => {
  const shapes: Array<[string, LateVerdict]> = [
    ['a rewrite', neutralize],
    ['a hide', hide],
    ['a fold', collapse],
    ['a mark', mark],
  ];

  for (const [name, verdict] of shapes) {
    it(`does not write ${name} on a box refilled with another post while it waited`, async () => {
      const el = plainBox('the post the verdict was made for');
      const post = postIn(el, 'the post the verdict was made for');

      const applying = _applyLateVerdictDirectForTesting(post, verdict);
      el.textContent = 'a different post the feed put in the same box';
      await applying;
      await afterTheApply();

      nothingWasWritten();
    });

    it(`still writes ${name} when the box holds the same post after the wait`, async () => {
      const el = plainBox('the post the verdict was made for');
      const post = postIn(el, 'the post the verdict was made for');

      const applying = _applyLateVerdictDirectForTesting(post, verdict);
      el.textContent = 'the post the verdict was made for';
      await applying;
      await afterTheApply();

      const writes = [injectIntoElement, injectHardHide, injectCollapseOrHide, markOnlyElement]
        .reduce((n, fn) => n + vi.mocked(fn).mock.calls.length, 0);
      expect(writes).toBe(1);
    });
  }

  it('keeps a turned-away mark for the post that comes back', async () => {
    const el = plainBox('the post the verdict was made for');
    const post = postIn(el, 'the post the verdict was made for');

    const applying = _applyLateVerdictDirectForTesting(post, mark);
    el.textContent = 'a different post the feed put in the same box';
    await applying;
    await afterTheApply();

    expect(_peekLateVerdictForTesting(_sessionVerdictKeyForTesting(post))).toEqual(mark);
  });
});

describe('a TikTok card is judged by its caption, not its whole text', () => {
  function card(caption: string): { item: HTMLElement; caption: HTMLElement } {
    const item = document.createElement('div');
    item.setAttribute('data-e2e', 'recommend-list-item-container');
    const author = document.createElement('a');
    author.textContent = '@seller 0:07 / 0:15';
    const cap = document.createElement('div');
    cap.setAttribute('data-e2e', 'video-desc');
    cap.textContent = caption;
    item.append(author, cap);
    document.body.appendChild(item);
    return { item, caption: cap };
  }

  it('writes a rewrite when only the card around the caption differs from the record', async () => {
    const c = card('buy now or your family suffers');
    const post = postIn(c.item, 'buy now or your family suffers', 'tiktok');

    await _applyLateVerdictDirectForTesting(post, neutralize);
    await afterTheApply();

    expect(injectIntoElement).toHaveBeenCalledTimes(1);
  });

  it('does not write it when the card now shows another video', async () => {
    const c = card('buy now or your family suffers');
    const post = postIn(c.item, 'buy now or your family suffers', 'tiktok');

    const applying = _applyLateVerdictDirectForTesting(post, neutralize);
    c.caption.textContent = 'a calm video about bread';
    await applying;
    await afterTheApply();

    nothingWasWritten();
  });
});

describe('the Child cover does not make a box look like another post', () => {
  const WORDS = 'buy now or your family suffers';

  function inChild(post: PostContent): void {
    state.mode = 'child';
    _setChildProtectionModeForTesting('child');
    _mountProtectionForTesting(post, performance.now());
  }

  function coverIn(host: HTMLElement): void {
    expect(host.querySelector('.fw-provisional-shield')).not.toBeNull();
  }

  it('X: the cover sits in the tweet, outside the tweet text, and the rewrite still lands', async () => {
    const article = document.createElement('article');
    article.setAttribute('data-testid', 'tweet');
    const text = document.createElement('div');
    text.setAttribute('data-testid', 'tweetText');
    text.textContent = WORDS;
    article.appendChild(text);
    document.body.appendChild(article);
    const post = postIn(text, WORDS);

    inChild(post);
    coverIn(article);
    await _applyLateVerdictDirectForTesting(post, neutralize);
    await afterTheApply();

    expect(injectIntoElement).toHaveBeenCalledTimes(1);
  });

  it('Facebook: the cover sits on the feed unit, outside the message, and the rewrite still lands', async () => {
    const unit = document.createElement('div');
    unit.setAttribute('aria-posinset', '3');
    const message = document.createElement('div');
    message.setAttribute('data-ad-rendering-role', 'story_message');
    message.textContent = WORDS;
    unit.appendChild(message);
    document.body.appendChild(unit);
    const post = postIn(message, WORDS, 'facebook');

    inChild(post);
    coverIn(unit);
    await _applyLateVerdictDirectForTesting(post, neutralize);
    await afterTheApply();

    expect(injectIntoElement).toHaveBeenCalledTimes(1);
  });

  it('TikTok: the cover sits inside the card itself, and the rewrite still lands', async () => {
    const item = document.createElement('div');
    item.setAttribute('data-e2e', 'recommend-list-item-container');
    const caption = document.createElement('div');
    caption.setAttribute('data-e2e', 'video-desc');
    caption.textContent = WORDS;
    item.appendChild(caption);
    document.body.appendChild(item);
    const post = postIn(item, WORDS, 'tiktok');

    inChild(post);
    coverIn(item);
    await _applyLateVerdictDirectForTesting(post, neutralize);
    await afterTheApply();

    expect(writesMade()).toBe(1);
  });

  it('a box no card selector claims holds the cover itself, and the rewrite still lands', async () => {
    const box = plainBox(WORDS);
    const post = postIn(box, WORDS);

    inChild(post);
    coverIn(box);
    await _applyLateVerdictDirectForTesting(post, neutralize);
    await afterTheApply();

    expect(injectIntoElement).toHaveBeenCalledTimes(1);
  });

  it('and a box refilled with another post in Child is still turned away', async () => {
    const box = plainBox(WORDS);
    const post = postIn(box, WORDS);

    inChild(post);
    const applying = _applyLateVerdictDirectForTesting(post, neutralize);
    box.querySelector('.fw-provisional-shield')?.remove();
    box.textContent = 'a different post the feed put in the same box';
    await applying;
    await afterTheApply();

    nothingWasWritten();
  });
});
