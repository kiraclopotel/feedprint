// @vitest-environment jsdom
//
// Instagram post modal: the comment composer lost focus 250 ms after every
// scroll pause and could never hold it again (owner report 2026-09-02, the
// feed → click photo → modal route; "without extension, it works").
//
// Measured live with a page-world prototype trap: the modal's <article> was
// removed and re-added with NO page-world DOM call on the stack, i.e. the
// extension moved it. The mover was the scroll trigger's re-extraction pass
// (`_reExtractCommentsInDialog`), which detached and re-inserted every
// stamped article so the body MutationObserver would re-walk it. A moved
// subtree loses focus without a `blur`, and the scrollTop restore after the
// move fired a fresh `scroll` event that re-armed the 250 ms debounce, so
// the move repeated every ~258 ms for as long as the modal stayed open.
//
// The re-walk now goes through `requestReExtract` and the DOM is never
// touched. These tests lock: (1) the scroll pass moves no node and keeps the
// composer focused, (2) the stamped article still reaches the interceptor's
// sink, (3) the interceptor registers the sink on start and drops it on stop,
// and (4) the Facebook and X passes are equally DOM-free.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstagramAdapter } from '../../../../src/content/platforms/instagram';
import { FacebookAdapter } from '../../../../src/content/platforms/facebook';
import { TwitterAdapter } from '../../../../src/content/platforms/twitter';
import { ContentInterceptor } from '../../../../src/content/post-path/dom-interceptor';
import { requestReExtract, setReExtractSink } from '../../../../src/content/post-path/scroll-trigger';
import type { PlatformAdapter } from '../../../../src/content/platforms/adapter';

function setLocation(hostname: string, pathname: string): void {
  Object.defineProperty(window, 'location', {
    value: { hostname, pathname, search: '', href: `https://${hostname}${pathname}`, origin: `https://${hostname}` },
    writable: true,
    configurable: true,
  });
}

function makeScroller(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.overflowY = 'auto';
  Object.defineProperty(el, 'scrollHeight', { value: 2000, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: 400, configurable: true });
  return el;
}

/** Records every childList removal under `root` — a moved node shows up here. */
function watchRemovals(root: Node): { removed: Node[]; stop: () => void } {
  const removed: Node[] = [];
  const mo = new MutationObserver((records) => {
    for (const r of records) removed.push(...Array.from(r.removedNodes));
  });
  mo.observe(root, { childList: true, subtree: true });
  return {
    removed,
    stop: () => { mo.takeRecords().forEach((r) => removed.push(...Array.from(r.removedNodes))); mo.disconnect(); },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
  setReExtractSink(null);
});

afterEach(() => {
  setReExtractSink(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('Instagram modal scroll re-extraction keeps the comment composer', () => {
  function mountModal(): { article: HTMLElement; scroller: HTMLElement; textarea: HTMLTextAreaElement } {
    setLocation('www.instagram.com', '/p/DExAmPle0b2/');
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const scroller = makeScroller();
    const article = document.createElement('article');
    article.dataset.fwCaptionEmitted = 'true';
    article.innerHTML = '<div><span>caption</span></div><ul><li>c1</li></ul>';
    const form = document.createElement('form');
    const textarea = document.createElement('textarea');
    textarea.setAttribute('aria-label', 'Add a comment…');
    form.appendChild(textarea);
    article.appendChild(form);
    scroller.appendChild(article);
    dialog.appendChild(scroller);
    document.body.appendChild(dialog);
    return { article, scroller, textarea };
  }

  it('moves no node and leaves the focused textarea focused after the scroll debounce', () => {
    const { article, scroller, textarea } = mountModal();
    const sink = vi.fn();
    setReExtractSink(sink);
    const adapter = new InstagramAdapter();
    // extractPosts wires the modal scroll trigger on the discovered scroller.
    adapter.extractPosts(document.body.childNodes);

    textarea.focus();
    textarea.value = '1234';
    expect(document.activeElement).toBe(textarea);

    const watch = watchRemovals(document.body);
    const insertSpy = vi.spyOn(scroller, 'insertBefore');
    scroller.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(250);
    watch.stop();

    expect(insertSpy).not.toHaveBeenCalled();
    expect(watch.removed).toHaveLength(0);
    expect(article.isConnected).toBe(true);
    expect(document.activeElement).toBe(textarea);
    expect(textarea.value).toBe('1234');
    // The stamped article still reaches the interceptor for its comment re-walk.
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0]).toEqual([article]);
  });

  it('hands over only caption-stamped articles, and drops the request with no sink', () => {
    const { article, scroller } = mountModal();
    const unstamped = document.createElement('article');
    unstamped.innerHTML = '<div><span>fresh</span></div>';
    scroller.appendChild(unstamped);
    const adapter = new InstagramAdapter();
    adapter.extractPosts(document.body.childNodes);

    // No sink registered: nothing happens, nothing moves.
    const watch = watchRemovals(document.body);
    scroller.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(250);
    watch.stop();
    expect(watch.removed).toHaveLength(0);

    const sink = vi.fn();
    setReExtractSink(sink);
    scroller.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(250);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0]).toEqual([article]);
  });
});

