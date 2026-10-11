// @vitest-environment jsdom
//
// A comment counts once a day per browser session, however often its page is opened (11 Oct 2026, the Leader's
// option c). The Tester's three visits to one video read 125, 205, 285 for about 107 threads: the page's seen-list is
// per page load, so each load counted the same comments again. The count now asks the service worker, which keeps a
// set of short one-way hashes of what it has counted today in chrome.storage.session. That area is memory only: never
// written to disk, gone when the browser closes, cleared at the end of the UTC day. Nothing new lands in
// chrome.storage.local, where the stored count stays numbers only.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PostContent } from '../../../../src/types/post';

vi.mock('../../../../src/storage/feature-flags', () => ({
  isFeatureEnabled: vi.fn(async (flag: string) => flag === 'ytWatchComments'),
}));

import { initYtWatchComments, __ytWatchScanNowForTest } from '../../../../src/content/platforms/yt-watch-comments';
import * as settings from '../../../../src/storage/settings';
import { installCounterChrome, type FakeCounterChrome } from '../../../helpers/fake-counter-chrome';

let fake: FakeCounterChrome;
let cleanup: (() => void) | null = null;
let emitted: PostContent[] = [];
let n = 0;

const flush = (): Promise<void> => (settings as unknown as { flushItemsRead: () => Promise<void> }).flushItemsRead();
const youtube = (): { comments: number } | undefined =>
  (fake.state.readToday as Record<string, { comments: number }> | undefined)?.youtube;
const TEXTS = ['first thread text here', 'second thread text here', 'third thread text here', 'fourth thread text here', 'fifth thread text here', 'sixth thread text here'];

function buildWatchPage(videoId: string, texts: string[]): void {
  window.history.replaceState({}, '', `/watch?v=${videoId}`);
  document.body.innerHTML = `
    <h1 class="ytd-watch-metadata"><yt-formatted-string>A video</yt-formatted-string></h1>
    <div id="owner"><ytd-channel-name id="channel-name"><a href="/@c">Channel</a></ytd-channel-name></div>
    <ytd-comments id="comments"></ytd-comments>`;
  const container = document.getElementById('comments')!;
  texts.forEach((text, i) => {
    n++;
    const thread = document.createElement('ytd-comment-thread-renderer');
    thread.innerHTML = `<div id="comment"><a id="author-text"><span>@user${i}</span></a>
      <a href="/watch?v=x&lc=c-${n}"></a><yt-attributed-string id="content-text"><span>${text}</span></yt-attributed-string></div>`;
    container.appendChild(thread);
  });
}

/** One visit: the page loads, the comments are read, the page is left and what it gathered is sent. */
async function visit(videoId: string, texts: string[]): Promise<void> {
  buildWatchPage(videoId, texts);
  cleanup = initYtWatchComments({ emitPost: (p) => emitted.push(p) });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  __ytWatchScanNowForTest();
  await flush();
  cleanup?.();
  cleanup = null;
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

describe('a comment counts once a day per browser session', () => {
  it('three visits to one video count each thread once', async () => {
    await visit('vid-revisit', TEXTS);
    expect(youtube()?.comments).toBe(6);
    await visit('vid-revisit', TEXTS);
    await visit('vid-revisit', TEXTS);
    expect(youtube()?.comments, 'the same six threads, opened three times').toBe(6);
  });

  it('a thread that is new on a later visit is added, the six already counted are not', async () => {
    await visit('vid-grow', TEXTS);
    await visit('vid-grow', [...TEXTS, 'a seventh thread that arrived since']);
    expect(youtube()?.comments).toBe(7);
  });

  it('the same words under another video are another comment', async () => {
    await visit('vid-a', TEXTS.slice(0, 3));
    await visit('vid-b', TEXTS.slice(0, 3));
    expect(youtube()?.comments).toBe(6);
  });

  it('the next day counts them again: the set belongs to the day', async () => {
    await visit('vid-day', TEXTS);
    const stored = fake.session.fw_read_hashes as { day: string; hashes: string[] };
    stored.day = '2000-01-01'; // what the worker would find after the UTC day turned over
    await visit('vid-day', TEXTS);
    expect(youtube()?.comments).toBe(12);
  });
});

describe('what is kept, and where', () => {
  it('the set sits in session memory as short hashes, and nothing of it lands in chrome.storage.local', async () => {
    const before = Object.keys(fake.state).sort();
    await visit('vid-where', TEXTS);
    const session = fake.session.fw_read_hashes as { day: string; hashes: string[] };
    expect(session.hashes, 'one hash per counted thread').toHaveLength(6);
    for (const h of session.hashes) expect(h, 'short, and one-way').toMatch(/^[0-9a-f]{12}$/);
    expect(JSON.stringify(fake.session), 'no word of a comment, no author, no video').not.toMatch(/thread text|user\d|vid-where/);
    // The disk: only the keys the count always wrote, and none of the hashes.
    const local = JSON.stringify(fake.state);
    for (const h of session.hashes) expect(local).not.toContain(h);
    expect(Object.keys(fake.state).sort().filter((k) => !before.includes(k)), 'no new key on disk').toEqual(['readToday']);
    expect(Object.keys(fake.state).some((k) => /hash|seen|read_keys/i.test(k))).toBe(false);
  });

  it('with no memory-only area to ask, every visit counts as before', async () => {
    delete (globalThis as unknown as { chrome: { storage: { session?: unknown } } }).chrome.storage.session;
    await visit('vid-nosession', TEXTS);
    await visit('vid-nosession', TEXTS);
    expect(youtube()?.comments).toBe(12);
  });
});
