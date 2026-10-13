// FeelingWise - Twitter/X platform adapter
//
// resilience: load-bearing selectors (post text, author handle,
// author display name, tweet ID, follow state) are expressed as priority
// chains and wrapped with selector-health telemetry. When X rotates a
// `data-testid` unannounced, the primary match drops to 0 and the
// fallback-hit counter ticks instead of the whole adapter going dark.
// The miss rate per label surfaces in `chrome.storage.local.fw_selector_health`
// so drift is observable before users complain.

import {
  PostContent,
  FeedSource,
  PlatformSpecificMeta,
  PostKind,
  PostNode,
  CommentNode,
  CommentNodeKind,
} from '../../types/post';
import { isInPrivateChatSubtree, PlatformAdapter } from './adapter';
import { parseCountText } from './count-text';
import { bumpCounter } from '../../diagnostics/diagnostics';
import { cardForRecord } from '../record/card-context';
import { queryWithFallback, queryAllWithFallback } from './selector-chain';
import { probeMetricsScope } from '../probes/metrics-probe';
import { noteTwitterPhotoSurface } from '../probes/m98-photo-probe';
import { requestReExtract, setupScrollExtractionTrigger } from '../post-path/scroll-trigger';
import { completesCutText, wireFieldsFor } from '../page-world/wire-store';
import type { AuthorCapture } from '../../types/author-capture';

// ─────────────────────────────────────────────────────────────────────────
// Encounter signal extraction helpers for X.
//
// Per `` §5.1 +
// `` §3.
//
// X is a permalink-tree platform: every comment-click navigates to a new
// URL and renders the full ancestry chain progressively. The chain is
// derivable from DOM order alone — no API resolution needed.
// ─────────────────────────────────────────────────────────────────────────

type TwitterSurfaceKind = NonNullable<
  Extract<PlatformSpecificMeta, { platform: 'twitter' }>['surfaceKind']
>;

type TwitterStatusIdentity = { id: string; author: string };

// A v4-shaped UUID anywhere in the id marks a `crypto.randomUUID()` fallback
// (extraction failed). A real X tweet id is always numeric (`/status/<digits>`).
// We must NOT embed a synthetic id in a `/status/<id>` URL — that link 404s.
const SYNTHETIC_UUID_RE = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i;

/** Detect the X surface from `window.location.pathname`. */
function detectTwitterSurface(): TwitterSurfaceKind {
  const path = (typeof window !== 'undefined' && window.location?.pathname) || '/';
  if (path.includes('/photo/')) return 'twitter-photo-modal';
  if (path.includes('/status/')) return 'twitter-permalink';
  if (path === '/home' || path === '/') return 'twitter-home-feed';
  if (path.includes('/search')) return 'twitter-search';
  if (path.includes('/i/lists/')) return 'twitter-list';
  // Default: a profile page (`/<handle>`).
  return 'twitter-profile';
}

/**
 * Extract per-article engagement metrics. Per §3 measurement, each
 * data-testid icon's `[data-testid="app-text-transition-container"]` carries
 * the formatted count. The `unlike` / `removeBookmark` variants surface when
 * the user has already engaged with the tweet (selector flips on toggle).
 */
function extractTweetMetrics(
  article: Element,
): NonNullable<Extract<PlatformSpecificMeta, { platform: 'twitter' }>['metrics']> {
  // Preferred source: the action-bar's role="group" aria-label, which X
  // maintains for screen readers with EXACT, non-abbreviated counts, e.g.
  // "40 replies, 52 reposts, 549 likes, 55 bookmarks, 13878 views". It is
  // stable across X's frequent DOM rotations (an accessibility contract, like
  // the role="log" gate) and exact — where the per-button text spans abbreviate
  // ("13K") and, as of the 2026-06-15 live DOM, concatenate adjacent numbers
  // (the like button's text read "549" likes + "55" bookmarks as one run, and
  // the analytics anchor doubled to "469K475K"), which is why the old per-span
  // path produced wrong/empty metrics. The per-button spans remain the fallback
  // when the label is absent (verified live against the home feed 2026-06-15).
  const group = article.querySelector('[role="group"][aria-label]');
  probeMetricsScope('twitter', 'action-bar group', article, group);
  const fromLabel = parseTweetGroupAriaLabel(group?.getAttribute('aria-label'));

  const cell = (testid: string): number | undefined => {
    const el = article.querySelector(
      `[data-testid="${testid}"] [data-testid="app-text-transition-container"]`,
    );
    return parseCountText(el?.textContent);
  };
  // Views are exposed only on root posts via the analytics anchor's text.
  const analyticsAnchor = article.querySelector('a[href*="/analytics"]');
  return {
    likes: fromLabel.likes ?? cell('like') ?? cell('unlike'),
    retweets: fromLabel.reposts ?? cell('retweet') ?? cell('unretweet'),
    replies: fromLabel.replies ?? cell('reply'),
    bookmarks: fromLabel.bookmarks ?? cell('bookmark') ?? cell('removeBookmark'),
    views: fromLabel.views ?? parseCountText(analyticsAnchor?.textContent),
  };
}

/**
 * Parse X's action-bar `role="group"` aria-label into exact engagement counts.
 * Returns only the keys present in the label — X omits zero-count actions, so a
 * post with no replies has no "N replies" segment (absent key → undefined →
 * omitted from the record, never recorded as 0). EN labels only (V1 is EN).
 * Exported for unit testing against captured live labels.
 */
export function parseTweetGroupAriaLabel(label: string | null | undefined): {
  replies?: number; reposts?: number; likes?: number; bookmarks?: number; views?: number;
} {
  const out: { replies?: number; reposts?: number; likes?: number; bookmarks?: number; views?: number } = {};
  if (!label) return out;
  const pairs: Array<[keyof typeof out, RegExp]> = [
    ['replies', /([\d,]+)\s+repl(?:y|ies)/i],
    ['reposts', /([\d,]+)\s+repost/i],
    ['likes', /([\d,]+)\s+like/i],
    ['bookmarks', /([\d,]+)\s+bookmark/i],
    ['views', /([\d,]+)\s+view/i],
  ];
  for (const [key, re] of pairs) {
    const m = label.match(re);
    if (m) {
      const n = parseInt(m[1].replace(/,/g, ''), 10);
      if (!Number.isNaN(n)) out[key] = n;
    }
  }
  return out;
}

/** True when the article carries a verified-author badge. */
function extractVerifiedFlag(article: Element): boolean {
  return !!article.querySelector('[data-testid="icon-verified"]');
}

/**
 * True when `el` sits inside X's Community Note box: the `birdwatch-pivot`
 * container, or a link into /i/birdwatch/ (the box is one big link on some
 * builds). Text inside it is the platform's, not the author's.
 */
function isInsideCommunityNote(el: Element): boolean {
  return !!(el.closest('[data-testid="birdwatch-pivot"]') || el.closest('a[href*="/i/birdwatch/"]'));
}

/** True when a Community Notes / Birdwatch indicator is present on the article. */
function extractCommunityNotesFlag(article: Element): boolean {
  return !!(
    article.querySelector('[data-testid="birdwatch-pivot"]') ||
    article.querySelector('a[href*="/i/birdwatch/"]')
  );
}

// Cross-language "edit marker" regex. Catches:
//   EN  "(edited)"   "Edited"   "edited Xm/h/d/y"
//   RO  "Editat"     "(editat)"
//   ES  "Editado"
//   FR  "Modifié"   "Modifiée"
//   DE  "Bearbeitet"
//   IT  "Modificato"
//   RU  "Изменено"
// Unicode-aware boundaries, not \b: see the note on FB_EDIT_MARKER_REGEX in
// facebook.ts (2026-09-19). \b is defined by \w, which excludes é and Cyrillic,
// so "Modifié" and "Изменено" were never read by any of the three copies of
// this list. This one had a second problem of its own: nothing called it.
const EDIT_MARKER_REGEX = /(?<!\p{L})\(?\s*(?:Edited|Editat|Editado|Modifi[éeè]e?|Bearbeitet|Modificato|Изменено)\s*\)?(?!\p{L})/iu;

