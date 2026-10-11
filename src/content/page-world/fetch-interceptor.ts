// FeelingWise — Page-world payload interceptor.
//
// Runs in the page's MAIN world (own JS realm). Wraps window.fetch +
// XMLHttpRequest.prototype.send. On URL substring match against the
// per-platform pattern list, clones the response and dispatches a
// CustomEvent('fw:platform-payload', { detail }) on document. The
// content-script-side relay (src/content/page-world/relay.ts) listens
// for this event.
//
// CRITICAL: this file has ZERO imports. It ships as its own bundle
// (BUILD_TARGET=pageworld) and runs in the page's JS realm before any
// content script can monkey-patch fetch from the isolated world.
//
// The patches cost the page something: clone().json() parses every matched
// response a second time, and the wrapped fetch is visible to page scripts.
// They are installed at page load because the room verdict for text-less posts
// reads what they copy. Two things keep the bill honest:
//   • the pattern list below is per-platform and per-endpoint, never "every
//     response on this host". Only a URL that matches is cloned and parsed;
//     everything else passes through untouched.
//   • each platform carries a SKIP list of response URLs that are known to
//     carry no items (logging beacons, story injections, preloads). They are
//     matched first and cost one substring test.
//
// Match by URL SUBSTRING (months-to-years stable), NOT by doc_id /
// query_hash / queryId (rotates every 2-4 weeks). Per
// docs/history/archive/V15_PAGE_WORLD_DESIGN.md. The endpoint lists are the facts documented
// in docs/research/ZEESCHUIMER-2026-09-14.md section 3, plus the YouTube
// endpoints derived in src/content/platforms/wire/youtube.ts. No code was
// taken from Zeeschuimer; a list of endpoint names is a fact about a platform.
//
// CRITICAL: this file has ZERO imports, so the surface inventory
// (src/content/post-path/surfaces.ts) cannot be consulted here. The stand-down gate for
// live chats and other streams is applied on the isolated-world side, in
// relay.ts, before anything is parsed. Private surfaces are refused earlier,
// here, twice: when the request is made (mayRead below) and again when its
// response arrives (stillMayRead), because a person can open a private
// conversation while a feed request is still on its way.

type Platform = 'twitter' | 'facebook' | 'instagram' | 'tiktok' | 'youtube';

interface UrlPattern {
  platform: Platform;
  /** Substrings that, when ANY is present, make the response worth reading. */
  include: readonly string[];
  /** Substrings that, when ANY is present, veto the match. Checked first. */
  exclude?: readonly string[];
  /** Extra condition beyond the substring lists (only X needs one). */
  extra?: (url: string) => boolean;
}

/**
 * The per-platform endpoint table. Exported so a test can assert what is and
 * is not matched without reaching into a live page.
 */
const PATTERNS: readonly UrlPattern[] = [
  {
    // X's GraphQL operations that carry posts, widened 2026-09-14 from six to
    // fourteen plus the older adaptive.json path. The nine added ones are the
    // per-tab profile timelines X created in 2026, the list timeline, Explore
    // and Likes. Kept in step with X_POST_OPERATIONS in
    // src/content/platforms/wire/x.ts.
    platform: 'twitter',
    include: [
      'TweetDetail',
      'TweetResultByRestId',
      'HomeTimeline',
      'HomeLatestTimeline',
      'SearchTimeline',
      'UserTweets',
      'ListLatestTweetsTimeline',
      'UserOriginalsTimeline',
      'UserRepliesTimeline',
      'UserRepostsTimeline',
      'UserPhotoTimeline',
      'UserVideoTimeline',
      'ExplorePage',
      'Likes',
      'adaptive.json',
    ],
    // The operations live under /i/api/graphql/; adaptive.json lives under
    // /i/api/2/. Both are inside /i/api/, which is also what keeps X disjoint
    // from the Facebook rule below.
    extra: (url) => url.includes('/i/api/'),
  },
  {
    // FB uses /api/graphql/ for its GraphQL endpoint. The operation
    // discriminator (`friendly_name` / `doc_id`) lives in the POST body,
    // which the URL-match function cannot see — so we accept ALL FB
    // GraphQL responses and let the parser drop what it does not recognise.
    //
    // CAVEAT: X's GraphQL endpoint is `/i/api/graphql/...` which contains
    // the substring `/api/graphql/`. Plain substring match would
    // mis-attribute non-recognized X operations as facebook on x.com
    // (live MCP probe 2026-05-23 caught a phantom facebook event on
    // x.com home). Explicit `/i/api/` exclusion keeps FB matching
    // disjoint from X. IG uses `/graphql/query/` (no `/api/`) so already
    // disjoint.
    platform: 'facebook',
    include: ['/api/graphql/'],
    exclude: ['/i/api/', 'bulk-route-definitions', '/ajax/qm/', '/ajax/bz'],
  },
  {
    // IG's GraphQL endpoint plus the three internal endpoints that carry
    // items: the timeline and reels feeds, the explore grid, and a single
    // media with its comments. The query_hash discriminator in the
    // querystring is deliberately not read: it rotates, the item shape does
    // not.
    platform: 'instagram',
    include: [
      '/graphql/query/',
      '/api/v1/feed/',
      '/api/v1/discover/web/explore_grid/',
      '/api/v1/media/',
    ],
    // Named in the research file as the responses worth skipping: logging
    // beacons, the story-unit injections, and the route/config chatter. None
    // carries a feed item, and each one skipped is one clone().json() unpaid.
    exclude: [
      'logging_client_events',
      'injected_story_units',
      'bulk-route-definitions',
      'qe/sync',
      '/logging/',
    ],
  },
  {
    // TT's item-feed family (For You, Following, a profile's posts, search)
    // plus the comment-list family the interceptor already matched:
    // /aweme/v1/comment/list/, /aweme/v1/comment/list/reply/ and
    // /api/comment/list/ all share the substring /comment/list/.
    // /api/preload/ is excluded on purpose: it carries items the page has not
    // decided to show.
    platform: 'tiktok',
    include: [
      '/api/recommend/item_list/',
      '/api/post/item_list/',
      '/api/item_list/',
      '/api/search/item/',
      '/comment/list/',
    ],
    exclude: ['/api/preload/'],
  },
  {
    // YouTube's internal API. `browse` carries Home, Subscriptions and a
    // channel's tabs (first page plus every continuation); `next` carries the
    // watch page's up-next rail. Derived in
    // src/content/platforms/wire/youtube.ts, which documents the derivation.
    // The logging, attestation and player endpoints under the same prefix
    // carry no items.
    platform: 'youtube',
    include: ['/youtubei/v1/browse', '/youtubei/v1/next'],
    exclude: ['/youtubei/v1/log_event', '/youtubei/v1/att/', '/youtubei/v1/player'],
  },
];

