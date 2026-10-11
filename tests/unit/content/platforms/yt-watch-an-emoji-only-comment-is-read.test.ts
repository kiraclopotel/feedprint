// @vitest-environment jsdom
//
// A YouTube comment made only of emoji is read (11 Oct 2026, the night walk: 2 of 104 threads on one watch page left
// the record). YouTube draws each emoji as a small picture whose alt attribute is the emoji itself, so the body has
// no text and the reader's length check dropped the comment: it was not recorded, counted, or checked by the rules.
// A pile of knives or a pointed finger is the whole message in some comments. The reader now takes the pictures'
// alt text when the body has no words. A comment that has words keeps only its words, as before. The render gate
// reads the body the same way, so a verdict still lands on the comment it was given for.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PostContent } from '../../../../src/types/post';

vi.mock('../../../../src/storage/feature-flags', () => ({
  isFeatureEnabled: vi.fn(async (flag: string) => flag === 'ytWatchComments'),
}));

import { initYtWatchComments, __ytWatchScanNowForTest } from '../../../../src/content/platforms/yt-watch-comments';
import { verifyAnchorMatch } from '../../../../src/forensics/anchor-revalidation';
import { computeAnchorKey } from '../../../../src/core/anchor-key';

let n = 0;
let cleanup: (() => void) | null = null;
let emitted: PostContent[] = [];

/** The picture YouTube draws for an emoji in a comment. */
const pic = (emoji: string): string =>
  `<img class="small-emoji yt-formatted-string" alt="${emoji}" src="https://example.invalid/e/${encodeURIComponent(emoji)}.png" width="16" height="16">`;

function buildPage(): HTMLElement {
  window.history.replaceState({}, '', '/watch?v=vid-emoji');
  document.body.innerHTML = `
    <h1 class="ytd-watch-metadata"><yt-formatted-string>A video</yt-formatted-string></h1>
    <div id="owner"><ytd-channel-name id="channel-name"><a href="/@chan">Chan</a></ytd-channel-name></div>
    <ytd-comments id="comments"></ytd-comments>`;
  return document.getElementById('comments')!;
}

function addThread(container: HTMLElement, bodyHtml: string): HTMLElement {
  n++;
  const thread = document.createElement('ytd-comment-thread-renderer');
  thread.innerHTML = `<div id="comment"><a id="author-text"><span>@user${n}</span></a>
    <a href="/watch?v=x&lc=c-${n}"></a><yt-attributed-string id="content-text">${bodyHtml}</yt-attributed-string></div>`;
  container.appendChild(thread);
  return thread;
}

async function init(): Promise<void> {
  emitted = [];
  cleanup = initYtWatchComments({ emitPost: (p) => emitted.push(p) });
  await Promise.resolve();
  await Promise.resolve();
  __ytWatchScanNowForTest();
}

const comments = (): PostContent[] => emitted.filter((p) => p.kind !== 'video');

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

describe('a comment made only of emoji pictures', () => {
  it('is read, with the emoji as its text', async () => {
    const container = buildPage();
    addThread(container, `<span>${pic('🔪')}${pic('🔪')}${pic('🔪')}</span>`);
    addThread(container, `<span>${pic('😂')}</span>`);
    await init();
    expect(comments().map((c) => c.text)).toEqual(['🔪🔪🔪', '😂']);
    expect(comments()[0].kind).toBe('top-comment');
    expect(comments()[0].author).toMatch(/^@user/);
  });

  it('is read as a reply too', async () => {
    const container = buildPage();
    const thread = addThread(container, '<span>a comment with words in it</span>');
    const box = document.createElement('div');
    box.id = 'replies';
    box.innerHTML = `<ytd-comment-replies-renderer><div id="expander"><div id="expander-contents"><div id="contents">
      <ytd-comment-view-model><a id="author-text"><span>@replier</span></a><a href="/watch?v=x&lc=c-${n}.r1"></a>
      <yt-attributed-string id="content-text"><span>${pic('🖕')}${pic('🖕')}</span></yt-attributed-string></ytd-comment-view-model>
    </div></div></div></ytd-comment-replies-renderer>`;
    thread.appendChild(box);
    await init();
    expect(comments().map((c) => [c.kind, c.text])).toEqual([['top-comment', 'a comment with words in it'], ['reply', '🖕🖕']]);
  });

  it('is read even when it is one emoji of one character', async () => {
    addThread(buildPage(), `<span>${pic('❤')}</span>`);
    await init();
    expect(comments().map((c) => c.text)).toEqual(['❤']);
  });

  it('keeps its record the same on the next scan: one record, not one per scan', async () => {
    addThread(buildPage(), `<span>${pic('😡')}${pic('😡')}</span>`);
    await init();
    __ytWatchScanNowForTest();
    __ytWatchScanNowForTest();
    expect(comments()).toHaveLength(1);
  });
});

describe('what has not changed', () => {
  it('a comment with words and an emoji keeps its words only, as before', async () => {
    addThread(buildPage(), `<span>I love this video ${pic('😂')} so much</span>`);
    await init();
    expect(comments().map((c) => c.text)).toEqual(['I love this video  so much']);
  });

  it('a body with nothing in it, no words and no picture, is still left unread', async () => {
    addThread(buildPage(), '<span></span>');
    await init();
    expect(comments()).toHaveLength(0);
  });

  it('a picture that is not an emoji (no alt) is not text', async () => {
    addThread(buildPage(), '<span><img src="https://example.invalid/sticker.png" width="120" height="120"></span>');
    await init();
    expect(comments()).toHaveLength(0);
  });
});

describe('the render gate reads the body the way the reader did', () => {
  it('a verdict for the emoji comment still matches its element', async () => {
    addThread(buildPage(), `<span>${pic('🔪')}${pic('🔪')}</span>`);
    await init();
    const post = comments()[0];
    expect(verifyAnchorMatch(computeAnchorKey(post), post, post.domRef), 'not turned away as a recycled element').toBe('match');
  });

  it('turns a verdict away when the element now holds another emoji comment', async () => {
    addThread(buildPage(), `<span>${pic('🔪')}${pic('🔪')}</span>`);
    await init();
    const post = comments()[0];
    post.domRef.deref()!.innerHTML = `<span>${pic('🎉')}</span>`;
    expect(verifyAnchorMatch(computeAnchorKey(post), post, post.domRef)).toBe('dom-recycled');
  });

  it('turns a verdict away when the element now holds words', async () => {
    addThread(buildPage(), `<span>${pic('🔪')}</span>`);
    await init();
    const post = comments()[0];
    post.domRef.deref()!.innerHTML = '<span>a different comment altogether</span>';
    expect(verifyAnchorMatch(computeAnchorKey(post), post, post.domRef)).toBe('dom-recycled');
  });

  it('an element with no stamp keeps the old reading: no words, no text', async () => {
    const el = document.createElement('div');
    el.innerHTML = pic('🔪');
    document.body.appendChild(el);
    const post = {
      id: 'x1', text: '', author: 'a', timestamp: new Date().toISOString(), platform: 'twitter' as const, domRef: new WeakRef(el),
    } as PostContent;
    expect(verifyAnchorMatch(computeAnchorKey(post), post, post.domRef), 'another site\'s empty post is unchanged').toBe('match');
  });
});
