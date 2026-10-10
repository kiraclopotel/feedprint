// @vitest-environment jsdom
//
// YouTube /watch comment capture (docs/history/2026-08/YOUTUBE-E1-BRIEF.md) —
// src/content/platforms/yt-watch-comments.ts.
//
// /watch capture behind the `ytWatchComments` feature flag (default ON since
// 2026-08-02; an explicit stored `false` is the kill switch). These tests lock
// the gate contract:
//   • flag OFF  → init is fully inert: no observer, no listeners, no emits.
//   • flag ON   → scoped extraction from `ytd-comments#comments` only,
//                 video-room record + comment records with
//                 parentVideoId = `yt-vid-<v>` (zero chain-schema change).
//   • the watch-session record is emitted INDEPENDENTLY of the comments
//     (owner decision 2026-08-02, diverging from TikTok's no-orphan rule) and
//     never before its own title element is readable, so an SPA transition
//     cannot attribute one video's title to another.
//   • debounce  → a mutation burst collapses to one scan ≥500ms later.
//   • caps      → per-scan emit cap + bounded seen-key set (renderer-OOM
//                 discipline, same family as interceptor MAX_PENDING_NODES).
//   • hidden    → observer disconnected + module state cleared on
//                 tab-background; re-armed on return to visible.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PostContent } from '../../../../src/types/post';

const flagState = { ytWatchComments: false };

vi.mock('../../../../src/storage/feature-flags', () => ({
  isFeatureEnabled: vi.fn(async (flag: string) =>
    flag === 'ytWatchComments' ? flagState.ytWatchComments : false),
}));

import {
  initYtWatchComments,
  __ytWatchScanNowForTest,
  __ytWatchDebugForTest,
  YT_WATCH_SCAN_DEBOUNCE_MS,
  YT_WATCH_MAX_COMMENTS_PER_SCAN,
  YT_WATCH_MAX_SEEN_KEYS,
} from '../../../../src/content/platforms/yt-watch-comments';

// ─── DOM fixture helpers ───

function setWatchUrl(videoId: string): void {
  window.history.replaceState({}, '', `/watch?v=${videoId}`);
}

function buildWatchPage(videoId: string, opts?: { title?: string; channel?: string }): HTMLElement {
  setWatchUrl(videoId);
  document.body.innerHTML = '';

  const meta = document.createElement('div');
  meta.innerHTML = `
    <h1 class="ytd-watch-metadata"><yt-formatted-string>${opts?.title ?? 'Test Video Title'}</yt-formatted-string></h1>
    <div id="owner"><ytd-channel-name id="channel-name"><a href="/@testchannel">${opts?.channel ?? 'Test Channel'}</a></ytd-channel-name></div>
  `;
  document.body.appendChild(meta);

  const comments = document.createElement('ytd-comments');
  comments.id = 'comments';
  document.body.appendChild(comments);
  return comments;
}

let commentCounter = 0;
function addComment(container: HTMLElement, text: string, author = `@user${++commentCounter}`): HTMLElement {
  const thread = document.createElement('ytd-comment-thread-renderer');
  thread.innerHTML = `
    <div id="comment">
      <a id="author-text"><span>${author}</span></a>
      <a href="/watch?v=x&lc=c-${commentCounter}"></a>
      <yt-attributed-string id="content-text"><span>${text}</span></yt-attributed-string>
    </div>
  `;
  container.appendChild(thread);
  return thread;
}

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: hidden ? 'hidden' : 'visible',
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

let cleanup: (() => void) | null = null;
let emitted: PostContent[] = [];

async function initWithFlag(on: boolean): Promise<void> {
  flagState.ytWatchComments = on;
  emitted = [];
  cleanup = initYtWatchComments({ emitPost: (post) => emitted.push(post) });
  await flushMicrotasks();
}

beforeEach(() => {
  vi.useFakeTimers();
  setHidden(false);
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.useRealTimers();
  document.body.innerHTML = '';
});

// ─── Flag OFF: fully inert ───

