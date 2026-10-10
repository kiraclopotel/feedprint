// @vitest-environment jsdom
// TiktokAdapter — sponsored detection exactness (TT-2)
//
// Cut out of tiktok-adapter.test.ts on 2026-09-16 (PLAN-2026-09-16 item 11.3).

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TiktokAdapter,
  _resetTikTokVideoDedupForTesting,
  resetTikTokVideoDedup,
} from '../../../../src/content/platforms/tiktok';
import { injectAdHide } from '../../../../src/content/injector';
import { makeFeedItem, makeSponsoredFeedItem, rehydrateSponsoredFeedItem, toNodeList } from './tiktok-page-fixtures';

describe('TiktokAdapter — sponsored detection exactness (TT-2)', () => {
  let adapter: TiktokAdapter;

  beforeEach(() => {
    adapter = new TiktokAdapter();
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.tiktok.com', pathname: '/' },
      writable: true,
      configurable: true,
    });
    document.body.innerHTML = '';
  });

  it('does NOT flag an organic caption that merely contains the word "Werbung"', () => {
    const item = makeFeedItem({
      caption: 'Warum sehe ich hier auf einmal so viel Werbung, das nervt echt total',
      author: 'creator1',
    });
    const posts = adapter.extractPosts(toNodeList([item]));
    const videoPost = posts.find((p) => p.kind === 'video');
    expect(videoPost?.is_sponsored).not.toBe(true);
  });

  it('does NOT flag an organic caption that merely contains the word "Anuncio"', () => {
    const item = makeFeedItem({
      caption: 'Vi un anuncio buenisimo anoche en la television y se los recomiendo',
      author: 'creator1',
    });
    const posts = adapter.extractPosts(toNodeList([item]));
    const videoPost = posts.find((p) => p.kind === 'video');
    expect(videoPost?.is_sponsored).not.toBe(true);
  });

  it('does NOT flag an organic comment that merely contains the word "Sponsored"', () => {
    const item = makeFeedItem({
      caption: 'This is a TikTok caption that is long enough to pass the minimum length filter',
      author: 'creator1',
      comments: [{ text: 'lol this feels sponsored ngl', author: 'viewer1' }],
    });
    const posts = adapter.extractPosts(toNodeList([item]));
    const videoPost = posts.find((p) => p.kind === 'video');
    expect(videoPost?.is_sponsored).not.toBe(true);
  });

  it('does NOT flag an organic video whose data-e2e attribute merely contains the "ad-" substring', () => {
    const item = makeFeedItem({
      caption: 'This is a TikTok caption that is long enough to pass the minimum length filter',
      author: 'creator1',
    });
    // Plausible real TikTok control button (download icon in the share panel)
    // whose data-e2e value contains "ad-" as a mid-word substring, not as the
    // exact documented ad marker.
    const downloadIcon = document.createElement('button');
    downloadIcon.setAttribute('data-e2e', 'download-video');
    item.appendChild(downloadIcon);

    const posts = adapter.extractPosts(toNodeList([item]));
    const videoPost = posts.find((p) => p.kind === 'video');
    expect(videoPost?.is_sponsored).not.toBe(true);
  });

  it('does NOT flag an organic video with an unrelated data-e2e value containing "sponsored" as a substring', () => {
    const item = makeFeedItem({
      caption: 'This is a TikTok caption that is long enough to pass the minimum length filter',
      author: 'creator1',
    });
    const unrelated = document.createElement('div');
    unrelated.setAttribute('data-e2e', 'unsponsored-badge-hidden');
    item.appendChild(unrelated);

    const posts = adapter.extractPosts(toNodeList([item]));
    const videoPost = posts.find((p) => p.kind === 'video');
    expect(videoPost?.is_sponsored).not.toBe(true);
  });

  it.each([
    ['ad-tag', 'Ad'],
    ['ad-link', 'Ad'],
    ['ttam-ads-cta', 'Contact us'],
  ])('DOES flag a genuine ad carrying the exact %s marker', (markerValue, label) => {
    const item = makeFeedItem({
      caption: 'A current TikTok campaign caption that is long enough for the normal extraction path',
      author: 'example_sponsor',
    });
    const marker = document.createElement('span');
    marker.setAttribute('data-e2e', markerValue);
    marker.textContent = label;
    item.appendChild(marker);

    const posts = adapter.extractPosts(toNodeList([item]));
    const videoPost = posts.find((p) => p.kind === 'video');
    expect(videoPost?.is_sponsored).toBe(true);
  });
});

