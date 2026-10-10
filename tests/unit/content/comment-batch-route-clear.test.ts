// @vitest-environment jsdom
//
// SPA route lifecycle regressions: M6 pending-batch leakage, M42 exact-PASS
// re-checking, and M59 strict-language policy invalidation.
//
// Bug: content/index.ts buckets comments per parentVideoId/roomUrl on a
// debounce timer. The interceptor's SPA route-change handler stripped stale
// `data-fw-processed` stamps and re-walked the DOM, but never cancelled the
// pending bucket timers. A bucket armed on page A would flush AFTER the user
// navigated to page B, writing page A's comments under page B's room context
// (VISION §1.1 chain-mirror violation).
//
// Fix: `clearPendingBatchesForRouteChange()` cancels every bucket timer and
// drops the bucket + per-parent flush-rate maps; the ContentInterceptor invokes
// it (as `onRouteChange`) at the start of `_rescanAfterRoute`.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  clearPendingBatchesForRouteChange,
  _seedPendingBatchForTesting,
  _peekPendingBatchKeysForTesting,
  _setChildProtectionModeForTesting,
  _mountProtectionForTesting,
  _stampClassificationForTesting,
  _isCurrentClassificationForTesting,
  _releaseProtectionForTesting,
  _renderCommentMarkerForTesting,
  _childProtectionActiveCountForTesting,
  _seedSessionVerdictCachesForTesting,
  _clearSessionVerdictCachesOnModeChangeForTesting,
  _hasSessionPassForTesting,
} from '../../../src/content/index';
import { ContentInterceptor } from '../../../src/content/post-path/dom-interceptor';
import { installPageWorldRouteNotifier } from '../../../src/content/page-world/route-notifier';
import type { PlatformAdapter } from '../../../src/content/platforms/adapter';
import type { PostContent } from '../../../src/types/post';
import {
  _resetViewportTrackerForTesting,
  setParentCooldown,
} from '../../../src/content/post-path/viewport-tracker';

interface RoomSnapshot {
  caption: string;
  videoUrl: string;
  videoAuthor: string;
  feedSource: string;
  platform: string;
  permalinkUrl?: string;
}

interface RoomContextHooks {
  seedParent(post: Record<string, unknown>): void;
  enqueue(post: Record<string, unknown>): boolean;
  takeForFlush(key: string): {
    batch: RoomSnapshot;
    commentRecord: {
      postUrl: string;
      roomAuthor: string;
      roomCaption: string;
      roomUrl: string;
    };
    environmentRecord: { postUrl: string; videoCaption: string };
  } | undefined;
  peekBatch(key: string): RoomSnapshot | undefined;
}

async function roomContextHooks(): Promise<RoomContextHooks> {
  const content = await import('../../../src/content/index') as unknown as Record<string, unknown>;
  expect(content._seedRoomContextFromPostForTesting).toBeTypeOf('function');
  expect(content._enqueueCommentForBatchForTesting).toBeTypeOf('function');
  expect(content._takePendingBatchForFlushForTesting).toBeTypeOf('function');
  expect(content._peekPendingBatchRoomForTesting).toBeTypeOf('function');
  return {
    seedParent: content._seedRoomContextFromPostForTesting as RoomContextHooks['seedParent'],
    enqueue: content._enqueueCommentForBatchForTesting as RoomContextHooks['enqueue'],
    takeForFlush:
      content._takePendingBatchForFlushForTesting as RoomContextHooks['takeForFlush'],
    peekBatch: content._peekPendingBatchRoomForTesting as RoomContextHooks['peekBatch'],
  };
}

function parentPost(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'post',
    id,
    text: `caption-${id}`,
    author: `author-${id}`,
    sourceUrl: `https://x.com/author-${id}/status/${id}`,
    platform: 'twitter',
    feedSource: 'home',
    ...overrides,
  };
}

function comment(id: string, parentVideoId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'comment',
    id,
    parentVideoId,
    text: `comment-${id}`,
    platform: 'twitter',
    feedSource: 'home',
    ...overrides,
  };
}

const PRISTINE_PUSH = history.pushState;
const PRISTINE_REPLACE = history.replaceState;

beforeEach(() => {
  document.body.innerHTML = '';
  history.pushState = PRISTINE_PUSH;
  history.replaceState = PRISTINE_REPLACE;
  history.replaceState({}, '', '/');
  // Drop any buckets a prior test seeded.
  clearPendingBatchesForRouteChange();
  _resetViewportTrackerForTesting();
});