/**
 * True when the article carries an X "Last edited" affordance. X surfaces
 * edits via a specific testid OR via "Last edited Xh ago" text near the time.
 */
function extractIsXEdited(article: Element): boolean {
  if (article.querySelector('[data-testid="lastEditedTimestamp"], [data-testid*="edit-history"]')) {
    return true;
  }
  // Localized text fallback — scan the time-stamp's parent area only.
  //
  // It said "localized" and tested /\bLast edited\b/i, which is English
  // (2026-09-19). EDIT_MARKER_REGEX was declared at the top of this file for
  // exactly this and never called: grep found the declaration and no use.
  // Facebook and Instagram both call their identical copies, so the same
  // "Editat" on the same person's screen set isEdited on two platforms and not
  // on the third, in a field every surface downstream reads as one thing.
  //
  // The scoping is unchanged and is the part X already had right: only the
  // time-stamp's own area is read, never the tweet body, which is the mistake
  // the Facebook comment signals were making until 2026-09-19.
  const timeEl = article.querySelector('time');
  const timeArea = timeEl?.closest('[role="link"]') ?? timeEl?.parentElement;
  if (timeArea && EDIT_MARKER_REGEX.test(timeArea.textContent ?? '')) return true;
  return false;
}

/**
 * True when the article carries an X "Promoted" / "Ad" indicator.
 * X labels ads with "Promoted" text typically near the timestamp + a specific
 * data-testid for the placement-tracking element. Ads have commercial intent
 * and should NOT be classified with the same rules as organic posts.
 */
export function extractIsXSponsored(article: Element): boolean {
  // X labels ads with a bare "Ad" / "Promoted" / "Sponsored" leaf shown in the
  // header INSTEAD of a relative timestamp — organic posts ALWAYS carry a
  // <time>. That no-<time> + bare-label pattern is the reliable discriminator.
  //
  // Live-verified on x.com 2026-06-05 (the "show more → advertisement" bug):
  // two real ads = no <time> + bare "Ad"; the 4 organic VIDEO
  // posts in the same feed (incl. one misflagged political post)
  // = <time> present, no ad label.
  if (!article.querySelector('time')) {
    for (const el of article.querySelectorAll('span, div')) {
      if (el.children.length === 0) {
        const t = (el.textContent ?? '').trim();
        if (t === 'Ad' || t === 'Promoted' || t === 'Sponsored') return true;
      }
    }
  }
  // Backup: an explicit "Promoted" / "Sponsored" aria-label (word-boundary; NOT
  // bare "Ad", which is too short to be safe outside the no-<time> header scan).
  for (const el of article.querySelectorAll('[aria-label]')) {
    if (/\b(Promoted|Sponsored)\b/i.test(el.getAttribute('aria-label') ?? '')) return true;
  }
  // REMOVED — `[data-testid="placementTracking"]`: it is X's VIDEO-PLAYER
  // wrapper, not an ad marker. It is present on EVERY organic video post (and
  // was even ABSENT on one of the real ads), so the primary check flagged
  // every video post as an advertisement once its video hydrated — which
  // "show more" re-triggers (found 2026-06-05). Also REMOVED the full-text
  // \bPromoted\b/\bSponsored\b scan: it false-positives on organic posts that
  // merely discuss sponsorship. The header label above is the precise signal.
  return false;
}

/**
 * True when the article embeds a quoted tweet (a nested `<article role="link">`
 * with its own `[data-testid="tweetText"]` — the X structural pattern for
 * quote-tweet rendering).
 */
function extractIsQuoteTweet(article: Element): boolean {
  const inner = article.querySelector('article[role="link"]');
  if (!inner) return false;
  return !!inner.querySelector('[data-testid="tweetText"]');
}

/** Tree-position info for one article in a permalink page. */
interface PermalinkPosition {
  depth: number;
  parentTweetId: string | undefined;
  /** The parent's article on the same page, so its text can travel with the item. */
  parentEl: HTMLElement | undefined;
  isFocused: boolean;
  isChildOfFocused: boolean;
}

/**
 * Walk the permalink-page article tree and compute depth + parent_id for
 * every article on the page. Per §3 Root identification rule:
 *   - articles before `tabindex="-1"` are ancestors (post at idx 0,
 *     intermediate comments at idx 1..n-1)
 *   - the `tabindex="-1"` article is the focused node
 *   - articles after focused are direct children of focused
 *
 * Returns an empty Map when no `tabindex="-1"` article is found (home-feed,
 * profile, search, or any non-permalink surface).
 */
function walkPermalinkTree(scope: Document | HTMLElement): Map<HTMLElement, PermalinkPosition> {
  const result = new Map<HTMLElement, PermalinkPosition>();
  const articles = Array.from(
    scope.querySelectorAll('article[role="article"]'),
  ).filter(article => !isInPrivateChatSubtree(article)) as HTMLElement[];
  const focusedIdx = articles.findIndex((a) => a.getAttribute('tabindex') === '-1');
  if (focusedIdx < 0) return result;

  // Pre-compute id for every article once.
  const ids = articles.map(extractArticleTweetId);

  // Ancestors (idx 0..focusedIdx-1) + focused (focusedIdx).
  for (let i = 0; i <= focusedIdx; i++) {
    const parentTweetId = i > 0 ? ids[i - 1] : undefined;
    result.set(articles[i], {
      depth: i,
      parentTweetId,
      parentEl: i > 0 ? articles[i - 1] : undefined,
      isFocused: i === focusedIdx,
      isChildOfFocused: false,
    });
  }

  // Children of focused (idx focusedIdx+1..)
  const focusedDepth = focusedIdx;
  const focusedId = ids[focusedIdx];
  for (let i = focusedIdx + 1; i < articles.length; i++) {
    result.set(articles[i], {
      depth: focusedDepth + 1,
      parentTweetId: focusedId,
      parentEl: articles[focusedIdx],
      isFocused: false,
      isChildOfFocused: true,
    });
  }

  return result;
}

// A profile page: `/handle`, with or without one of its tabs. X's reserved
// top-level paths are not handles.
const X_RESERVED_PATHS = new Set(['home', 'explore', 'notifications', 'messages', 'i', 'search', 'settings', 'compose', 'login', 'signup', 'communities', 'jobs', 'premium', 'lists', 'bookmarks']);
const X_PROFILE_PATH_RE = /^\/([A-Za-z0-9_]{1,15})(?:\/(?:with_replies|media|likes|highlights|articles|affiliates|superfollows))?\/?$/;
function isXProfilePath(path: string): boolean {
  const m = X_PROFILE_PATH_RE.exec(path);
  return !!m && !X_RESERVED_PATHS.has(m[1].toLowerCase());
}

/**
 * Map a depth integer to the PostKind union value (per §3 of
 * COMMENT_BURST_MEASUREMENT_X). Caps at 'reply-to-reply' for depth ≥ 3 — X
 * allows arbitrary depth but the chain schema collapses everything ≥ 3.
 */
function depthToKind(depth: number): PostKind {
  if (depth === 0) return 'post';
  if (depth === 1) return 'top-comment';
  if (depth === 2) return 'reply';
  return 'reply-to-reply';
}

/**
 * Map a comment's depth to the narrowed `CommentNodeKind` used by
 * `Encounter.ancestors[]` and `Encounter.children[]`. Caller MUST guarantee
 * `depth >= 1` (depth=0 = post; not a comment).
 */
function depthToCommentKind(depth: number): CommentNodeKind {
  if (depth <= 1) return 'top-comment';
  if (depth === 2) return 'reply';
  return 'reply-to-reply';
}

