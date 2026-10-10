// FeelingWise - Core interception logic
// Watches for new DOM nodes via MutationObserver, routes to the active adapter
// for post extraction, then marks nodes with data-fw-processed.
//
// : handles SPA route changes on X. When the user clicks
// a tweet from the feed, X's client-side router replaces the timeline with a
// post-detail view. The tweetText element for the main tweet may carry a
// stale `data-fw-processed` stamp from the feed render (when X reuses the
// same DOM node across views), so the adapter skips it. Replies in the
// conversation tree are usually fresh nodes but can arrive before our
// observer boots for the new route. Fix: detect route changes via
// popstate + the MAIN-world route notifier relay (fw:route-change, see
// page-world/route-notifier.ts) + fallback polling, then strip
// `data-fw-processed` from every tweet-text node in body and re-process
// document.body.childNodes from scratch. Keeps the stamp semantics intact
// for in-page scroll, resets them on genuine navigation.

import { PostContent } from '../../types/post';
import {
  PlatformAdapter,
  isPrivateMessageSurface,
  hasActiveChatOverlay,
  nodeContainsChatOverlay,
  findChatOverlayAncestor,
} from '../platforms/adapter';
import { sharedSurfaceDetector, type SurfaceDescriptor } from './surface-detector';
import { recordExtractionResult } from '../../diagnostics/extraction-canary';
import { probeRoomAtExtract } from '../probes/room-availability-probe';
import { bumpCounter, registerHeapGauge, registerHeapValve, setGaugePeak, unregisterHeapValve } from '../../diagnostics/diagnostics';
import { classifySurface, noteSurfaceSighting } from './surfaces';
import { ChurnBreaker } from './churn-breaker';

/**
 * The body observer's rate ceiling (churn-breaker.ts). 1,500 callbacks a
 * sliding minute is twenty-five a second, sustained for a full minute: a
 * stream, not a page. Hydration bursts are shorter and never trip it. When
 * it trips the observer is disconnected for the cooldown, the loss is a
 * signed gap on the chain, and the observer is re-armed after.
 */
const CHURN_MAX_PER_MINUTE = 1_500;
const CHURN_SUSTAIN_MS = 60_000;
const CHURN_COOLDOWN_MS = 60_000;
import { noteGap } from '../record/gap-ledger';
import { releaseAllGuards } from '../injector';
import { recordItemRead, type ReadKind } from '../../storage/settings';
import { setReExtractSink } from './scroll-trigger';

/**
 * Per-platform check: is the FW-relevant content UI actually rendered?
 * The canary uses this to skip counting when the platform shows a no-
 * comment surface (e.g. TT comment panel closed) — that's not a
 * regression, just normal closed-panel state.
 */
