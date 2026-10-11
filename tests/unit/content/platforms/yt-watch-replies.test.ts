// @vitest-environment jsdom
//
// The replies a person opens under a YouTube comment are read (11 Oct 2026, the night walk). On one watch page 104
// threads loaded and 4 reply threads were opened; Feedprint read 102 top comments and no reply, because the scan
// took the first body of each thread and skipped a thread for good once it had seen it, so a reply that loaded
// afterwards was never looked at. A harmful reply was therefore never checked, hidden or recorded. The DOM here has
// the shape the page has: a thread holds its top comment and, once opened, a replies box with one comment element
// per reply.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PostContent } from '../../../../src/types/post';

vi.mock('../../../../src/storage/feature-flags', () => ({
  isFeatureEnabled: vi.fn(async (flag: string) => flag === 'ytWatchComments'),
}));

import {
  initYtWatchComments,
  __ytWatchScanNowForTest,
  YT_WATCH_MAX_COMMENTS_PER_SCAN,
} from '../../../../src/content/platforms/yt-watch-comments';

let counter = 0;

function commentHtml(author: string, text: string, lc: string): string {
  return `
    <ytd-comment-view-model>
      <a id="author-text"><span>${author}</span></a>
      <a href="/watch?v=vid&lc=${lc}"></a>
      <yt-attributed-string id="content-text"><span>${text}</span></yt-attributed-string>
    </ytd-comment-view-model>`;
}

function buildPage(): HTMLElement {
  window.history.replaceState({}, '', '/watch?v=vid001');
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
  container.appendChild(thread);
  if (replies.length) openReplies(thread, replies);
  return thread;
}

/** What opening "N replies" does: a replies box appears in the thread, holding one comment element per reply. */
function openReplies(thread: HTMLElement, replies: string[]): void {
  const box = document.createElement('div');
  box.id = 'replies';
  box.innerHTML = `<ytd-comment-replies-renderer><div id="expander"><div id="expander-contents"><div id="contents">${
    replies.map((r, i) => commentHtml(`@reply${counter}-${i}`, r, `top-${counter}.rep-${i}`)).join('')
  }</div></div></div></ytd-comment-replies-renderer>`;
  thread.appendChild(box);
}

let cleanup: (() => void) | null = null;
let emitted: PostContent[] = [];

async function init(): Promise<void> {
  emitted = [];
  cleanup = initYtWatchComments({ emitPost: (post) => emitted.push(post) });
  await Promise.resolve();
  await Promise.resolve();
}

const kinds = (): string[] => emitted.filter((p) => p.kind !== 'video').map((p) => p.kind as string);
const texts = (): string[] => emitted.filter((p) => p.kind !== 'video').map((p) => p.text);

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});
afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('the replies under a YouTube comment', () => {
  it('are read beside their top comment, one level down, on the same video', async () => {
    const container = buildPage();
    addThread(container, 'the top comment of this thread', ['first reply in the thread', 'second reply in the thread']);
    await init();
    __ytWatchScanNowForTest();

    expect(texts()).toEqual(['the top comment of this thread', 'first reply in the thread', 'second reply in the thread']);
    expect(kinds()).toEqual(['top-comment', 'reply', 'reply']);
    const replies = emitted.filter((p) => p.kind === 'reply');
    for (const r of replies) {
      expect(r.depth).toBe(2);
      expect(r.parentVideoId).toBe('yt-vid-vid001');
      expect(r.platform).toBe('youtube');
    }
    expect(new Set(emitted.map((p) => p.id)).size, 'every comment has its own id').toBe(emitted.length);
  });

  it('are read when they load after the thread was first seen, and only once', async () => {
    const container = buildPage();
    const thread = addThread(container, 'a top comment with replies to come');
    await init();
    __ytWatchScanNowForTest();
    expect(texts()).toEqual(['a top comment with replies to come']);

    openReplies(thread, ['a reply that arrived later', 'another reply that arrived later']);
    __ytWatchScanNowForTest();
    expect(texts()).toEqual([
      'a top comment with replies to come',
      'a reply that arrived later',
      'another reply that arrived later',
    ]);

    __ytWatchScanNowForTest();
    __ytWatchScanNowForTest();
    expect(emitted.filter((p) => p.kind !== 'video'), 'a third and a fourth scan add nothing').toHaveLength(3);
  });

  it('are read under a top comment that has no text (an emoji-only comment)', async () => {
    const container = buildPage();
    addThread(container, '', ['a reply under a comment made only of emoji']);
    await init();
    __ytWatchScanNowForTest();
    expect(texts()).toEqual(['a reply under a comment made only of emoji']);
    expect(kinds()).toEqual(['reply']);
  });

  it('point at their own body, so the page and the record hold the same words', async () => {
    const container = buildPage();
    addThread(container, 'the top comment', ['the reply whose body is the anchor']);
    await init();
    __ytWatchScanNowForTest();
    const reply = emitted.find((p) => p.kind === 'reply');
    expect(reply).toBeDefined();
    const el = reply!.domRef.deref();
    expect(el?.textContent?.trim()).toBe(reply!.text);
    expect(el?.closest('ytd-comment-view-model'), 'the marker host the hide table walks up to').not.toBeNull();
  });

  it('count toward the per-scan cap and the rest wait for the next scan', async () => {
    const container = buildPage();
    for (let i = 0; i < YT_WATCH_MAX_COMMENTS_PER_SCAN; i++) addThread(container, `top comment number ${i} here`, [`reply to number ${i} here`]);
    await init();
    // init's arm() runs the first scan itself, and the cap applies to that pass.
    expect(emitted.filter((p) => p.kind !== 'video')).toHaveLength(YT_WATCH_MAX_COMMENTS_PER_SCAN);
    __ytWatchScanNowForTest();
    expect(emitted.filter((p) => p.kind !== 'video').length, 'the next scan reads on').toBeGreaterThan(YT_WATCH_MAX_COMMENTS_PER_SCAN);
  });
});
