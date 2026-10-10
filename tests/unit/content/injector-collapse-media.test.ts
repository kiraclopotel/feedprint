// @vitest-environment jsdom
//
// Fold = remove the MEDIA, not just the caption (a live report 2026-06-04:
// "FeelingWise hid this post: advertisement" while the video kept playing).
// The collapse/hide path swaps the caption text AND hides the post's
// video / image / link-card within the same post container, reversibly. Also
// locks the technique-accurate placeholder (the prior hardcoded "direct threat
// or harassment" for every hide).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  injectIntoElement,
  injectCollapseOrHide,
  injectAdHide,
  injectHardHide,
} from '../../../src/content/injector';
import type { AnalysisResult } from '../../../src/types/analysis';
import type { TechniqueName } from '../../../src/types/analysis';

function analysisWith(technique: TechniqueName, score = 6): AnalysisResult {
  return {
    postId: 'p1',
    techniques: [{ technique, present: true, confidence: 0.9, severity: score, evidence: [] }],
    overallScore: score,
    overallConfidence: 0.9,
    isManipulative: true,
    processingTimeMs: 0,
    primaryTechnique: technique,
    explanation: 'x',
  };
}

/** Build a minimal X-shaped post: article > (tweetText + videoPlayer + card). */
function makeXPost(): { article: HTMLElement; text: HTMLElement; video: HTMLElement; card: HTMLElement } {
  const article = document.createElement('article');
  article.setAttribute('role', 'article');
  const text = document.createElement('div');
  text.setAttribute('data-testid', 'tweetText');
  text.textContent = 'original caption text';
  const video = document.createElement('div');
  video.setAttribute('data-testid', 'videoPlayer');
  video.appendChild(document.createElement('video'));
  const card = document.createElement('div');
  card.setAttribute('data-testid', 'card.wrapper');
  article.append(text, video, card);
  document.body.appendChild(article);
  return { article, text, video, card };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('injectIntoElement â€” verified rewrite postcondition', () => {
  const neutralized = {
    rewrittenText: 'calm replacement',
    analysis: analysisWith('fear-appeal'),
    aiSource: 'cloud',
  } as const;

  it('returns true only when the replacement is present in visible text', () => {
    const text = document.createElement('div');
    text.textContent = 'hostile original';
    document.body.appendChild(text);

    expect(injectIntoElement(text, neutralized as never, 'child')).toBe(true);
    expect(text.textContent).toBe('calm replacement');
  });

  it('returns false when a platform setter silently no-ops', () => {
    const text = document.createElement('div');
    Object.defineProperty(text, 'textContent', {
      configurable: true,
      get: () => 'hostile original',
      set: () => undefined,
    });
    document.body.appendChild(text);

    expect(injectIntoElement(text, neutralized as never, 'child')).toBe(false);
  });

  it('returns false instead of swallowing a DOM throw as success', () => {
    const text = document.createElement('div');
    text.textContent = 'hostile original';
    text.setAttribute = () => { throw new Error('platform rejected mutation'); };
    document.body.appendChild(text);

    expect(injectIntoElement(text, neutralized as never, 'child')).toBe(false);
  });
});

describe('injectCollapseOrHide — fold hides media, not just caption', () => {
  it('hides the video + card within the post container, reversibly', () => {
    const { text, video, card } = makeXPost();
    injectCollapseOrHide(text, analysisWith('consumer-rapid-frame'), 'collapse');

    expect(video.style.display).toBe('none');
    expect(video.dataset.fwHiddenMedia).toBe('true');
    expect(card.style.display).toBe('none');
    expect(card.dataset.fwHiddenMedia).toBe('true');
    // caption itself is the placeholder, not display:none
    expect(text.style.display).not.toBe('none');
  });

  it('does NOT touch media of a neighboring post', () => {
    const a = makeXPost();
    const b = makeXPost();
    injectCollapseOrHide(a.text, analysisWith('consumer-rapid-frame'), 'collapse');

    expect(a.video.style.display).toBe('none');
    expect(b.video.style.display).not.toBe('none'); // neighbor untouched
    expect(b.video.dataset.fwHiddenMedia).toBeUndefined();
  });

  it('folding an INNER quote tweet hides only the quote media, never the host post media', () => {
    // X quote tweet: outer article[role=article] (host) with its own video,
    // containing a nested article[role=link] (quote) with its own caption+video.
    const host = document.createElement('article');
    host.setAttribute('role', 'article');
    const hostVideo = document.createElement('div');
    hostVideo.setAttribute('data-testid', 'videoPlayer');
    const quote = document.createElement('article');
    quote.setAttribute('role', 'link');
    const quoteText = document.createElement('div');
    quoteText.setAttribute('data-testid', 'tweetText');
    quoteText.textContent = 'quoted caption';
    const quoteVideo = document.createElement('div');
    quoteVideo.setAttribute('data-testid', 'videoPlayer');
    quote.append(quoteText, quoteVideo);
    host.append(hostVideo, quote);
    document.body.appendChild(host);

    injectCollapseOrHide(quoteText, analysisWith('consumer-rapid-frame'), 'collapse');

    expect(quoteVideo.style.display).toBe('none');        // quote media folded
    expect(hostVideo.style.display).not.toBe('none');     // host media untouched
    expect(hostVideo.dataset.fwHiddenMedia).toBeUndefined();
  });

  it('folding the OUTER post hides both the host media and the nested quote media', () => {
    const host = document.createElement('article');
    host.setAttribute('role', 'article');
    const hostText = document.createElement('div');
    hostText.setAttribute('data-testid', 'tweetText');
    hostText.textContent = 'host caption';
    const hostVideo = document.createElement('div');
    hostVideo.setAttribute('data-testid', 'videoPlayer');
    const quote = document.createElement('article');
    quote.setAttribute('role', 'link');
    const quoteVideo = document.createElement('div');
    quoteVideo.setAttribute('data-testid', 'videoPlayer');
    quote.append(quoteVideo);
    host.append(hostText, hostVideo, quote);
    document.body.appendChild(host);

    injectCollapseOrHide(hostText, analysisWith('consumer-rapid-frame'), 'collapse');

    expect(hostVideo.style.display).toBe('none');
    expect(quoteVideo.style.display).toBe('none'); // nested quote folded with the post
  });

  it('degrades safely (no throw, caption still folds) when there is no known container', () => {
    // Orphan caption with no article wrapper.
    const text = document.createElement('div');
    text.setAttribute('data-testid', 'tweetText');
    text.textContent = 'orphan';
    document.body.appendChild(text);
    expect(() => injectCollapseOrHide(text, analysisWith('consumer-rapid-frame'), 'collapse')).not.toThrow();
    expect(text.getAttribute('data-fw-action')).toBe('collapse');
  });
});

describe('block paths SILENCE the video (audio must stop, not just hide)', () => {
  // Live test, 2026-06-16: a blocked video kept playing AUDIO. Neither display:none
  // nor visibility:hidden reliably stops a playing <video>'s sound, so every
  // block path must mute+pause the media.
  it('a fold mutes the post video, not just display:none', () => {
    const { text, video } = makeXPost();
    const mediaEl = video.querySelector('video') as HTMLVideoElement;
    injectCollapseOrHide(text, analysisWith('consumer-rapid-frame'), 'collapse');
    expect(mediaEl.muted).toBe(true);
    expect(video.style.display).toBe('none'); // still hidden too
  });

  it('an ad-hide mutes the ad video before display:none', () => {
    const { article, text } = makeXPost();
    const mediaEl = article.querySelector('video') as HTMLVideoElement;
    expect(injectAdHide(text, 'twitter')).toBe(true);
    expect(mediaEl.muted).toBe(true);
    expect(article.style.display).toBe('none');
  });

  it('TikTok backstop: a video with no X/FB container is still SILENCED even though it stays in layout', () => {
    // TikTok shape: a recommend-list-item-container that POST_CONTAINER_SELECTORS
    // (X/FB only) does not match — display:none-fold is skipped to protect
    // auto-advance, but the video must still go silent.
    const item = document.createElement('div');
    item.setAttribute('data-e2e', 'recommend-list-item-container');
    const desc = document.createElement('div');
    desc.setAttribute('data-e2e', 'video-desc');
    desc.textContent = 'tiktok caption';
    const media = document.createElement('video');
    item.append(desc, media);
    document.body.appendChild(item);

    const pause = vi.spyOn(media, 'pause').mockImplementation(() => undefined);
    injectCollapseOrHide(desc, analysisWith('consumer-rapid-frame'), 'collapse');

    // Silenced via the backstop, scoped to the card (video-feed-hide.ts):
    // paused, and `muted` back to the user's own state so TikTok does not
    // carry our mute to the next video (owner 2026-09-13).
    expect(pause).toHaveBeenCalled();
    expect(media.muted).toBe(false);
    expect(item.getAttribute('data-fw-silenced')).toBe('true');
    expect(media.style.display).not.toBe('none'); // layout preserved (no auto-advance break)
  });
});

describe('injectCollapseOrHide — technique-accurate placeholder', () => {
  it('a hard hide names the real technique, not the hardcoded "direct threat"', () => {
    const { text } = makeXPost();
    injectCollapseOrHide(text, analysisWith('violence-graphic', 9), 'hide');
    expect(text.textContent).toContain('graphic violence');
    expect(text.textContent).not.toContain('direct threat');
  });

  it('an advertisement fold reads "advertisement"', () => {
    const { text } = makeXPost();
    injectCollapseOrHide(text, analysisWith('consumer-rapid-frame'), 'collapse');
    expect(text.textContent).toContain('advertisement');
  });

  it('a hide with no specific technique falls back to direct-threat wording', () => {
    const { text } = makeXPost();
    // fear-appeal has no dedicated hide line → residual hide reason
    injectCollapseOrHide(text, analysisWith('fear-appeal', 9), 'hide');
    expect(text.textContent).toContain('direct threat or harassment');
  });
});

describe('injectAdHide — fully removes the ad container (no placeholder, no gap)', () => {
  it('display:none on the X feed cell when present (so the gap collapses), reversibly', () => {
    const cell = document.createElement('div');
    cell.setAttribute('data-testid', 'cellInnerDiv');
    const { text } = (() => {
      const article = document.createElement('article');
      article.setAttribute('role', 'article');
      const t = document.createElement('div');
      t.setAttribute('data-testid', 'tweetText');
      t.textContent = 'sponsored caption';
      article.append(t);
      cell.append(article);
      document.body.appendChild(cell);
      return { text: t };
    })();

    const hidden = injectAdHide(text, 'twitter');
    expect(hidden).toBe(true);
    expect(cell.style.display).toBe('none');                 // the whole cell, no gap
    expect(cell.getAttribute('data-fw-ad-hidden')).toBe('true');
    expect(cell.getAttribute('data-fw-prev-display')).toBe(''); // prior inline display preserved
  });

  it('falls back to the post article when no feed cell wraps it', () => {
    const { article, text } = makeXPost();
    expect(injectAdHide(text, 'twitter')).toBe(true);
    expect(article.style.display).toBe('none');
  });

  it('is idempotent and leaves NO placeholder text on the caption', () => {
    const { article, text } = makeXPost();
    const original = text.textContent;
    expect(injectAdHide(text, 'twitter')).toBe(true);
    expect(injectAdHide(text, 'twitter')).toBe(true); // second call is a no-op success
    expect(article.style.display).toBe('none');
    expect(text.textContent).toBe(original);          // caption untouched — no "folded this post" trace
    expect(text.getAttribute('data-fw-action')).toBeNull();
  });

  it('returns false (caller degrades to the fold) when no container resolves', () => {
    const orphan = document.createElement('div');
    orphan.setAttribute('data-testid', 'tweetText');
    document.body.appendChild(orphan);
    expect(injectAdHide(orphan, 'twitter')).toBe(false);
    expect(orphan.style.display).not.toBe('none');
  });

  it('stamps data-fw-block-reason so a vanished ad names its circuit (Q87/W16)', () => {
    const { article, text } = makeXPost();
    expect(injectAdHide(text, 'twitter')).toBe(true);
    expect(article.getAttribute('data-fw-block-reason')).toBe('ad-hide');
  });
});

describe('injectAdHide on Instagram — visibility-based, height-preserving (Q87)', () => {
  // Measured live 2026-08-11: IG renders a window of articles in normal flow
  // inside one padded column and positions/loads from its own height
  // bookkeeping. display:none removed the article's box and truncated the
  // whole feed below the ad. The IG branch must keep the box (visibility) and
  // must never touch display.
  function makeIgPost(): { article: HTMLElement; text: HTMLElement } {
    const article = document.createElement('article');
    const text = document.createElement('span');
    text.textContent = 'sponsored caption';
    const media = document.createElement('video');
    article.append(text, media);
    document.body.appendChild(article);
    return { article, text };
  }

  it('hides via visibility:hidden !important and leaves display untouched', () => {
    const { article, text } = makeIgPost();
    expect(injectAdHide(text, 'instagram')).toBe(true);
    expect(article.style.getPropertyValue('visibility')).toBe('hidden');
    expect(article.style.getPropertyPriority('visibility')).toBe('important');
    expect(article.style.display).toBe('');
    expect(article.getAttribute('data-fw-hide-mode')).toBe('visibility');
    expect(article.getAttribute('data-fw-prev-visibility')).toBe('');
    expect(article.getAttribute('data-fw-ad-hidden')).toBe('true');
    expect(article.getAttribute('data-fw-block-reason')).toBe('ad-hide');
  });

  it('still mutes and pauses the ad media', () => {
    const { article, text } = makeIgPost();
    const media = article.querySelector('video') as HTMLVideoElement;
    expect(injectAdHide(text, 'instagram')).toBe(true);
    expect(media.muted).toBe(true);
  });

  it('is idempotent', () => {
    const { article, text } = makeIgPost();
    expect(injectAdHide(text, 'instagram')).toBe(true);
    expect(injectAdHide(text, 'instagram')).toBe(true);
    expect(article.style.getPropertyValue('visibility')).toBe('hidden');
  });

  it('every other platform keeps the display:none path', () => {
    const { article, text } = makeXPost();
    expect(injectAdHide(text, 'facebook')).toBe(true);
    expect(article.style.display).toBe('none');
    expect(article.getAttribute('data-fw-hide-mode')).toBeNull();
  });
});

describe('injectHardHide — silent full collapse for a severe un-reframeable post (found 2026-06-19)', () => {
  it('display:none on the cell CONTENT (M96: the cell hosts the notice), no placeholder, distinct stamp', () => {
    const cell = document.createElement('div');
    cell.setAttribute('data-testid', 'cellInnerDiv');
    const article = document.createElement('article');
    article.setAttribute('role', 'article');
    const text = document.createElement('div');
    text.setAttribute('data-testid', 'tweetText');
    text.textContent = 'direct threat caption';
    article.append(text);
    cell.append(article);
    document.body.appendChild(cell);

    expect(injectHardHide(text, 'twitter')).toBe(true);
    // M96 (2026-08-04): the hard hide targets the cell's single content
    // child, keeping the cell as the notice mount host — the X virtualizer
    // never closed the "gap" of a hidden cell anyway (measured live).
    expect(article.style.getPropertyValue('display')).toBe('none');
    expect(article.style.getPropertyPriority('display')).toBe('important');
    expect(article.getAttribute('data-fw-hard-hidden')).toBe('true');
    expect(cell.style.getPropertyValue('display')).toBe('');
    expect(cell.getAttribute('data-fw-ad-hidden')).toBeNull();  // never confused with an ad-hide
    expect(text.textContent).toBe('direct threat caption');     // caption untouched — nothing shown
    expect(text.getAttribute('data-fw-action')).toBeNull();
  });

  it('mutes the post video before hiding (audio must stop)', () => {
    const { article, text } = makeXPost();
    const mediaEl = article.querySelector('video') as HTMLVideoElement;
    expect(injectHardHide(text, 'twitter')).toBe(true);
    expect(mediaEl.muted).toBe(true);
    expect(article.style.display).toBe('none');
  });

  it('is idempotent', () => {
    const { article, text } = makeXPost();
    expect(injectHardHide(text, 'twitter')).toBe(true);
    expect(injectHardHide(text, 'twitter')).toBe(true); // second call no-op success
    expect(article.style.display).toBe('none');
  });

  it('returns false (caller degrades to the placeholder) when no container resolves', () => {
    const orphan = document.createElement('div');
    orphan.setAttribute('data-testid', 'tweetText');
    document.body.appendChild(orphan);
    expect(injectHardHide(orphan, 'twitter')).toBe(false);
    expect(orphan.style.display).not.toBe('none');
  });
});

describe('injectHardHide on Instagram — visibility-based, height-preserving (Q88)', () => {
  function makeIgPost(): { article: HTMLElement; text: HTMLElement } {
    const article = document.createElement('article');
    const text = document.createElement('span');
    text.textContent = 'severe threat caption';
    article.appendChild(document.createElement('video'));
    article.appendChild(text);
    document.body.appendChild(article);
    return { article, text };
  }

  it('hides via visibility:hidden !important, display untouched, mode + reason stamped', () => {
    const { article, text } = makeIgPost();
    expect(injectHardHide(text, 'instagram')).toBe(true);
    expect(article.style.getPropertyValue('visibility')).toBe('hidden');
    expect(article.style.getPropertyPriority('visibility')).toBe('important');
    expect(article.style.display).toBe('');
    expect(article.getAttribute('data-fw-hide-mode')).toBe('visibility');
    expect(article.getAttribute('data-fw-hard-hidden')).toBe('true');
    expect(article.getAttribute('data-fw-block-reason')).toBe('hard-hide');
    const media = article.querySelector('video') as HTMLVideoElement;
    expect(media.muted).toBe(true);
  });

  it('is idempotent and the reveal path restores visibility, not display', () => {
    const { article, text } = makeIgPost();
    const reveal = {
      noticeText: 'FeelingWise hid this post', showLabel: 'show anyway', hideLabel: 'hide again',
    };
    expect(injectHardHide(text, 'instagram', reveal)).toBe(true);
    expect(injectHardHide(text, 'instagram', reveal)).toBe(true);
    // Click the notice button: reveal must clear the visibility override.
    const btn = document.querySelector('[data-fw-hide-notice] button, button') as HTMLButtonElement;
    btn.click();
    expect(article.getAttribute('data-fw-user-revealed')).toBe('true');
    expect(article.style.getPropertyValue('visibility')).toBe('');
    expect(article.style.display).toBe('');
    // Hide again: back to visibility:hidden.
    btn.click();
    expect(article.style.getPropertyValue('visibility')).toBe('hidden');
  });

  it('X keeps the display:none path untouched (M96 geometry)', () => {
    const { article, text } = makeXPost();
    expect(injectHardHide(text, 'twitter')).toBe(true);
    expect(article.style.display).toBe('none');
    expect(article.getAttribute('data-fw-hide-mode')).toBeNull();
  });
});