// X-1 (audit swarm-2026-07-13) — module-level temporal-coherence gate for the
// permalink-tree id funnel.
//
// M66's instance gate (`_coherentIdentityForArticle`, the XOR "identity and body
// must change together" snapshot check) guards ONLY the `extractPosts` own-id
// binding. The permalink-tree consumers (`walkPermalinkTree`,
// `buildPermalinkEncounterContext`, `articleToCommentNode`) resolve ancestor /
// parent / root / focused ids through `extractArticleTweetId` below, which did
// atomic-only resolution. On a virtualized/recycled permalink reply tree an
// article caught mid-hydration — previous occupant's header + `/status/<id>`
// link but the NEXT occupant's fully-rendered body — is internally consistent at
// the instant of parsing, so the atomic resolver returns the STALE id. That
// stale id then became a child record's `parent_id` and the classifier's
// Encounter parent (a wrong evidence binding, weight 0.3).
//
// This snapshot mirrors the instance gate for that funnel: a recycled slot whose
// identity and body did NOT change together is refused (id → undefined), so the
// downstream degrades to the safe fail path (synthetic/uncertain, empty parent)
// rather than to a stale binding. Keyed on the virtualizer's reused slot
// (`cellInnerDiv`), matching `_coherentIdentityForArticle`.
const _permalinkIdentityBySlot = new WeakMap<
  HTMLElement,
  { id: string; author: string; text: string; tweetEl: HTMLElement | null }
>();

/**
 * Re-validate id↔body coherence for a permalink-tree article against the last
 * observation of the same slot. Returns the identity when coherent (and records
 * the snapshot), or null when the slot was recycled incoherently (stale id with
 * a swapped body, or vice-versa) — the caller must then refuse the stale id.
 */
function coherentPermalinkIdentity(
  article: HTMLElement,
  current: TwitterStatusIdentity,
  tweetEl: HTMLElement | null,
  text: string,
): TwitterStatusIdentity | null {
  const slot = article.closest<HTMLElement>('[data-testid="cellInnerDiv"]') ?? article;
  const previous = _permalinkIdentityBySlot.get(slot);
  if (previous) {
    const identityChanged = previous.id !== current.id
      || previous.author.toLowerCase() !== current.author.toLowerCase();
    const bodyChanged = previous.tweetEl !== tweetEl || previous.text !== text;
    if (identityChanged !== bodyChanged) return null;
  }
  _permalinkIdentityBySlot.set(slot, { id: current.id, author: current.author, text, tweetEl });
  return current;
}

/**
 * Extract a tweet ID (the `/status/<id>` numeric segment) from any
 * article. Mirrors `_extractTweetId` but doesn't take the focused-article
 * scope. Routes through the temporal-coherence gate (X-1) so a recycled slot's
 * stale id is refused before it can become a `parent_id` / Encounter parent.
 */
function extractArticleTweetId(article: HTMLElement): string | undefined {
  const identity = resolveTwitterStatusIdentity(article, extractArticleAuthorHandle(article));
  if (!identity || identity === 'mismatch') return undefined;
  const tweetEl = article.querySelector<HTMLElement>('[data-testid="tweetText"]');
  const text = tweetEl?.textContent?.trim() ?? '';
  // No tweetText body to couple identity to (video/image-only), or a truncated
  // body that will GROW on expand: the temporal body-coherence check can't
  // distinguish a recycle in either case, and `extractPosts` likewise skips
  // both before its own gate (empty-text `continue` + truncation backoff). Take
  // the atomic id and do not snapshot, so a later truncation → full-text
  // expansion of the SAME tweet is not misread as a recycle.
  if (text === '' || tweetIsTruncated(article)) return identity.id;
  return coherentPermalinkIdentity(article, identity, tweetEl, text)?.id;
}

/**
 * Extract the author handle (the `/<handle>` segment) for an
 * article, honoring body-mention + quote-tweet exclusions. Mirrors
 * the existing `_extractHandle` logic but is module-level (not bound to an
 * adapter instance) so the runtime Encounter constructor can call it without
 * touching the per-instance selector-health counters.
 */
function extractArticleAuthorHandle(article: HTMLElement): string | undefined {
  const links = Array.from(article.querySelectorAll('a[href^="/"][role="link"], a[href^="/"]')) as HTMLAnchorElement[];
  const own = links.filter((link) => !link.closest('[data-testid="tweetText"]') // body @-mention, not author header
    && !link.closest(SOCIAL_CONTEXT_SELECTOR) // the reposter / liker, not the author
    && (!link.closest('article') || link.closest('article') === article)); // quote-tweet author
  // The header's own links first: a profile link elsewhere in the article is a fallback, never the first choice.
  const ordered = [...own.filter((l) => l.closest('[data-testid="User-Name"]')), ...own];
  for (const link of ordered) {
    const href = link.getAttribute('href') ?? '';
    const m = href.match(/^\/([A-Za-z0-9_]+)$/);
    if (m) return m[1];
  }
  return undefined;
}

/**
 * Extract the author display name (visible name span). Best-effort
 * — falls back to handle when the span is missing.
 *
 * Cold read finding 3 (COLD-READ-ee35374f-74c9ea6a-2026-09-28.md #3): the
 * old selector's fallback half, `a[href^="/"][role="link"] span`, matched
 * body @-mentions, quoted tweets and "reposted" bylines too — any of them
 * can sit earlier in DOM order than the article's own header. Scoped to
 * `[data-testid="User-Name"] span` only, with the same body/nested-article
 * exclusions `extractArticleAuthorHandle` already applies to the handle.
 */
function extractArticleDisplayName(article: HTMLElement): string | undefined {
  const spans = Array.from(article.querySelectorAll('[data-testid="User-Name"] span')) as HTMLElement[];
  for (const span of spans) {
    if (span.closest('[data-testid="tweetText"]')) continue; // body @-mention, not author header
    const closestArticle = span.closest('article');
    if (closestArticle && closestArticle !== article) continue; // quote-tweet author
    const text = span.textContent?.trim();
    if (text) return text;
  }
  return undefined;
}

/**
 * Extract the article body text from `[data-testid="tweetText"]`.
 * Returns empty string for video-only / image-only tweets where there's no
 * tweetText element.
 */
function extractArticleText(article: HTMLElement): string {
  const tweetEl = article.querySelector('[data-testid="tweetText"]');
  return tweetEl?.textContent?.trim() ?? '';
}

/**
 * Extract the visible relative-time text from the article's
 * `<time>` element ("5h", "1y", "39m"). The `datetime` attribute is the
 * ISO-8601 anchor; `age_relative` is the rendered text the child saw.
 */
function extractArticleAge(article: HTMLElement): { age_iso?: string; age_relative?: string } {
  const time = article.querySelector('time') as HTMLTimeElement | null;
  if (!time) return {};
  const age_iso = time.getAttribute('datetime') ?? undefined;
  const age_relative = time.textContent?.trim() || undefined;
  return { age_iso, age_relative };
}

/**
 * Build PostNode / CommentNode / Encounter assemblage from a live
 * X-permalink page. Walks `document.querySelectorAll('article[role="article"]')`
 * fresh and produces the rich Encounter context the BATCH classifier needs to
 * disambiguate slur-as-attack from slur-as-narrative-frame ().
 *
 * Returns null when:
 *   - Not on a permalink surface (caller responsibility to check first)
 *   - No `tabindex="-1"` article found (page hasn't fully rendered)
 *   - First article has no extractable text (would produce empty PostNode)
 *
 * The caller (`buildEncounterForFlushBatch`) combines this with `bucket.posts`
 * (the children PostContents extracted by the mutation observer) to construct
 * the full Encounter.
 *
 * Per VISION §1.1 chain-mirror invariant: this function reads ONLY rendered
 * DOM at call time. It does NOT pre-fetch / API-resolve / reconstruct from
 * the chain store.
 */
