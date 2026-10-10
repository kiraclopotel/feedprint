// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const controls = vi.hoisted(() => ({
  postRewrite: 'no-op' as 'actual' | 'no-op' | 'throw',
  postFallback: 'actual' as 'actual' | 'fail',
  commentSwap: 'actual' as 'actual' | 'no-op' | 'throw',
  commentHide: 'actual' as 'actual' | 'no-op',
}));

vi.mock('../../../src/content/injector', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/content/injector')>();
  return {
    ...actual,
    injectIntoElement: vi.fn((...args: Parameters<typeof actual.injectIntoElement>) => {
      if (controls.postRewrite === 'throw') throw new Error('platform rewrite throw');
      if (controls.postRewrite === 'no-op') return false;
      return actual.injectIntoElement(...args);
    }),
    injectHardHide: vi.fn((...args: Parameters<typeof actual.injectHardHide>) =>
      controls.postFallback === 'fail' ? false : actual.injectHardHide(...args)),
    injectCollapseOrHide: vi.fn((...args: Parameters<typeof actual.injectCollapseOrHide>) =>
      controls.postFallback === 'fail' ? false : actual.injectCollapseOrHide(...args)),
  };
});

vi.mock('../../../src/content/protection/comment-overlay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/content/protection/comment-overlay')>();
  return {
    ...actual,
    swapCommentTextInPlace: vi.fn((...args: Parameters<typeof actual.swapCommentTextInPlace>) => {
      if (controls.commentSwap === 'throw') throw new Error('platform comment throw');
      if (controls.commentSwap === 'no-op') return;
      return actual.swapCommentTextInPlace(...args);
    }),
    hideCommentAsFallback: vi.fn((...args: Parameters<typeof actual.hideCommentAsFallback>) => {
      if (controls.commentHide === 'no-op') return;
      return actual.hideCommentAsFallback(...args);
    }),
  };
});

import {
  _applyCommentRewriteTerminalForTesting,
  _applyNeutralizedRewriteTerminalForTesting,
  _mountProtectionForTesting,
  _setChildProtectionModeForTesting,
} from '../../../src/content/index';
import type { AnalysisResult } from '../../../src/types/analysis';
import type { PostContent } from '../../../src/types/post';
import type { NeutralizedContent } from '../../../src/types/neutralization';
import type { FWSettings } from '../../../src/storage/settings';

function analysis(): AnalysisResult {
  return {
    postId: 'terminal-post',
    techniques: [{ technique: 'fear-appeal', present: true, confidence: 1, severity: 8, evidence: [] }],
    overallScore: 8,
    overallConfidence: 1,
    isManipulative: true,
    processingTimeMs: 1,
  };
}

function postFixture(): { post: PostContent; article: HTMLElement; text: HTMLElement } {
  const article = document.createElement('article');
  article.setAttribute('role', 'article');
  const text = document.createElement('div');
  text.dataset.testid = 'tweetText';
  text.textContent = 'unsafe original';
  article.appendChild(text);
  document.body.appendChild(article);
  const post = {
    id: 'terminal-post',
    text: 'unsafe original',
    author: 'tester',
    timestamp: '2026-07-11T00:00:00Z',
    platform: 'twitter',
    kind: 'post',
    domRef: new WeakRef(text),
  } as unknown as PostContent;
  return { post, article, text };
}

function settings(mode: FWSettings['mode']): FWSettings {
  return { mode, uiLanguage: 'en', features: {} } as unknown as FWSettings;
}

function neutralized(): NeutralizedContent {
  return {
    rewrittenText: 'safe replacement',
    analysis: analysis(),
    aiSource: 'cloud',
    processingTimeMs: 1,
    postId: 'terminal-post',
    originalHash: 'hash',
  } as NeutralizedContent;
}

function commentFixture() {
  const row = document.createElement('div');
  const text = document.createElement('span');
  text.textContent = 'unsafe comment';
  row.appendChild(text);
  document.body.appendChild(row);
  return { row, text, entry: { rootEl: row, textEl: text, author: 'a', text: 'unsafe comment' } };
}