afterEach(() => {
  _setChildProtectionModeForTesting('adult');
  _clearSessionVerdictCachesOnModeChangeForTesting();
  history.pushState = PRISTINE_PUSH;
  history.replaceState = PRISTINE_REPLACE;
  clearPendingBatchesForRouteChange();
  _resetViewportTrackerForTesting();
  vi.useRealTimers();
});

describe('M6 + M42 + M59 route lifecycle', () => {
  it('M42 bypasses an unchanged resolved comment but not changed input or room identity', async () => {
    const row = document.createElement('div');
    row.textContent = 'already checked comment';
    document.body.appendChild(row);
    const resolved = {
      id: 'comment-42', text: row.textContent, author: 'alice', timestamp: '',
      platform: 'facebook', kind: 'comment', parentVideoId: 'room-A', depth: 1,
      context: 'room caption A', domRef: new WeakRef(row),
    } as PostContent;
    _seedSessionVerdictCachesForTesting(
      resolved,
      { rewrittenText: '', analysis: {} } as never,
      {} as never,
    );

    const content = await import('../../../src/content/index') as unknown as {
      _shouldBypassResolvedBatchedCommentForTesting?: (post: PostContent) => boolean;
      _routeBatchedCommentForTesting?: (
        post: PostContent,
        enqueue: () => boolean,
        detectedAt: number,
      ) => boolean;
    };
    expect(content._shouldBypassResolvedBatchedCommentForTesting).toBeTypeOf('function');
    expect(content._routeBatchedCommentForTesting).toBeTypeOf('function');
    const shouldBypass = content._shouldBypassResolvedBatchedCommentForTesting!;
    const routeComment = content._routeBatchedCommentForTesting!;

    expect(shouldBypass(resolved)).toBe(true);
    expect(shouldBypass({ ...resolved, text: 'changed comment' })).toBe(false);
    expect(shouldBypass({ ...resolved, parentVideoId: 'room-B' })).toBe(false);
    expect(shouldBypass({ ...resolved, context: 'room caption B' })).toBe(false);

    const preview = {
      ...resolved,
      id: 'comment-42-preview',
      text: 'same Facebook comment previewâ€¦ See more',
    } as PostContent;
    const expanded = {
      ...preview,
      text: 'same Facebook comment preview with the full remaining body',
    } as PostContent;
    _seedSessionVerdictCachesForTesting(
      preview,
      { rewrittenText: '', analysis: {} } as never,
      {} as never,
    );
    expect(shouldBypass(preview)).toBe(true);
    expect(shouldBypass(expanded)).toBe(false);

    const expandedFirst = { ...expanded, id: 'comment-42-expanded' } as PostContent;
    const previewAfterExpanded = { ...preview, id: expandedFirst.id } as PostContent;
    _seedSessionVerdictCachesForTesting(
      expandedFirst,
      { rewrittenText: '', analysis: {} } as never,
      {} as never,
    );
    expect(shouldBypass(expandedFirst)).toBe(true);
    expect(shouldBypass(previewAfterExpanded)).toBe(false);

    _setChildProtectionModeForTesting('child');
    const enqueue = vi.fn(() => true);
    expect(routeComment(resolved, enqueue, performance.now())).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
    expect(row.querySelector('.fw-provisional-shield')).toBeNull();

    const changed = { ...resolved, text: 'changed comment' } as PostContent;
    expect(routeComment(changed, enqueue, performance.now())).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(row.querySelector('.fw-provisional-shield')).not.toBeNull();
    _releaseProtectionForTesting(changed);
  });

  it('M59 strict-language change invalidates an exact PASS and pending old-policy batch', async () => {
    vi.useFakeTimers();
    const row = document.createElement('div');
    row.textContent = 'damn, already passed with strict language off';
    document.body.appendChild(row);
    const post = {
      id: 'comment-59', text: row.textContent, author: 'alice', timestamp: '',
      platform: 'facebook', kind: 'comment', parentVideoId: 'room-59', depth: 1,
      domRef: new WeakRef(row),
    } as PostContent;
    _seedSessionVerdictCachesForTesting(
      post,
      { rewrittenText: '', analysis: {} } as never,
      {} as never,
    );
    _seedPendingBatchForTesting('room-59', vi.fn(), 1500);
    expect(_hasSessionPassForTesting(post)).toBe(true);
    expect(_peekPendingBatchKeysForTesting()).toContain('room-59');

    const content = await import('../../../src/content/index') as unknown as {
      _applyRuntimeStrictLanguageChangeForTesting?: () => void;
    };
    expect(content._applyRuntimeStrictLanguageChangeForTesting).toBeTypeOf('function');
    content._applyRuntimeStrictLanguageChangeForTesting!();

    expect(_hasSessionPassForTesting(post)).toBe(false);
    expect(_peekPendingBatchKeysForTesting()).not.toContain('room-59');
  });

  it('M60 hides only an exact Facebook comment anchor', async () => {
    const parent = document.createElement('div');
    parent.dataset.fwPostId = 'room-60';
    const wrapper = document.createElement('div');
    wrapper.setAttribute('role', 'article');
    wrapper.setAttribute('aria-label', 'Comment by Alice');
    const author = document.createElement('a');
    author.setAttribute('role', 'link');
    author.textContent = 'Alice';
    const body = document.createElement('div');
    body.setAttribute('dir', 'auto');
    body.textContent = 'exact harmful comment';
    wrapper.append(author, body);
    parent.appendChild(wrapper);
    document.body.appendChild(parent);
    const post = {
      id: 'comment-60', text: body.textContent, author: 'Alice', timestamp: '',
      platform: 'facebook', kind: 'comment', parentVideoId: 'room-60', depth: 1,
      domRef: new WeakRef(body),
    } as PostContent;
    const content = await import('../../../src/content/index') as unknown as {
      _applyCommentHideForTesting?: (post: PostContent) => boolean;
    };
    expect(content._applyCommentHideForTesting).toBeTypeOf('function');
    _setChildProtectionModeForTesting('teen');

    expect(content._applyCommentHideForTesting!(post)).toBe(true);
    expect(body.dataset.fwHiddenFallback).toBe('true');
    expect(body.style.getPropertyValue('display')).toBe('none');

    const benign = document.createElement('div');
    benign.setAttribute('dir', 'auto');
    benign.textContent = 'different benign comment';
    wrapper.replaceChild(benign, body);
    const recycledPost = { ...post, domRef: new WeakRef(benign) } as PostContent;
    expect(content._applyCommentHideForTesting!(recycledPost)).toBe(false);
    expect(benign.style.getPropertyValue('display')).toBe('');

    const childParent = document.createElement('div');
    childParent.dataset.fwPostId = 'room-60-child';
    const oldWrapper = document.createElement('div');
    oldWrapper.setAttribute('role', 'article');
    oldWrapper.setAttribute('aria-label', 'Comment by Alice');
    const oldAuthor = author.cloneNode(true) as HTMLElement;
    const oldBody = document.createElement('div');
    oldBody.setAttribute('dir', 'auto');
    oldBody.textContent = 'child exact harmful comment';
    oldWrapper.append(oldAuthor, oldBody);
    childParent.appendChild(oldWrapper);
    document.body.appendChild(childParent);
    const childPost = {
      ...post,
      id: 'comment-60-child',
      text: oldBody.textContent,
      parentVideoId: 'room-60-child',
      domRef: new WeakRef(oldBody),
    } as PostContent;
    _setChildProtectionModeForTesting('child');
    _mountProtectionForTesting(childPost, performance.now());
    expect(_childProtectionActiveCountForTesting()).toBe(1);

    const newWrapper = document.createElement('div');
    newWrapper.setAttribute('role', 'article');
    newWrapper.setAttribute('aria-label', 'Comment by Alice');
    const newAuthor = author.cloneNode(true) as HTMLElement;
    const newBody = document.createElement('div');
    newBody.setAttribute('dir', 'auto');
    newBody.textContent = childPost.text;
    newWrapper.append(newAuthor, newBody);
    oldWrapper.replaceWith(newWrapper);

    expect(content._applyCommentHideForTesting!(childPost)).toBe(true);
    expect(newBody.dataset.fwHiddenFallback).toBe('true');
    expect(_childProtectionActiveCountForTesting()).toBe(0);
  });

  it('M62 hides an exact multi-paragraph Facebook comment', async () => {
    const parent = document.createElement('div');
    parent.dataset.fwPostId = 'room-62';
    const wrapper = document.createElement('div');
    wrapper.setAttribute('role', 'article');
    wrapper.setAttribute('aria-label', 'Comment by Alice');
    const author = document.createElement('a');
    author.setAttribute('role', 'link');
    author.textContent = 'Alice';
    const body = document.createElement('div');
    const first = document.createElement('div');
    first.setAttribute('dir', 'auto');
    first.textContent = 'first harmful paragraph';
    const second = document.createElement('div');
    second.setAttribute('dir', 'auto');
    second.textContent = 'second harmful paragraph';
    body.append(first, second);
    wrapper.append(author, body);
    parent.appendChild(wrapper);
    document.body.appendChild(parent);
    const post = {
      id: 'comment-62', text: 'first harmful paragraph\nsecond harmful paragraph',
      author: 'Alice', timestamp: '', platform: 'facebook', kind: 'comment',
      parentVideoId: 'room-62', depth: 1, domRef: new WeakRef(body),
    } as PostContent;
    const content = await import('../../../src/content/index') as unknown as {
      _applyCommentHideForTesting?: (post: PostContent) => boolean;
    };
    _setChildProtectionModeForTesting('teen');

    second.textContent = 'changed harmful paragraph';
    expect(content._applyCommentHideForTesting!(post)).toBe(false);
    expect(body.dataset.fwHiddenFallback).toBeUndefined();
    second.textContent = 'second harmful paragraph';
    expect(content._applyCommentHideForTesting!(post)).toBe(true);
    expect(body.dataset.fwHiddenFallback).toBe('true');
  });

  it('M60 never walks to the first duplicate on a non-Facebook hide', async () => {
    const list = document.createElement('ul');
    const makeInstagramRow = (authorText: string): HTMLElement => {
      const row = document.createElement('li');
      const authorEl = document.createElement('a');
      authorEl.setAttribute('role', 'link');
      authorEl.textContent = authorText;
      const body = document.createElement('span');
      body.textContent = 'duplicate body with enough substance';
      row.append(authorEl, body);
      return row;
    };
    const first = makeInstagramRow('@first');
    const second = makeInstagramRow('@second');
    list.append(first, second);
    document.body.appendChild(list);
    const post = {
      id: 'ig-comment-60',
      text: 'duplicate body with enough substance',
      author: '@second',
      timestamp: '',
      platform: 'instagram',
      kind: 'comment',
      parentVideoId: 'ig-room-60',
      depth: 1,
      domRef: new WeakRef(second),
    } as PostContent;
    const content = await import('../../../src/content/index') as unknown as {
      _applyCommentHideForTesting?: (post: PostContent) => boolean;
    };
    _setChildProtectionModeForTesting('teen');

    expect(content._applyCommentHideForTesting!(post)).toBe(true);
    expect(first.dataset.fwHiddenFallback).toBeUndefined();
    expect(second.dataset.fwHiddenFallback).toBe('true');
  });

  it('reuses observed parent identity when a later batch forms after the first drain', async () => {
    const hooks = await roomContextHooks();
    hooks.seedParent(parentPost('123'));
    expect(_peekPendingBatchKeysForTesting()).toEqual([]);

    hooks.enqueue(comment('first', '123'));
    expect(hooks.peekBatch('123')).toMatchObject({
      caption: 'caption-123',
      videoUrl: 'https://x.com/author-123/status/123',
      videoAuthor: 'author-123',
      feedSource: 'home',
      platform: 'twitter',
    });

    expect(hooks.takeForFlush('123')).toMatchObject({
      batch: {
        caption: 'caption-123',
        videoUrl: 'https://x.com/author-123/status/123',
        videoAuthor: 'author-123',
      },
      commentRecord: {
        postUrl: 'https://x.com/author-123/status/123',
        roomAuthor: 'author-123',
        roomCaption: 'caption-123',
        roomUrl: 'https://x.com/author-123/status/123',
      },
      environmentRecord: {
        postUrl: 'https://x.com/author-123/status/123',
        videoCaption: 'caption-123',
      },
    });
    hooks.enqueue(comment('later', '123'));
    expect(hooks.peekBatch('123')).toMatchObject({
      caption: 'caption-123',
      videoUrl: 'https://x.com/author-123/status/123',
      videoAuthor: 'author-123',
    });
  });

  it('reports a cooldown-rejected comment without allocating a batch', async () => {
    const hooks = await roomContextHooks();
    setParentCooldown('cooling-parent');

    expect(hooks.enqueue(comment('blocked', 'cooling-parent'))).toBe(false);
    expect(_peekPendingBatchKeysForTesting()).not.toContain('cooling-parent');
  });

  it('seeds an X focused reply that acts as the parent of batched child replies', async () => {
    const hooks = await roomContextHooks();
    hooks.seedParent(parentPost('8100000000000000003', {
      kind: 'reply',
      text: 'focused tweet',
      author: 'focused-author',
      sourceUrl: 'https://x.com/focused-author/status/8100000000000000003',
    }));

    hooks.enqueue(comment('3001', '8100000000000000003', { kind: 'reply-to-reply' }));

    expect(hooks.peekBatch('8100000000000000003')).toMatchObject({
      caption: 'focused tweet',
      videoUrl: 'https://x.com/focused-author/status/8100000000000000003',
      videoAuthor: 'focused-author',
    });
  });

  it('bounds parent-only room context without creating timerless pending batches', async () => {
    const hooks = await roomContextHooks();
    for (let i = 0; i <= 500; i += 1) {
      hooks.seedParent(parentPost(String(i)));
    }
    expect(_peekPendingBatchKeysForTesting()).toEqual([]);

    hooks.enqueue(comment('old', '0'));
    hooks.enqueue(comment('new', '500'));
    expect(hooks.peekBatch('0')).toMatchObject({ caption: '', videoUrl: '', videoAuthor: 'unknown' });
    expect(hooks.peekBatch('500')).toMatchObject({ caption: 'caption-500' });
  });

  it('does not carry a conflicting late parent over the observed room or future batches', async () => {
    const hooks = await roomContextHooks();
    hooks.seedParent(parentPost('123'));
    hooks.enqueue(comment('first', '123'));

    hooks.seedParent(parentPost('123', {
      text: 'neighbour caption',
      author: 'neighbour',
      sourceUrl: 'https://x.com/neighbour/status/999',
    }));

    expect(hooks.peekBatch('123')).toMatchObject({
      caption: 'caption-123',
      videoUrl: 'https://x.com/author-123/status/123',
      videoAuthor: 'author-123',
    });
    hooks.takeForFlush('123');
    hooks.enqueue(comment('later', '123'));
    expect(hooks.peekBatch('123')).toMatchObject({
      caption: 'caption-123',
      videoUrl: 'https://x.com/author-123/status/123',
      videoAuthor: 'author-123',
    });
  });

  it('promotes a generic Facebook surface URL to a later exact parent permalink', async () => {
    const hooks = await roomContextHooks();
    hooks.seedParent(parentPost('456', {
      platform: 'facebook',
      author: 'creator',
      sourceUrl: 'https://www.facebook.com/',
    }));
    hooks.enqueue(comment('first', '456', { platform: 'facebook' }));
    hooks.takeForFlush('456');

    hooks.seedParent(parentPost('456', {
      platform: 'facebook',
      author: 'creator',
      sourceUrl: 'https://www.facebook.com/creator/posts/456',
    }));
    hooks.enqueue(comment('later', '456', { platform: 'facebook' }));

    expect(hooks.peekBatch('456')).toMatchObject({
      videoUrl: 'https://www.facebook.com/creator/posts/456',
      videoAuthor: 'creator',
    });
  });

  it('scopes remembered identity by platform and takes observation metadata from the new comment', async () => {
    const hooks = await roomContextHooks();
    history.replaceState({}, '', '/old-surface');
    hooks.seedParent(parentPost('123'));
    history.replaceState({}, '', '/search?q=current');

    hooks.enqueue(comment('tt-comment', '123', { platform: 'tiktok', feedSource: 'search' }));

    expect(hooks.peekBatch('123')).toEqual({
      caption: '',
      videoUrl: '',
      videoAuthor: 'unknown',
      feedSource: 'search',
      platform: 'tiktok',
      permalinkUrl: 'http://localhost:3000/search?q=current',
    });
  });

  it('persists an id-gated permalink fallback for later batches', async () => {
    const hooks = await roomContextHooks();
    history.replaceState({}, '', '/@creator/video/123');
    hooks.enqueue(comment('first', '123', { platform: 'tiktok' }));
    expect(hooks.takeForFlush('123')).toMatchObject({
      commentRecord: {
        postUrl: 'http://localhost:3000/@creator/video/123',
        roomAuthor: '@creator',
        roomUrl: 'http://localhost:3000/@creator/video/123',
      },
      environmentRecord: {
        postUrl: 'http://localhost:3000/@creator/video/123',
      },
    });

    hooks.enqueue(comment('later', '123', { platform: 'tiktok' }));

    expect(hooks.peekBatch('123')).toMatchObject({
      videoUrl: 'http://localhost:3000/@creator/video/123',
      videoAuthor: '@creator',
    });
  });

  it('a previously-pending bucket timer does NOT flush after a route-change clear', () => {
    vi.useFakeTimers();
    const flush = vi.fn();
    _seedPendingBatchForTesting('parent-A', flush, 1500);

    // The bucket is armed.
    expect(_peekPendingBatchKeysForTesting()).toEqual(['parent-A']);

    // Route change occurs before the debounce elapses.
    clearPendingBatchesForRouteChange();

    // Advance well past the original debounce window.
    vi.advanceTimersByTime(5000);

    // The stale bucket's timer was cancelled — it must never flush under the
    // new url's context.
    expect(flush).not.toHaveBeenCalled();
    expect(_peekPendingBatchKeysForTesting()).toEqual([]);
  });

  it('keeps a connected Child cover while invalidating old public-route work', () => {
    const row = document.createElement('article');
    row.textContent = 'old route content still mounted';
    document.body.appendChild(row);
    const post = {
      id: 'route-covered', text: row.textContent, author: 'alice', timestamp: '',
      platform: 'twitter', kind: 'post', domRef: new WeakRef(row),
    } as PostContent;
    _setChildProtectionModeForTesting('child');
    _stampClassificationForTesting(post);
    _mountProtectionForTesting(post, performance.now());

    history.replaceState({}, '', '/next-public-surface');
    clearPendingBatchesForRouteChange('route');

    expect(_isCurrentClassificationForTesting(post)).toBe(false);
    _releaseProtectionForTesting(post); // stale queue/batch completion
    expect(row.querySelector('.fw-provisional-shield')).not.toBeNull();

    const freshPost = { ...post, domRef: new WeakRef(row) } as PostContent;
    _stampClassificationForTesting(freshPost);
    _mountProtectionForTesting(freshPost, performance.now());
    _releaseProtectionForTesting(post);
    expect(_childProtectionActiveCountForTesting()).toBe(1);
    expect(row.querySelector('.fw-provisional-shield')).not.toBeNull();

    _releaseProtectionForTesting(freshPost);
    expect(_childProtectionActiveCountForTesting()).toBe(0);
    expect(row.querySelector('.fw-provisional-shield')).toBeNull();

    _setChildProtectionModeForTesting('adult');
  });

  it('a deferred comment generation cannot mount its marker after route invalidation', () => {
    const row = document.createElement('div');
    row.textContent = 'safe rewritten comment';
    document.body.appendChild(row);
    const post = {
      id: 'stale-comment', text: 'original comment', author: 'alice', timestamp: '',
      platform: 'twitter', kind: 'top-comment', parentVideoId: 'parent', domRef: new WeakRef(row),
    } as PostContent;
    _stampClassificationForTesting(post);
    clearPendingBatchesForRouteChange('route');

    const marker = _renderCommentMarkerForTesting(post, {
      el: row,
      analysis: {
        postId: post.id,
        techniques: [],
        overallScore: 7,
        overallConfidence: 0.8,
        isManipulative: true,
        processingTimeMs: 0,
        primaryTechnique: 'shame-attack',
      },
      originalText: post.text,
      kind: 'rewrite',
      rewriteText: 'safe rewritten comment',
      lang: 'en',
    });

    expect(marker).toBeNull();
    expect(row.querySelector('.fw-teen-marker')).toBeNull();
  });

  it('releases Child covers immediately when the route becomes private', () => {
    const row = document.createElement('article');
    row.textContent = 'public feed item';
    document.body.appendChild(row);
    const post = {
      id: 'private-transition', text: row.textContent, author: 'alice', timestamp: '',
      platform: 'facebook', kind: 'post', domRef: new WeakRef(row),
    } as PostContent;
    _setChildProtectionModeForTesting('child');
    _stampClassificationForTesting(post);
    _mountProtectionForTesting(post, performance.now());

    history.replaceState({}, '', '/messages/t/private-thread');
    clearPendingBatchesForRouteChange('route');

    expect(row.querySelector('.fw-provisional-shield')).toBeNull();
    _setChildProtectionModeForTesting('adult');
    history.replaceState({}, '', '/');
  });

  it('route-change clear also removes remembered room context', async () => {
    const hooks = await roomContextHooks();
    hooks.seedParent(parentPost('old-room'));

    clearPendingBatchesForRouteChange();
    hooks.enqueue(comment('after-route', 'old-room'));

    expect(hooks.peekBatch('old-room')).toMatchObject({
      caption: '',
      videoUrl: '',
      videoAuthor: 'unknown',
    });
  });

  it('without a clear, the seeded bucket timer WOULD flush (control — proves the timer is real)', () => {
    vi.useFakeTimers();
    const flush = vi.fn();
    _seedPendingBatchForTesting('parent-B', flush, 1500);

    vi.advanceTimersByTime(1500);

    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('clears multiple buckets and the per-parent flush-rate map in one pass', () => {
    vi.useFakeTimers();
    const a = vi.fn();
    const b = vi.fn();
    _seedPendingBatchForTesting('parent-A', a, 1500);
    _seedPendingBatchForTesting('parent-B', b, 1500);
    expect(_peekPendingBatchKeysForTesting().sort()).toEqual(['parent-A', 'parent-B']);

    clearPendingBatchesForRouteChange();
    vi.advanceTimersByTime(5000);

    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
    expect(_peekPendingBatchKeysForTesting()).toEqual([]);
  });
});

function makeTwitterAdapter(): PlatformAdapter {
  return {
    platform: 'twitter',
    detectPlatform: () => true,
    getPostSelector: () => '[data-testid="tweetText"]',
    extractPosts: () => [],
  };
}

describe('M6 — ContentInterceptor invokes onRouteChange on SPA navigation', () => {
  // G3 (2026-08-04): the interceptor no longer patches its isolated-world
  // History binding (page frameworks never call it). Install the MAIN-world
  // route notifier so the `history.pushState` calls below reach the watcher
  // as fw:route-change — jsdom's single realm stands in for both worlds.
  let disposeNotifier: (() => void) | null = null;
  beforeEach(() => {
    delete (window as { __fwRouteNotifierInstalled?: boolean }).__fwRouteNotifierInstalled;
    disposeNotifier = installPageWorldRouteNotifier();
  });
  afterEach(() => {
    disposeNotifier?.();
    disposeNotifier = null;
  });

  it('calls the onRouteChange hook when the route changes', async () => {
    vi.useFakeTimers();
    const onRouteChange = vi.fn();
    const interceptor = new ContentInterceptor(makeTwitterAdapter(), vi.fn(), onRouteChange);
    interceptor.start();
    expect(onRouteChange).not.toHaveBeenCalled();

    history.pushState({}, '', '/alice/status/12345');
    await vi.advanceTimersByTimeAsync(500);

    expect(onRouteChange).toHaveBeenCalled();
    interceptor.stop();
  });

  it('prunes a detached stale comment cover after the delayed empty-route rescan', async () => {
    vi.useFakeTimers();
    history.replaceState({}, '', '/home');
    const row = document.createElement('article');
    row.textContent = 'old route comment awaiting a verdict';
    document.body.appendChild(row);
    const post = {
      id: 'empty-route-stale-comment', text: row.textContent, author: 'alice', timestamp: '',
      platform: 'twitter', kind: 'top-comment', parentVideoId: 'old-parent',
      domRef: new WeakRef(row),
    } as PostContent;
    _setChildProtectionModeForTesting('child');
    _stampClassificationForTesting(post);
    _mountProtectionForTesting(post, performance.now());
    const interceptor = new ContentInterceptor(
      makeTwitterAdapter(),
      vi.fn(),
      clearPendingBatchesForRouteChange,
    );
    interceptor.start();

    history.pushState({}, '', '/empty');
    expect(row.querySelector('.fw-provisional-shield')).not.toBeNull();
    row.remove();
    await vi.advanceTimersByTimeAsync(500);

    expect(row.querySelector('.fw-provisional-shield')).toBeNull();
    interceptor.stop();
    _setChildProtectionModeForTesting('adult');
  });

  it('omitting the hook is safe (no throw on route change)', async () => {
    vi.useFakeTimers();
    const interceptor = new ContentInterceptor(makeTwitterAdapter(), vi.fn());
    interceptor.start();

    history.pushState({}, '', '/bob/status/67890');
    let threw = false;
    try {
      await vi.advanceTimersByTimeAsync(500);
    } catch {
      threw = true;
    }
    // Route-change rescan ran with no onRouteChange hook and did not throw.
    expect(threw).toBe(false);

    interceptor.stop();
  });
});