export function buildPermalinkEncounterContext(scope?: Document | HTMLElement): {
  post: PostNode;
  ancestors: CommentNode[];
  focused: PostNode | CommentNode;
  conversationId: string;
} | null {
  // SW chunk-graph safety. Pre-fix this used a
  // default param `scope = document` which evaluated `document` at module
  // load. If a future vite chunk reshape pulls this transitively into
  // `service-worker.ts` (which has no `document`), SW boot would throw a
  // ReferenceError per the `feedback_vite_chunk_graph_caution` memory.
  // Resolve `document` inside the function body with a typeof guard;
  // return null when running in a no-DOM realm rather than crashing.
  const root = scope ?? (typeof document !== 'undefined' ? document : null);
  if (!root) return null;

  // X-2/X-3: filter chat-overlay AND role="log" DM articles, matching
  // walkPermalinkTree (twitter.ts:257). At debounced flush a DM/chat
  // [role="dialog"] overlay or [role="log"] message list may be mounted on
  // a permalink page; without this filter its articles could enter the
  // Encounter post/ancestors/focused (DM red-line, defense-in-depth).
  const articles = (Array.from(root.querySelectorAll('article[role="article"]')) as HTMLElement[])
    .filter(article => !isInPrivateChatSubtree(article));
  const focusedIdx = articles.findIndex((a) => a.getAttribute('tabindex') === '-1');
  if (focusedIdx < 0) return null;
  if (articles.length === 0) return null;

  // articles[0] is the original post (depth=0).
  const postArticle = articles[0];
  const postId = extractArticleTweetId(postArticle);
  const postText = extractArticleText(postArticle);
  if (!postId || !postText) return null;

  const postAuthor = extractArticleAuthorHandle(postArticle) ?? '';
  const postDisplayName = extractArticleDisplayName(postArticle);
  const postVerified = extractVerifiedFlag(postArticle);
  const postMetrics = extractTweetMetrics(postArticle);
  const postAge = extractArticleAge(postArticle);
  const postCommunityNotes = extractCommunityNotesFlag(postArticle);
  const postQuoteTweet = extractIsQuoteTweet(postArticle);
  const hasVideo = !!postArticle.querySelector('video, [data-testid="videoPlayer"]');

  // Sponsored/Ad detection on the conversation-root tweet.
  const postIsSponsored = extractIsXSponsored(postArticle);

  const post: PostNode = {
    id: postId,
    kind: hasVideo ? 'video' : 'post',
    text: postText,
    author: {
      handle: postAuthor,
      display_name: postDisplayName,
      verified: postVerified,
      is_creator: false,
    },
    age_iso: postAge.age_iso,
    age_relative: postAge.age_relative,
    metrics: {
      primary_likes: postMetrics.likes,
      retweets: postMetrics.retweets,
      comments_count: postMetrics.replies,
      views: postMetrics.views,
      bookmarks: postMetrics.bookmarks,
    },
    community_notes_present: postCommunityNotes,
    is_quote_tweet: postQuoteTweet,
    has_video: hasVideo || undefined,
    is_sponsored: postIsSponsored || undefined,
  };

  // articles[1..focusedIdx-1] are intermediate ancestors (depth=1..focusedIdx-1).
  const ancestors: CommentNode[] = [];
  for (let i = 1; i < focusedIdx; i++) {
    const node = articleToCommentNode(articles[i], i, articles[i - 1]);
    if (node) ancestors.push(node);
  }

  // articles[focusedIdx] is the focused node — could be the post itself
  // (focusedIdx=0 — though that requires the post to have tabindex=-1) OR a
  // comment.
  let focused: PostNode | CommentNode;
  if (focusedIdx === 0) {
    focused = post;
  } else {
    const focusedNode = articleToCommentNode(
      articles[focusedIdx],
      focusedIdx,
      articles[focusedIdx - 1],
    );
    // Fallback: if focused-node extraction fails, treat the post as focused.
    focused = focusedNode ?? post;
  }

  return {
    post,
    ancestors,
    focused,
    conversationId: postId,
  };
}

/**
 * Convert an ancestor / focused article into a CommentNode for
 * Encounter consumption. Returns null when the article has no extractable
 * id or no text (defensive — prevents broken Encounter slots).
 */
function articleToCommentNode(
  article: HTMLElement,
  depth: number,
  parent: HTMLElement | undefined,
): CommentNode | null {
  const id = extractArticleTweetId(article);
  const text = extractArticleText(article);
  if (!id || !text) return null;

  const handle = extractArticleAuthorHandle(article) ?? '';
  const displayName = extractArticleDisplayName(article);
  const verified = extractVerifiedFlag(article);
  const metrics = extractTweetMetrics(article);
  const age = extractArticleAge(article);
  const parentTweetId = parent ? extractArticleTweetId(parent) : undefined;
  // depth >= 1 narrows to CommentNodeKind variants; cap at 3.
  const safeDepth = Math.min(Math.max(depth, 1), 3) as 1 | 2 | 3;
  const kind = depthToCommentKind(safeDepth);

  return {
    id,
    kind,
    depth: safeDepth,
    parent_id: parentTweetId ?? '',
    text,
    author: {
      handle,
      display_name: displayName,
      verified,
      is_pinned_by_creator: false,
      is_creator_hearted: false,
    },
    age_iso: age.age_iso,
    age_relative: age.age_relative,
    metrics: {
      likes: metrics.likes,
      reply_count: metrics.replies,
      views: metrics.views,
    },
    render_state: 'visible-now',
    fw_marker_present: !!article.querySelector('button.fw-teen-marker'),
  };
}

// Primary → fallback chains. Each chain is ordered by confidence: the
// highest-precision X-specific selector first, then progressively more
// structural fallbacks that rely on stable HTML semantics (lang+dir on
// natural-language blocks, href patterns on profile links, etc.).
const TWEET_TEXT_SELECTORS = [
  '[data-testid="tweetText"]',           // primary (2022-2026 stable)
  'article [lang][dir]',                 // fallback 1: lang+dir are applied by X to every user-authored body block
  'article div[lang]',                   // fallback 2: older X variant that omitted dir
];

// primary swap. The extension-error pane showed
// 100% fallback-#1 hit rate on `twitter.post-profile-link` — meaning the
// prior primary `a[data-testid="User-Name"] a[href^="/"][role="link"]`
// has been effectively dead. X rotated the nested anchor structure; the
// data-testid="User-Name" wrapper still exists but the inner anchor no
// longer carries both `href^="/"` and `role="link"` in that tight selector
// chain. Promoted the fallback-#1 to primary (it's matching 100% in
// production) and added a tighter tight-form as fallback-#1 for future-
// proofing; the broad `a[href^="/"]` stays as the structural backstop.
const PROFILE_LINK_SELECTORS = [
  'a[href^="/"][role="link"]',                            // primary (post-LOOP-069)
  'a[data-testid="User-Name"] a[href^="/"]',              // fallback 1: inside user-name block, loose
  'a[href^="/"]',                                         // fallback 2: structural backstop
];

const DISPLAY_NAME_SELECTORS = [
  'a[href^="/"][role="link"] span',            // primary (post-LOOP-069)
  'a[data-testid="User-Name"] span',           // fallback 1
  '[data-testid="User-Name"] span',            // fallback 2
];

const STATUS_LINK_SELECTORS = [
  'a[href*="/status/"][role="link"]',          // primary
  'a[href*="/status/"]',                       // fallback 1: no role qualifier
  'time[datetime]',                            // fallback 2: timestamps are usually wrapped in a status link
];

function collectTwitterStatusLinks(article: Element): Set<Element> {
  const statusLinks = new Set<Element>();
  for (const selector of STATUS_LINK_SELECTORS) {
    try {
      for (const match of article.querySelectorAll(selector)) statusLinks.add(match);
    } catch {
      // Invalid selector in a host quirk: keep trying the remaining forms.
    }
  }
  return statusLinks;
}