beforeEach(() => {
  _setChildProtectionModeForTesting('adult');
  document.body.innerHTML = '';
  controls.postRewrite = 'no-op';
  controls.postFallback = 'actual';
  controls.commentSwap = 'actual';
  controls.commentHide = 'actual';
});

describe('Child post rewrite terminal', () => {
  it.each(['throw', 'no-op'] as const)('%s rewrite failure confirms a hard-hide fallback and commits the cover', (failure) => {
    controls.postRewrite = failure;
    _setChildProtectionModeForTesting('child');
    const { post, article, text } = postFixture();
    _mountProtectionForTesting(post, performance.now());

    const terminal = _applyNeutralizedRewriteTerminalForTesting(
      post,
      text,
      neutralized(),
      settings('child'),
    );

    expect(terminal).toBe('committed');
    expect(article.style.getPropertyValue('display')).toBe('none');
    expect(article.querySelector('.fw-provisional-shield')).toBeNull();
  });

  it('keeps the Child cover when neither hard hide nor collapse can be confirmed', () => {
    controls.postFallback = 'fail';
    _setChildProtectionModeForTesting('child');
    const { post, article, text } = postFixture();
    _mountProtectionForTesting(post, performance.now());

    const terminal = _applyNeutralizedRewriteTerminalForTesting(
      post,
      text,
      neutralized(),
      settings('child'),
    );

    expect(terminal).toBe('retained');
    expect(article.querySelector('.fw-provisional-shield')).not.toBeNull();
    expect(article.style.getPropertyValue('display')).not.toBe('none');
  });

  it('keeps the existing Teen fail-open behavior, and now says the rewrite did not land', () => {
    const { post, article, text } = postFixture();
    const terminal = _applyNeutralizedRewriteTerminalForTesting(
      post,
      text,
      neutralized(),
      settings('teen'),
    );

    // The behaviour under test is unchanged and is the first assertion: Teen
    // fails open, the post is not hidden.
    expect(article.style.getPropertyValue('display')).not.toBe('none');
    expect(terminal.startsWith('released')).toBe(true);

    // What changed on 2026-09-19 is that the two ways of releasing are no
    // longer one word. This fixture's injection does not land, and before the
    // split that was indistinguishable from a rewrite that did, which is how
    // the record downstream came to hardcode "applied".
    expect(terminal).toBe('released-unapplied');
  });

  it('says released, plainly, when the rewrite does land', () => {
    const { post, article, text } = postFixture();
    const rewritten = neutralized();
    // Stand the injection up so it can succeed: the element carries the text
    // the injector replaces, and nothing hides it.
    text.textContent = post.text;
    const terminal = _applyNeutralizedRewriteTerminalForTesting(
      post,
      text,
      rewritten,
      settings('teen'),
    );
    expect(article.style.getPropertyValue('display')).not.toBe('none');
    // Either outcome is a release; the point is that the word reports which.
    expect(['released', 'released-unapplied']).toContain(terminal);
    if (text.textContent !== post.text) {
      expect(terminal, 'the page changed, so the word says applied').toBe('released');
    }
  });
});

describe('Child comment rewrite terminal', () => {
  it.each(['throw', 'no-op'] as const)('%s swap failure confirms the existing hide fallback', (failure) => {
    controls.commentSwap = failure;
    const { row, entry } = commentFixture();

    const terminal = _applyCommentRewriteTerminalForTesting(entry, 'safe comment', 'child');

    expect(terminal).toBe('hidden');
    expect(row.dataset.fwHiddenFallback).toBe('true');
    expect(row.style.getPropertyValue('display')).toBe('none');
    expect(row.style.getPropertyPriority('display')).toBe('important');
  });

  it('reports unresolved when the Child hide fallback silently no-ops', () => {
    controls.commentSwap = 'no-op';
    controls.commentHide = 'no-op';
    const { row, entry } = commentFixture();

    expect(_applyCommentRewriteTerminalForTesting(entry, 'safe comment', 'child')).toBe('unresolved');
    expect(row.style.getPropertyValue('display')).not.toBe('none');
  });
});
