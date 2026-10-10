// @vitest-environment jsdom
//
// LOOP-070 — ContentInterceptor SPA route-change re-scan.
//
// Context: a 2026-04-21 X live test reported that clicking a feed post
// to open its detail view left the replies + re-rendered main tweet
// un-scanned — the page needed a hard Ctrl+R to surface dots again. Root
// cause: `data-fw-processed` stamps stuck on tweetText nodes across X's
// client-side navigation (history.pushState), and X's router does not
// fire `popstate`. These tests lock the fix: (a) a page-initiated
// pushState triggers a rescan, (b) rescan strips stale fwProcessed stamps
// and re-invokes adapter.extractPosts, (c) non-V1 platforms don't
// activate the watcher.
//
// G3 (2026-08-04): programmatic-nav detection moved from an isolated-world
// pushState/replaceState patch (which page frameworks can never hit — the
// isolated world has its own History binding) to the MAIN-world route
// notifier (page-world/route-notifier.ts) relaying fw:route-change.
// jsdom has a single realm, so installing the notifier here makes
// `history.pushState` below behave exactly like a page-framework
// (MAIN-world) navigation being relayed to the isolated listener.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ContentInterceptor, computeRouteKey } from '../../../../src/content/post-path/dom-interceptor';
import { installPageWorldRouteNotifier } from '../../../../src/content/page-world/route-notifier';
import { FacebookAdapter } from '../../../../src/content/platforms/facebook';
import { ChildProtectionManager } from '../../../../src/content/protection/child-first-protection';
import type { PlatformAdapter } from '../../../../src/content/platforms/adapter';
import type { PostContent } from '../../../../src/types/post';

function makeTwitterAdapter(): {
  adapter: PlatformAdapter;
  extractCalls: NodeList[];
  extractReturns: PostContent[][];
} {
  const extractCalls: NodeList[] = [];
  const extractReturns: PostContent[][] = [];
  const adapter: PlatformAdapter = {
    platform: 'twitter',
    detectPlatform: () => true,
    getPostSelector: () => '[data-testid="tweetText"]',
    extractPosts: (nodes: NodeList) => {
      extractCalls.push(nodes);
      const nextReturn = extractReturns.shift() ?? [];
      return nextReturn;
    },
  };
  return { adapter, extractCalls, extractReturns };
}

function makeTiktokAdapter(): PlatformAdapter {
  return {
    platform: 'tiktok',
    detectPlatform: () => true,
    getPostSelector: () => '[data-e2e="video-desc"]',
    extractPosts: () => [],
  };
}

// non-V1 platform to verify the watcher does NOT attach.
function makeFacebookAdapter(): PlatformAdapter {
  return {
    platform: 'facebook',
    detectPlatform: () => true,
    getPostSelector: () => '[data-testid="fb-post-text"]',
    extractPosts: () => [],
  };
}

// Simulates a page framework (React Router etc.) navigating: in the real
// extension that call happens on the MAIN-world History binding, which the
// page-world route notifier wraps. Tests that need the notifier install it
// per-describe (see the LOOP-070 / M87 beforeEach hooks).
function navigateSPA(newPath: string): void {
  history.pushState({}, '', newPath);
}

// Capture the PRISTINE history methods before any test runs, so we can
// forcibly restore them in beforeEach — prevents cross-test leakage when a
// test fails to cleanup via the notifier disposer.
const PRISTINE_PUSH = history.pushState;
const PRISTINE_REPLACE = history.replaceState;

beforeEach(() => {
  document.body.innerHTML = '';
  history.pushState = PRISTINE_PUSH;
  history.replaceState = PRISTINE_REPLACE;
  // Force-restoring the methods above orphans any leaked notifier wrapper;
  // clear its install flag too so the next install isn't a no-op.
  delete (window as { __fwRouteNotifierInstalled?: boolean }).__fwRouteNotifierInstalled;
  // Reset URL at the start of each test so route-change detection fires cleanly.
  history.replaceState({}, '', '/');
});

afterEach(() => {
  history.pushState = PRISTINE_PUSH;
  history.replaceState = PRISTINE_REPLACE;
  delete (window as { __fwRouteNotifierInstalled?: boolean }).__fwRouteNotifierInstalled;
  vi.useRealTimers();
});