// yt-watch-comments stamps 'top-comment' + depth 1 since 2026-09-08. It stamped
// the legacy 'comment' alias, which types/post.ts documents as valid and every
// encounter assembler's child filter dropped — so YouTube /watch comments never
// reached a judge, the harm-floor fallback never ran on them either, and each
// distinct comment text was written to the chain as a cancelled record naming a
// Groq model for a call nobody made. The assemblers accept the alias again as
// well; this producer no longer needs it.
describe('ytWatchComments flag OFF (default)', () => {
  it('does zero work: no observer, no emits, even with comments present', async () => {
    const container = buildWatchPage('vid001');
    addComment(container, 'you are all pathetic losers honestly');
    await initWithFlag(false);
    __ytWatchScanNowForTest();
    vi.advanceTimersByTime(60_000);
    await flushMicrotasks();
    expect(emitted).toHaveLength(0);
    expect(__ytWatchDebugForTest().armed).toBe(false);
    expect(__ytWatchDebugForTest().observerActive).toBe(false);
  });
});

// ─── Flag ON: scoped extraction ───

describe('ytWatchComments flag ON', () => {
  it('emits one video-room record + comment records with yt-vid parentVideoId', async () => {
    const container = buildWatchPage('abc123', { title: 'My Video', channel: 'ChannelX' });
    addComment(container, 'first comment text here');
    addComment(container, 'second comment text here');
    await initWithFlag(true);
    __ytWatchScanNowForTest();

    const videos = emitted.filter((p) => p.kind === 'video');
    const comments = emitted.filter((p) => p.kind === 'top-comment');
    expect(videos).toHaveLength(1);
    expect(videos[0].id).toBe('yt-vid-abc123');
    expect(videos[0].parentVideoId).toBe('yt-vid-abc123');
    expect(videos[0].text).toBe('My Video');
    expect(videos[0].author).toBe('ChannelX');
    expect(videos[0].sourceUrl).toBe('https://www.youtube.com/watch?v=abc123');
    expect(videos[0].platform).toBe('youtube');

    expect(comments).toHaveLength(2);
    for (const c of comments) {
      expect(c.parentVideoId).toBe('yt-vid-abc123');
      expect(c.platform).toBe('youtube');
      expect(c.feedSource).toBe('video');
      expect(c.platform_specific).toEqual({ platform: 'youtube', surfaceKind: 'youtube-watch' });
    }
    expect(comments.map((c) => c.text)).toEqual([
      'first comment text here',
      'second comment text here',
    ]);
  });

  it('ignores comment-shaped DOM outside ytd-comments#comments (scoped)', async () => {
    buildWatchPage('abc123');
    // Comment thread OUTSIDE the container (e.g. a recommendation shelf clone).
    const stray = document.createElement('div');
    document.body.appendChild(stray);
    addComment(stray, 'outside text that must not be captured');
    await initWithFlag(true);
    __ytWatchScanNowForTest();
    expect(emitted.filter((p) => p.kind === 'top-comment')).toHaveLength(0);
  });

  // REVERSAL of the original no-orphan-video rule copied from TikTok (owner
  // decision 2026-08-02): on YouTube the watch session IS the exposure unit and
  // the canonical link stays resolvable, so the record is worth keeping with no
  // comments at all. Under-recording a watched video is the bigger evidence
  // failure here. The superseded test asserted `emitted` was empty.
  it('records the watch session with NO comments present', async () => {
    buildWatchPage('abc123', { title: 'Silent Video', channel: 'ChannelQ' });
    await initWithFlag(true);
    __ytWatchScanNowForTest();
    const videos = emitted.filter((p) => p.kind === 'video');
    expect(videos).toHaveLength(1);
    expect(videos[0].id).toBe('yt-vid-abc123');
    expect(videos[0].text).toBe('Silent Video');
    expect(videos[0].author).toBe('ChannelQ');
    expect(videos[0].sourceUrl).toBe('https://www.youtube.com/watch?v=abc123');
    expect(emitted.filter((p) => p.kind === 'top-comment')).toHaveLength(0);
  });

  it('records the watch session when the video has comments disabled (no container ever mounts)', async () => {
    // No `ytd-comments#comments` at all — the container-discovery poll is the
    // only thing that can ever record this watch session.
    setWatchUrl('nocomments1');
    document.body.innerHTML = '';
    const meta = document.createElement('div');
    meta.innerHTML = `
      <h1 class="ytd-watch-metadata"><yt-formatted-string>Comments Off Video</yt-formatted-string></h1>
      <div id="owner"><ytd-channel-name id="channel-name"><a href="/@c">ChannelZ</a></ytd-channel-name></div>
    `;
    document.body.appendChild(meta);

    await initWithFlag(true);
    const videos = emitted.filter((p) => p.kind === 'video');
    expect(videos).toHaveLength(1);
    expect(videos[0].id).toBe('yt-vid-nocomments1');
    expect(videos[0].text).toBe('Comments Off Video');
    expect(document.querySelector('ytd-comments#comments')).toBeNull();
  });

  it('never attributes a stale title: defers the record until the title element is readable', async () => {
    // Page shell with no title element yet — the SPA-transition state in which
    // `document.title` still holds the PREVIOUS video's title.
    setWatchUrl('lateTitle1');
    document.body.innerHTML = '';
    document.title = 'Some Previous Video - YouTube';
    const comments = document.createElement('ytd-comments');
    comments.id = 'comments';
    document.body.appendChild(comments);

    await initWithFlag(true);
    __ytWatchScanNowForTest();
    expect(emitted.filter((p) => p.kind === 'video')).toHaveLength(0);

    // Header renders; the next tick records it, with the real title.
    const meta = document.createElement('div');
    meta.innerHTML = `
      <h1 class="ytd-watch-metadata"><yt-formatted-string>The Real Title</yt-formatted-string></h1>
      <div id="owner"><ytd-channel-name id="channel-name"><a href="/@c">RealChannel</a></ytd-channel-name></div>
    `;
    document.body.appendChild(meta);
    __ytWatchScanNowForTest();

    const videos = emitted.filter((p) => p.kind === 'video');
    expect(videos).toHaveLength(1);
    expect(videos[0].text).toBe('The Real Title');
    expect(videos[0].text).not.toContain('Previous');
  });

  it('records the watch session exactly once across repeated comment-less scans', async () => {
    buildWatchPage('abc123');
    await initWithFlag(true);
    __ytWatchScanNowForTest();
    __ytWatchScanNowForTest();
    __ytWatchScanNowForTest();
    expect(emitted.filter((p) => p.kind === 'video')).toHaveLength(1);
  });

  it('does not re-emit already-seen comments on a rescan', async () => {
    const container = buildWatchPage('abc123');
    addComment(container, 'first comment text here');
    await initWithFlag(true);
    __ytWatchScanNowForTest();
    expect(emitted.filter((p) => p.kind === 'top-comment')).toHaveLength(1);
    __ytWatchScanNowForTest();
    expect(emitted.filter((p) => p.kind === 'top-comment')).toHaveLength(1);
    addComment(container, 'a brand new later comment');
    __ytWatchScanNowForTest();
    expect(emitted.filter((p) => p.kind === 'top-comment')).toHaveLength(2);
    // Video room record emitted exactly once per video.
    expect(emitted.filter((p) => p.kind === 'video')).toHaveLength(1);
  });

  it('debounces mutation bursts into one scan after the debounce window', async () => {
    const container = buildWatchPage('abc123');
    await initWithFlag(true);
    // Container discovery poll tick.
    vi.advanceTimersByTime(2100);
    expect(__ytWatchDebugForTest().observerActive).toBe(true);

    addComment(container, 'burst comment one text');
    addComment(container, 'burst comment two text');
    // MutationObserver callbacks flush as microtasks under jsdom.
    await Promise.resolve();
    vi.advanceTimersByTime(YT_WATCH_SCAN_DEBOUNCE_MS - 50);
    expect(emitted.filter((p) => p.kind === 'top-comment')).toHaveLength(0);
    vi.advanceTimersByTime(100);
    expect(emitted.filter((p) => p.kind === 'top-comment')).toHaveLength(2);
  });

  it('caps emits per scan at YT_WATCH_MAX_COMMENTS_PER_SCAN', async () => {
    const container = buildWatchPage('abc123');
    for (let i = 0; i < YT_WATCH_MAX_COMMENTS_PER_SCAN + 15; i++) {
      addComment(container, `unique comment body number ${i} with text`);
    }
    // init's arm() runs the first scan itself — cap applies to that pass.
    await initWithFlag(true);
    expect(emitted.filter((p) => p.kind === 'top-comment')).toHaveLength(YT_WATCH_MAX_COMMENTS_PER_SCAN);
    // Next scan picks up the remainder (window slides, nothing frozen out).
    __ytWatchScanNowForTest();
    expect(emitted.filter((p) => p.kind === 'top-comment')).toHaveLength(YT_WATCH_MAX_COMMENTS_PER_SCAN + 15);
  });

  it('bounds the seen-key set at YT_WATCH_MAX_SEEN_KEYS', async () => {
    const container = buildWatchPage('abc123');
    await initWithFlag(true);
    for (let i = 0; i < YT_WATCH_MAX_SEEN_KEYS + 40; i++) {
      addComment(container, `flood comment body number ${i} with text`);
      if ((i + 1) % YT_WATCH_MAX_COMMENTS_PER_SCAN === 0) __ytWatchScanNowForTest();
    }
    __ytWatchScanNowForTest();
    expect(__ytWatchDebugForTest().seenKeyCount).toBeLessThanOrEqual(YT_WATCH_MAX_SEEN_KEYS);
  });

  it('disconnects the observer and clears state on tab-background, re-arms on visible', async () => {
    const container = buildWatchPage('abc123');
    addComment(container, 'first comment text here');
    await initWithFlag(true);
    vi.advanceTimersByTime(2100);
    __ytWatchScanNowForTest();
    expect(__ytWatchDebugForTest().observerActive).toBe(true);

    setHidden(true);
    expect(__ytWatchDebugForTest().observerActive).toBe(false);
    expect(__ytWatchDebugForTest().seenKeyCount).toBe(0);

    // Mutations while hidden accumulate nothing and trigger nothing.
    addComment(container, 'comment added while hidden');
    await Promise.resolve();
    vi.advanceTimersByTime(10_000);
    const countWhileHidden = emitted.filter((p) => p.kind === 'top-comment').length;

    setHidden(false);
    vi.advanceTimersByTime(2100);
    await Promise.resolve();
    vi.advanceTimersByTime(YT_WATCH_SCAN_DEBOUNCE_MS + 100);
    expect(__ytWatchDebugForTest().observerActive).toBe(true);
    // The hidden-time comment is recovered after return to visible.
    expect(emitted.filter((p) => p.kind === 'top-comment').length)
      .toBeGreaterThan(countWhileHidden);
  });

  it('does nothing off /watch even with the flag on', async () => {
    const container = buildWatchPage('abc123');
    addComment(container, 'first comment text here');
    window.history.replaceState({}, '', '/feed/subscriptions');
    await initWithFlag(true);
    __ytWatchScanNowForTest();
    expect(emitted).toHaveLength(0);
  });

  it('cleanup() tears everything down', async () => {
    const container = buildWatchPage('abc123');
    await initWithFlag(true);
    vi.advanceTimersByTime(2100);
    expect(__ytWatchDebugForTest().observerActive).toBe(true);
    cleanup?.();
    cleanup = null;
    expect(__ytWatchDebugForTest().observerActive).toBe(false);
    expect(__ytWatchDebugForTest().armed).toBe(false);
    // Arming already recorded the watch session, so assert NOTHING FURTHER is
    // emitted after teardown rather than that nothing ever was.
    const afterCleanup = emitted.length;
    addComment(container, 'post-cleanup comment text');
    await Promise.resolve();
    vi.advanceTimersByTime(10_000);
    expect(emitted).toHaveLength(afterCleanup);
  });
});
