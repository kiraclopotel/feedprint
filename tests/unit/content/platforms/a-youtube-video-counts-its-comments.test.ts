// @vitest-environment jsdom
//
// B10-1: a YouTube watch page counts the comment threads it read, once each.
//
// The auditor's live walk (A3): 140 comments read on one video, the only count held 2, because
// the comment path sends no scan log. The count sits where a thread is first seen (the fwYtSeen
// stamp of a new comment), so scrolling that re-stamps a thread already seen adds nothing.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const flagState = { ytWatchComments: true };
vi.mock('../../../../src/storage/feature-flags', () => ({
  isFeatureEnabled: vi.fn(async (flag: string) => (flag === 'ytWatchComments' ? flagState.ytWatchComments : false)),
}));

import { initYtWatchComments, __ytWatchScanNowForTest } from '../../../../src/content/platforms/yt-watch-comments';
import * as settings from '../../../../src/storage/settings';
import type { PostContent } from '../../../../src/types/post';
import { installCounterChrome, type FakeCounterChrome } from '../../../helpers/fake-counter-chrome';

let fake: FakeCounterChrome;
let cleanup: (() => void) | null = null;
let emitted: PostContent[] = [];
let n = 0;

const flush = (): Promise<void> => (settings as unknown as { flushItemsRead: () => Promise<void> }).flushItemsRead();
const youtube = (): { posts: number; comments: number; videos: number } | undefined =>
  (fake.state.readToday as Record<string, { posts: number; comments: number; videos: number }> | undefined)?.youtube;

function buildWatchPage(videoId: string): HTMLElement {
  window.history.replaceState({}, '', `/watch?v=${videoId}`);
  document.body.innerHTML = `
    <h1 class="ytd-watch-metadata"><yt-formatted-string>A video</yt-formatted-string></h1>
    <div id="owner"><ytd-channel-name id="channel-name"><a href="/@c">Channel</a></ytd-channel-name></div>
    <ytd-comments id="comments"></ytd-comments>`;
  return document.getElementById('comments')!;
}

function addThread(container: HTMLElement, text: string, author: string): HTMLElement {
  n++;
  const thread = document.createElement('ytd-comment-thread-renderer');
  thread.innerHTML = `<div id="comment"><a id="author-text"><span>${author}</span></a>
    <a href="/watch?v=x&lc=c-${n}"></a><yt-attributed-string id="content-text"><span>${text}</span></yt-attributed-string></div>`;
  container.appendChild(thread);
  return thread;
}

beforeEach(() => {
  vi.useFakeTimers();
  fake = installCounterChrome({ lastResetDate: settings.utcDayKey(), lastResetMonth: settings.utcMonthKey() });
  emitted = [];
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.useRealTimers();
  document.body.innerHTML = '';
});

async function start(): Promise<void> {
  cleanup = initYtWatchComments({ emitPost: (p) => emitted.push(p) });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
}

describe('a YouTube watch page counts its comments', () => {
  it('M comment threads leave readToday.youtube.comments = M', async () => {
    const container = buildWatchPage('vid-count');
    for (let i = 0; i < 6; i++) addThread(container, `comment text number ${i}`, `@user${i}`);
    await start();
    __ytWatchScanNowForTest();
    await flush();
    expect(youtube()?.comments).toBe(6);
  });

  it('scrolling that re-stamps threads already seen adds nothing', async () => {
    const container = buildWatchPage('vid-scroll');
    const threads = [0, 1, 2, 3].map((i) => addThread(container, `steady comment ${i}`, `@steady${i}`));
    await start();
    __ytWatchScanNowForTest();
    for (const t of threads) delete t.dataset.fwYtSeen; // the page re-rendered them: the stamp is gone
    __ytWatchScanNowForTest();
    __ytWatchScanNowForTest();
    await flush();
    expect(youtube()?.comments).toBe(4);
  });

  it('threads that arrive later are added to the count', async () => {
    const container = buildWatchPage('vid-later');
    addThread(container, 'first comment here', '@first');
    await start();
    __ytWatchScanNowForTest();
    addThread(container, 'second comment here', '@second');
    addThread(container, 'third comment here', '@third');
    __ytWatchScanNowForTest();
    await flush();
    expect(youtube()?.comments).toBe(3);
  });
});