describe('ContentInterceptor — normal mutation flow (unchanged by LOOP-070)', () => {
  it('processes body.childNodes on start()', () => {
    const { adapter, extractCalls } = makeTwitterAdapter();
    const interceptor = new ContentInterceptor(adapter, vi.fn());
    interceptor.start();
    expect(extractCalls.length).toBeGreaterThanOrEqual(1);
    interceptor.stop();
  });

  it('stamps data-fw-processed on successfully extracted tweet nodes', () => {
    const { adapter, extractReturns } = makeTwitterAdapter();
    const tweetEl = document.createElement('div');
    tweetEl.setAttribute('data-testid', 'tweetText');
    tweetEl.textContent = 'hello world this is a tweet';
    document.body.appendChild(tweetEl);

    extractReturns.push([{
      id: 'tw-1', text: tweetEl.textContent, author: 'alice',
      timestamp: new Date().toISOString(), platform: 'twitter',
      domRef: new WeakRef(tweetEl),
    } as PostContent]);

    const interceptor = new ContentInterceptor(adapter, vi.fn());
    interceptor.start();
    expect(tweetEl.dataset.fwProcessed).toBe('true');
    interceptor.stop();
  });

  it('resumes immediately when a chat overlay present at start closes', async () => {
    const { adapter, extractCalls } = makeTwitterAdapter();
    const onSurfaceChange = vi.fn();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Chat with Maria');
    document.body.appendChild(dialog);
    const interceptor = new ContentInterceptor(adapter, vi.fn(), onSurfaceChange);
    interceptor.start();
    const callsWhileOpen = extractCalls.length;

    dialog.remove();
    await vi.waitFor(() => expect(extractCalls.length).toBeGreaterThan(callsWhileOpen));

    expect(onSurfaceChange).toHaveBeenCalledOnce();
    expect(onSurfaceChange).toHaveBeenCalledWith('chat-close');
    interceptor.stop();
  });

  it('filters chat-contained records while processing new public feed content beside the popup', async () => {
    const { adapter, extractReturns } = makeTwitterAdapter();
    const publicRow = document.createElement('article');
    publicRow.textContent = 'public feed post';
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Chat with Maria');
    const privateRow = document.createElement('article');
    privateRow.textContent = 'private chat message';
    dialog.appendChild(privateRow);
    document.body.append(publicRow, dialog);
    const publicPost = {
      id: 'public', text: publicRow.textContent, author: 'alice', timestamp: '', platform: 'twitter',
      domRef: new WeakRef(publicRow),
    } as PostContent;
    const privatePost = {
      id: 'private', text: privateRow.textContent, author: 'remi', timestamp: '', platform: 'twitter',
      domRef: new WeakRef(privateRow),
    } as PostContent;
    extractReturns.push([publicPost, privatePost]);
    const onPost = vi.fn();
    const interceptor = new ContentInterceptor(adapter, onPost, undefined, () => true);
    interceptor.start();

    expect(onPost).toHaveBeenCalledWith(publicPost, expect.any(Number));
    expect(onPost).not.toHaveBeenCalledWith(privatePost, expect.anything());

    const nextPublicRow = document.createElement('article');
    nextPublicRow.textContent = 'new public post beside chat';
    const nextPublicPost = {
      ...publicPost, id: 'public-2', text: nextPublicRow.textContent, domRef: new WeakRef(nextPublicRow),
    } as PostContent;
    extractReturns.push([nextPublicPost]);
    document.body.appendChild(nextPublicRow);
    await Promise.resolve();

    expect(onPost).toHaveBeenCalledWith(nextPublicPost, expect.any(Number));
    interceptor.stop();
  });

  it('re-arms and immediately reprocesses one stamped virtualized row', () => {
    const { adapter, extractReturns } = makeTwitterAdapter();
    const onPost = vi.fn();
    const row = document.createElement('div');
    row.dataset.fwProcessed = 'true';
    row.textContent = 'replacement row';
    document.body.appendChild(row);
    const replacement = {
      id: 'replacement', text: row.textContent, author: 'alice', timestamp: new Date().toISOString(),
      platform: 'twitter', domRef: new WeakRef(row),
    } as PostContent;
    extractReturns.push([], [replacement]);
    const interceptor = new ContentInterceptor(adapter, onPost);
    interceptor.start();

    interceptor.rearmElement(row);

    expect(row.dataset.fwProcessed).toBe('true');
    expect(onPost).toHaveBeenCalledWith(replacement, expect.any(Number));
    interceptor.stop();
  });

  it('re-arms a modern Facebook comment from its enclosing post article', () => {
    const article = document.createElement('div');
    article.setAttribute('role', 'article');
    article.innerHTML = `
      <a href="/u/posts/postId001">post</a>
      <div dir="auto">Main post body that is long enough to extract per the 20-char floor.</div>
      <div role="article" aria-label="Comment by Maria">
        <a role="link" href="/maria"><span>Maria</span></a>
        <div dir="auto">Original comment body long enough to extract.</div>
      </div>
    `;
    document.body.appendChild(article);
    const onPost = vi.fn();
    const interceptor = new ContentInterceptor(new FacebookAdapter(), onPost);
    interceptor.start();
    const body = article.querySelectorAll<HTMLElement>('[dir="auto"]')[1];
    expect(body).toBeDefined();
    onPost.mockClear();
    body.textContent = 'Replacement comment body long enough to extract.';

    interceptor.rearmElement(body);

    expect(onPost).toHaveBeenCalledWith(expect.objectContaining({
      platform: 'facebook',
      kind: 'top-comment',
      text: 'Replacement comment body long enough to extract.',
    }), expect.any(Number));
    interceptor.stop();
  });

  it('re-arms a modern Facebook sibling comment from its aria-posinset feed unit', () => {
    const feedUnit = document.createElement('div');
    feedUnit.setAttribute('aria-posinset', '1');
    feedUnit.innerHTML = `
      <a href="/u/posts/postModern001">post</a>
      <div role="article"></div>
      <div data-ad-rendering-role="story_message">
        <div dir="auto">Main post body long enough for modern extraction.</div>
      </div>
      <div role="article" aria-label="Comment by Maria">
        <a role="link" href="/maria"><span>Maria</span></a>
        <div dir="auto">Original sibling comment body long enough to extract.</div>
      </div>
    `;
    document.body.appendChild(feedUnit);
    const onPost = vi.fn();
    const interceptor = new ContentInterceptor(new FacebookAdapter(), onPost);
    interceptor.start();
    const commentBody = Array.from(feedUnit.querySelectorAll<HTMLElement>('[dir="auto"]'))
      .find(element => element.textContent?.includes('Original sibling'))!;
    onPost.mockClear();
    commentBody.textContent = 'Replacement sibling comment body long enough to extract.';

    interceptor.rearmElement(commentBody);

    expect(onPost).toHaveBeenCalledWith(expect.objectContaining({
      platform: 'facebook',
      kind: 'top-comment',
      text: 'Replacement sibling comment body long enough to extract.',
    }), expect.any(Number));
    interceptor.stop();
  });

  it('does not scan the whole document for chat overlays on ordinary mutations', async () => {
    const { adapter } = makeTwitterAdapter();
    const queryAll = vi.spyOn(document, 'querySelectorAll');
    const interceptor = new ContentInterceptor(adapter, vi.fn());
    interceptor.start();
    queryAll.mockClear();

    document.body.appendChild(document.createElement('span'));
    await Promise.resolve();
    await Promise.resolve();
    expect(queryAll).not.toHaveBeenCalledWith('[role="dialog"][aria-label]');

    interceptor.stop();
  });

  it('mounts a Child cover in the mutation microtask before any queued animation frame', async () => {
    const { adapter, extractReturns } = makeTwitterAdapter();
    extractReturns.push([]);
    const manager = new ChildProtectionManager<PostContent>();
    manager.setMode('child');
    const interceptor = new ContentInterceptor(
      adapter,
      post => { manager.protect(post); },
      undefined,
      () => true,
    );
    interceptor.start();
    const row = document.createElement('article');
    row.textContent = 'new Child feed item';
    const post = {
      id: 'sync-child', text: row.textContent, author: 'alice', timestamp: new Date().toISOString(),
      platform: 'twitter', domRef: new WeakRef(row), kind: 'post',
    } as PostContent;
    extractReturns.push([post]);
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);

    document.body.appendChild(row);
    await Promise.resolve();

    expect(row.querySelector('.fw-provisional-shield')).not.toBeNull();
    expect(raf).not.toHaveBeenCalled();
    manager.release(post);
    interceptor.stop();
  });

  it('synchronously covers current posts when runtime mode enters Child', () => {
    const { adapter, extractReturns } = makeTwitterAdapter();
    const manager = new ChildProtectionManager<PostContent>();
    manager.setMode('teen');
    const row = document.createElement('article');
    row.textContent = 'already visible during Teen analysis';
    document.body.appendChild(row);
    const teenPost = {
      id: 'mode-transition', text: row.textContent, author: 'alice', timestamp: '', platform: 'twitter',
      domRef: new WeakRef(row), kind: 'post',
    } as PostContent;
    extractReturns.push([teenPost]);
    const interceptor = new ContentInterceptor(adapter, post => { manager.protect(post); });
    interceptor.start();
    expect(row.querySelector('.fw-provisional-shield')).toBeNull();

    manager.setMode('child');
    const childPost = { ...teenPost, domRef: new WeakRef(row) } as PostContent;
    extractReturns.push([childPost]);
    interceptor.rescanCurrentSurfaceNow();

    expect(row.querySelector('.fw-provisional-shield')).not.toBeNull();
    manager.release(childPost);
    interceptor.stop();
  });
});

