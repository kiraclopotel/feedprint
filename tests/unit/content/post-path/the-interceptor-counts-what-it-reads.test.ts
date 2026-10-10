// @vitest-environment jsdom
//
// B10-1: the interceptor counts each item it accepts as read, once, by kind.
//
// The count sits at the one place an item is accepted (the fwProcessed stamp, before onPost), so it
// holds for posts the queue later drops and posts the session caches answer, which the scan log
// never saw. Only numbers reach storage.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentInterceptor } from '../../../../src/content/post-path/dom-interceptor';
import * as settings from '../../../../src/storage/settings';
import type { PlatformAdapter } from '../../../../src/content/platforms/adapter';
import type { PostContent } from '../../../../src/types/post';
import { installCounterChrome, type FakeCounterChrome } from '../../../helpers/fake-counter-chrome';

let fake: FakeCounterChrome;
const flush = (): Promise<void> => (settings as unknown as { flushItemsRead: () => Promise<void> }).flushItemsRead();
const readToday = (): Record<string, { posts: number; comments: number; videos: number }> =>
  fake.state.readToday as Record<string, { posts: number; comments: number; videos: number }>;

/** One element per item on the page, and an adapter that hands each unstamped element back as a post. */
function pageWith(kinds: Array<PostContent['kind']>, platform: PlatformAdapter['platform']): PlatformAdapter {
  document.body.innerHTML = kinds.map((_, i) => `<div class="item" id="item-${i}">text ${i}</div>`).join('');
  return {
    platform,
    detectPlatform: () => true,
    getPostSelector: () => '.item',
    extractPosts: () =>
      [...document.querySelectorAll<HTMLElement>('.item')]
        .filter((el) => el.dataset.fwProcessed !== 'true')
        .map((el) => {
          const i = Number(el.id.replace('item-', ''));
          return {
            id: `p-${i}`, text: `text ${i}`, author: '@a', timestamp: '2026-09-30T00:00:00Z', platform,
            domRef: new WeakRef(el), kind: kinds[i],
          } as PostContent;
        }),
  };
}

beforeEach(() => {
  fake = installCounterChrome({ lastResetDate: settings.utcDayKey(), lastResetMonth: settings.utcMonthKey() });
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('the interceptor counts what it reads', () => {
  it('a page of N posts leaves readToday.<platform>.posts = N', async () => {
    const interceptor = new ContentInterceptor(pageWith(['post', 'post', 'post', 'post', 'post'], 'twitter'), vi.fn());
    interceptor.start();
    await flush();
    interceptor.stop();
    expect(readToday().twitter).toEqual({ posts: 5, comments: 0, videos: 0 });
  });

  it('comments and videos are counted apart from posts', async () => {
    const interceptor = new ContentInterceptor(
      pageWith(['post', 'video', 'video', 'top-comment', 'reply', 'reply-to-reply', 'comment'], 'tiktok'),
      vi.fn(),
    );
    interceptor.start();
    await flush();
    interceptor.stop();
    expect(readToday().tiktok).toEqual({ posts: 1, comments: 4, videos: 2 });
  });

  it('a rescan of the same elements adds nothing: an item counts once', async () => {
    const adapter = pageWith(['post', 'post', 'post'], 'facebook');
    const interceptor = new ContentInterceptor(adapter, vi.fn());
    interceptor.start();
    interceptor.rescanCurrentSurfaceNow();
    interceptor.rescanCurrentSurfaceNow();
    await flush();
    interceptor.stop();
    expect(readToday().facebook.posts).toBe(3);
  });

  it('only numbers are stored, and nothing about the items', async () => {
    const interceptor = new ContentInterceptor(pageWith(['post', 'post'], 'twitter'), vi.fn());
    interceptor.start();
    await flush();
    interceptor.stop();
    const text = JSON.stringify(fake.state.readToday);
    expect(text).toContain('twitter');
    expect(text).not.toContain('text 0');
    expect(text).not.toContain('@a');
    expect(text).not.toContain('p-0');
  });
});