function parseTwitterStatusIdentityHref(href: string): TwitterStatusIdentity | null {
  const raw = href.trim();
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw, 'https://x.com');
  } catch {
    return null;
  }
  const hostname = url.hostname.toLowerCase();
  const isTwitterHost = hostname === 'x.com'
    || hostname.endsWith('.x.com')
    || hostname === 'twitter.com'
    || hostname.endsWith('.twitter.com');
  if (!isTwitterHost) return null;

  const match = url.pathname.match(/^\/([^/]+)\/status\/(\d+)(?:\/|$)/i);
  if (!match || !/^[a-z0-9_]+$/i.test(match[1])) return null;
  return { author: match[1], id: match[2] };
}

/**
 * The line above a post that says who put it in front of the reader ("Name reposted", "Name liked", "Pinned"). Its link
 * goes to THAT account's profile, which is not the author's: read as the author's handle it made every repost on the
 * for-you feed look like a header and a status link of two different accounts (13 Oct 2026, the export: one in five X
 * records with no author).
 */
const SOCIAL_CONTEXT_SELECTOR = '[data-testid="socialContext"]';

/** The status identities this article's own links carry: body links and a nested quoted article's are not its own. */
function collectOwnStatusIdentities(article: Element, statusLinks: Iterable<Element>): Map<string, TwitterStatusIdentity> {
  const identities = new Map<string, TwitterStatusIdentity>();

  for (const statusLink of statusLinks) {
    if (statusLink.closest('[data-testid="tweetText"]')) continue;
    const closestArticle = statusLink.closest('article');
    if (closestArticle && closestArticle !== article) continue;

    const href = statusLink instanceof HTMLAnchorElement
      ? statusLink.getAttribute('href') ?? ''
      : statusLink.closest('a')?.getAttribute('href') ?? '';
    const identity = parseTwitterStatusIdentityHref(href);
    if (!identity) continue;
    identities.set(`${identity.author.toLowerCase()}:${identity.id}`, identity);
  }
  return identities;
}

function resolveTwitterStatusIdentity(
  article: Element,
  visibleHandle: string | null | undefined,
  statusLinks = collectTwitterStatusLinks(article),
): TwitterStatusIdentity | 'mismatch' | null {
  const identities = collectOwnStatusIdentities(article, statusLinks);

  const expectedAuthor = visibleHandle?.replace(/^@/, '').toLowerCase();
  const candidates = Array.from(identities.values()).filter(identity => (
    !expectedAuthor || identity.author.toLowerCase() === expectedAuthor
  ));
  if (identities.size === 0) return null;
  return candidates.length === 1 ? candidates[0] : 'mismatch';
}

// truncation detection. X profile feeds render long
// tweets with a "Show more" link and only the first ~280 characters in
// DOM; the full text is fetched via API on click. Reading textContent of
// a truncated tweet yields the cut-off form, which both (a) costs an LLM
// call on partial content (often passing because key signals are below
// the cut) and (b) writes the truncated text into the forensic chain
// (parent dashboard's "what the platform served" column shows mid-
// sentence cut-offs like "...Is this all for"). The fix is to detect the
// Show-more link and skip extraction; on click, the link disappears and
// the full text appears in the next mutation tick — element is still
// unmarked (no fwProcessed) so it becomes processable then.
//
// Selector strategy mirrors the chains above: primary `data-testid` form
// first (X has used `tweet-text-show-more-link` since at least 2024),
// fallback to a structural href-pattern that matches the link target
// even when the testid rotates.
const SHOW_MORE_SELECTORS = [
  '[data-testid="tweet-text-show-more-link"]',
  '[data-testid$="show-more-link"]',
  'a[href*="/status/"][role="link"][aria-label*="Show more" i]',
  'a[href*="/status/"][role="link"][aria-label*="Mai mult" i]',  // RO
  'a[href*="/status/"][role="link"][aria-label*="Afișează" i]',  // RO variant
];

function tweetIsTruncated(article: Element): boolean {
  for (const sel of SHOW_MORE_SELECTORS) {
    try {
      if (article.querySelector(sel)) return true;
    } catch {
      // Bad selector (host environment quirk) — try the next one.
    }
  }
  return false;
}

export class TwitterAdapter implements PlatformAdapter {
  readonly platform = 'twitter' as const;

  private readonly _identityBySlot = new WeakMap<
    HTMLElement,
    TwitterStatusIdentity & { text: string; tweetEl: HTMLElement }
  >();

  // Page-scroll extraction trigger. The MutationObserver in interceptor.ts
  // catches lazy-load + tree mutations but does NOT fire on pure scroll
  // inside already-mounted DOM. On X permalink pages the focal tweet and
  // its visible reply tree mount on first paint; replies the user reaches
  // via pure scroll on the already-mounted reply tree stay un-classified
  // because no MO event fires for them. The scroll trigger wires a
  // debounced passive listener on `window` (X's permalink + feed surfaces
  // are page-scrolling, not modal-scrollers) that re-tickles tweet shells
  // whose text element is un-stamped. Per-element dedup via
  // `tweetEl.dataset.fwProcessed` makes the re-tickle idempotent — only
  // shells un-stamped by the viewport-gate's `unmarkPostsForReExtraction`
  // flow back through the MO route to `extractPosts` and into the BATCH
  // path.
  //
  // One listener per adapter instance. `window` is stable across SPA navs
  // on X so we never re-discover or re-attach; the lazy-on-first-extract
  // attach + null-disposer guard ensures a single listener.
  private _disposeScrollTrigger: (() => void) | null = null;

  detectPlatform(): boolean {
    const host = window.location.hostname;
    return host.includes('twitter.com') || host.includes('x.com');
  }

  getPostSelector(): string {
    return '[data-testid="tweetText"]';
  }