describe('ContentInterceptor — LOOP-070 SPA route rescan (MAIN-world notifier present)', () => {
  // The MAIN-world bundle ships on X/FB/IG/TT (manifest.json world:"MAIN"
  // entry), so these tests run with the route notifier installed — a
  // `history.pushState` call below is a page-framework navigation being
  // relayed as fw:route-change (G3 2026-08-04).
  let disposeNotifier: (() => void) | null = null;
  beforeEach(() => {
    disposeNotifier = installPageWorldRouteNotifier();
  });
  afterEach(() => {
    disposeNotifier?.();
    disposeNotifier = null;
  });

  it('start() leaves the isolated-world history bindings untouched (G3)', () => {
    // An in-world patch can never observe MAIN-world navigations, and
    // re-wrapping the notifier's wrapper would only add fingerprint
    // surface. The interceptor must attach listeners, not patch History.
    const { adapter } = makeTwitterAdapter();
    const pushBeforeStart = history.pushState;
    const replaceBeforeStart = history.replaceState;
    const interceptor = new ContentInterceptor(adapter, vi.fn());
    interceptor.start();
    expect(history.pushState).toBe(pushBeforeStart);
    expect(history.replaceState).toBe(replaceBeforeStart);
    interceptor.stop();
    expect(history.pushState).toBe(pushBeforeStart);
    expect(history.replaceState).toBe(replaceBeforeStart);
  });

  it('a MAIN-world pushState is seen SYNCHRONOUSLY via the fw:route-change relay', () => {
    // Core G3 contract: old-surface invalidation (`onSurfaceChange('route')`)
    // fires in the same task as the page framework's pushState — not up to
    // ROUTE_POLL_MS later via the poll.
    const { adapter } = makeTwitterAdapter();
    const onSurfaceChange = vi.fn();
    const interceptor = new ContentInterceptor(adapter, vi.fn(), onSurfaceChange);
    interceptor.start();

    navigateSPA('/alice/status/12345');

    expect(onSurfaceChange).toHaveBeenCalledWith('route');
    interceptor.stop();
  });

  it('pushState to a new pathname triggers a rescan (adapter.extractPosts called again)', async () => {
    vi.useFakeTimers();
    const { adapter, extractCalls } = makeTwitterAdapter();
    const interceptor = new ContentInterceptor(adapter, vi.fn());
    interceptor.start();
    const callsOnStart = extractCalls.length;

    navigateSPA('/alice/status/12345');
    await vi.advanceTimersByTimeAsync(500);

    // Rescan should have fired — extractCalls grew.
    expect(extractCalls.length).toBeGreaterThan(callsOnStart);
    interceptor.stop();
  });

  it('rescan strips data-fw-processed from tweetText nodes so the new scan sees them fresh', async () => {
    vi.useFakeTimers();
    const { adapter, extractCalls } = makeTwitterAdapter();
    const staleTweet = document.createElement('div');
    staleTweet.setAttribute('data-testid', 'tweetText');
    staleTweet.setAttribute('data-fw-processed', 'true');
    staleTweet.textContent = 'a tweet from an earlier feed render';
    document.body.appendChild(staleTweet);

    const interceptor = new ContentInterceptor(adapter, vi.fn());
    interceptor.start();

    navigateSPA('/alice/status/12345');
    await vi.advanceTimersByTimeAsync(500);

    // Stamp stripped — the new scan had a chance to re-consider this node.
    expect(staleTweet.dataset.fwProcessed).toBeUndefined();
    expect(extractCalls.length).toBeGreaterThanOrEqual(2);
    interceptor.stop();
  });

  it('same pathname pushState does NOT trigger a rescan (no-op)', async () => {
    vi.useFakeTimers();
    const { adapter, extractCalls } = makeTwitterAdapter();
    history.replaceState({}, '', '/home');
    const interceptor = new ContentInterceptor(adapter, vi.fn());
    interceptor.start();
    const callsAfterStart = extractCalls.length;

    navigateSPA('/home'); // same path, no-op
    await vi.advanceTimersByTimeAsync(500);

    expect(extractCalls.length).toBe(callsAfterStart);
    interceptor.stop();
  });

  it('TikTok also activates the route watcher (V1 platform scope)', () => {
    const onSurfaceChange = vi.fn();
    const interceptor = new ContentInterceptor(makeTiktokAdapter(), vi.fn(), onSurfaceChange);
    interceptor.start();
    navigateSPA('/@creator/video/42');
    expect(onSurfaceChange).toHaveBeenCalledWith('route');
    interceptor.stop();
  });

  it('Facebook also watches routes so public-to-DM cleanup cannot be skipped', () => {
    const onSurfaceChange = vi.fn();
    const interceptor = new ContentInterceptor(makeFacebookAdapter(), vi.fn(), onSurfaceChange);
    interceptor.start();
    navigateSPA('/groups/456');
    expect(onSurfaceChange).toHaveBeenCalledWith('route');
    interceptor.stop();
  });

  it('Facebook public-to-DM navigation invokes cleanup and never extracts the private route', async () => {
    vi.useFakeTimers();
    history.replaceState({}, '', '/home');
    const adapter = makeFacebookAdapter();
    const extractPosts = vi.spyOn(adapter, 'extractPosts');
    const onSurfaceChange = vi.fn();
    const interceptor = new ContentInterceptor(adapter, vi.fn(), onSurfaceChange);
    interceptor.start();
    const publicCalls = extractPosts.mock.calls.length;

    navigateSPA('/messages/t/123');
    expect(onSurfaceChange).toHaveBeenCalledWith('route');
    await vi.advanceTimersByTimeAsync(500);

    expect(extractPosts).toHaveBeenCalledTimes(publicCalls);
    interceptor.stop();
  });

  it('treats a query-only SPA navigation as a new surface', async () => {
    vi.useFakeTimers();
    history.replaceState({}, '', '/watch?v=first');
    const adapter = makeFacebookAdapter();
    const extractPosts = vi.spyOn(adapter, 'extractPosts');
    const onSurfaceChange = vi.fn();
    const interceptor = new ContentInterceptor(adapter, vi.fn(), onSurfaceChange);
    interceptor.start();
    const callsOnStart = extractPosts.mock.calls.length;

    history.pushState({}, '', '/watch?v=second');
    expect(onSurfaceChange).toHaveBeenCalledWith('route');
    await vi.advanceTimersByTimeAsync(500);

    expect(extractPosts.mock.calls.length).toBeGreaterThan(callsOnStart);
    interceptor.stop();
  });
});