describe('ContentInterceptor owns the re-extraction sink', () => {
  function stubAdapter(): PlatformAdapter & { extractPosts: ReturnType<typeof vi.fn> } {
    return {
      platform: 'instagram',
      detectPlatform: () => true,
      extractPosts: vi.fn(() => []),
      getPostSelector: () => 'article',
    };
  }

  it('routes requested roots into extractPosts while started, and not after stop', () => {
    setLocation('www.instagram.com', '/');
    const adapter = stubAdapter();
    const interceptor = new ContentInterceptor(adapter, () => {});
    interceptor.start();
    adapter.extractPosts.mockClear();

    const root = document.createElement('article');
    document.body.appendChild(root);
    adapter.extractPosts.mockClear();

    expect(requestReExtract([root])).toBe(true);
    const seen = adapter.extractPosts.mock.calls.some(
      (call) => Array.from(call[0] as ArrayLike<Node>).includes(root),
    );
    expect(seen).toBe(true);

    interceptor.stop();
    adapter.extractPosts.mockClear();
    expect(requestReExtract([root])).toBe(false);
    expect(adapter.extractPosts).not.toHaveBeenCalled();
  });
});

describe('Facebook and X re-extraction passes are DOM-free too', () => {
  it('Facebook hands the posinset wrapper to the sink without moving it', () => {
    setLocation('www.facebook.com', '/photo/');
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const scroller = makeScroller();
    const unit = document.createElement('div');
    unit.setAttribute('aria-posinset', '1');
    const article = document.createElement('div');
    article.setAttribute('role', 'article');
    article.dataset.fwProcessed = 'true';
    article.innerHTML = '<div data-ad-rendering-role="story_message"><span>post body</span></div>';
    unit.appendChild(article);
    scroller.appendChild(unit);
    dialog.appendChild(scroller);
    document.body.appendChild(dialog);

    const sink = vi.fn();
    setReExtractSink(sink);
    const adapter = new FacebookAdapter();
    adapter.extractPosts(document.body.childNodes);

    const watch = watchRemovals(document.body);
    scroller.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(250);
    watch.stop();

    expect(watch.removed).toHaveLength(0);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0]).toEqual([unit]);
  });

  it('X hands un-stamped text articles to the sink without moving them', () => {
    setLocation('x.com', '/home');
    const timeline = document.createElement('div');
    const article = document.createElement('article');
    article.setAttribute('role', 'article');
    article.innerHTML = '<a href="/TextUser" role="link"><span>Text User</span></a>'
      + '<div data-testid="tweetText" lang="en" dir="ltr">Un-stamped tweet body</div>';
    timeline.appendChild(article);
    document.body.appendChild(timeline);

    const sink = vi.fn();
    setReExtractSink(sink);
    const adapter = new TwitterAdapter();
    (adapter as unknown as { _reExtractTweetsOnPage(): void })._reExtractTweetsOnPage();

    expect(article.parentElement).toBe(timeline);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0]).toEqual([article]);
  });
});