describe('TiktokAdapter sponsored-card remount replay (M70)', () => {
  const hiddenVideoId = '7910000000000000414';
  let adapter: TiktokAdapter;

  beforeEach(() => {
    adapter = new TiktokAdapter();
    _resetTikTokVideoDedupForTesting();
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.tiktok.com', pathname: '/', href: 'https://www.tiktok.com/' },
      writable: true,
      configurable: true,
    });
    document.body.innerHTML = '';
  });

  it('re-emits once when the same hidden ad rehydrates on the same root without its hide state', () => {
    const item = makeSponsoredFeedItem(hiddenVideoId);
    document.body.appendChild(item);

    const first = adapter.extractPosts(document.body.childNodes);
    expect(first.find((post) => post.kind === 'video')?.parentVideoId).toBe(hiddenVideoId);
    expect(injectAdHide(item, 'tiktok')).toBe(true);
    item.dataset.fwProcessed = 'true';

    rehydrateSponsoredFeedItem(item, hiddenVideoId);
    expect(item.dataset.fwCaptionEmitted).toBe('true');
    expect(item.dataset.fwProcessed).toBe('true');

    const replay = adapter.extractPosts(document.body.childNodes);
    expect(replay.filter((post) => post.kind === 'video')).toMatchObject([
      { parentVideoId: hiddenVideoId, is_sponsored: true },
    ]);

    expect(adapter.extractPosts(document.body.childNodes).filter((post) => post.kind === 'video')).toHaveLength(0);

    expect(injectAdHide(item, 'tiktok')).toBe(true);
    rehydrateSponsoredFeedItem(item, hiddenVideoId);
    expect(adapter.extractPosts(document.body.childNodes).filter((post) => post.kind === 'video')).toHaveLength(1);
  });

  it('does not replay a same-id sponsored card that was never successfully hidden', () => {
    const item = makeSponsoredFeedItem(hiddenVideoId);
    item.dataset.fwCaptionEmitted = 'true';
    document.body.appendChild(item);

    expect(adapter.extractPosts(document.body.childNodes).filter((post) => post.kind === 'video')).toHaveLength(0);
  });

  it('processes a changed sponsored identity as fresh without transferring the old identity', () => {
    const item = makeSponsoredFeedItem(hiddenVideoId);
    document.body.appendChild(item);
    expect(adapter.extractPosts(document.body.childNodes).filter((post) => post.kind === 'video')).toHaveLength(1);
    expect(injectAdHide(item, 'tiktok')).toBe(true);

    rehydrateSponsoredFeedItem(item, '7910000000000000415');
    expect(adapter.extractPosts(document.body.childNodes).filter((post) => post.kind === 'video')).toMatchObject([
      { parentVideoId: '7910000000000000415', is_sponsored: true },
    ]);
    expect(adapter.extractPosts(document.body.childNodes).filter((post) => post.kind === 'video')).toHaveLength(0);
  });

  it('does not transfer the hidden-ad replay to another root', () => {
    const item = makeSponsoredFeedItem(hiddenVideoId);
    document.body.appendChild(item);
    expect(adapter.extractPosts(document.body.childNodes).filter((post) => post.kind === 'video')).toHaveLength(1);
    expect(injectAdHide(item, 'tiktok')).toBe(true);

    const otherRoot = makeSponsoredFeedItem(hiddenVideoId);
    otherRoot.dataset.fwCaptionEmitted = 'true';
    document.body.replaceChildren(otherRoot);
    expect(adapter.extractPosts(document.body.childNodes).filter((post) => post.kind === 'video')).toHaveLength(0);
  });

  it.each([
    ['wrapper-less', []],
    ['malformed', ['xgwrapper-0-not-a-video-id']],
    ['valid plus malformed', ['xgwrapper-0-7910000000000000414', 'xgwrapper-1-not-a-video-id']],
    ['mixed', ['xgwrapper-0-7910000000000000414', 'xgwrapper-1-7910000000000000415']],
  ])('retains hidden identity through a %s partial rehydration until the exact wrapper appears', (_name, wrapperIds) => {
    const item = makeSponsoredFeedItem(hiddenVideoId);
    document.body.appendChild(item);
    expect(adapter.extractPosts(document.body.childNodes).filter((post) => post.kind === 'video')).toHaveLength(1);
    expect(injectAdHide(item, 'tiktok')).toBe(true);

    const hydrated = makeSponsoredFeedItem(hiddenVideoId);
    hydrated.querySelectorAll('[id^="xgwrapper-"]').forEach((wrapper) => wrapper.remove());
    for (const id of wrapperIds) {
      const wrapper = document.createElement('div');
      wrapper.id = id;
      hydrated.appendChild(wrapper);
    }
    item.replaceChildren(...Array.from(hydrated.childNodes));
    item.removeAttribute('data-fw-ad-hidden');
    item.style.removeProperty('display');

    expect(adapter.extractPosts(document.body.childNodes).filter((post) => post.kind === 'video')).toHaveLength(0);

    item.querySelectorAll('[id^="xgwrapper-"]').forEach((wrapper) => wrapper.remove());
    const exactWrapper = document.createElement('div');
    exactWrapper.id = `xgwrapper-0-${hiddenVideoId}`;
    item.appendChild(exactWrapper);

    expect(adapter.extractPosts(document.body.childNodes).filter((post) => post.kind === 'video')).toMatchObject([
      { parentVideoId: hiddenVideoId, is_sponsored: true },
    ]);
    expect(injectAdHide(item, 'tiktok')).toBe(true);
    expect(item.dataset.fwAdHidden).toBe('true');
    expect(adapter.extractPosts(document.body.childNodes).filter((post) => post.kind === 'video')).toHaveLength(0);
  });

  it('does not replay when the same identity rehydrates without a sponsored marker', () => {
    const item = makeSponsoredFeedItem(hiddenVideoId);
    document.body.appendChild(item);
    expect(adapter.extractPosts(document.body.childNodes).filter((post) => post.kind === 'video')).toHaveLength(1);
    expect(injectAdHide(item, 'tiktok')).toBe(true);

    rehydrateSponsoredFeedItem(item, hiddenVideoId);
    const adTag = item.querySelector<HTMLElement>('[data-e2e="ad-tag"]');
    expect(adTag).not.toBeNull();
    adTag!.remove();
    expect(adapter.extractPosts(document.body.childNodes).filter((post) => post.kind === 'video')).toHaveLength(0);

    item.appendChild(adTag!);
    expect(adapter.extractPosts(document.body.childNodes).filter((post) => post.kind === 'video')).toHaveLength(1);
    expect(adapter.extractPosts(document.body.childNodes).filter((post) => post.kind === 'video')).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TikTok DOM rotation: rows are now `[class*="DivCommentItemWrapper"]` DIVs;
// `[data-e2e="comment-level-1"]` is the inner text-wrapper SPAN, not the row.
// The row holds: avatar `<a>` (text empty) + username `<a>` (text=handle) +
// `comment-level-1` SPAN containing the inner TUXText span. Backward-compat
// path: when no DivCommentItemWrapper rows match, the legacy
// `comment-level-1`-as-row shape still extracts.
// ─────────────────────────────────────────────────────────────────────────────