  extractPosts(nodes: NodeList): PostContent[] {
    const posts: PostContent[] = [];
    const feedSource = this._detectFeedSource();

    // Wire the page-scroll trigger so user-scroll on X re-routes un-stamped
    // tweet shells back through the MO. Cheap when the listener is already
    // attached; only does work on the first extractPosts call after adapter
    // init.
    this._ensureScrollTrigger();

    // surface + permalink-tree walk are page-level; computed once
    // per extractPosts call and reused per article. On non-permalink surfaces
    // the tree map is empty and per-article fallback applies (kind='post',
    // depth=0, no parent_id).
    const surfaceKind = detectTwitterSurface();
    // M98 probe: the cache-identity fix is blocked on live facts about the
    // /photo/N DOM (does the underlay persist, which copy holds the
    // tabindex pivot). Measurement only; throttled + change-deduped inside.
    if (surfaceKind === 'twitter-photo-modal') noteTwitterPhotoSurface(document);
    const treeMap = surfaceKind === 'twitter-permalink'
      ? walkPermalinkTree(document)
      : new Map<HTMLElement, PermalinkPosition>();

    //: the focused
    // tweet's ID is the bucket key for children-of-focused under the comment-
    // batch path. Pre-X-permalink children had no parentVideoId →
    // bucket key defaulted to each post's own id → each comment got its own
    // bucket of 1 → no batch effect → Encounter prompt path never
    // exercised in production. Compute the focused article's coherent id once
    // here so each child can use that accepted identity below.
    let coherentFocusedTweetId: string | undefined;
    if (surfaceKind === 'twitter-permalink') {
      for (const [el, pos] of treeMap) {
        if (pos.isFocused) {
          const focusedTweetEl = this._collectTweetNodes(el).find(candidate => (
            candidate.closest('article') === el
          ));
          const focusedText = focusedTweetEl?.textContent?.trim() ?? '';
          const visibleHandle = this._extractHandle(el);
          const statusResolution = this._extractStatusIdentity(el, visibleHandle);
          if (
            focusedTweetEl
            && focusedText
            && !tweetIsTruncated(el)
            && statusResolution
            && statusResolution !== 'mismatch'
          ) {
            coherentFocusedTweetId = this._coherentIdentityForArticle(
              el,
              focusedTweetEl,
              focusedText,
              statusResolution,
            )?.id;
          }
          break;
        }
      }
    }

    nodes.forEach((node) => {
      if (!(node instanceof HTMLElement)) return;

      const tweetNodes = this._collectTweetNodes(node);

      for (const tweetEl of tweetNodes) {
        // X-3: X chat dialogs AND role="log" DM message lists may be
        // portalled beside the public timeline. Reject their candidates
        // before textContent or any extraction metadata read. Uses the
        // shared predicate (dialog OR role="log") for parity with IG/FB's
        // belt-and-suspenders gate — X previously only checked the dialog
        // case via findChatOverlayAncestor.
        if (isInPrivateChatSubtree(tweetEl)) continue;

        const article = tweetEl.closest('article') as HTMLElement | null;

        // Skip already-processed nodes — with ONE carve-out: late ad-label
        // hydration (owner live evidence 2026-08-04, x.com/home: a promoted
        // article stamped fwProcessed + pass while showing the bare "Ad"
        // leaf and no <time>). X can hydrate the header AFTER the tweetText
        // mounts, so extraction saw NEITHER a <time> NOR an ad label,
        // emitted the post organic, and the stamp blocked every re-look —
        // the same failure family as TikTok M94 (tiktok-ad-remount.ts).
        // Claim exactly ONE sponsored reprocess per stamped element when
        // extractIsXSponsored matches now; the fwAdRecheckClaimed marker
        // bounds it (no unbounded re-tickle — cf. the media-only guard in
        // _reExtractTweetsOnPage). Cheap on the 3s periodic rescan: organic
        // posts always carry a <time>, so the label scan only runs on
        // time-less headers. The re-emission flows through the normal
        // routes — sessionVerdictKey / classificationDedupKey both include
        // is_sponsored, so the flipped flag is a fresh classification input.
        if (tweetEl.dataset.fwProcessed) {
          const lateAdLabel = article
            && tweetEl.dataset.fwAdRecheckClaimed !== 'true'
            && !article.querySelector('time')
            && extractIsXSponsored(article);
          if (!lateAdLabel) continue;
          tweetEl.dataset.fwAdRecheckClaimed = 'true';
        }

        // skip truncated tweets. X profile feeds
        // render long tweets with a "Show more" button and only the
        // first ~280 chars in DOM; the full text is fetched on click.
        // Pre-fix our adapter read `textContent` of the visible
        // tweetText, which captured the truncated form — the AI
        // analyzed truncated text (often passing it because key signals
        // are below the cut), and the chain stored the truncated form
        // ("Is this all for" instead of the full sentence). Skipping
        // truncated posts entirely is the conservative fix: we do not
        // mark fwProcessed, so when the user expands the tweet OR when
        // they navigate to the status page (where X loads the full
        // text), the post becomes processable again on the next
        // mutation tick.
        // The exception: when X's own data for this tweet already holds the
        // whole text and it begins with what the page shows, the tweet goes on,
        // marked cut, and the whole text replaces the fragment at detection
        // (page-world/wire-store.ts). Without that data it is skipped as before.
        let shownCut = false;
        if (article && tweetIsTruncated(article)) {
          const shown = tweetEl.textContent?.trim() ?? '';
          const status = this._extractStatusIdentity(article, this._extractHandle(article));
          const whole = status && status !== 'mismatch' ? wireFieldsFor('twitter', status.id)?.text : undefined;
          if (whole && completesCutText(shown, whole, true)) {
            shownCut = true;
          } else {
            // Stamp a backoff timestamp so the 3s periodic rescan doesn't
            // re-process truncated tweets every tick. Expanded text or
            // status-page navigation removes the truncation node and clears
            // the gate on next pass.
            const last = Number(tweetEl.dataset.fwTruncatedAt ?? '0');
            const now = Date.now();
            if (now - last < 60_000) continue;
            tweetEl.dataset.fwTruncatedAt = String(now);
            continue;
          }
        }

        const text = tweetEl.textContent?.trim() ?? '';
        if (!text) continue;

        const visibleHandle = this._extractHandle(article);
        const statusResolution = this._extractStatusIdentity(article, visibleHandle);
        const identity = article && statusResolution && statusResolution !== 'mismatch'
          ? this._coherentIdentityForArticle(article, tweetEl, text, statusResolution)
          : null;
        // WHERE THE ANONYMOUS X RECORDS COME FROM (diagnosed 2026-09-08, open
        // since 2026-08-25). When a status link WAS found but the identity gate
        // refused it — `_coherentIdentityForArticle` returning null on M66's
        // XOR, or `resolveTwitterStatusIdentity` returning 'mismatch' — the
        // visible handle is deliberately NOT used. That is right: the slot was
        // recycled by the virtualiser and this body may not belong to that
        // handle, and signing one account's words under another's is the worst
        // thing this product could do.
        //
        // The consequence is what needs watching. The record is still written,
        // with author 'unknown' and a synthetic uuid, so `buildPostUrl` falls
        // back to https://x.com/home and the row carries no status id: an
        // observation a recipient cannot check against the platform, sitting in
        // the file as an ordinary passed post. 179 such rows in the 2026-09-08
        // export, and 11 of them hold text the same file records correctly
        // elsewhere with the real handle and permalink.
        //
        // The render gate already has an honest verdict for exactly this
        // physical cause — 'cancelled-dom-recycled' — and this stage does not
        // use it. Routing here would move ~179 rows a day from pass to
        // cancelled, which changes the flagged-share denominator and the
        // dashboard, so it is the owner's call rather than a silent fix.
        // Meanwhile account-type.ts no longer stamps 'person' on these, because
        // nothing here proves a person posted.
        // Since 2026-09-17 the record says which of the three this is, so a
        // reader can tell a refusal from a header that never rendered.
        const author = identity?.author
          ?? (statusResolution === null
            ? visibleHandle ?? this._extractAuthor(article)
            : 'unknown');
        const authorCapture: AuthorCapture | undefined =
          !identity && statusResolution !== null && (visibleHandle ?? null) !== null
            ? 'withheld'
            : undefined;
        // The display name beside the handle (record-feed-study/C-NOTES.md
        // fault 5): read only when `author` itself is trustworthy. When the
        // identity gate refused the visible header above (author==='unknown'
        // in the recycled-slot case), a name read from that same slot would
        // carry the identical misattribution risk authorCapture:'withheld'
        // exists to name, so it stays absent there too.
        const authorName = author !== 'unknown' && article
          ? extractArticleDisplayName(article)
          : undefined;
        const tweetId = identity?.id ?? crypto.randomUUID();

        // Encounter signals.
        const articleEl = article ?? undefined;
        const treePosition = articleEl ? treeMap.get(articleEl) : undefined;

        // For permalink: kind/depth/parent_id from tree walk.
        // For non-permalink: default to top-level post (depth=0).
        const depth = (treePosition?.depth ?? 0) as 0 | 1 | 2 | 3;
        const kind: PostKind = depthToKind(depth);
        const parent_id = identity
          ? (treePosition?.isChildOfFocused
            ? coherentFocusedTweetId
            : treePosition?.parentTweetId)
          : undefined;

        // children-of-focused get parentVideoId = focusedTweetId
        // so the comment-batch routing in content/index.ts:onPostDetected can
        // bucket them together. Ancestors and the focused itself get no
        // parentVideoId → fall through to per-post pipeline (each gets its
        // own chain record, ancestry context handled separately by
        // buildPermalinkEncounterContext at flush time).
        const isChildOfFocused =
          identity !== null &&
          treePosition?.isChildOfFocused === true &&
          coherentFocusedTweetId !== undefined;
        const parentVideoId = isChildOfFocused ? coherentFocusedTweetId : undefined;

        const platform_specific: Extract<PlatformSpecificMeta, { platform: 'twitter' }> = {
          platform: 'twitter',
          surfaceKind,
        };
        if (articleEl) {
          platform_specific.verified = extractVerifiedFlag(articleEl);
          platform_specific.metrics = extractTweetMetrics(articleEl);
          platform_specific.communityNotesPresent = extractCommunityNotesFlag(articleEl);
          platform_specific.isQuoteTweet = extractIsQuoteTweet(articleEl);
          // capture edit-marker so the chain records honest
          // "comment was edited" caveat per VISION §1.1 chain-mirror.
          platform_specific.isEdited = extractIsXEdited(articleEl);
        }

        // Sponsored/Ad detection on the post (depth=0) only.
        // Comments are never themselves sponsored; the flag belongs to the
        // post container above them.
        const isSponsored = depth === 0 && articleEl ? extractIsXSponsored(articleEl) : false;

        // sourceUrl — `https://x.com/{handle}/status/{tweetId}`. Without
        // this, the dashboard's "View original" button showed "No URL on
        // this record" for every X record (other platforms set sourceUrl;
        // X's extractPosts was missing this field). Construct from the
        // handle + tweet id we already extracted above.
        //
        // When tweetId is the `crypto.randomUUID()` fallback (extraction
        // failed), the `/status/<uuid>` URL is guaranteed-dead. Leave
        // sourceUrl empty so the dashboard shows no broken "View original"
        // (buildPostUrl then falls back to the current page URL).
        const sourceUrl =
          author && author !== 'unknown' && tweetId && !SYNTHETIC_UUID_RE.test(tweetId)
            ? `https://x.com/${author.replace(/^@/, '')}/status/${tweetId}`
            : '';

        // anchorUrl — on X every node (post AND reply) is a status with its
        // own `/status/<id>` permalink, which `sourceUrl` already encodes from
        // this node's own tweetId. For a reply (depth ≥ 1) that URL lands the
        // recipient ON the exact reply, so it doubles as the per-comment deep-
        // link. Posts (depth 0) leave it undefined — their `postUrl` already
        // IS the address. No new selector: reuses the per-node sourceUrl above.
        const anchorUrl = depth >= 1 && sourceUrl ? sourceUrl : undefined;

        posts.push({
          id: tweetId,
          text,
          ...(shownCut ? { textCapture: 'cut' as const } : {}),
          author,
          authorName,
          timestamp: new Date().toISOString(),
          platform: 'twitter',
          domRef: new WeakRef(tweetEl),
          recoveryScopeRef: article?.closest<HTMLElement>('[data-testid="cellInnerDiv"]')?.parentElement
            ? new WeakRef(article.closest<HTMLElement>('[data-testid="cellInnerDiv"]')!.parentElement!)
            : undefined,
          feedSource,
          sourceUrl,
          anchorUrl,
          kind,
          depth,
          parent_id,
          // The parent's text, for the judge's context slot (docs/audits/
          // 2026-09-07-xray, C3): only when the parent id resolved, so a
          // refused stale parent never lends its words either.
          parentText: parent_id && treePosition?.parentEl
            ? (extractArticleText(treePosition.parentEl) || undefined)
            : undefined,
          // The card beyond the body: quoted post, link card, "From" line.
          card: article ? cardForRecord(article, 'twitter') : undefined,
          parentVideoId,
          platform_specific,
          authorCapture,
          is_sponsored: isSponsored || undefined,
        });
      }
    });

    return posts;
  }

