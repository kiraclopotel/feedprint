// @vitest-environment jsdom
//
// Hashtag rule must not read the comment region.
//
// Bug: the hashtag fallback scanned raw container.textContent, which on
// Instagram includes the comment preview under the same <article>. A viewer
// comment containing a blocklisted tag (the default list includes the bare
// token "ai") hid the whole post — and only after the comments hydrated,
// which is why the post survived first paint and vanished later. The fix
// routes the fallback through the same comment-stripped haystack the
// AI-label rule already uses (buildAiLabelHaystack).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { startAiContentBlocker } from '../../../src/content/engagement/ai-content-blocker';
import {
  FWSettings,
  FeatureToggles,
  CURRENT_SETTINGS_SCHEMA_VERSION,
} from '../../../src/storage/settings';
import { teenPreset } from '../../../src/storage/presets';

function makeSettings(features: FeatureToggles): FWSettings {
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    mode: 'teen',
    strictLanguage: false,
    hideUnrewritable: false,
    aiAnalysisEnabled: true,
    parentPin: '', dailyCap: 5000, monthlyUsdCapOverride: null, locale: 'en',
    outputLanguage: 'auto', uiLanguage: 'auto',
    totalChecksToday: 0, totalNeutralizedToday: 0, totalTokensToday: 0,
    estimatedCostToday: 0, lastResetDate: '',
    totalChecksThisMonth: 0, totalTokensThisMonth: 0, lastResetMonth: '',
    totalTokensAllTime: 0, totalChecksAllTime: 0,
    totalNeutralizedAllTime: 0, estimatedCostAllTime: 0,
    features,
    presets: { appliedAt: '', appliedPreset: 'teen' },
    dashboardTheme: 'dark',
  };
}

function settingsWithAiBlockerOn(): FWSettings {
  const features = teenPreset();
  for (const key of Object.keys(features)) {
    features[key as keyof typeof features].enabled = false;
  }
  features['block-ai-content'].enabled = true;
  return makeSettings(features);
}

function buildInstagramArticle(caption: string, commentText?: string): HTMLElement {
  const article = document.createElement('article');
  const captionEl = document.createElement('h1');
  captionEl.textContent = caption;
  article.appendChild(captionEl);
  if (commentText !== undefined) {
    // Instagram renders comment previews as nested role="article" nodes
    // whose aria-label carries "Comment by …" — matches the blocker's
    // COMMENT_REGION_SELECTORS entry.
    const comment = document.createElement('div');
    comment.setAttribute('role', 'article');
    comment.setAttribute('aria-label', 'Comment by someuser');
    comment.textContent = commentText;
    article.appendChild(comment);
  }
  document.body.appendChild(article);
  return article;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('ai-content-blocker — hashtag rule ignores the comment region', () => {
  it('a blocklisted hashtag ONLY inside a comment does not hide the post', () => {
    vi.useFakeTimers();
    const article = buildInstagramArticle(
      'a normal holiday photo caption',
      'wow is this #ai or real??',
    );

    const stop = startAiContentBlocker('instagram', settingsWithAiBlockerOn());

    expect(article.getAttribute('data-fw-blocked')).toBeNull();
    stop();
  });

  it('a blocklisted hashtag in the caption still hides the post (comments present)', () => {
    vi.useFakeTimers();
    const article = buildInstagramArticle(
      'my new clip #aifruit',
      'nice one!',
    );

    const stop = startAiContentBlocker('instagram', settingsWithAiBlockerOn());

    expect(article.getAttribute('data-fw-blocked')).toBe('ai-content');
    expect(article.getAttribute('data-fw-block-reason')).toContain('hashtag');
    stop();
  });

  it('page-level MAIN: hashtag inside the comment list (ul) or a suggested-post tile does not blank the page', () => {
    vi.useFakeTimers();
    history.replaceState({}, '', '/p/abc123/');
    const main = document.createElement('main');
    const caption = document.createElement('h1');
    caption.textContent = 'a clean caption';
    main.appendChild(caption);
    const commentList = document.createElement('ul');
    const li = document.createElement('li');
    li.textContent = 'is this #ai though?';
    commentList.appendChild(li);
    main.appendChild(commentList);
    const suggestedTile = document.createElement('article');
    suggestedTile.textContent = 'more posts #aifruit';
    main.appendChild(suggestedTile);
    document.body.appendChild(main);

    const stop = startAiContentBlocker('instagram', settingsWithAiBlockerOn());

    // The page container survives; the suggested tile is evaluated on its
    // own by the always-on article surface and hides individually.
    expect(main.getAttribute('data-fw-blocked')).toBeNull();
    expect(suggestedTile.getAttribute('data-fw-blocked')).toBe('ai-content');
    stop();
    history.replaceState({}, '', '/');
  });

  it('non-caption hashtag outside the comment region still triggers the fallback', () => {
    vi.useFakeTimers();
    const article = document.createElement('article');
    const overlay = document.createElement('div');
    overlay.textContent = 'ui label row #aifruit';
    article.appendChild(overlay);
    document.body.appendChild(article);

    const stop = startAiContentBlocker('instagram', settingsWithAiBlockerOn());

    expect(article.getAttribute('data-fw-blocked')).toBe('ai-content');
    expect(article.getAttribute('data-fw-block-reason')).toContain('hashtag');
    stop();
  });
});