function detectPlatform(): Platform | null {
  const host = (typeof window !== 'undefined' && window.location?.hostname) || '';
  if (host.includes('twitter.com') || host.includes('x.com')) return 'twitter';
  if (host.includes('facebook.com')) return 'facebook';
  if (host.includes('instagram.com')) return 'instagram';
  if (host.includes('tiktok.com')) return 'tiktok';
  if (host.includes('youtube.com')) return 'youtube';
  return null;
}

/**
 * Whether this response, on this site, is worth reading. Exclusions are
 * checked before inclusions so a skipped beacon costs one substring test and
 * never a JSON parse.
 *
 * Only the rule for the site the tab is on is consulted. That is what makes
 * cross-attribution impossible by construction rather than by a caveat: the
 * 2026-05-23 live probe caught an X response labelled facebook because the
 * whole table was tried against every URL, and Instagram and Facebook share
 * endpoint shapes for the same reason (one company, one gateway).
 *
 * Exported under a testing name so the endpoint table can be asserted from a
 * unit test rather than from a live page.
 */
function matchPlatform(url: string, site: Platform): boolean {
  for (const p of PATTERNS) {
    if (p.platform !== site) continue;
    if (p.exclude?.some((s) => url.includes(s))) return false;
    if (!p.include.some((s) => url.includes(s))) return false;
    if (p.extra && !p.extra(url)) return false;
    return true;
  }
  return false;
}

export function _matchPlatformForTesting(url: string, site: Platform): boolean {
  return matchPlatform(url, site);
}

/** Beyond this a response is not parsed: a double parse of a huge body costs the page memory it did not ask to spend. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

/**
 * Private surfaces are out of scope for every filter (project rule), and this
 * wrapper runs before the isolated-world stand-down in relay.ts can look. The
 * manifest's exclude_matches apply only to the page the tab first loaded, so
 * an in-app move to a chat is checked here, at response time, by path.
 */
const PRIVATE_PATH = /^\/(?:messages|direct|messenger|inbox|t\/|chat)(?:\/|$)/i;

/**
 * Facebook serves the Messenger dock through the same /api/graphql/ endpoint
 * as the feed, on the feed's own path, so the path cannot tell them apart.
 * The operation's name travels in the request body
 * (`fb_api_req_friendly_name`). A response is read only when that name is
 * present and is not a messaging operation; an unnamed request is not read.
 */
const FACEBOOK_PRIVATE_OPERATION = /messenger|^mw|lsplatform|chat|inbox|thread|message|mailbox/i;

function facebookOperationName(body: unknown): string | null {
  try {
    if (typeof body === 'string') {
      const m = /(?:^|&)fb_api_req_friendly_name=([^&]*)/.exec(body);
      return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null;
    }
    if (body instanceof URLSearchParams || (typeof FormData !== 'undefined' && body instanceof FormData)) {
      const v = body.get('fb_api_req_friendly_name');
      return typeof v === 'string' ? v : null;
    }
  } catch {
    /* unreadable body: treated as unnamed */
  }
  return null;
}