  private _collectTweetNodes(root: HTMLElement): HTMLElement[] {
    const results = new Set<HTMLElement>();

    // Primary: root itself is a tweetText node (happens when the mutation
    // observer adds a tweet fragment directly rather than the article).
    if (root.matches?.('[data-testid="tweetText"]')) {
      results.add(root);
    }

    // ancestor scan. When the user clicks "Show more"
    // on a truncated tweet, X re-renders the inner text spans. The
    // mutation observer's addedNodes are the new spans (NOT the parent
    // tweetText, which already existed). Without an upward walk, our
    // adapter misses the expansion event entirely. Walking up to the
    // nearest tweetText ancestor catches the post-expansion re-extract:
    // truncation flag is gone, fwProcessed is still unset (we never
    // marked truncated tweets), so the post is fresh-processable now.
    const ancestor = root.closest?.('[data-testid="tweetText"]');
    if (ancestor instanceof HTMLElement) {
      results.add(ancestor);
    }

    // Descendant DISCOVERY scan through the fallback chain. This runs on every
    // MutationObserver-added `root` — the overwhelming majority of which are
    // non-tweet SPA chrome (buttons, avatars, video-player ticks, sidebar,
    // virtualizer remounts) with no tweetText descendant — so a "miss" here is
    // the normal case, NOT selector drift. Deliberately UNLABELED for
    // selector-health: feeding these discovery misses to the counter inflated
    // X's miss-rate to ~90% and tripped the dashboard's false "looks broken"
    // verdict. A genuine tweetText-selector break is caught by the
    // extraction-canary's 0-extractions signal (the discerning detector) —
    // do NOT re-add a label here.
    const found = queryAllWithFallback(root, TWEET_TEXT_SELECTORS, undefined, 'twitter');
    for (const el of found) {
      if (el instanceof HTMLElement) results.add(el);
    }

    // Filter out nested tweetText elements (quote tweets inside a parent
    // tweet body — the parent already surfaced with its own scan).
    return Array.from(results).filter(el => {
      // The Community Note box is the platform's own chrome, never the post
      // (Stage 5 of the 2026-09-07 plan, extraction hygiene). Its header
      // ("Readers added a Community Note to this Post:") is a lang+dir block,
      // so the fallback selectors offered it as a body on media-only posts:
      // seven records in the owner's 2026-09-06 export carried that sentence
      // as the post's text, and the judge read it. Counted, never dropped
      // silently, so the diagnostics show how often the box was met.
      if (isInsideCommunityNote(el)) {
        bumpCounter('x.communityNoteChromeSkipped');
        return false;
      }
      let parent = el.parentElement;
      while (parent && parent !== root) {
        if (
          parent.matches?.('[data-testid="tweetText"]') ||
          (parent.hasAttribute('lang') && parent.hasAttribute('dir') && parent.closest('article') === el.closest('article'))
        ) {
          // Only filter when the outer lang+dir block is inside the SAME
          // article — otherwise a neighboring tweet's lang block would be
          // mis-identified as an ancestor.
          if (parent !== el && results.has(parent as HTMLElement)) return false;
        }
        parent = parent.parentElement;
      }
      return true;
    });
  }

  /**
   * Wire the page-scroll trigger once per adapter instance.
   *
   * The MutationObserver in interceptor.ts fires on lazy-load + tree
   * mutations but NOT on pure scroll inside already-mounted DOM. On X
   * permalink pages the focal tweet and its visible reply tree mount on
   * first paint; replies the user reaches via pure scroll on the
   * already-mounted reply tree stay un-extracted because no MO event
   * fires. The scroll trigger restores re-extraction on user-scroll-in-
   * mounted-DOM, which matters most when the viewport-gate previously
   * dropped tweets (it un-stamps them via `unmarkPostsForReExtraction` so
   * a re-extract pass can re-bucket them — but only if a re-extract
   * actually happens).
   *
   * Target is `window` directly — X's permalink + home + profile surfaces
   * are page-scrolling, not modal-scrollers (unlike FB/IG which discover a
   * modal-internal scroller). `window` is stable across SPA navs so a
   * single attach for the adapter's lifetime suffices; subsequent calls
   * short-circuit on the non-null disposer.
   */
  private _ensureScrollTrigger(): void {
    if (typeof window === 'undefined') return;
    if (this._disposeScrollTrigger !== null) return;

    this._disposeScrollTrigger = setupScrollExtractionTrigger(
      window,
      () => this._reExtractTweetsOnPage(),
    );
  }

