// @vitest-environment jsdom
//
// A YouTube comment the queue gave back is read again (11 Oct 2026, found while tracing the household-list P1). When a
// batch fails, the video is put in a cooldown and every comment that arrives meanwhile is refused with a request to
// extract it again once it comes back into view. That request cleared the stamps the generic extractor keeps
// (fwCommentSeen, fwProcessed) and not the YouTube reader's own (the fwYtSeen stamp and its list of keys), so the next
// scan skipped the comment as already seen and it was never judged until the page was reloaded. The request now reaches
// the reader, which forgets the comment; the count of what was read still counts it once.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PostContent } from '../../../../src/types/post';

vi.mock('../../../../src/storage/feature-flags', () => ({
  isFeatureEnabled: vi.fn(async (flag: string) => flag === 'ytWatchComments'),
}));

import { initYtWatchComments, __ytWatchScanNowForTest } from '../../../../src/content/platforms/yt-watch-comments';
import { unmarkPostsForReExtraction } from '../../../../src/content/post-path/viewport-tracker';
import * as settings from '../../../../src/storage/settings';
import { installCounterChrome, type FakeCounterChrome } from '../../../helpers/fake-counter-chrome';

let counter = 0;
let fake: FakeCounterChrome;
let cleanup: (() => void) | null = null;
let emitted: PostContent[] = [];

function commentHtml(author: string, text: string, lc: string): string {
  return `
    <ytd-comment-view-model>
      <a id="author-text"><span>${author}</span></a>
      <a href="/watch?v=vid&lc=${lc}"></a>
      <yt-attributed-string id="content-text"><span>${text}</span></yt-attributed-string>
    </ytd-comment-view-model>`;
}

function buildPage(): HTMLElement {
  window.history.replaceState({}, '', '/watch?v=vidgive');
  document.body.innerHTML = `
    <h1 class="ytd-watch-metadata"><yt-formatted-string>A video</yt-formatted-string></h1>
    <div id="owner"><ytd-channel-name id="channel-name"><a href="/@chan">Chan</a></ytd-channel-name></div>`;
  const comments = document.createElement('ytd-comments');
  comments.id = 'comments';
  document.body.appendChild(comments);
  return comments;
}

function addThread(container: HTMLElement, top: string, replies: string[] = []): HTMLElement {
  const n = ++counter;
  const thread = document.createElement('ytd-comment-thread-renderer');
  thread.innerHTML = `<div id="comment">${commentHtml(`@top${n}`, top, `top-${n}`)}</div>`;
  if (replies.length) {
    const box = document.createElement('div');
    box.innerHTML = `<ytd-comment-replies-renderer><div id="contents">${
      replies.map((r, i) => commentHtml(`@reply${n}-${i}`, r, `top-${n}.rep-${i}`)).join('')
    }</div></ytd-comment-replies-renderer>`;
    thread.appendChild(box);
  }
  container.appendChild(thread);
  return thread;
}

const comments = (): PostContent[] => emitted.filter((p) => p.kind !== 'video');
const flush = (): Promise<void> => (settings as unknown as { flushItemsRead: () => Promise<void> }).flushItemsRead();

beforeEach(async () => {
  vi.useFakeTimers();
  fake = installCounterChrome({ lastResetDate: settings.utcDayKey(), lastResetMonth: settings.utcMonthKey() });
  emitted = [];
  buildPage();
  cleanup = initYtWatchComments({ emitPost: (post) => emitted.push(post) });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
});
afterEach(async () => {
  // Reads wait in a module-level batch; send them to this test's counters so the next test starts from none.
  await flush();
  cleanup?.();
  cleanup = null;
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('a comment the queue gave back is read again', () => {
  it('control: without the request, a second scan does not emit it again', () => {
    addThread(document.getElementById('comments')!, 'a comment that nobody gives back');
    __ytWatchScanNowForTest();
    __ytWatchScanNowForTest();
    expect(comments()).toHaveLength(1);
  });

  it('a top comment given back is emitted again on the next scan', () => {
    addThread(document.getElementById('comments')!, 'a comment the queue refused');
    __ytWatchScanNowForTest();
    expect(comments()).toHaveLength(1);
    unmarkPostsForReExtraction([comments()[0]]);
    __ytWatchScanNowForTest();
    expect(comments(), 'read a second time').toHaveLength(2);
    expect(comments()[1].text).toBe('a comment the queue refused');
  });

  it('a reply given back is emitted again, and the comment beside it is not', () => {
    addThread(document.getElementById('comments')!, 'the top comment stays read', ['a reply the queue refused']);
    __ytWatchScanNowForTest();
    expect(comments()).toHaveLength(2);
    const reply = comments().find((p) => p.kind === 'reply')!;
    unmarkPostsForReExtraction([reply]);
    __ytWatchScanNowForTest();
    expect(comments().map((p) => p.text)).toEqual([
      'the top comment stays read', 'a reply the queue refused', 'a reply the queue refused',
    ]);
  });

  it('the count of what was read counts a comment once, however often it is given back', async () => {
    addThread(document.getElementById('comments')!, 'counted once');
    __ytWatchScanNowForTest();
    unmarkPostsForReExtraction([comments()[0]]);
    __ytWatchScanNowForTest();
    unmarkPostsForReExtraction([comments()[1]]);
    __ytWatchScanNowForTest();
    expect(comments()).toHaveLength(3);
    await flush();
    const youtube = (fake.state.readToday as Record<string, { comments: number }> | undefined)?.youtube;
    expect(youtube?.comments).toBe(1);
  });
});