/** Whether a matched request may be read at all. Never throws. */
function mayRead(site: Platform, requestBody: unknown): boolean {
  try {
    if (PRIVATE_PATH.test(window.location.pathname)) return false;
    if (site !== 'facebook') return true;
    const name = facebookOperationName(requestBody);
    return name !== null && !FACEBOOK_PRIVATE_OPERATION.test(name);
  } catch {
    return false;
  }
}

/** Asked again when a response arrives: the page may have moved to a private path since the request was made. */
function stillMayRead(): boolean {
  try {
    return !PRIVATE_PATH.test(window.location.pathname);
  } catch {
    return false;
  }
}

export function _mayReadForTesting(site: Platform, requestBody: unknown): boolean {
  return mayRead(site, requestBody);
}

/** The request's address, or '' when it cannot be read. Never throws into the page. */
function requestUrl(input: unknown): string {
  try {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.href;
    const u = (input as { url?: unknown } | null)?.url;
    return typeof u === 'string' ? u : '';
  } catch {
    return '';
  }
}

function dispatchPayload(platform: Platform, url: string, body: unknown): void {
  try {
    document.dispatchEvent(
      new CustomEvent('fw:platform-payload', {
        detail: { platform, url, body },
      }),
    );
  } catch {
    /* dispatch must never disrupt page JS */
  }
}

/**
 * Install the interceptor. Returns a disposer that restores original
 * fetch + XHR.send. Idempotent: a second install while the first is
 * active returns a no-op disposer.
 */
export function installPageWorldInterceptor(): () => void {
  const w = window as unknown as { __fwPageWorldInstalled?: boolean };
  if (w.__fwPageWorldInstalled) {
    return () => {
      /* already installed by another caller */
    };
  }
  w.__fwPageWorldInstalled = true;

  const sitePlatform = detectPlatform();
  if (!sitePlatform) {
    return () => {
      w.__fwPageWorldInstalled = false;
    };
  }

  const originalFetch = window.fetch;

  // The page always gets back the very promise its fetch made. Awaiting it here sent every failure of the page's own
  // requests (a site's blocked telemetry, say) through this frame as our uncaught rejection; reading a response we
  // inspect happens on a side branch that swallows its own failures and never touches what the page receives.
  window.fetch = function fwFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const pending = originalFetch.call(window, input, init);
    let url = '';
    try {
      url = requestUrl(input);
      if (!url || !matchPlatform(url, sitePlatform) || !mayRead(sitePlatform, init?.body)) return pending;
    } catch {
      return pending;
    }
    // Registered before the page holds the promise, so this runs first and clones before the page can read the body.
    pending.then(
      (response) => {
        try {
          if (!stillMayRead()) return;
          const length = Number(response.headers.get('Content-Length') ?? '0');
          const contentType = response.headers.get('Content-Type') ?? '';
          if (contentType.includes('application/json') && !(length > MAX_BODY_BYTES)) {
            response.clone().json().then(
              (body) => dispatchPayload(sitePlatform, url, body),
              () => {
                /* malformed JSON — silently skip */
              },
            );
          }
        } catch {
          /* clone() failed or anything else: the page's response is untouched */
        }
      },
      () => {
        /* the request failed: that is the page's to handle, through its own promise */
      },
    );
    return pending;
  };

  // XHR wrap. Some legacy X endpoints use XHR.
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;
  const xhrUrlMap = new WeakMap<XMLHttpRequest, string>();

  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ): void {
    const urlStr = requestUrl(url);
    if (urlStr) xhrUrlMap.set(this, urlStr);
    return (originalXhrOpen as any).call(this, method, url, ...rest);
  } as typeof XMLHttpRequest.prototype.open;

  XMLHttpRequest.prototype.send = function (
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ): void {
    const url = xhrUrlMap.get(this);
    if (url) {
      let matched = false;
      try {
        matched = matchPlatform(url, sitePlatform) && mayRead(sitePlatform, body);
      } catch {
        matched = false;
      }
      if (matched) {
        this.addEventListener('load', () => {
          try {
            if (!stillMayRead()) return;
            const contentType = this.getResponseHeader('Content-Type') ?? '';
            if (!contentType.includes('application/json')) return;
            if (this.responseText.length > MAX_BODY_BYTES) return;
            const parsed = JSON.parse(this.responseText);
            dispatchPayload(sitePlatform, url, parsed);
          } catch {
            /* malformed — skip */
          }
        });
      }
    }
    return (originalXhrSend as any).call(this, body);
  };

  return () => {
    window.fetch = originalFetch;
    XMLHttpRequest.prototype.open = originalXhrOpen;
    XMLHttpRequest.prototype.send = originalXhrSend;
    w.__fwPageWorldInstalled = false;
  };
}