  /**
   * Re-extract tweets on the page by handing un-stamped tweet shells back
   * to the interceptor through `requestReExtract`.
   *
   * The interceptor owns the routing into the comment-batch enqueue
   * (`onPost` lives in interceptor scope, not in the adapter). The re-walk
   * runs `extractPosts`, whose per-element dedup (`tweetEl.dataset.fwProcessed`)
   * finds the un-stamped tweetText, extracts it, and pushes a record into
   * the BATCH path. This used to detach and re-insert each article so the
   * body MutationObserver would fire; a moved subtree loses focus without a
   * `blur`, which on Instagram's post modal made the comment composer
   * unusable (2026-09-02). Nothing here touches the DOM any more.
   *
   * Un-stamped shells exist after the viewport-gate's
   * `unmarkPostsForReExtraction` runs on a prior fail-closed flush — the
   * viewport-gate clears `dataset.fwProcessed` for shells dropped because
   * they weren't yet visible. This re-tickle is the path that brings them
   * back into BATCH once the user scrolls them into view.
   *
   * The dedup gate is keyed on the tweetText element (where the X adapter
   * sets `fwProcessed`) rather than the article shell itself — X does not
   * stamp the article wrapper. We hand over the article anyway because
   * that's the natural extraction unit and `_collectTweetNodes` finds
   * tweetText via descendant scan from any ancestor. Articles with NO
   * tweetText element at all (media-only tweets) are excluded — see the
   * loop comment.
   */
  private _reExtractTweetsOnPage(): void {
    if (typeof document === 'undefined') return;
    const articles = document.querySelectorAll<HTMLElement>('article[role="article"]');
    const roots: HTMLElement[] = [];
    for (const article of articles) {
      const tweetEl = article.querySelector<HTMLElement>('[data-testid="tweetText"]');
      // Media-only tweets (photo/video/GIF with no body text) have NO
      // tweetText element to carry the fwProcessed stamp, so a null-tolerant
      // gate here could never terminate for them: every 250ms-debounced
      // scroll pause re-processed the same article forever. A text-less
      // article has nothing for `extractPosts` to route into BATCH, so skip
      // it outright — a tweetText that hydrates later mounts through the MO
      // on its own childList mutation, and a media-only tweet quoting a text
      // tweet still gates on the quote's tweetText found by the descendant
      // query above.
      if (!tweetEl) continue;
      if (tweetEl.dataset.fwProcessed) continue;
      roots.push(article);
    }
    requestReExtract(roots);
  }

  private _extractHandle(article: Element | null): string | null {
    if (!article) return null;
    // Twitter articles contain profile links like href="/synthetic_author".
    // Use the chain so drift into new test-ids or anchor layouts still
    // surfaces the handle; miss is recorded when NOTHING in the article
    // looks like a profile link.
    //
    // body @-mention + quote-tweet exclusion. The
    // primary selector `a[href^="/"][role="link"]` is intentionally broad
    // (post-X structural rotation) and matches three distinct
    // link classes inside an article: (a) author header in [data-testid=
    // "User-Name"], (b) body @-mentions inside [data-testid="tweetText"],
    // (c) quote-tweet author header in nested <article> elements. Without
    // a structural filter, DOM ordering decides which link wins — and
    // X's profile-feed / hydration-race / virtualizer-remount paths can
    // emit (b) before (a), mis-attributing posts that @-mention public
    // figures (a chain record used a body mention as the post author).
    // Filter rules:
    //   1. Skip links inside [data-testid="tweetText"] — these are body
    //      @-mentions; the post author's header is never inside the body.
    //   2. Skip links whose closest <article> ancestor is NOT the article
    //      we were called with — these belong to a quote-tweet (X renders
    //      quote tweets as nested <article role="link"> blocks).
    // Pre-filter check preserves the original first-match-wins behavior
    // among the legitimate author-header candidates; downstream selector-
    // health metrics on `twitter.post-profile-link` are unaffected.
    const links = queryAllWithFallback(article, PROFILE_LINK_SELECTORS, 'twitter.post-profile-link');
    // A third filter (13 Oct 2026): skip the "Name reposted" / "Name liked" line, whose link is the reposter's profile.
    // Read as the author, it gave every repost a header handle that no status link of the article matched, and the
    // identity gate refused the name and the address of one in five X records in the owner's export.
    const own = Array.from(links).filter((link) => (
      !link.closest('[data-testid="tweetText"]') // body @-mentions — author handle is never inside post body text
      && !link.closest(SOCIAL_CONTEXT_SELECTOR)
      && (!link.closest('article') || link.closest('article') === article) // quote-tweet author links (nested <article>)
    ));
    // The header's own links first, then any other that is not excluded.
    const ordered = [...own.filter((l) => l.closest('[data-testid="User-Name"]')), ...own];
    for (const link of ordered) {
      const href = (link as HTMLAnchorElement).getAttribute('href') ?? '';
      if (/^\/[A-Za-z0-9_]+$/.test(href)) {
        return href.slice(1); // strip leading /
      }
    }
    return null;
  }

  private _extractAuthor(article: Element | null): string {
    if (!article) return 'unknown';
    const span = queryWithFallback(article, DISPLAY_NAME_SELECTORS, 'twitter.post-display-name');
    return span?.textContent?.trim() ?? 'unknown';
  }

  private _extractStatusIdentity(
    article: Element | null,
    visibleHandle: string | null,
  ): TwitterStatusIdentity | 'mismatch' | null {
    if (!article) return null;
    const observed = queryWithFallback(
      article,
      STATUS_LINK_SELECTORS,
      'twitter.post-status-link',
    );
    const statusLinks = collectTwitterStatusLinks(article);
    if (observed) statusLinks.add(observed);
    return resolveTwitterStatusIdentity(article, visibleHandle, statusLinks);
  }

  private _coherentIdentityForArticle(
    article: HTMLElement,
    tweetEl: HTMLElement,
    text: string,
    current: TwitterStatusIdentity,
  ): TwitterStatusIdentity | null {
    const slot = article.closest<HTMLElement>('[data-testid="cellInnerDiv"]') ?? article;
    const previous = this._identityBySlot.get(slot);
    if (previous) {
      const identityChanged = previous.id !== current.id
        || previous.author.toLowerCase() !== current.author.toLowerCase();
      // The same text element that now holds more of the same words (a "Show more" opened, a translation settled) is
      // the same post growing, not a new occupant of the slot: a recycled slot's body is another post's words.
      const grew = previous.tweetEl === tweetEl && previous.text !== text
        && (text.startsWith(previous.text) || previous.text.startsWith(text));
      const bodyChanged = !grew && (previous.tweetEl !== tweetEl || previous.text !== text);
      if (identityChanged !== bodyChanged) return null;
    }

    this._identityBySlot.set(slot, { ...current, text, tweetEl });
    return current;
  }

  private _detectFeedSource(): FeedSource {
    try {
      const path = window.location.pathname;
      if (path.includes('/search')) return 'search';
      // A post or a thread the reader opened: its own surface, not a profile
      // visit (the label the dashboard reads as "the reader's choice").
      if (path.includes('/status/')) return 'permalink';
      if (isXProfilePath(path)) return 'profile';
      if (path === '/home' || path === '/') {
        // Which home tab is selected, by POSITION, never by its translated
        // label (wiring audit 13 Sep, L2): the Romanian tab reads "Pentru
        // tine", so a text match left every Romanian home impression
        // 'unknown'. X's home tablist puts For you first; Following and any
        // pinned list come after it, and both are feeds the reader chose.
        const tablist = document.querySelector('[data-testid="primaryColumn"] [role="tablist"]')
          ?? document.querySelector('[role="tablist"]');
        const tabs = tablist ? Array.from(tablist.querySelectorAll('[role="tab"]')) : [];
        const selected = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
        if (selected === 0) return 'for-you';
        if (selected > 0) return 'following';
        // No tablist to read: the English label is the last resort it always was.
        const activeTab = document.querySelector('[role="tab"][aria-selected="true"]');
        const tabText = activeTab?.textContent?.toLowerCase() ?? '';
        if (tabText.includes('following')) return 'following';
        if (tabText.includes('for you')) return 'for-you';
      }
      return 'unknown';
    } catch {
      return 'unknown';
    }
  }
}