function isPlatformContentUiPresent(platform: string): boolean {
  if (typeof document === 'undefined') return false;
  if (platform === 'tiktok') {
    // Video-detail surface (`/@user/video/<id>`): the video isn't shaped
    // as a post that `extractPosts` returns — caption + comments flow
    // through separate pipelines. Counting these batches toward the
    // canary produces guaranteed false-positives even when FW is fully
    // functional. Only count on /foryou or /explore feeds where
    // `extractPosts` is structurally expected to return non-zero.
    const path = typeof location !== 'undefined' ? location.pathname : '';
    if (/^\/@[^/]+\/video\//.test(path)) return false;
    return document.querySelector('[class*="DivCommentListContainer"]') !== null
      || document.querySelector('[class*="DivCommentItemWrapper"]') !== null;
  }
  if (platform === 'instagram') {
    return document.querySelector('article') !== null
      || document.querySelector('[data-fw-comment-row]') !== null
      || document.querySelector('a[href*="/c/"]') !== null;
  }
  if (platform === 'youtube') {
    // /watch is intentionally disabled for post extraction per OOM
    // mitigation (youtube.ts:1-26). Don't count those batches.
    // /shorts is V1.5-deferred per OPERATING_POINT — post adapter only
    // matches `ytd-backstage-post-renderer` (community posts), which
    // doesn't exist on Shorts. Canary would otherwise fire a misleading
    // "selectors may be stale" warning on every Shorts visit (chrome://
    // extensions error report, 2026-05-24).
    const path = typeof location !== 'undefined' ? location.pathname : '';
    if (path === '/watch') return false;
    if (path.startsWith('/shorts/')) return false;
    return document.querySelector('ytd-comment-thread-renderer') !== null
      || document.querySelector('ytd-comment-view-model') !== null
      || document.querySelector('ytd-backstage-post-renderer') !== null;
  }
  // X / Facebook / unknown — feed surfaces always count.
  return true;
}

/**
 * How many elements the adapter's own post selector matches in the DOM right
 * now (before the already-seen dedup). Feeds the extraction canary's
 * "stamped-zero vs broken-selector-zero" discriminator. Returns undefined on
 * any failure (no document, empty/malformed selector) so the canary falls
 * back to its legacy postsLength-only gate — this runs on the hot extraction
 * path and must never throw.
 */
function countRawSelectorMatches(adapter: PlatformAdapter): number | undefined {
  if (typeof document === 'undefined') return undefined;
  try {
    const selector = adapter.getPostSelector();
    if (!selector) return undefined;
    return document.querySelectorAll(selector).length;
  } catch {
    return undefined;
  }
}

export type PostHandler = (post: PostContent, detectedAt?: number) => void;
export type SurfaceChangeReason = 'route' | 'route-settled' | 'chat-open' | 'chat-close';

// Platforms we apply SPA re-scan to. Keep tight to avoid
// unintended extra work on platforms where it isn't needed.
const SPA_RESCAN_PLATFORMS = new Set(['twitter', 'tiktok', 'facebook', 'instagram']);
const ROUTE_POLL_MS = 800;
const RESCAN_DELAY_MS = 400;

// periodic safety-net rescan. An FB modal diagnostic
// showed 4/7 comments with fwProcessed=false (visible in DOM but never went
// through extractPosts), while 3/7 had fwProcessed=true. The MutationObserver
// must be missing some lazy-loaded insertions on FB (likely React-batched
// updates that fire as character-data or attribute mutations rather than
// childList). The periodic re-scan walks body.childNodes every N seconds —
// cheap because every adapter's per-article fwProcessed gate skips already-
// processed nodes. Caught up to the same insurance pattern structural-finder
// uses for the engagement-bar virtualization race.
const PERIODIC_RESCAN_MS = 3000;
/** Hard cap on the per-frame pending-node Set — unbounded growth = renderer OOM. */
const MAX_PENDING_NODES = 10_000;

// SurfaceDescriptor registrations for the route-rescan stamp-strip path.
// The selectors here target the per-platform NODES that carry the stale
// `data-fw-processed` stamp on SPA navigation (tweetText for X, video-desc
// for TikTok). Registered through the shared detector so the per-platform
// stamp-list lives in one place across consumers.
const INTERCEPTOR_RESCAN_SURFACES: SurfaceDescriptor[] = [
  {
    id: 'interceptor:twitter:stamps',
    platform: 'twitter',
    surfaceKind: 'route-rescan-stamps',
    pathnamePattern: null,
    containerSelectors: ['[data-testid="tweetText"][data-fw-processed="true"]'],
    dynamicContentRescan: true,
  },
  {
    id: 'interceptor:tiktok:stamps',
    platform: 'tiktok',
    surfaceKind: 'route-rescan-stamps',
    pathnamePattern: null,
    containerSelectors: [
      '[data-e2e="video-desc"][data-fw-processed="true"]',
      '[data-e2e="browse-video-desc"][data-fw-processed="true"]',
    ],
    dynamicContentRescan: true,
  },
];

for (const desc of INTERCEPTOR_RESCAN_SURFACES) {
  try {
    sharedSurfaceDetector.register(desc);
  } catch {
    // Already registered (re-import / HMR / test rebuild). The shared
    // detector enforces id-uniqueness by throwing; tolerated here because
    // the registry is module-load idempotent for our purposes.
  }
}

/**
 * Whether the body MutationObserver should SKIP accumulating added nodes.
 * Pure + exported for testing.
 *
 * On YouTube /watch the adapter's `extractPosts` always returns [] (the watch
 * page is captured by yt-watch-comments.ts through one scoped observer), so
 * accumulating + draining + walking the watch page's constant mutations every
 * frame is pure waste AND adds FW's footprint to the surface of the 2026-06
 * renderer OOM. Critically, a backgrounded *playing* tab suspends
 * `requestAnimationFrame` — the ONLY drain — while YouTube keeps mutating, so
 * accumulating grew the Set toward the cap. Skip /watch.
 *
 * The home feed (`/`) was skipped for the same reason from 2026-06-07 until
 * 2026-09-17, when its tiles became records (platforms/youtube.ts,
 * PLAN-2026-09-17 item 6). What bounds it now, and did not exist in June: the
 * pending-node cap (MAX_PENDING_NODES), the backlog dropped on
 * `visibilitychange`, the churn breaker and the heap valve on this observer,
 * and the adapter's own per-page tile cap. Pure + exported for testing.
 */
export function shouldSkipNodeAccumulation(platform: string, pathname: string): boolean {
  return platform === 'youtube' && pathname.startsWith('/watch');
}

/**
 * Q70 (W61): the extraction gate against ingesting FeelingWise's OWN text.
 * `data-fw-neutralized` marks every element whose visible text FW replaced
 * (rewrites AND collapse/fold placeholders, injector.ts); hard-hidden and
 * ad-hidden containers carry their own stamps. An element inside such a
 * container, or a container holding such an element, was already
 * adjudicated this session and its textContent is (or blends in) FW copy,
 * not what the platform served. Pure + exported for testing.
 */
const FW_INJECTED_TEXT_SELECTOR = '[data-fw-neutralized],[data-fw-hard-hidden],[data-fw-ad-hidden]';

export function carriesFwInjectedText(el: Element | null): boolean {
  if (!el) return false;
  return el.closest(FW_INJECTED_TEXT_SELECTOR) !== null
    || el.querySelector(FW_INJECTED_TEXT_SELECTOR) !== null;
}

/**
 * Per-platform allowlist of query params that are part of the SPA route
 * IDENTITY (as opposed to incidental — search text, tracking params, etc).
 * Any param not listed here is dropped when `_startRouteWatcher` computes
 * its route key. Pure + exported for testing (M87/CORE-6).
 *
 * - youtube `v` — the actual video id. `/watch?v=A` -> `/watch?v=B` is a
 *   real surface change (a different video) even though the pathname
 *   ("/watch") never changes. Same id video-context/identity.ts and
 *   video-pipeline.ts's `derivePlatformVideoId` already treat as load-
 *   bearing for forensic grouping.
 * - youtube `list` — no code reads this today, but it is kept defensively:
 *   a playlist-context change while `v` stays the same is still a
 *   plausible real navigation, and an extra rescan is far cheaper than a
 *   missed one.
 * - facebook `v` — Facebook Watch uses the identical `/watch?v=<id>` shape
 *   (see video-context/identity.ts's facebook case); everything else on
 *   Facebook (search text, `story_fbid`, etc.) is incidental.
 *
 * Twitter/TikTok/Instagram have no load-bearing query param anywhere in the
 * codebase today (their post/video identity comes from the pathname alone),
 * so their route key is pathname-only — a search-as-you-type replaceState
 * (`/search?q=a` -> `/search?q=ab`) collapses to the same key and does not
 * reset in-flight work.
 */
const ROUTE_KEY_QUERY_PARAMS: Readonly<Record<string, readonly string[]>> = {
  youtube: ['v', 'list'],
  facebook: ['v'],
};

/**
 * Compute the SPA route-identity key used by `_startRouteWatcher` to decide
 * whether a pushState/replaceState/popstate is a real navigation. Pathname
 * always participates; `search` participates only through the platform's
 * load-bearing param allowlist above — everything else in the query string
 * (search text, ids, tracking params) is dropped so it can change freely
 * without tripping a route reset. Pure + exported for testing (M87/CORE-6).
 */
export function computeRouteKey(platform: string, pathname: string, search: string): string {
  const keptParams = ROUTE_KEY_QUERY_PARAMS[platform];
  if (!keptParams || keptParams.length === 0 || !search) return pathname;
  const params = new URLSearchParams(search);
  const kept: string[] = [];
  for (const name of keptParams) {
    const value = params.get(name);
    if (value !== null) kept.push(`${name}=${value}`);
  }
  return kept.length > 0 ? `${pathname}?${kept.join('&')}` : pathname;
}

/** How many item ids one page remembers as counted; the oldest goes first. */
const COUNTED_AS_READ_MAX = 2000;

/** What the read count calls an item: a video, a comment of any depth, or a post. */
function readKindOf(kind: PostContent['kind']): ReadKind {
  if (kind === 'video') return 'video';
  if (kind === 'comment' || kind === 'top-comment' || kind === 'reply' || kind === 'reply-to-reply') return 'comment';
  return 'post';
}

export class ContentInterceptor {
  private observer: MutationObserver | null = null;
  /** visibilitychange handler — drops the backlog when the tab is backgrounded. */
  private onVisibility: (() => void) | null = null;
  /** rAF id for pending per-frame node-batch drain. 0 when idle. */
  private _pendingRaf = 0;
  /** Nodes added across MO fires waiting to be drained in the next rAF tick. */
  private _pendingNodes = new Set<Node>();
  /** The pending-node set is the one interceptor structure that can grow between rescans; its size at every heap peak. */
  private _pendingGauge = registerHeapGauge('interceptor.pendingNodes', () => this._pendingNodes.size);
  private readonly churn = new ChurnBreaker({ maxPerMinute: CHURN_MAX_PER_MINUTE, sustainMs: CHURN_SUSTAIN_MS, cooldownMs: CHURN_COOLDOWN_MS });
  private churnRearmId: number | null = null;
  /** A backlog was dropped while the tab was in the background; one walk is owed when it returns. */
  private _droppedWhileHidden = false;

  /** Set by the heap valve and never cleared: nothing reads the page again until it reloads. */
  private _heapShed = false;

  /**
   * The heap valve (diagnostics.ts): past the threshold the recorder stops
   * reading the page for the rest of its life and says so on the chain. Every
   * walk of the body is stopped, not only the observer, because the page is
   * already close to running out of memory. Registered in start, removed in
   * stop, so a torn-down surface never sheds twice.
   */
  private readonly onHeapValve = (mb: number): void => {
    this._heapShed = true;
    if (this.churnRearmId !== null) { clearTimeout(this.churnRearmId); this.churnRearmId = null; }
    if (this.periodicRescanId !== null) { window.clearInterval(this.periodicRescanId); this.periodicRescanId = null; }
    this.observer?.disconnect();
    if (this._pendingRaf !== 0) { cancelAnimationFrame(this._pendingRaf); this._pendingRaf = 0; }
    this._pendingNodes.clear();
    noteGap('heap-valve', 1, 'events');
    console.warn(`[FeelingWise] heap valve: ${mb} MB on ${location.pathname}; the recorder stops reading this page until the next page load`);
  };

  /**
   * One pass over the page after the recorder was not watching it.
   *
   * The observer is shed in three places: the churn breaker's cooldown, a
   * backgrounded tab's dropped backlog, and the heap valve. Each writes its
   * gap marker, so the record says a stretch is missing, and on most platforms
   * the three second safety rescan picks the items up when the surface comes
   * back. YouTube has no safety rescan, deliberately: walking the body every
   * three seconds on that SPA was part of the watch-page memory climb. So on
   * the one platform where the breaker is most likely to trip, nothing ever
   * looked again, and items that arrived during the cooldown were never
   * recorded at all.
   *
   * One walk when the surface comes back is not the rescan loop. It costs a
   * twentieth of what the loop would have cost over the same minute, it runs
   * once per event rather than on a timer, and it is what turns a recorded gap
   * into a recovered one.
   */
  private catchUpScan(reason: string): void {
    if (this._heapShed || typeof document === 'undefined' || !document.body) return;
    try {
      bumpCounter(`interceptor.catchUpScan.${reason}`);
      this._processNodes(document.body.childNodes, true);
    } catch (err) {
      console.warn('[FeelingWise] catch-up scan threw:', err);
    }
  }

  /** The breaker tripped: stop observing, say so on the chain, come back after the cooldown. */
  private tripChurnBreaker(count: number): void {
    this.observer?.disconnect();
    if (this._pendingRaf !== 0) { cancelAnimationFrame(this._pendingRaf); this._pendingRaf = 0; }
    this._pendingNodes.clear();
    bumpCounter('interceptor.churnBreaker');
    noteGap('churn-breaker', count, 'events');
    console.warn(`[FeelingWise] observer rate ceiling: ${count} callbacks in a minute on ${location.pathname}; standing down for ${CHURN_COOLDOWN_MS / 1000}s`);
    if (this.churnRearmId !== null) clearTimeout(this.churnRearmId);
    this.churnRearmId = window.setTimeout(() => {
      this.churnRearmId = null;
      if (!this.observer || typeof document === 'undefined' || !document.body) return;
      this.observer.observe(document.body, { childList: true, subtree: true });
      // Everything the page added during the cooldown arrived while nobody was
      // watching, and the observer only reports what happens next.
      this.catchUpScan('churn');
    }, CHURN_COOLDOWN_MS);
  }
  private adapter: PlatformAdapter;
  private onPost: PostHandler;
  /** Optional SPA route-change hook. Invoked at the start of every rescan so
   *  the owner (content/index.ts) can cancel work bound to the OLD url — e.g.
   *  pending comment-batch timers that would otherwise flush under the new
   *  page's room context. */
  private onRouteChange: ((reason: SurfaceChangeReason) => void) | null;
  private periodicRescanId: number | null = null;

  // route-change state.
  private lastPath: string | null = null;
  private routeIntervalId: number | null = null;
  private onPopState: (() => void) | null = null;
  private onFwRouteEvent: (() => void) | null = null;
  private rescanTimeoutId: number | null = null;
  private chatOverlayActive = false;
  private readonly shouldProcessSynchronously: () => boolean;

  constructor(
    adapter: PlatformAdapter,
    onPost: PostHandler,
    onRouteChange?: (reason: SurfaceChangeReason) => void,
    shouldProcessSynchronously: () => boolean = () => false,
  ) {
    this.adapter = adapter;
    this.onPost = onPost;
    this.onRouteChange = onRouteChange ?? null;
    this.shouldProcessSynchronously = shouldProcessSynchronously;
  }

  /** Ids already counted as read on this page; bounded, and only ever held in memory. */
  private readonly countedAsRead = new Set<string>();

  private countRead(post: PostContent): void {
    if (this.countedAsRead.has(post.id)) return;
    if (this.countedAsRead.size >= COUNTED_AS_READ_MAX) {
      const oldest = this.countedAsRead.values().next().value;
      if (oldest !== undefined) this.countedAsRead.delete(oldest);
    }
    this.countedAsRead.add(post.id);
    recordItemRead(this.adapter.platform, readKindOf(post.kind));
  }

  /**
   * Start observing the document for new posts.
   * MutationObserver with subtree:true handles Twitter's infinite scroll.
   */
  start(): void {
    if (this.observer) return; // already running

    registerHeapValve(this.onHeapValve);
    this.chatOverlayActive = hasActiveChatOverlay();
    // Adapters' scroll triggers re-walk mounted articles through this sink
    // instead of moving them in the DOM (see scroll-trigger.ts). isRescan is
    // true because these roots are not new content and must not feed the
    // extraction canary.
    setReExtractSink((roots) => {
      try {
        this._processNodes(roots as unknown as NodeList, true);
      } catch (err) {
        console.warn('[FeelingWise] re-extraction request threw:', err);
      }
    });
    // Process any posts already present in the DOM on load
    this._processNodes(document.body.childNodes);

    // rAF-debounced + node-accumulating body observer.
    //
    // Two failure modes this pattern fixes:
    //
    //  • Pre-Ship-#27 (original): the callback ran per MO fire and called
    //    _processNodes(mutation.addedNodes) for each mutation. Hundreds of
    //    mutations per second on YouTube's homepage hydration → hundreds of
    //    extractPosts calls per second → CPU pressure that fed the OOM.
    //
    //  • Ship #27.1 (regression): the rAF callback did a full-body rescan
    //    (_processNodes(document.body.childNodes)) once per frame. Far
    //    fewer calls, but each call walked the entire YT homepage DOM —
    //    the browser flagged "requestAnimationFrame handler took 66ms" in
    //    a live re-test, well over the 16ms frame budget. Layout
    //    starvation, jank, would have eventually OOMed under sustained
    //    bursts.
    //
    //  • Ship #27.2 (this): accumulate added nodes across MO fires into a
    //    Set; drain the Set on the next rAF tick. Per-mutation specificity
    //    preserved (only walk new nodes, not the whole body), per-frame
    //    rate preserved (≤60 callbacks/sec). The Set dedupes nodes added
    //    multiple times in the same frame.
    this.observer = new MutationObserver((mutations) => {
      // Rate ceiling first, before any work on the mutations (churn-breaker.ts).
      const churn = this.churn.note();
      if (churn.tripped) { this.tripChurnBreaker(churn.count); return; }
      const addedChatOverlay = mutations.some(mutation =>
        Array.from(mutation.addedNodes).some(nodeContainsChatOverlay));
      const removedChatOverlay = this.chatOverlayActive && mutations.some(mutation =>
        Array.from(mutation.removedNodes).some(nodeContainsChatOverlay));
      const chatOverlayActive = addedChatOverlay
        ? true
        : removedChatOverlay
          ? hasActiveChatOverlay()
          : this.chatOverlayActive;
      if (chatOverlayActive !== this.chatOverlayActive) {
        this.chatOverlayActive = chatOverlayActive;
        if (this._pendingRaf !== 0) {
          cancelAnimationFrame(this._pendingRaf);
          this._pendingRaf = 0;
        }
        this._pendingNodes.clear();
        this.onRouteChange?.(chatOverlayActive ? 'chat-open' : 'chat-close');
        if (!chatOverlayActive) {
          this._processNodes(document.body.childNodes, true);
        }
      }
      // Leak guard: on YouTube /watch the interceptor has no work, and a
      // backgrounded playing tab suspends rAF (the only drain) while the MO
      // keeps firing → unbounded _pendingNodes growth → renderer OOM. Skip
      // accumulation and drop any stale backlog.
      if (shouldSkipNodeAccumulation(this.adapter.platform, location.pathname)) {
        if (this._pendingNodes.size > 0) this._pendingNodes.clear();
        return;
      }
      if (this.shouldProcessSynchronously()) {
        const added = new Set<Node>();
        for (const mutation of mutations) {
          if (mutation.type !== 'childList') continue;
          for (const node of mutation.addedNodes) added.add(node);
        }
        if (added.size > 0) {
          const detectedAt = performance.now();
          try {
            this._processNodes([...added] as unknown as NodeList, false, detectedAt, true);
          } catch (err) {
            console.warn('[FeelingWise] synchronous Child extraction threw:', err);
          }
        }
        return;
      }
      for (const m of mutations) {
        if (m.type === 'childList' && m.addedNodes.length > 0) {
          for (const n of m.addedNodes) this._pendingNodes.add(n);
        }
      }
      // Hard memory bound: never let the pending set grow without limit (e.g.
      // rAF starved under heavy infinite-scroll, or suspended on a backgrounded
      // tab). Dropping a batch loses at most one frame of new nodes; the
      // periodic rescan (non-YouTube) recovers them. Surfaced in diagnostics so
      // a non-zero drop count flags node-accumulation pressure.
      if (this._pendingNodes.size > MAX_PENDING_NODES) {
        bumpCounter('interceptor.pendingOverflowDrops');
        // Register item 9: the drop is a bound on loss, in DOM nodes; the
        // signed gap marker says so (forensics/gap-marker.ts).
        noteGap('backlog-overflow', this._pendingNodes.size, 'nodes');
        this._pendingNodes.clear();
        return;
      }
      if (this._pendingRaf !== 0) return;
      this._pendingRaf = requestAnimationFrame(() => {
        this._pendingRaf = 0;
        if (this._pendingNodes.size === 0) return;
        const batch = Array.from(this._pendingNodes);
        this._pendingNodes.clear();
        // Diagnostics: how many node-batches we drain + the largest batch seen.
        // A climbing peak alongside a climbing heap points the OOM at node
        // accumulation; a flat peak exonerates it.
        bumpCounter('interceptor.batchesDrained');
        setGaugePeak('interceptor.pendingNodesPeak', batch.length);
        // Array.from(Set<Node>) yields Node[], but _processNodes is typed
        // for NodeList. Both expose the iteration shape adapters need
        // (forEach with same signature); cast through unknown is safe.
        try {
          this._processNodes(batch as unknown as NodeList);
        } catch (err) {
          console.warn('[FeelingWise] interceptor batch processing threw:', err);
        }
      });
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Memory backstop: a backgrounded tab SUSPENDS requestAnimationFrame (the
    // only _pendingNodes drain) while the MutationObserver keeps firing — so
    // without this, any platform's playing/auto-updating background tab grows
    // the Set without bound. When the tab goes hidden we cannot process anyway,
    // so cancel the pending drain and drop the backlog. On return, the MO
    // resumes and (on rescan-enabled platforms) the periodic safety rescan
    // recovers anything added while hidden.
    this.onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (this._pendingRaf !== 0) {
          cancelAnimationFrame(this._pendingRaf);
          this._pendingRaf = 0;
        }
        // Register item 9: same bound, same unit, for the backlog a hidden
        // tab drops.
        noteGap('backlog-hidden', this._pendingNodes.size, 'nodes');
        this._pendingNodes.clear();
        this._droppedWhileHidden = true;
        return;
      }
      // Back in front, and a backlog was dropped while it was away. One walk
      // recovers what the observer will never report again.
      if (this._droppedWhileHidden) {
        this._droppedWhileHidden = false;
        this.catchUpScan('hidden');
      }
    };
    document.addEventListener('visibilitychange', this.onVisibility);

    // SPA route-change detection.
    if (SPA_RESCAN_PLATFORMS.has(this.adapter.platform)) {
      this._startRouteWatcher();
    }

    // periodic safety-net rescan (see top-of-file). Skipped on YouTube
    // because (a) extractPosts early-returns on /watch and (b) other YT
    // surfaces don't have the FB lazy-load problem this re-scan was
    // designed for, so walking body.childNodes every 3s on YT's massive
    // SPA is pure overhead that contributed to the watch-page OOM.
    if (this.adapter.platform !== 'youtube') {
      // M79 suspect-4 measurement counter (docs/spec/known-issues.md): cheap
      // windowed sampling of the periodic full-body rescan's SYNCHRONOUS cost
      // (walk + adapter extractPosts re-query; rAF-deferred work not
      // included). One console line per ~15s window while ticks run — same
      // shape as section-model's chip-scan sampler.
      let perfWindowStart = 0;
      let perfCount = 0;
      let perfTotalMs = 0;
      let perfMaxMs = 0;
      this.periodicRescanId = window.setInterval(() => {
        try {
          const t0 = performance.now();
          this._processNodes(document.body.childNodes, true);
          const dt = performance.now() - t0;
          perfCount++;
          perfTotalMs += dt;
          if (dt > perfMaxMs) perfMaxMs = dt;
          if (perfWindowStart === 0) {
            perfWindowStart = Date.now();
          } else if (Date.now() - perfWindowStart >= 15_000) {
            const secs = Math.round((Date.now() - perfWindowStart) / 1000);
            console.log(
              `[FW perf] periodic-rescan ${secs}s window: n=${perfCount} ` +
              `total=${perfTotalMs.toFixed(1)}ms mean=${(perfTotalMs / perfCount).toFixed(2)}ms max=${perfMaxMs.toFixed(1)}ms`,
            );
            perfWindowStart = Date.now();
            perfCount = 0;
            perfTotalMs = 0;
            perfMaxMs = 0;
          }
        } catch (err) {
          console.warn('[FeelingWise] periodic rescan threw:', err);
        }
      }, PERIODIC_RESCAN_MS);
    }
  }

  stop(): void {
    // Q72 (W64): a stopped interceptor means this surface is being torn
    // down; the rewrite guards' observers and strong element refs go with
    // it (they were only ever pruned opportunistically inside addGuard).
    releaseAllGuards();
    setReExtractSink(null);
    unregisterHeapValve(this.onHeapValve);
    if (this.churnRearmId !== null) { clearTimeout(this.churnRearmId); this.churnRearmId = null; }
    this.observer?.disconnect();
    this.observer = null;
    if (this._pendingRaf !== 0) {
      cancelAnimationFrame(this._pendingRaf);
      this._pendingRaf = 0;
    }
    this._pendingNodes.clear();
    this.chatOverlayActive = false;
    if (this.onVisibility) {
      document.removeEventListener('visibilitychange', this.onVisibility);
      this.onVisibility = null;
    }
    if (this.periodicRescanId !== null) {
      window.clearInterval(this.periodicRescanId);
      this.periodicRescanId = null;
    }
    this._stopRouteWatcher();
  }

  /** Re-arm one virtualized row whose content changed under a pending verdict. */
  rearmElement(anchor: HTMLElement): void {
    if (this._heapShed) return;
    const commentRoot = anchor.closest<HTMLElement>('[data-fw-comment-seen]')
      ?? anchor.querySelector<HTMLElement>('[data-fw-comment-seen]');
    const root = commentRoot
      ?? anchor.closest<HTMLElement>('[data-fw-processed]')
      ?? anchor.querySelector<HTMLElement>('[data-fw-processed]')
      ?? anchor;
    const wasComment = !!commentRoot;
    delete root.dataset.fwProcessed;
    delete root.dataset.fwCommentSeen;
    const extractionRoot = this.adapter.platform === 'facebook' && wasComment
      ? root.closest<HTMLElement>(
          '[role="article"][data-fw-processed], [role="article"][data-fw-post-id], '
          + '[aria-posinset][data-fw-processed], [aria-posinset][data-fw-post-id]',
        ) ?? root
      : root;
    this._processNodes([extractionRoot] as unknown as NodeList, true);
  }

  /** Re-extract the current public surface immediately (used when Child turns on). */
  rescanCurrentSurfaceNow(): void {
    // Checked before the stamps are cleared, because clearing them walks the
    // whole document, which the heap valve is there to stop.
    if (this._heapShed) return;
    this._clearExtractionStamps();
    this._processNodes(document.body.childNodes, true, performance.now());
  }

  private _clearExtractionStamps(): void {
    document.querySelectorAll<HTMLElement>('[data-fw-processed], [data-fw-comment-seen]')
      .forEach(element => {
        delete element.dataset.fwProcessed;
        delete element.dataset.fwCommentSeen;
      });
  }

  private _processNodes(
    nodes: NodeList,
    isRescan: boolean = false,
    detectedAt: number = performance.now(),
    skipDiagnostics: boolean = false,
  ): void {
    // Every way in (a scroll re-extraction, a rescan asked for by a mode
    // change) stops here once the heap valve has tripped.
    if (this._heapShed) return;
    // Runtime DM-surface gate. SPA navigation from a public feed into a
    // DM surface (`facebook.com/home` → `facebook.com/messages/t/<id>`)
    // keeps the existing content-script + interceptor running because
    // content_scripts inject once per top-level navigation, not per SPA
    // route change. Without this gate the adapter would happily extract
    // private message text from the new DOM. VISION §0: public-feed
    // protection only; DMs are out-of-scope and reading them would
    // violate the trust contract with the parent.
    if (isPrivateMessageSurface()) {
      console.debug('[FeelingWise] DM gate (URL): skipping _processNodes on', window.location.pathname);
      return;
    }
    // Surface gate (surfaces.ts, 2026-09-06). A live or streaming chat, a
    // notifications list, a marketplace, a dating or account page is
    // recognised by its path and left alone: no extraction, no observer work
    // beyond this return, one counter per page life. A path no rule names is
    // extracted as before and counted, so the inventory learns what it lacks
    // from the next diagnostics paste instead of from the next crash.
    if (typeof location !== 'undefined') {
      const surface = classifySurface(this.adapter.platform, location.pathname);
      noteSurfaceSighting(this.adapter.platform, location.pathname, surface);
      if (surface.treatment === 'stand-down' || surface.treatment === 'excluded') return;
    }
    // Chat popups may coexist with a public feed. Adapters exclude candidates
    // before reading/stamping them; the per-record gate below is a final
    // defense while public siblings continue through normal extraction.
    // YT /watch hard short-circuit. `extractPosts` is structurally off
    // here (youtube.ts:43-50), but the per-batch framework overhead —
    // NodeList iteration, the `recordExtractionResult` call, and the
    // `isPlatformContentUiPresent` 3-querySelector probe — still ran on
    // every MO fire under YT's player + chat + recommendations DOM churn.
    // A live install's renderer crashed with "Aw, Snap! Out of Memory" while
    // FW was running on /watch. Early-return before any of that work happens.
    // Engagement-hider (separate controller) is untouched by this gate.
    if (
      this.adapter.platform === 'youtube'
      && typeof location !== 'undefined'
      && location.pathname === '/watch'
    ) {
      return;
    }
    const posts = this.adapter.extractPosts(nodes)
      .filter(post => !findChatOverlayAncestor(post.domRef.deref() ?? null))
      // Q70 (W61): never re-ingest FeelingWise's own injected text as post
      // content. After a rescan clears the processed stamps (mode flip,
      // image-understanding toggle), adapters re-read textContent, which on
      // an already-protected element is FW's rewrite or fold placeholder;
      // re-scoring that can write FW's own copy into the forensic chain as
      // "what the child saw" (Promise 1 corruption). Elements re-created by
      // the platform's virtualizer carry no stamp and still re-extract
      // normally, so cache replay on genuine remounts is unaffected. A
      // container is also skipped when a descendant carries the stamp: such
      // a container was already adjudicated this session and re-reading it
      // would blend FW copy into its text.
      .filter(post => !carriesFwInjectedText(post.domRef.deref() ?? null));
    // Measurement only (2026-08-24): was each root post's own room in the DOM
    // when the post was extracted? Decides, per platform AND per surface,
    // whether the single-post judge can be given a room block the way
    // tiktok.ts:793 already does. Never reads a verdict, never writes DOM.
    probeRoomAtExtract(posts, this.adapter.platform);
    // Canary gate. Two filters before counting a batch toward the
    // cold-start / regression thresholds:
    //   1. `isRescan` — periodic-rescan + route-rescan call sites walk
    //      `document.body.childNodes` (potentially hundreds of nodes) on a
    //      timer or after SPA navigation, NOT in response to real new
    //      content. Treating those as "real mutation batches with zero
    //      extract" inflated the canary counter and produced the universal
    //      false-positive firing observed across FB / X / TT / YT on
    //      2026-05-22. MO-fired calls (where mutationCount is the actual
    //      addedNodes length) still count normally.
    //   2. `contentUiPresent` — per-platform check, skips TT cold-start
    //      when the comment panel isn't open. Other platforms always
    //      count because their content UI is the feed itself.
    if (!isRescan && !skipDiagnostics) {
      const contentUiPresent = isPlatformContentUiPresent(this.adapter.platform);
      // Count how many elements the adapter's own post selector matches right
      // now (before dedup). A zero extract with candidates still present means
      // "all already stamped" (idle/dwell), not drift — see recordExtractionResult.
      const rawCandidateCount = countRawSelectorMatches(this.adapter);
      recordExtractionResult(
        this.adapter.platform,
        posts.length,
        nodes.length,
        contentUiPresent,
        rawCandidateCount,
      );
    }

    for (const post of posts) {
      // Mark the DOM element as processed so we don't re-process on re-render
      const el = post.domRef.deref();
      if (el) {
        el.dataset.fwProcessed = 'true';
      }

      // The one place an item is accepted as read (B10-1): counted here, before the queue, the
      // caches or the pipeline can drop or answer it, so the count is of what was read and not of
      // what was finished. Once per item per page: a platform that re-creates an element carries
      // no stamp, but the id is the same.
      this.countRead(post);

      this.onPost(post, detectedAt);
    }
  }

  /**
   * Watch for SPA route changes on the rescan platforms (X / TikTok /
   * FB / IG — SPA_RESCAN_PLATFORMS).
   *
   * Their client-side routers navigate via history.pushState /
   * replaceState and do NOT emit `popstate` unless the user presses
   * back. This content script CANNOT observe those calls by patching
   * `history` here: it runs in the ISOLATED world, which has its own
   * History binding — a wrapper installed on it only ever sees the
   * content script's own (nonexistent) calls. (G3 2026-08-04: the
   * previous in-world pushState/replaceState patch, plus its same-/
   * cross-generation nesting guards, protected a hook that could never
   * fire for page navigations; detection really rode popstate + the
   * ROUTE_POLL_MS poll, i.e. up to ROUTE_POLL_MS + RESCAN_DELAY_MS
   * ≈ 1.2 s of extraction under the stale route.)
   *
   * Detection is therefore three-source:
   *   1. `fw:route-change` CustomEvent relayed by the MAIN-world route
   *      notifier (page-world/route-notifier.ts) — synchronous with the
   *      page framework's pushState/replaceState. Same cross-world
   *      relay idiom as fw:platform-payload. The event carries no
   *      detail; we re-read window.location ourselves, so a page
   *      spoofing the event can at most trigger the same no-op the
   *      route-key check below already absorbs.
   *   2. `popstate` — back/forward; a DOM event on the shared tree, so
   *      no relay is needed.
   *   3. ROUTE_POLL_MS pathname poll — safety net for when the
   *      MAIN-world bundle is absent or the page rebound History from a
   *      fresh realm (iframe trick).
   *
   * On detected route change, `_rescanAfterRoute()` fires after a short
   * delay (RESCAN_DELAY_MS) to let the new view mount, then strips
   * `data-fw-processed` from every tweet-text node visible in the document
   * and re-processes body.childNodes from scratch. Replies in the
   * conversation tree get caught this way even when their parent article
   * was already stamped from the feed view.
   */
  private _startRouteWatcher(): void {
    if (typeof window === 'undefined' || typeof history === 'undefined') return;
    this.lastPath = computeRouteKey(this.adapter.platform, window.location.pathname, window.location.search);

    const onRouteChange = (): void => {
      try {
        const next = computeRouteKey(this.adapter.platform, window.location.pathname, window.location.search);
        if (next === this.lastPath) return;
        this.lastPath = next;
        // Invalidate old-surface async work immediately. The DOM rescan waits
        // for the new view to mount, but image/video capture must not retain a
        // 400 ms window in which newly recycled private content can be read.
        this.onRouteChange?.('route');
        this._scheduleRescan();
      } catch {
        // Defensive — never let a route check throw on the host page.
      }
    };

    this.onPopState = onRouteChange;
    window.addEventListener('popstate', this.onPopState);

    // Programmatic (page-framework) navigations, relayed from the MAIN
    // world. Listener attach/detach replaces the old patch-and-restore
    // machinery — an orphaned content script (extension reload while the
    // page persisted) leaves nothing behind on History anymore, so the
    // generation-tag disambiguation is gone with it.
    this.onFwRouteEvent = onRouteChange;
    document.addEventListener('fw:route-change', this.onFwRouteEvent);

    // Polling safety net (source 3 above).
    this.routeIntervalId = window.setInterval(onRouteChange, ROUTE_POLL_MS);
  }

  private _stopRouteWatcher(): void {
    if (this.onPopState) {
      window.removeEventListener('popstate', this.onPopState);
      this.onPopState = null;
    }
    if (this.onFwRouteEvent) {
      document.removeEventListener('fw:route-change', this.onFwRouteEvent);
      this.onFwRouteEvent = null;
    }
    if (this.routeIntervalId !== null) {
      window.clearInterval(this.routeIntervalId);
      this.routeIntervalId = null;
    }
    if (this.rescanTimeoutId !== null) {
      window.clearTimeout(this.rescanTimeoutId);
      this.rescanTimeoutId = null;
    }
  }

  private _scheduleRescan(): void {
    if (this.rescanTimeoutId !== null) {
      window.clearTimeout(this.rescanTimeoutId);
    }
    this.rescanTimeoutId = window.setTimeout(() => {
      this.rescanTimeoutId = null;
      this._rescanAfterRoute();
    }, RESCAN_DELAY_MS);
  }

  /**
   * Strip stale `data-fw-processed` stamps from every candidate node in the
   * document, then re-process body.childNodes. Per-platform stamp selectors
   * are looked up from the shared SurfaceDetector (registered as
   * `interceptor:<platform>:stamps`) so the per-platform stamp list lives in
   * one place rather than as an inline switch in this method.
   */
  private _rescanAfterRoute(): void {
    try {
      // After the heap valve the owner is still told the route settled, but the
      // new page is not walked.
      if (this._heapShed) return;
      // Route changed — cancel work bound to the OLD url BEFORE re-walking the
      // new DOM. Without this, a pending comment-batch timer flushes the prior
      // page's comments under the new page's parentVideoId / roomUrl
      // (VISION §1.1 chain-mirror). Owner-supplied (content/index.ts).
      this._clearExtractionStamps();
      const pathname = typeof location !== 'undefined' ? location.pathname : '';
      const surfaceMatches = sharedSurfaceDetector.matchAndWalk(this.adapter.platform, pathname);
      for (const surfaceMatch of surfaceMatches) {
        if (!surfaceMatch.descriptor.id.startsWith('interceptor:')) continue;
        for (const el of surfaceMatch.containers) {
          delete (el as HTMLElement).dataset.fwProcessed;
        }
      }
      this._processNodes(document.body.childNodes, true);
    } catch (err) {
      console.warn('[FeelingWise] route-change rescan failed', err);
    } finally {
      // Fresh extraction has had its chance to rotate connected provisional
      // owners. The owner can now release only handles whose old host detached.
      this.onRouteChange?.('route-settled');
    }
  }
}