describe('ContentInterceptor — G3 poll fallback (no MAIN-world notifier)', () => {
  // No notifier install here: this is the degraded environment — the
  // MAIN-world bundle failed to install, or the page rebound History from
  // a fresh iframe realm so the wrapper no longer sits on the binding the
  // framework calls. Programmatic navs are then invisible until the
  // ROUTE_POLL_MS pathname poll ticks. (YouTube ships no MAIN-world
  // bundle at all, but it also never starts this watcher — see
  // SPA_RESCAN_PLATFORMS and the NOTE in the M87 describe below.)

  it('a programmatic nav is caught by the ROUTE_POLL_MS poll, not synchronously', async () => {
    vi.useFakeTimers();
    const { adapter } = makeTwitterAdapter();
    const onSurfaceChange = vi.fn();
    const interceptor = new ContentInterceptor(adapter, vi.fn(), onSurfaceChange);
    interceptor.start();

    navigateSPA('/alice/status/12345'); // native pushState — nothing relays it

    // Honest latency contract: without the notifier there is NO synchronous
    // detection (the isolated world cannot patch what the page calls) …
    expect(onSurfaceChange).not.toHaveBeenCalled();
    // … but the 800 ms poll still catches it.
    await vi.advanceTimersByTimeAsync(800);
    expect(onSurfaceChange).toHaveBeenCalledWith('route');
    interceptor.stop();
  });

  it('popstate (browser back) triggers rescan without any notifier', async () => {
    // popstate is a DOM event on the shared document tree, so the isolated
    // world hears it directly — no MAIN-world relay needed. (This is why it
    // lives in the no-notifier describe: with the notifier active, the
    // replaceState below would already relay and mask the popstate path.)
    vi.useFakeTimers();
    const { adapter, extractCalls } = makeTwitterAdapter();
    const interceptor = new ContentInterceptor(adapter, vi.fn());
    interceptor.start();
    const baseline = extractCalls.length;

    history.replaceState({}, '', '/alice/status/12345'); // silent URL change
    window.dispatchEvent(new PopStateEvent('popstate'));
    await vi.advanceTimersByTimeAsync(500);

    expect(extractCalls.length).toBeGreaterThan(baseline);
    interceptor.stop();
  });

  it('stop() detaches the fw:route-change listener', () => {
    const { adapter } = makeTwitterAdapter();
    const onSurfaceChange = vi.fn();
    const interceptor = new ContentInterceptor(adapter, vi.fn(), onSurfaceChange);
    interceptor.start();
    interceptor.stop();

    history.replaceState({}, '', '/alice/status/12345');
    document.dispatchEvent(new CustomEvent('fw:route-change'));

    expect(onSurfaceChange).not.toHaveBeenCalled();
  });

  it('a relayed event with an unchanged route key is a no-op (spoof/burst safe)', () => {
    const { adapter, extractCalls } = makeTwitterAdapter();
    const onSurfaceChange = vi.fn();
    const interceptor = new ContentInterceptor(adapter, vi.fn(), onSurfaceChange);
    interceptor.start();
    const callsOnStart = extractCalls.length;

    // A page can dispatch fw:route-change at will; without an actual URL
    // change it must not reset the surface or clear pending batches.
    document.dispatchEvent(new CustomEvent('fw:route-change'));
    document.dispatchEvent(new CustomEvent('fw:route-change'));

    expect(onSurfaceChange).not.toHaveBeenCalled();
    expect(extractCalls.length).toBe(callsOnStart);
    interceptor.stop();
  });
});

describe('ContentInterceptor — M87/CORE-6 route-key query-param dedup', () => {
  // G3 (2026-08-04): with the MAIN-world notifier installed, every
  // replaceState below actually reaches the watcher as fw:route-change —
  // these dedup tests exercise computeRouteKey against a live signal, not
  // against silence.
  let disposeNotifier: (() => void) | null = null;
  beforeEach(() => {
    disposeNotifier = installPageWorldRouteNotifier();
  });
  afterEach(() => {
    disposeNotifier?.();
    disposeNotifier = null;
  });

  // Root cause: `_startRouteWatcher` keyed route identity on
  // `pathname + search`, so a search-param-only replaceState (X/FB
  // search-as-you-type fires replaceState on every keystroke) looked like a
  // full navigation — generation bump, bucket drop, in-flight cover release
  // — even though the child never left the search surface. Fix: the route
  // key drops `search` entirely UNLESS the platform has a query param that
  // is actually load-bearing elsewhere in the codebase (YouTube's `v` —
  // video-context/identity.ts, video-pipeline.ts derivePlatformVideoId;
  // Facebook's `v` on `/watch` — video-context/identity.ts facebook case).

  it('a search-only replaceState on X (query-param edit, same pathname) does NOT trigger a route reset', async () => {
    vi.useFakeTimers();
    const { adapter, extractCalls } = makeTwitterAdapter();
    history.replaceState({}, '', '/search?q=a');
    const onSurfaceChange = vi.fn();
    const interceptor = new ContentInterceptor(adapter, vi.fn(), onSurfaceChange);
    interceptor.start();
    const callsOnStart = extractCalls.length;

    history.replaceState({}, '', '/search?q=ab');
    await vi.advanceTimersByTimeAsync(500);

    expect(onSurfaceChange).not.toHaveBeenCalled();
    expect(extractCalls.length).toBe(callsOnStart);
    interceptor.stop();
  });

  it('a search-only replaceState on Facebook (non-Watch path) does NOT trigger a route reset', async () => {
    vi.useFakeTimers();
    history.replaceState({}, '', '/search/top?q=a');
    const onSurfaceChange = vi.fn();
    const interceptor = new ContentInterceptor(makeFacebookAdapter(), vi.fn(), onSurfaceChange);
    interceptor.start();

    history.replaceState({}, '', '/search/top?q=ab');
    await vi.advanceTimersByTimeAsync(500);

    expect(onSurfaceChange).not.toHaveBeenCalled();
    interceptor.stop();
  });

  it('a real pathname change away from a search page still triggers a route reset', async () => {
    vi.useFakeTimers();
    const { adapter, extractCalls } = makeTwitterAdapter();
    history.replaceState({}, '', '/search?q=a');
    const onSurfaceChange = vi.fn();
    const interceptor = new ContentInterceptor(adapter, vi.fn(), onSurfaceChange);
    interceptor.start();
    const callsOnStart = extractCalls.length;

    navigateSPA('/alice/status/999');
    await vi.advanceTimersByTimeAsync(500);

    expect(onSurfaceChange).toHaveBeenCalledWith('route');
    expect(extractCalls.length).toBeGreaterThan(callsOnStart);
    interceptor.stop();
  });

  // NOTE: no ContentInterceptor-level YouTube route-reset test here.
  // `SPA_RESCAN_PLATFORMS` (interceptor.ts) does not include 'youtube' —
  // `_startRouteWatcher` never attaches for that platform (also excluded
  // from the periodic rescan and short-circuited in `_processNodes` on
  // `/watch` — see the OOM-mitigation comments at interceptor.ts:403-408
  // and :521-532). YouTube also ships no MAIN-world bundle (manifest.json
  // world:"MAIN" entry omits *.youtube.com), so no fw:route-change relay
  // exists there either. A YouTube `?v=` regression can't be observed
  // through ContentInterceptor today; the guard lives at the
  // `computeRouteKey` pure-function level below, and would only become
  // interceptor-visible if a future change adds 'youtube' to
  // SPA_RESCAN_PLATFORMS.

  describe('computeRouteKey (pure)', () => {
    it('drops all query params for platforms with no load-bearing query param', () => {
      expect(computeRouteKey('twitter', '/search', '?q=a')).toBe(computeRouteKey('twitter', '/search', '?q=ab'));
      expect(computeRouteKey('tiktok', '/foryou', '?q=a')).toBe('/foryou');
      expect(computeRouteKey('instagram', '/explore', '?q=a')).toBe('/explore');
    });

    it('keeps YouTube `v` and `list` as part of the route identity', () => {
      expect(computeRouteKey('youtube', '/watch', '?v=A')).not.toBe(computeRouteKey('youtube', '/watch', '?v=B'));
      expect(computeRouteKey('youtube', '/watch', '?v=A&list=PL1'))
        .not.toBe(computeRouteKey('youtube', '/watch', '?v=A&list=PL2'));
    });

    it('keeps Facebook `v` (Watch video id) but drops everything else', () => {
      expect(computeRouteKey('facebook', '/watch', '?v=A')).not.toBe(computeRouteKey('facebook', '/watch', '?v=B'));
      expect(computeRouteKey('facebook', '/search/top', '?q=a'))
        .toBe(computeRouteKey('facebook', '/search/top', '?q=ab'));
    });

    it('is a pure pathname passthrough when there is no search string', () => {
      expect(computeRouteKey('youtube', '/watch', '')).toBe('/watch');
      expect(computeRouteKey('twitter', '/home', '')).toBe('/home');
    });
  });
});
