// FeelingWise - Facebook platform adapter
// Extracts post text via div[role="article"] selector

import { isAdLabelElement, LABEL_BEARERS } from '../engagement/ad-labels';
import { PostContent, FeedSource, PlatformSpecificMeta } from '../../types/post';
import { findChatOverlayAncestor, isInPrivateChatSubtree, PlatformAdapter } from './adapter';
import { extractTextWithFallback } from './selector-chain';
import { parseCountText } from './count-text';
import { holdsMoreThanWords } from '../text-box';
import { requestReExtract, setupScrollExtractionTrigger } from '../post-path/scroll-trigger';
import { bumpCounter } from '../../diagnostics/diagnostics';
import { currentPageAddress } from '../record/post-url';
import {
  facebookOwnCommentId,
  hasOwnFacebookCommentAnchor,
  isFacebookCommentArticle,
  isFacebookCommentLabel,
} from './facebook-comment-signal';

export { hasOwnFacebookCommentAnchor, isFacebookCommentArticle, isFacebookCommentLabel };


// FB surface kinds per PER_PLATFORM_V1_SPEC §5.5.
type FacebookSurfaceKind = NonNullable<
  Extract<PlatformSpecificMeta, { platform: 'facebook' }>['surfaceKind']
>;

/** Detect FB surface from URL pathname. */
function detectFacebookSurface(): FacebookSurfaceKind {
  const path = typeof window !== 'undefined' && window.location?.pathname || '/';
  if (path.startsWith('/reel/')) return 'facebook-reel';
  if (path.startsWith('/photo')) return 'facebook-photo-modal';
  // /<page>/posts/<id> or /permalink.php → permalink
  if (path.includes('/posts/') || path.includes('permalink')) return 'facebook-permalink';
  return 'facebook-home-feed';
}

/**
 * True when the FB article is a sponsored / promoted post.
 * FB labels with `[aria-label*="Sponsored"]` or visible "Sponsored" / "Sponsorizat"
 * text on the post header (between author handle and timestamp).
 */
/**
 * The cheap Facebook ad markers: three lookups, no walk. Off's feed rule
 * uses this as its platform signal and does the one label walk itself
 * (feed-ad-blocker.ts); calling the full detector there gave every post two
 * walks and cost 110 ms on a 28k-node page (engagement-latency.mjs,
 * 2026-09-03).
 */
export function hasFacebookAdMarker(article: Element): boolean {
  if (article.querySelector('[aria-label*="Sponsored" i], [aria-label*="Sponsorizat" i]')) {
    return true;
  }
  // FB also uses screen-reader-hidden "S" + style-stacked letters as a visual obfuscation.
  // A simpler signal is the `<a>` link with href containing /sponsored or `data-ad-preview="message"` ancestor.
  if (article.closest('[data-ad-preview], [data-pagelet*="FeedUnit"][data-ad-preview]')) return true;
  // Scan visible text — FB labels are localized.
  const headerText = article.querySelector('header, [role="link"] strong')?.textContent
    ?? article.querySelector('span[dir="auto"]')?.textContent
    ?? '';
  return /^(Sponsored|Sponsorizat|Patrocinado|Sponsorisé|Werbung|Реклама)$/i.test(headerText.trim());
}

/** The recorder's detector: the cheap markers, then one label walk. */
export function extractIsFacebookSponsored(article: Element): boolean {
  if (hasFacebookAdMarker(article)) return true;
  // 2026-09-03, live: the "Ad" label is an SVG <use> chain ending in a
  // <text> outside the post; the post's own text never contains the word.
  // labelTexts reads every channel a word can be drawn in (text, aria,
  // title, alt, SVG word), outside the body and the comments, with the same
  // list of labels as Off's feed rule. Label test first (cheap, fails for
  // almost every element); the exclusion walk only for a hit.
  for (const el of article.querySelectorAll(LABEL_BEARERS)) {
    if (!isAdLabelElement(el)) continue;
    if (el.closest('[data-ad-rendering-role="story_message"], [data-ad-comet-preview], [data-ad-preview], [role="article"] [role="article"], [role="log"]')) continue;
    return true;
  }
  return false;
}

/**
 * .FB-cap — extract POST-level (caption) FB metrics.
 *
 * Selectors per `` §2.5 (live MCP-
 * captured on RO-locale permalink). FB renders the aggregate engagement
 * row as a `span[role="toolbar"]` with aria-label containing the reactions
 * count + a sibling text block formatted "N comentarii N distribuiri" (RO) /
 * "N comments N shares" (EN). `views` is NOT exposed on standard FB posts
 * (Reels expose play-count separately — V1.5 work).
 *
 * Conservative posture: any selector miss → field stays undefined (per
 * scope-guard "0 is a lie that breaks amplification ratio math").
 */
export function extractFacebookPostMetrics(article: HTMLElement): {
  postReactions?: number;
  postCommentsCount?: number;
  postShares?: number;
} {
  let postReactions: number | undefined;
  let postCommentsCount: number | undefined;
  let postShares: number | undefined;
  let expectReactionCount = false;

  // FB renders the engagement row as separate LEAF spans: an "All reactions:"
  // label + the numeric reaction total, then "N comments" and "N shares". Two
  // 2026-06-15 live findings broke the old approach: (1) the reaction-summary
  // button's aria-label dropped its count ("See who reacted to this"), and
  // (2) reading the row's COMBINED textContent glues the reaction + comment
  // numbers together ("966" + "84 comments" → "96684 comments"). So scan the
  // leaf spans instead — tie the reaction total to the "All reactions:" label,
  // and read the clean "N comments" / "N shares" leaves. EN + RO labels.
  article.querySelectorAll<HTMLElement>('span, div').forEach((el) => {
    if (el.childElementCount !== 0) return;
    const t = (el.textContent ?? '').trim();
    if (!t || t.length > 24) return;
    const cm = t.match(/^(\d[\d.,]*\s*[KMB]?)\s+(?:comments?|comentarii)$/i);
    if (cm) {
      if (postCommentsCount === undefined) postCommentsCount = parseCountText(cm[1]);
      expectReactionCount = false;
      return;
    }
    const sh = t.match(/^(\d[\d.,]*\s*[KMB]?)\s+(?:shares?|distribuiri)$/i);
    if (sh) {
      if (postShares === undefined) postShares = parseCountText(sh[1]);
      expectReactionCount = false;
      return;
    }
    // The reaction total is the numeric leaf immediately following the
    // "All reactions:" / "Toate reacţiile:" label — tie them so a stray number
    // elsewhere in the post can't be mistaken for the reaction count.
    if (/^(?:all reactions|toate reac)/i.test(t)) {
      expectReactionCount = true;
      return;
    }
    if (expectReactionCount && /^\d[\d.,]*\s*[KMB]?$/i.test(t)) {
      if (postReactions === undefined) postReactions = parseCountText(t);
      expectReactionCount = false;
    }
  });

  // Legacy fallback: older surfaces exposed the count in the reaction-toolbar
  // aria-label (e.g. "Toate reacţiile: N").
  if (postReactions === undefined) {
    const tb = article.querySelector<HTMLElement>('[role="toolbar"][aria-label*="reac" i]');
    const m = tb?.getAttribute('aria-label')?.match(/(\d[\d.,\s]*\s*[KMBkmb]?)/);
    if (m) postReactions = parseCountText(m[0]);
  }

  return { postReactions, postCommentsCount, postShares };
}

/**
 * extract per-comment FB signals.
 *
 * FB's comment DOM is a `[role="article"]` with aria-label "Comentariu adăugat
 * de X..." (RO) / "Comment by X..." (EN). Likes count is in a sibling element
 * after the action buttons. Verified badge is an svg with aria-label.
 */
// Cross-language "edit marker" regex (mirrors twitter.ts).
// Unicode-aware boundaries, not \b (2026-09-19). \b is defined by \w, which is
// [A-Za-z0-9_] and contains neither é nor Cyrillic, so after matching "Modifié"
// or "Изменено" the trailing \b saw a non-word character on both sides and
// refused. Two of the seven languages this list declares had never once been
// read, on any of the three platforms that carry a copy of it. Measured:
// "Modifie" without the accent matched and "Modifié" did not.
//
// The same shape as the donation check's \w, found on 2026-09-19 as well: a
// character class that excludes the characters the rule is about.
//
// The lookarounds keep the half that was working. "Editadores" and "Reeditado"
// stay quiet, checked on both sides before this replaced anything.
const FB_EDIT_MARKER_REGEX = /(?<!\p{L})\(?\s*(?:Edited|Editat|Editado|Modifi[éeè]e?|Bearbeitet|Modificato|Изменено)\s*\)?(?!\p{L})/iu;

// First-path-segment names that are FB product routes, NOT user/page profile
// slugs. Used by the permalink-derivation fallback so a non-profile anchor
// (e.g. `/watch`, `/groups`) is never mistaken for the post author's slug when
// building `<slug>/posts/<id>`. FB usernames may contain dots ("john.doe"), so
// dots can't be blanket-excluded — anything ending in `.php` is excluded too.
/** Minimum gap between two full walks of a dialog that had no scroller. */
const SCROLLER_PROBE_RETRY_MS = 2000;

const FB_NON_PROFILE_SLUGS = new Set<string>([
  'permalink.php', 'photo.php', 'photo', 'watch', 'reel', 'reels', 'groups',
  'profile.php', 'story.php', 'events', 'marketplace', 'gaming', 'share',
  'media', 'pages', 'pg', 'home', 'sharer.php', 'login', 'help', 'bookmarks',
  'friends', 'notifications', 'messages', 'settings', 'search',
]);

/**
 * The comment's chrome: everything the platform drew around it, without the
 * words the person wrote (2026-09-19).
 *
 * Four of the five signals below are text scans, and they were run over
 * `commentEl.textContent`, which includes the comment body. So the body was
 * being read as metadata about itself. "As an author I disagree" set
 * `isAuthor`. "got 3 likes on my last post" set `likes: 3`. "9 replies to my
 * email" set `reply_count: 9`. Every one of those goes into the signed record.
 *
 * This is the same false-positive shape the codebase already diagnosed and
 * fixed for sponsored detection, where an organic caption merely mentioning
 * advertising flipped the flag. It was never carried to this function.
 *
 * `isVerified` was right all along, because it asks an element
 * (`svg[aria-label*="erif"]`) rather than a blob of words.
 *
 * Removing the body string once is deliberate rather than clever: the badges
 * and counters FB draws sit outside the body, and a body that happens to repeat
 * itself costs only a missed signal, never an invented one. With no body text
 * to remove there is nothing to be polluted by, so the whole string stands.
 */
function commentChromeText(commentEl: Element, bodyText: string): string {
  const all = commentEl.textContent ?? '';
  const body = bodyText.trim();
  if (!body) return all;
  const at = all.indexOf(body);
  return at < 0 ? all : `${all.slice(0, at)} ${all.slice(at + body.length)}`;
}

function extractFacebookCommentSignals(commentEl: Element, bodyText = ''): {
  likes?: number;
  reply_count?: number;
  isVerified: boolean;
  isAuthor: boolean;
  isEdited: boolean;
} {
  const text = commentChromeText(commentEl, bodyText);
  // Likes — "N de aprecieri" (RO) / "N likes" (EN) / "Like 5" / "1 person likes this"
  const likesMatch = text.match(
    /(\d[\d.,\s]*[kmb]?)\s*(?:de\s+aprecieri|likes?|me\s+gusta|j[''']aimes?|reactions?)/i,
  );
  const likes = likesMatch ? parseCountText(likesMatch[1]) : undefined;

  // Reply count — "N răspunsuri" (RO) / "N replies" (EN) / "View N replies"
  const replyMatch = text.match(/(\d+)\s+(?:r[ăa]spunsuri|repl(?:y|ies))/i)
    ?? text.match(/(?:Vezi|View)(?:\s+all)?\s+(\d+)\s+(?:r[ăa]spunsuri|repl(?:y|ies))/i);
  const reply_count = replyMatch ? parseInt(replyMatch[1], 10) : undefined;

  // Verified — svg with aria-label containing "erif" (Verified / Verificat / etc.)
  const isVerified = !!commentEl.querySelector('svg[aria-label*="erif" i]');

  // Author label — FB shows "Author" / "Autor" badge when post-creator comments
  const isAuthor = /\b(Author|Autor|Auteur|Autor[ai]e|Autore)\b/.test(text);

  // edit-marker. FB shows "Editat" / "Edited" near the timestamp.
  const isEdited = FB_EDIT_MARKER_REGEX.test(text);

  return { likes, reply_count, isVerified, isAuthor, isEdited };
}

/**
 * Q58 (live-attested 2026-08-11, MCP inspection of a real group thread): FB
 * renders each comment's timestamp as an anchor whose href carries
 * `?comment_id=<id>` plus click-tracking params (`__cft__`, `__tn__`). Keep
 * origin + path + comment_id only, so the export can deep-link the exact
 * comment (parity with X reply URLs and IG `/c/` links) without shipping
 * tracking tokens into the signed record. Absent anchor → undefined, the
 * pre-Q58 behavior.
 */
function extractFacebookCommentAnchorUrl(commentEl: Element): string | undefined {
  // `commentEl` is the comment's TEXT element (what _extractComments returns);
  // the timestamp anchor is sibling chrome, so climb to the comment article.
  const row = commentEl.closest('[role="article"][aria-label]') ?? commentEl;
  const a = row.querySelector<HTMLAnchorElement>('a[href*="comment_id="]');
  if (!a) return undefined;
  try {
    const u = new URL(a.href, window.location.origin);
    const cid = u.searchParams.get('comment_id');
    if (!cid) return undefined;
    return `${u.origin}${u.pathname}?comment_id=${encodeURIComponent(cid)}`;
  } catch {
    return undefined;
  }
}

/**
 * Verified-page badge on the POST AUTHOR header (not a comment). Reuses the
 * comment-path badge selector svg[aria-label*="erif" i] but bounds it to the
 * post author's header block so a verified COMMENTER nested in the same post
 * article never mis-stamps the post as a page. Author anchor is the same
 * [data-ad-rendering-role="profile_name"] element _extractAuthor trusts.
 * Feeds deriveAccountType -> accountType:'page'. Bounded scope = under-detect safe.
 */
/**
 * Record why a comment candidate was dropped, and answer whether this is the
 * FIRST time that element was dropped for that reason.
 *
 * `_extractComments` re-runs on every mutation, and a dropped element is
 * deliberately never marked seen, so it is re-examined every pass. Without
 * this the drop counters measured passes over a permanent DOM fixture rather
 * than distinct comments, which is what made the 2026-09-01 dump's 11%
 * "extraction rate" unreadable. Reading is unchanged; only counting is
 * deduplicated. The reason is part of the key, so an element whose verdict
 * changes (a body that renders late, a label FB rewrites) is counted again
 * under its new reason.
 */
/**
 * The commenter's visible name: the first non-trivial `role="link"` text
 * inside the comment article. Avatar links carry an aria-label and no text, so
 * the name link is the first one with words in it.
 *
 * Read in two places now, the record's `author` and the walker's dedup key, so
 * it is one function rather than two loops that could drift.
 */
function firstCommentAuthorName(cmtEl: HTMLElement): string | null {
  for (const link of cmtEl.querySelectorAll<HTMLElement>('a[role="link"]')) {
    const t = link.textContent?.trim() ?? '';
    if (t.length > 0 && t.length < 80) return t;
  }
  return null;
}

function noteCommentDrop(el: HTMLElement, reason: string): boolean {
  if (el.dataset.fwCommentDrop === reason) return false;
  el.dataset.fwCommentDrop = reason;
  return true;
}

function extractFacebookPostVerified(article: Element): boolean {
  const authorEl =
    article.querySelector<HTMLElement>('[data-ad-rendering-role="profile_name"]')
    ?? article.closest('[aria-posinset]')?.querySelector<HTMLElement>('[data-ad-rendering-role="profile_name"]')
    ?? null;
  if (!authorEl) return false;
  const scope =
    authorEl.closest('h2, h3, h4, [role="heading"]')
    ?? authorEl.parentElement?.parentElement
    ?? authorEl;
  return !!scope.querySelector('svg[aria-label*="erif" i]');
}


/**
 * How many posts keep a comment-counter high-water mark at once. Mirrors the
 * comment-batch queue's remembered-room bound: past this, the oldest post's
 * mark is dropped, and a remount of that post falls back to the element's own
 * counter as it did before.
 */
const MAX_REMEMBERED_COMMENT_COUNTERS = 2000;

export class FacebookAdapter implements PlatformAdapter {
  readonly platform = 'facebook' as const;

  // Session-scoped rate limit for the _extractTextElement null log.
  private static _nullExtractLogs = 0;

  // Once any post has been successfully extracted in this session, the
  // "selector is not matching" diagnostic stays silent. The reality is that
  // some scans hit only non-post chrome (suggested-friend cards, "Memories",
  // group recommendations) which legitimately return null from _extractText
  // but aren't a sign of selector breakage. Real selector rotation keeps
  // this flag false across all scans → the diagnostic re-fires loudly.
  // Healthy operation → silent.
  private _hasEverExtracted = false;

  // Per-reel-id gate for the synthesized fb-vid-<id> caption record. The
  // previous one-shot boolean (_reelCommentDiagFired) never reset on SPA
  // navigation, so only the FIRST reel of a session got a video record —
  // every later reel's comments carried a parentVideoId with no video node,
  // orphaning them against the chain-mirror invariant (VISION §1.1). Keyed
  // by the URL reel id (mirrors the TikTok emittedVideoIds guard): each
  // distinct reel emits exactly once; re-scans of the same reel and
  // back-navigation stay silent.
  private _emittedReelIds = new Set<string>();
  /**
   * The highest comment-counter value this content-script life has issued for
   * a post, by post id. The dataset counter it backs up dies with the article
   * element; this does not, so a remount continues the numbering instead of
   * restarting at zero and signing a second comment under an id the chain
   * already carries. Numbers only, and bounded: an install that meets more
   * posts than this in one page life has long since re-walked the early ones.
   */
  private _commentIdxByPost = new Map<string, number>();

  // Modal-internal scroll trigger. The MutationObserver in interceptor.ts
  // catches lazy-load + tree mutations but does NOT fire on pure scroll
  // inside already-mounted DOM. When the user scrolls the comments-modal's
  // inner scroll container past comments rendered on a prior pass, those
  // comments stay un-extracted because no MO event fires. The scroll
  // trigger wires a debounced passive listener on the dialog's scroller
  // that re-invokes _extractComments per article in the modal; per-comment
  // dedup via cmtEl.dataset.fwCommentSeen + persistent fwCommentNextIdx
  // counter makes the re-invoke idempotent.
  //
  // One listener per scroll-container instance. WeakRef holds the container
  // so a closed/recycled modal lets the disposer fire on the next extract
  // pass, after which a fresh container can be discovered and wired.
  private _scrollContainerRef: WeakRef<HTMLElement> | null = null;
  private _disposeScrollTrigger: (() => void) | null = null;

  detectPlatform(): boolean {
    return window.location.hostname.includes('facebook.com');
  }

  getPostSelector(): string {
    return 'div[role="article"]';
  }

  extractPosts(nodes: NodeList): PostContent[] {
    const posts: PostContent[] = [];
    const feedSource = this._detectFeedSource();

    // Wire (or re-wire) the modal-scroll trigger so user-scroll inside an
    // already-mounted comments dialog re-runs comment extraction. Cheap when
    // the listener is already attached to the same container; only does work
    // on the first call after a dialog opens or recycles.
    this._ensureScrollTrigger();

    // diagnostic counters. A live test surfaced
    // "FB doesn't scan/check, nothing marked"; the hypothesis is that the
    // legacy `div[dir="auto"]` extractor doesn't match current FB DOM.
    // The counters log a one-line summary per scan when at least one
    // article was found but zero extracted, so the next live test can
    // tell us WHICH path failed (extraction null vs filtered as comment
    // vs all already-processed) without needing a DOM dump.
    let dbgArticlesFound = 0;
    let dbgAlreadyProcessed = 0;
    let dbgCommentArticles = 0;
    let dbgExtractionNull = 0;
    let dbgPostsExtracted = 0;

    nodes.forEach((node) => {
      if (!(node instanceof HTMLElement)) return;

      const articles = this._collectArticles(node);
      dbgArticlesFound += articles.length;

      for (const article of articles) {
        // A Messenger popup can coexist with the public feed. Gate the
        // candidate before reading text or touching any FW dedup stamps.
        if (findChatOverlayAncestor(article)) continue;

        // re-entry: lazy-loaded comments arrived
        // (FB renders new comment articles inside the same post article on
        // scroll / "Vezi mai mult" expand). Skip post-body push (already done
        // on first entry) but fall through to _extractComments below for
        // delta-comment pickup. Per-comment dedup + persistent ID counter live
        // in _extractComments via cmtEl.dataset.fwCommentSeen +
        // article.dataset.fwCommentNextIdx so chain IDs don't collide.
        const isReentry = !!article.dataset.fwProcessed;

        // skip comment articles in the main post loop.
        // FB nests each comment as <div role="article" aria-label="Comentariu
        // adăugat de X..."> inside the post article. Without this filter,
        // each comment was being processed TWICE (post-path + comment-path).
        // only relevant on first entry — re-entries skip the post-body
        // path entirely so the comment-article filter is moot there.
        if (!isReentry && this._isCommentArticle(article)) { dbgCommentArticles++; continue; }

        let postId: string;
        let surfaceKind: ReturnType<typeof detectFacebookSurface>;
        let ts: string;

        if (isReentry) {
          dbgAlreadyProcessed++;
          // Use stashed postId so chain IDs stay consistent across re-entries.
          postId = article.dataset.fwPostId ?? this._extractPostId(article) ?? crypto.randomUUID();
          surfaceKind = detectFacebookSurface();
          ts = new Date().toISOString();
        } else {
          const result = this._extractText(article);
          if (!result) { dbgExtractionNull++; continue; }
          dbgPostsExtracted++;

          const { element, text } = result;

          const author = this._extractAuthor(article);
          // M118: after `_clearExtractionStamps` (route change, Child turn-on)
          // the article loses fwProcessed but keeps fwPostId, and this
          // first-entry path minted a fresh UUID for an anchorless post, so
          // its later comments carried a new id and the id-keyed session
          // verdict cache missed (a second LLM call). A real extracted id
          // still wins; the stash only replaces the random fallback.
          postId = this._extractPostId(article) ?? article.dataset.fwPostId ?? crypto.randomUUID();
          const sourceUrl = this._extractPostUrl(article);

          article.dataset.fwProcessed = 'true';
          article.dataset.fwPostId = postId; // stash for re-entry
          // M36 — stash the mount-captured post URL so comment records pushed
          // on later re-entries (lazy-loaded comments) carry the same permalink
          // instead of letting buildPostUrl re-read a stale location.href.
          if (sourceUrl) article.dataset.fwPostUrl = sourceUrl;

          ts = new Date().toISOString();

          // split: 1 caption record (kind='video' on Reels,
          // 'post' on feed) + N comment records under it. Same parentVideoId
          // contract as TikTok adapter so dashboard can group "1 post + N
          // comments" cross-platform.
          //
          // surface detection + Encounter signals on caption + comments.
          // Sponsored/Ad detection on the caption record.
          const isReel = window.location.pathname.startsWith('/reel');
          surfaceKind = detectFacebookSurface();
          const isSponsored = extractIsFacebookSponsored(article);
          const isVerifiedPost = extractFacebookPostVerified(article);
          // Group-post container name (the group is FB's actor on group posts;
          // the human poster lives in the /groups/<gid>/user/ link). Undefined
          // off group posts → no source label change. Drives accountType:'group'
          // + sourceContainer in deriveAccountType.
          const sourceContainer = this._extractGroupContainer(article);
          // .FB-cap — caption-level engagement metrics so the
          // BATCH classifier sees post amplification context (consumed by
          // `computePreLlmRoomSignals` in comment-batch-scorer.ts → `algorithmic
          // Amplification`). FB doesn't expose `views` on standard posts, so the
          // amplification ratio remains 'unknown' but `primary_likes` flows.
          const captionMetrics = extractFacebookPostMetrics(article);
          posts.push({
            id: `fb-${isReel ? 'vid' : 'post'}-${postId}`,
            text,
            author,
            timestamp: ts,
            platform: 'facebook',
            domRef: new WeakRef(element),
            feedSource,
            sourceUrl,
            kind: isReel ? 'video' : 'post',
            parentVideoId: postId,
            platform_specific: {
              platform: 'facebook',
              surfaceKind,
              postReactions: captionMetrics.postReactions,
              postCommentsCount: captionMetrics.postCommentsCount,
              postShares: captionMetrics.postShares,
              isVerified: isVerifiedPost || undefined,
            },
            is_sponsored: isSponsored || undefined,
            sourceContainer,
          });
        }

        // Per-comment records — runs on every entry; dedup in _extractComments.
        const comments = this._extractComments(article, postId);
        for (const c of comments) {
          // extract Encounter signals from the comment element.
          // The comment's own article, not its text element, and the body
          // passed so it can be taken back out (2026-09-19). This was reading
          // the person's words as metadata about themselves.
          const sig = extractFacebookCommentSignals(c.chromeEl, c.text);
          // kind derived from depth (1=top-comment, 2=reply, 3=reply-to-reply).
          // Pre-hardcoded 'top-comment' / depth=1 for ALL comments,
          // misrepresenting reply nesting in the forensic chain.
          const kind: 'top-comment' | 'reply' | 'reply-to-reply' =
            c.depth === 1 ? 'top-comment' : c.depth === 2 ? 'reply' : 'reply-to-reply';
          posts.push({
            id: `fb-cmt-${postId}-${c.id}`,
            text: c.text,
            author: c.author,
            timestamp: ts,
            platform: 'facebook',
            // Comment-specific DOM ref so neutralizer can address it
            // independently if a future feature wants per-comment swap.
            domRef: new WeakRef(c.element),
            feedSource,
            // M36 — the parent post's mount-captured permalink (stashed on
            // the article); keeps comment "Original Post" links off the
            // log-time homepage fallback. undefined when none was captured.
            sourceUrl: article.dataset.fwPostUrl || undefined,
            // Q58: exact-comment deep link from the row's timestamp anchor.
            anchorUrl: extractFacebookCommentAnchorUrl(c.element),
            kind,
            depth: c.depth,
            parent_id: c.parent_id ?? postId,
            parentVideoId: postId,
            platform_specific: {
              platform: 'facebook',
              surfaceKind,
              metrics: {
                likes: sig.likes,
                reply_count: sig.reply_count,
              },
              isVerified: sig.isVerified,
              isAuthor: sig.isAuthor,
              isEdited: sig.isEdited,
            },
          });
        }
      }
    });

    // Reels side-panel comment extraction. On /reel/ pages:
    // - _collectArticles finds nothing (no posinset, no story_message)
    // - comments are [role="article"][aria-label="Comment by..."] inside
    //   [role="complementary"] (the side panel), NOT inside a dialog
    // - video element is outside the complementary panel
    // Confirmed via live MCP DOM probe 2026-06-28.
    if (
      typeof window !== 'undefined'
      && window.location.pathname.startsWith('/reel')
    ) {
      const reelMatch = window.location.pathname.match(/\/reel\/(\d+)/);
      const reelId = reelMatch ? reelMatch[1] : null;
      if (reelId) {
        const comp = Array.from(
          document.querySelectorAll<HTMLElement>('[role="complementary"]'),
        ).find(candidate => !findChatOverlayAncestor(candidate)) ?? null;
        if (comp) {
          const surfaceKind = detectFacebookSurface();
          const ts = new Date().toISOString();
          const postId = reelId;
          comp.dataset.fwPostId = postId;
          // Attempt to extract the Reel author and caption from the page.
          // The author name is typically in the first link with a profile href
          // above the complementary panel. Caption text sits adjacent.
          const reelAuthor = this._extractReelAuthor(comp);
          const reelCaption = this._extractReelCaption(comp);

          // Synthesize a reel caption record once per distinct reel id.
          if (!this._emittedReelIds.has(postId)) {
            posts.push({
              id: `fb-vid-${postId}`,
              text: reelCaption,
              author: reelAuthor,
              timestamp: ts,
              platform: 'facebook',
              domRef: new WeakRef(comp),
              feedSource,
              sourceUrl: currentPageAddress(),
              kind: 'video',
              parentVideoId: postId,
              // Q53 (W56): the reel caption skipped sponsored detection.
              // Scope is the side panel (it carries the post header block);
              // the video overlay outside it stays uncovered until a live
              // DOM probe confirms where reel ads put their label
              // (instrument-first; see Q53 YT/FB-overlay remainder).
              is_sponsored: extractIsFacebookSponsored(comp) || undefined,
              platform_specific: {
                platform: 'facebook',
                surfaceKind,
              },
            });
            this._emittedReelIds.add(postId);
          }
          // Extract comments from the complementary side panel using
          // the same logic as _extractComments but rooted at the panel
          // (comments are NOT inside any post article on Reels).
          const reelComments = this._extractComments(comp, postId);
          for (const c of reelComments) {
            const kind: 'top-comment' | 'reply' | 'reply-to-reply' =
              c.depth === 1 ? 'top-comment' : c.depth === 2 ? 'reply' : 'reply-to-reply';
            posts.push({
              id: `fb-cmt-${postId}-${c.id}`,
              text: c.text,
              author: c.author,
              timestamp: ts,
              platform: 'facebook',
              domRef: new WeakRef(c.element),
              feedSource,
              // M36 — the /reel/ page URL is the single-post surface; carry it
              // so reel comments share the parent permalink (captured at mount).
              sourceUrl: currentPageAddress(),
              // Q58: exact-comment deep link from the row's timestamp anchor.
              anchorUrl: extractFacebookCommentAnchorUrl(c.element),
              kind,
              depth: c.depth,
              parent_id: c.parent_id ?? postId,
              parentVideoId: postId,
              platform_specific: {
                platform: 'facebook',
                surfaceKind,
              },
            });
          }
        }
      }
    }

    // diagnostic only fires when we've NEVER extracted in
    // this session AND there's at least one article that wasn't
    // already-processed and wasn't a comment. That suppresses the noise
    // (most "extraction-null" cases are non-post chrome — group-suggestion
    // cards, "Memories", etc. — which return null legitimately) while still
    // firing loudly if FB rotates DOM and breaks extraction outright.
    if (dbgPostsExtracted > 0) {
      this._hasEverExtracted = true;
    }
    const newArticles = dbgArticlesFound - dbgAlreadyProcessed - dbgCommentArticles;
    if (
      !this._hasEverExtracted
      && newArticles > 0
      && dbgPostsExtracted === 0
      && dbgExtractionNull > 0
    ) {
      console.log(
        `[FW FB-extract] articles=${dbgArticlesFound} already-processed=${dbgAlreadyProcessed} ` +
          `comment-articles=${dbgCommentArticles} extraction-null=${dbgExtractionNull} extracted=0 — ` +
          `no posts extracted yet on FB this session. If this persists across scans, the body anchors ` +
          `may have rotated. Run document.querySelectorAll('[data-ad-rendering-role="story_message"]').length to confirm.`,
      );
    }

    return posts;
  }

  /**
   * extract comments under a Facebook article.
   *
   * FB renders comments as `ul > li` inside the article body. Each comment
   * has an author link (`a[role="link"]`) and a body text (`div[dir="auto"]`).
   * Selectors are conservative — false-extracts are tolerable (pipeline +
   * triviality filter drops noise), false-misses are the cost (we just don't
   * scan that comment).
   *
   * Skips:
   *   • text < 5 chars (signal-to-noise)
   *   • duplicate text within the same article (FB renders some labels twice)
   */
  private _noteCommentIdxHighWater(postId: string, next: number): void {
    if (!postId) return;
    const current = this._commentIdxByPost.get(postId) ?? 0;
    if (next <= current && this._commentIdxByPost.has(postId)) return;
    this._commentIdxByPost.delete(postId);
    this._commentIdxByPost.set(postId, Math.max(current, next));
    if (this._commentIdxByPost.size > MAX_REMEMBERED_COMMENT_COUNTERS) {
      const oldest = this._commentIdxByPost.keys().next().value;
      if (oldest !== undefined) this._commentIdxByPost.delete(oldest);
    }
  }

  /**
   * `element` is the TEXT element, because a rewrite replaces its textContent.
   * `chromeEl` is the comment's own article, added 2026-09-19, because the
   * signals FB draws around a comment (the likes counter, the reply counter,
   * the Author badge, the edit marker, the verified tick) are not inside the
   * body and were being looked for there.
   */
  private _extractComments(article: HTMLElement, postId: string): Array<{ id: string; text: string; author: string; element: HTMLElement; chromeEl: HTMLElement; depth: 1 | 2 | 3; parent_id: string | null }> {
    const out: Array<{ id: string; text: string; author: string; element: HTMLElement; chromeEl: HTMLElement; depth: 1 | 2 | 3; parent_id: string | null }> = [];
    const seen = new Set<string>();
    // persistent counter across re-entries (lazy-loaded
    // comments arrive on scroll/expand, mutation observer re-fires extractPosts,
    // we re-run _extractComments). Pre-cmtIdx reset to 0 each call →
    // re-entry "c0" would collide with first-call "c0" in the chain ID space.
    // Per-element dedup via cmtEl.dataset.fwCommentSeen below stops re-pushing
    // already-extracted comments; the counter only advances on NEW elements.
    //
    // 2026-09-18: the dataset alone was not enough in either direction, and the
    // chain id is the dedup key (content/record/forensic-gate.ts), so both
    // directions wrote a second signed record or signed two comments as one.
    //
    // Forward: the route rescan strips data-fw-processed and
    // data-fw-comment-seen (dom-interceptor.ts:_clearExtractionStamps) but the
    // post id survives on the article and so did this counter, so the same
    // comments re-extracted as c5.. instead of c0.. and every one of them was
    // written twice. Closed by `commentIdFor` below: identity comes from the
    // comment, not from where the walk happened to be.
    //
    // Inverse: the counter lives on the article ELEMENT, so a virtualizer that
    // replaces the article restarts it at zero and c0 names a different comment
    // from the c0 already signed under the same post id. Closed by the
    // per-post high-water mark, which outlives the element.
    const seenIdxForPost = this._commentIdxByPost.get(postId) ?? 0;
    const datasetIdx = parseInt(article.dataset.fwCommentNextIdx ?? '0', 10);
    let cmtIdx = Math.max(Number.isFinite(datasetIdx) ? datasetIdx : 0, seenIdxForPost);
    /**
     * This comment's id, in the order that survives a re-walk:
     *
     *   1. The id Facebook itself puts on the comment permalink
     *      (facebook-comment-signal.ts, live-attested 2026-08-11). It is the
     *      same value on every pass, on every remount and in every locale — the
     *      structural signal the comment beside the label list asks for.
     *   2. The id this element was already given. A route rescan clears the
     *      processed and seen stamps but not this one, so an element that has
     *      a chain record keeps the id that record names.
     *   3. The counter, which is what 1 and 2 replace.
     */
    const commentIdFor = (el: HTMLElement): string => {
      const ownId = facebookOwnCommentId(el);
      if (ownId) return `fbc-${ownId}`;
      const stamped = el.dataset.fwCommentId;
      if (stamped) return stamped;
      return `c${cmtIdx++}`;
    };

    // FB has migrated comment structure from <ul><li>
    // to <div role="article" aria-label="Comentariu adăugat de X acum Y ore">
    // nested inside the post's article. A live test on FB photo
    // viewer / modal showed comments visible on screen but not flagged —
    // detector was never called because _extractComments was returning
    // zero (the legacy <ul><li> selector doesn't match the new layout).
    // Match by aria-label semantic with multi-language stems.
    //
    // added reply stems. Live MCP capture on a RO-locale
    // FB permalink showed: clicking "Vezi toate cele 2 răspunsuri" produced
    // 5 new <div role="article"> elements with aria-label="Răspuns de la X".
    // Pre-, the stem list had 'comentariu' (matches "Comentariu adăugat
    // de" — top-level only) but NO reply stem — so RO-locale FB replies got
    // silently skipped at line 193's `continue`, producing zero chain records
    // for replies the child clicked to expand. Per VISION §1.1 corollary B
    // ("every node the child encountered produces a chain record") this was
    // a data-loss hole the size of the entire reply tree.
    //
    // FOUR COPIES of this word list live in this repo (here, line 303,
    // engagement/facebook-engagement.ts, empty-comment-hide.ts) and they have
    // already diverged once: the engagement copy was rebuilt from a live
    // diagnostic and gained 'Reply by' / 'Reply from', while this one kept two
    // forms its own comment marked '(presumed)'. Every English reply was
    // therefore dropped or misfiled until 2026-09-08. A structural signal — the
    // comment-id anchor — would end the divergence; until that is verified
    // live, the lists must at least be reconciled whenever one of them learns
    // something.
    // EXTRACTION YIELD (measured over 30 days to 2026-08). FeelingWise acts on 1% of Facebook content
    // against 7% of X, across 3,832 and 11,836 scans over 30 days. Nothing in
    // the code explains an eight-fold gap, and the leading hypothesis is that
    // it is not a judgement difference: this walker takes ONE DOM shape and
    // every candidate that misses it fell out SILENTLY. Content never
    // extracted is never judged, so the act rate reads low whatever the feed
    // held. These counters answer that before anything touches a gate.
    //
    // The same counters were put on `extractFacebookComments` in
    // comment-extractors.ts and they never fired: that function is a secondary
    // path, and THIS is the one the adapter actually runs. Corrected here.
    //
    // COUNT PER ELEMENT, NOT PER PASS (2026-09-02). The 2026-09-01 dump read
    // 2705 candidates, 1145 dropped on label, 296 extracted, and that 11% is
    // not an extraction rate. `fwCommentSeen` is stamped only AFTER a
    // successful extraction, so an extracted comment leaves the candidate set
    // for good while every REJECTED element is re-examined and re-counted on
    // every re-entry of this method. The mutation observer re-enters it many
    // times per article, and the things `[role="article"][aria-label]` matches
    // and this walker correctly rejects (nested and shared posts, ad wrappers)
    // are permanent DOM fixtures. So the numerator counted each element once
    // and the denominator counted each reject once per pass: the ratio was
    // between two different units and could not be read.
    //
    // The stamps below make every counter here count DISTINCT ELEMENTS. Note
    // what is deliberately NOT done: a rejected element is not marked seen and
    // is still re-evaluated on every pass. Some drops are transient (a comment
    // body that has not rendered yet reads as no-text), and going blind to a
    // comment to make a number tidy is the wrong trade. Only the COUNTING is
    // deduplicated; the reading is not.
    let fbCandidates = 0;
    let fbDroppedLabel = 0;
    // Of the label-drops, how many still LOOK like comments (a body element
    // with real text). See the drop site below for why this split exists.
    let fbDroppedLabelWithText = 0;
    // Comments the label list missed and the comment permalink caught. This
    // is the number that says how much of Facebook's hundred languages the
    // eight stems were leaving unread.
    let fbCommentByAnchor = 0;
    let fbDroppedNoText = 0;
    let fbDroppedShort = 0;
    let fbDroppedDuplicate = 0;
    let fbSeenAlready = 0;
    const commentArticles = article.querySelectorAll<HTMLElement>('[role="article"][aria-label]');
    for (const cmtEl of commentArticles) {
      if (cmtEl === article) continue; // skip the post itself
      // META-6: this method is also invoked directly on the Reel
      // [role="complementary"] side panel, whose caller only filters out a
      // chat-*dialog* ancestor (findChatOverlayAncestor), not a nested
      // role="log" message live-region. If FB ever nests a persistent
      // chat/notification surface inside that panel, its bubbles would
      // otherwise satisfy this same [role="article"][aria-label] shape.
      // Refuse any candidate inside a private-chat subtree here, at the
      // choke point, so every caller of _extractComments gets the gate for
      // free instead of each caller re-deriving a clean root.
      if (isInPrivateChatSubtree(cmtEl)) continue;
      // per-element dedup: skip comments we've already extracted in
      // a prior _extractComments call on this article (FB lazy-loads more
      // comments on scroll, but the previously-extracted ones stay in the DOM).
      if (cmtEl.dataset.fwCommentSeen) { fbSeenAlready++; continue; }
      // One candidate per element for its whole life, however many passes it
      // takes to resolve. `fbCommentAlreadySeen` above keeps its per-pass
      // meaning: it counts re-visits of settled comments, not candidates.
      if (!cmtEl.dataset.fwCommentCandidate) {
        cmtEl.dataset.fwCommentCandidate = '1';
        fbCandidates++;
      }
      // The shared reader, not a third copy of it. This line used to scan the
      // stem list itself with a substring test, where
      // `isFacebookCommentLabel` anchors the stems at the START of the label
      // and strips a parenthesised prefix first. The two answer differently on
      // a label that merely CONTAINS a stem, and this candidate set is
      // `[role="article"][aria-label]` under a post, which on a shared-post
      // layout includes other posts: a post whose label mentions a comment was
      // read as a comment and written into the chain as one. The helper was
      // already imported into this file and already re-exported from it; only
      // this line and the depth walk below had gone on with their own copy
      // (2026-09-19).
      const labelSaysComment = isFacebookCommentLabel(cmtEl.getAttribute('aria-label'));
      // The structural signal the four diverging word lists were waiting for:
      // the comment's own permalink carries comment_id in every language. It
      // is read only when the label missed, so a comment the list already
      // knows costs nothing, and it is counted so the size of the hole the
      // list leaves can be read off a diagnostics blob.
      const anchorSaysComment = !labelSaysComment && hasOwnFacebookCommentAnchor(cmtEl);
      if (anchorSaysComment) fbCommentByAnchor++;
      // The single highest-risk drop: a comment whose aria-label is in a
      // language this list does not carry, and whose permalink has not
      // rendered either, is invisible to FeelingWise.
      if (!labelSaysComment && !anchorSaysComment) {
        const firstLabelDrop = noteCommentDrop(cmtEl, 'label');
        if (firstLabelDrop) fbDroppedLabel++;
        // `fbCommentDroppedLabel` alone cannot answer the only question that
        // matters about it. `[role="article"][aria-label]` matches plenty of
        // things that are NOT comments (nested/shared posts, ad wrappers), and
        // rejecting those is CORRECT — but it matches exactly the same shape as
        // a real comment whose label is in a language the stem list in
        // facebook-comment-signal.ts does not carry (the list moved out of this
        // file with its reader on 2026-09-19, and this sentence named it here
        // until then), and rejecting THAT is FeelingWise going blind. The counter
        // reports both as one number: the owner's 2026-08-20 dump read 346
        // candidates, 100 extracted, 246 dropped here, and nothing on disk can
        // say whether that is 246 correct rejections or 246 unread comments.
        // A body element with real text is the cheap discriminator: a shared
        // post or ad wrapper rarely carries one at this depth, an unreadable
        // comment always does. Deliberately NOT recorded: the aria-label text
        // itself, which is the obvious way to identify the language and also
        // carries the commenter's NAME ("Comentariu adaugat de <NAME>") — that
        // is personal data walking into a diagnostics blob the owner pastes
        // into chat, so the shape gets counted and the words never leave.
        const body = cmtEl.querySelector<HTMLElement>('div[dir="auto"]');
        if (firstLabelDrop && (body?.textContent?.trim().length ?? 0) >= 5) fbDroppedLabelWithText++;
        continue;
      }

      // Body text. FB renders multi-paragraph comments as N sibling
      // `<div dir="auto">` elements under a clean body container; the legacy
      // "longest single dir-auto" heuristic missed all but one paragraph
      // (Bug C, live MCP capture 2026-05-21: Andrea's 5-paragraph hostile
      // comment surfaced only paragraph 1 to the LLM → paragraphs 2-5 with
      // "RĂZBOI?", "FAKE?", and dismissive framings stayed invisible to FW).
      // Filter to dir-autos OWNED by this comment article (skip dir-autos
      // belonging to nested/quoted comment articles), then prefer the
      // common parent as the text element so a textContent replacement
      // atomically swaps every paragraph to the single rewrite string.
      const ownDirAutos = Array.from(
        cmtEl.querySelectorAll<HTMLElement>('div[dir="auto"]'),
      ).filter((el) => el.closest('[role="article"][aria-label]') === cmtEl);
      if (ownDirAutos.length === 0) {
        if (noteCommentDrop(cmtEl, 'no-text')) fbDroppedNoText++;
        continue;
      }

      const paragraphs = ownDirAutos
        .map((el) => (el.textContent ?? '').trim())
        .filter((t) => t.length > 0);
      const text = paragraphs.join('\n');
      if (text.length < 5) {
        if (noteCommentDrop(cmtEl, 'short')) fbDroppedShort++;
        continue;
      }
      // Duplicate drop inside one pass. The guard is for Facebook rendering
      // one comment's body twice inside the same article; it was keyed on the
      // text alone, so two different people writing the same short reply
      // ("same", "amin", a lone emoji phrase) lost the second one, and the
      // chain's claim is that every node the reader met leaves a record.
      // Keyed now on what identifies the comment: its own permalink id where
      // the page carries one, otherwise the commenter's name beside the words,
      // and only where neither is there does it fall back to the text alone.
      const authorName = firstCommentAuthorName(cmtEl);
      const commentId = facebookOwnCommentId(cmtEl);
      const dedupKey = commentId
        ? `id:${commentId}`
        : (authorName ? `who:${authorName.length}:${authorName}${text}` : `text:${text}`);
      if (seen.has(dedupKey)) {
        if (noteCommentDrop(cmtEl, 'duplicate-text')) fbDroppedDuplicate++;
        continue;
      }
      seen.add(dedupKey);

      // Pick the text element. Single-paragraph → use the dir-auto itself
      // (preserves the legacy DOM-mutation target). Multi-paragraph → use
      // the immediate parent IF it contains ALL paragraphs AND has no
      // non-dir-auto children (defensive — otherwise textContent replace
      // would wipe sibling chrome like timestamps or reactions). Fall back
      // to the longest single dir-auto if the parent shape doesn't qualify.
      let textEl: HTMLElement;
      if (ownDirAutos.length === 1) {
        textEl = ownDirAutos[0];
      } else {
        const parent = ownDirAutos[0].parentElement;
        const allShareParent =
          !!parent && ownDirAutos.every((d) => d.parentElement === parent);
        const onlyDirAutoChildren =
          !!parent &&
          Array.from(parent.children).every((c) =>
            (c as HTMLElement).matches?.('div[dir="auto"]'),
          );
        if (parent && allShareParent && onlyDirAutoChildren) {
          textEl = parent;
        } else {
          // Fall back to longest dir-auto. Visual artifact for multi-
          // paragraph fallback (only first replaced), but the LLM still saw
          // the full text above so the verdict is correct.
          textEl = ownDirAutos.reduce(
            (best, cur) =>
              (cur.textContent?.length ?? 0) > (best.textContent?.length ?? 0) ? cur : best,
            ownDirAutos[0],
          );
        }
      }

      // Read once, above, for the dedup key and again for the record.
      const author = authorName ?? 'unknown';

      // depth + parent_id detection. Walk up from
      // cmtEl looking for ancestor comment articles. Each = +1 depth (cap 3).
      // The closest comment-article ancestor's stamped fwCommentId becomes
      // parent_id. Fixes the audit bug "all FB comments tagged depth=1
      // regardless of nesting" → forensic chain misrepresented reply structure.
      let depth: 1 | 2 | 3 = 1;
      let parent_id: string | null = null;
      let ancestor: HTMLElement | null = cmtEl.parentElement;
      while (ancestor && ancestor !== article) {
        if (ancestor.matches('[role="article"][aria-label]')) {
          const ancestorLabel = (ancestor.getAttribute('aria-label') || '').toLowerCase();
          // Same two signals as the gate above: a reply under a comment in an
          // unlisted language used to read as depth 1, so the thread was flat
          // in the record even when both rows were extracted.
          // `isFacebookCommentArticle` IS these two signals, and this was the
          // third hand-rolled copy of them (2026-09-19). Its own comment above
          // says "same two signals as the gate", which was true of the copy and
          // not of the rule.
          if (isFacebookCommentArticle(ancestor)) {
            const newDepth = (Math.min(depth + 1, 3)) as 1 | 2 | 3;
            depth = newDepth;
            if (!parent_id && ancestor.dataset.fwCommentId) {
              parent_id = ancestor.dataset.fwCommentId;
            }
            if (depth >= 3) break;
          }
        }
        ancestor = ancestor.parentElement;
      }

      const cmtId = commentIdFor(cmtEl);
      cmtEl.dataset.fwCommentId = cmtId; // stamp for descendant lookup
      cmtEl.dataset.fwCommentSeen = 'true'; // mark seen AFTER successful extraction
      out.push({ id: cmtId, text, author, element: textEl, chromeEl: cmtEl, depth, parent_id });
    }

    // Legacy fallback: <ul><li> structure (older FB versions; some feed
    // contexts may still render this way). Treats all <li> entries as
    // depth=1 / no parent — legacy layout doesn't surface reply nesting.
    if (out.length === 0) {
      const lists = article.querySelectorAll<HTMLElement>('ul');
      for (const ul of lists) {
        const items = ul.querySelectorAll<HTMLElement>(':scope > li');
        for (const li of items) {
          if (li.dataset.fwCommentSeen) continue; // same per-element dedup
          const authorEl = li.querySelector<HTMLElement>('a[role="link"]');
          const textEl = li.querySelector<HTMLElement>('div[dir="auto"]');
          if (!authorEl || !textEl) continue;

          const text = textEl.textContent?.trim() ?? '';
          if (text.length < 5) {
            // The modern walker above drops on the same floor and records it
            // (noteCommentDrop, fbDroppedShort). This fallback was doing it
            // silently, so "lol" or an emoji reply on an older-rendered thread
            // left no trace at all: not in the record, not in a counter.
            // Counted here on the same terms (2026-09-19). The floor itself is
            // unchanged.
            if (text.length > 0) bumpCounter('shortDrop.facebook.legacy');
            continue;
          }
          const author = authorEl.textContent?.trim() ?? 'unknown';
          // Same rule as the walker above: two people writing the same short
          // reply are two comments, not one rendered twice.
          const legacyKey = `who:${author.length}:${author}${text}`;
          if (seen.has(legacyKey)) continue;
          seen.add(legacyKey);

          li.dataset.fwCommentSeen = 'true'; // mark seen
          // Same identity rule as the walker above; the legacy layout renders
          // no comment permalink, so it lands on the stamp or the counter.
          const legacyId = commentIdFor(li);
          li.dataset.fwCommentId = legacyId;
          out.push({ id: legacyId, text, author, element: textEl, chromeEl: li, depth: 1, parent_id: null });
        }
      }
    }

    // persist the counter so the next call continues from where
    // this one left off, keeping `fb-cmt-${postId}-c${N}` chain IDs unique.
    // Both places: the element, which a remount destroys, and the per-post
    // high-water mark, which it does not.
    article.dataset.fwCommentNextIdx = String(cmtIdx);
    this._noteCommentIdxHighWater(postId, cmtIdx);

    if (fbCandidates > 0 || fbSeenAlready > 0) {
      bumpCounter('fbCommentCandidates', fbCandidates);
      bumpCounter('fbCommentExtracted', out.length);
      if (fbDroppedLabel > 0) bumpCounter('fbCommentDroppedLabel', fbDroppedLabel);
      if (fbDroppedLabelWithText > 0) bumpCounter('fbCommentDroppedLabelWithText', fbDroppedLabelWithText);
      if (fbCommentByAnchor > 0) bumpCounter('fbCommentByAnchor', fbCommentByAnchor);
      if (fbDroppedNoText > 0) bumpCounter('fbCommentDroppedNoText', fbDroppedNoText);
      if (fbDroppedShort > 0) bumpCounter('fbCommentDroppedShort', fbDroppedShort);
      if (fbDroppedDuplicate > 0) bumpCounter('fbCommentDroppedDuplicate', fbDroppedDuplicate);
      if (fbSeenAlready > 0) bumpCounter('fbCommentAlreadySeen', fbSeenAlready);
    }
    return out;
  }

  /**
   * true if this [role="article"] is a comment, not a post. Two signals:
   * the aria-label ("Comentariu adăugat de X" / "Comment by X" / etc. across
   * the FB locales the stem list carries; posts don't have this prefix), and
   * the comment permalink this article owns, which is language-free. Used by
   * the main loop to skip comment articles (they go through the batch path
   * via _extractComments instead — better-tuned classifier).
   */
  private _isCommentArticle(article: HTMLElement): boolean {
    return isFacebookCommentArticle(article);
  }

  /**
   * Wire (or re-wire) the modal-internal scroll trigger.
   *
   * The MutationObserver in interceptor.ts fires on lazy-load + tree mutations
   * but NOT on pure scroll inside already-mounted DOM. When the user scrolls
   * the FB comments-modal's inner scroll container past comments rendered on
   * a prior pass, those comments stay un-extracted because no MO event fires.
   * The scroll trigger restores re-extraction on user-scroll-in-mounted-DOM,
   * which matters most when the viewport-gate previously dropped comments
   * (it un-stamps them via `unmarkPostsForReExtraction` so a re-extract pass
   * can re-bucket them — but only if a re-extract actually happens).
   *
   * One listener per scroll-container instance. On every extractPosts call we
   * compare the currently-tracked container against a fresh discovery; if the
   * container has been recycled (modal closed + reopened, SPA-nav swapped the
   * dialog DOM) we dispose the prior trigger and re-attach.
   *
   * Silently no-op when no scroll container is found (e.g. permalink URL
   * without modal, or modal not yet mounted) — the existing MO path stays
   * the only trigger for that surface.
   */
  private _ensureScrollTrigger(): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    const next = this._findDialogScrollContainer();
    const current = this._scrollContainerRef?.deref() ?? null;

    if (current !== next) {
      if (this._disposeScrollTrigger) {
        this._disposeScrollTrigger();
        this._disposeScrollTrigger = null;
      }
      this._scrollContainerRef = null;
    }

    if (!next) return;
    if (this._disposeScrollTrigger) return;

    this._scrollContainerRef = new WeakRef(next);
    this._disposeScrollTrigger = setupScrollExtractionTrigger(
      next,
      () => this._reExtractCommentsInDialog(),
    );
  }

  /**
   * Locate the dialog's inner scroller — the descendant element with computed
   * `overflowY: auto|scroll` AND `scrollHeight > clientHeight + 10`. The +10
   * absorbs FB's 1px scrollbar artifacts. Returns the first match across all
   * dialogs in the document; FB's comment modal renders only one open dialog
   * at a time on standard surfaces.
   */
  private _scrollContainerCache: WeakMap<HTMLElement, HTMLElement> = new WeakMap();
  /** When a dialog was last walked without finding a scroller. */
  private _scrollProbeMissAt: WeakMap<HTMLElement, number> = new WeakMap();

  private _findDialogScrollContainer(): HTMLElement | null {
    // META-7: exclude chat/DM dialogs (Messenger pop-out, chat-head window)
    // so we never attach a live scroll listener to, or walk the full DOM
    // of, a private conversation window — and never mis-select a chat's
    // scroller instead of the real comments/post modal when both are
    // mounted at once.
    const dialogs = Array.from(
      document.querySelectorAll<HTMLElement>('[role="dialog"]'),
    ).filter(dialog => !isInPrivateChatSubtree(dialog));
    for (const dialog of dialogs) {
      const cached = this._scrollContainerCache.get(dialog);
      if (cached && dialog.contains(cached)) return cached;
      // Only a hit was cached, so a dialog with no scroller was walked with
      // getComputedStyle on every extractPosts call while it stayed open
      // (same defect as instagram.ts). Remember the miss and re-probe at most
      // every SCROLLER_PROBE_RETRY_MS.
      const missAt = this._scrollProbeMissAt.get(dialog);
      if (missAt !== undefined && Date.now() - missAt < SCROLLER_PROBE_RETRY_MS) continue;
      this._scrollProbeMissAt.set(dialog, Date.now());
      const candidates = dialog.querySelectorAll<HTMLElement>('*');
      for (const el of candidates) {
        const style = window.getComputedStyle(el);
        const overflow = style.overflowY;
        if (
          (overflow === 'auto' || overflow === 'scroll')
          && el.scrollHeight > el.clientHeight + 10
        ) {
          this._scrollContainerCache.set(dialog, el);
          return el;
        }
      }
    }
    return null;
  }

  /**
   * Re-extract comments inside the dialog by handing each stamped post
   * article (or its `[aria-posinset]` wrapper if one exists) back to the
   * interceptor through `requestReExtract`.
   *
   * The interceptor owns the routing into the comment-batch enqueue
   * (`onPost` lives in interceptor scope, not in the adapter). The re-walk
   * runs the adapter's re-entry path (article.dataset.fwProcessed === 'true'
   * → skips post-body push) and fans out `_extractComments` whose
   * per-element dedup picks up only the comments that were un-stamped by
   * the viewport-gate's `unmarkPostsForReExtraction` after a prior
   * fail-closed flush.
   *
   * The posinset-wrapper preference is required because `_collectArticles`
   * skips role="article" elements that have a posinset ancestor (to avoid
   * the duplicate-shell-vs-feed-unit bug); handing over the bare
   * role="article" element when it sits inside a posinset wrapper would
   * leave `_collectArticles` returning empty for that root.
   *
   * Comment-articles are skipped — their re-extraction is driven by walking
   * down from the post article they sit inside.
   *
   * This used to detach and re-insert each root so the body
   * MutationObserver would fire; a moved subtree loses focus without a
   * `blur` and the scrollTop restore re-armed the scroll debounce, which on
   * Instagram made the modal's comment composer unusable (2026-09-02).
   * Nothing here touches the DOM any more; see scroll-trigger.ts.
   */
  private _reExtractCommentsInDialog(): void {
    const container = this._scrollContainerRef?.deref();
    if (!container) return;
    const dialog = container.closest<HTMLElement>('[role="dialog"]');
    if (!dialog) return;
    const articles = dialog.querySelectorAll<HTMLElement>('div[role="article"]');
    const roots = new Set<HTMLElement>();
    for (const article of articles) {
      if (!article.dataset.fwProcessed) continue;
      if (this._isCommentArticle(article)) continue;
      roots.add(article.closest<HTMLElement>('[aria-posinset]') ?? article);
    }
    requestReExtract([...roots]);
  }

  private _collectArticles(root: HTMLElement): HTMLElement[] {
    const results: HTMLElement[] = [];
    const collected = new Set<HTMLElement>();

    // primary feed-unit boundary on modern FB DOM is
    // [aria-posinset] (validated against live FB capture via dom-mapper
    // Stage 1, see ). [role="article"] is
    // now an empty 12-descendant shell on the home feed; the post body
    // ([data-ad-rendering-role="story_message"]) lives as a cousin under
    // the [aria-posinset] feed unit, NOT as a descendant of the shell.
    // Iterate posinset first so the body extractor can find body via
    // direct query instead of walking out of the shell subtree.
    if (root.matches?.('[aria-posinset]')) {
      results.push(root);
      collected.add(root);
    }
    root.querySelectorAll<HTMLElement>('[aria-posinset]').forEach((el) => {
      if (!collected.has(el)) {
        results.push(el);
        collected.add(el);
      }
    });

    // Legacy [role="article"] path for non-feed contexts (modal, photo
    // viewer, profile pages where posinset may be absent). Skip articles
    // whose [aria-posinset] ancestor is already collected — the shell
    // would produce a duplicate post otherwise.
    //
    // Messenger chat-log exclusion: each chat-message bubble on
    // facebook.com is a `<div role="article" aria-label="">` nested inside
    // a `<div role="log" aria-label="Messages in conversation with …">`.
    // ARIA `role="log"` is the canonical "live-region for messages" role
    // — Messenger uses it correctly for accessibility, and platforms
    // cannot drop it without breaking screen-reader support, so this gate
    // is stable across FB DOM rotations. Without this filter the message
    // bubbles flow through the legacy `[role="article"]` branch (they have
    // no `[aria-posinset]` ancestor) and get extracted as posts — leaking
    // private DMs into the forensic chain and routing them through the
    // neutralizer.
    if (root.matches?.('div[role="article"]')) {
      if (!collected.has(root) && !root.closest('[aria-posinset]') && !root.closest('[role="log"]')) {
        results.push(root);
        collected.add(root);
      }
    }
    root.querySelectorAll<HTMLElement>('div[role="article"]').forEach((el) => {
      if (collected.has(el)) return;
      if (el.closest('[aria-posinset]')) return;
      if (el.closest('[role="log"]')) return;
      results.push(el);
      collected.add(el);
    });

    return results;
  }

  private _extractText(article: HTMLElement): { element: HTMLElement; text: string } | null {
    // primary anchor on modern FB DOM (validated via dom-mapper
    // Stage 1 live capture, see ). FB body
    // lives at [data-ad-rendering-role="story_message"] inside the
    // [aria-posinset] feed unit — NOT inside [role="article"] anymore.
    // _collectArticles now iterates posinset wrappers so the body is a
    // direct descendant; the closest('[aria-posinset]') walk-up is a
    // safety net for the legacy [role="article"] path (modal, photo
    // viewer) where the article shell itself is iterated.
    const storyMsg = article.querySelector<HTMLElement>(
      '[data-ad-rendering-role="story_message"]',
    );
    if (storyMsg) {
      const text = storyMsg.textContent?.trim() ?? '';
      if (text.length >= 12) {
        return { element: storyMsg, text };
      }
    }

    const posinsetAncestor = article.closest<HTMLElement>('[aria-posinset]');
    if (posinsetAncestor && posinsetAncestor !== article) {
      const cousinStoryMsg = posinsetAncestor.querySelector<HTMLElement>(
        '[data-ad-rendering-role="story_message"]',
      );
      if (cousinStoryMsg) {
        const text = cousinStoryMsg.textContent?.trim() ?? '';
        if (text.length >= 12) {
          return { element: cousinStoryMsg, text };
        }
      }
    }

    // Legacy fallback for ads + older surfaces. Reached ONLY after the modern
    // organic-post body path ([data-ad-rendering-role="story_message"]) above
    // missed — and these ad-only selectors don't match organic content, so a
    // miss here is the normal case, NOT selector drift. Deliberately UNLABELED
    // for selector-health: labeling it 'facebook-text' made the counter show
    // 100% miss (it never sees the unlabeled story_message primary path that
    // does the real work) and falsely flagged Facebook "broken". Real FB body
    // breakage is caught by the extraction-canary's 0-extractions signal — do
    // NOT re-add a label here.
    const adResult = extractTextWithFallback(
      article,
      ['div[data-ad-preview="message"]', 'div[data-ad-comet-preview="message"]'],
      20,
      undefined,
      'facebook',
    );
    if (adResult) return adResult;

    return this._extractTextElement(article);
  }

  private _isInCommentOrNested(el: HTMLElement, article: HTMLElement): boolean {
    let current: HTMLElement | null = el.parentElement;
    while (current && current !== article) {
      // Inside a comment section
      if (current.tagName === 'UL') return true;
      // Inside a nested shared article
      if (current.getAttribute('role') === 'article') return true;
      // Inside complementary content
      if (current.getAttribute('role') === 'complementary') return true;
      current = current.parentElement;
    }
    return false;
  }

  private _extractTextElement(article: HTMLElement): { element: HTMLElement; text: string } | null {
    const candidates = article.querySelectorAll<HTMLElement>('div[dir="auto"]');
    let best: HTMLElement | null = null;
    let bestLen = 0;
    // track filter reasons so when the function returns
    // null on a non-empty candidate set, the caller can log why. Lengths
    // help distinguish "all candidates were too short" (FB text format
    // changed) from "all were filtered as nested" (selector chain rotated).
    let dbgCandidateCount = 0;
    let dbgFilteredNested = 0;
    let dbgUnderLength = 0;
    let dbgMaxLengthSeen = 0;

    for (const el of candidates) {
      dbgCandidateCount++;
      if (this._isInCommentOrNested(el, article)) { dbgFilteredNested++; continue; }

      const text = el.textContent?.trim() ?? '';
      if (text.length > dbgMaxLengthSeen) dbgMaxLengthSeen = text.length;
      // dropped min length 20 → 12 to match the pipeline's
      // MIN_TEXT_LENGTH gate. A 16-char "URGENT! Act now!" post is real
      // manipulation; the 20-char threshold was over-cautious.
      if (text.length >= 12 && text.length > bestLen) {
        best = el;
        bestLen = text.length;
      } else if (text.length < 12) {
        dbgUnderLength++;
      }
    }

    if (!best) {
      // Rate-limited: reel/video cards with no caption legitimately null
      // here on every rescan — 19 identical lines per session (2026-06-12)
      // drowned the real signals. First 3 occurrences carry the detail;
      // after that, silence. Real FB body breakage is still caught by the
      // extraction-canary's 0-extractions signal.
      if (dbgCandidateCount > 0 && FacebookAdapter._nullExtractLogs < 3) {
        FacebookAdapter._nullExtractLogs++;
        console.log(
          `[FW FB-extract] _extractTextElement returned null: ${dbgCandidateCount} dir=auto candidates ` +
            `(${dbgFilteredNested} filtered as nested/comment, ${dbgUnderLength} under 12 chars, ` +
            `longest=${dbgMaxLengthSeen} chars). Usually a caption-less video/reel card; ` +
            `if extracted=0 persists on a TEXT feed, the dir="auto" anchor may have rotated.` +
            (FacebookAdapter._nullExtractLogs === 3 ? ' (further occurrences suppressed this session)' : ''),
        );
      }
      return null;
    }
    // The longest box can be a wrapper around the words and a link preview or a photo, since the
    // preview's headline adds to its length. A rewrite cannot land in a card without deleting
    // what is beside the words, so the body is the longest text box inside it. With none inside,
    // the wrapper stays the body: the post is still read, and the writer leaves its media alone.
    if (holdsMoreThanWords(best)) {
      let inner: HTMLElement | null = null;
      let innerLen = 0;
      for (const el of candidates) {
        if (el === best || !best.contains(el)) continue;
        if (this._isInCommentOrNested(el, article) || holdsMoreThanWords(el)) continue;
        const len = el.textContent?.trim().length ?? 0;
        if (len >= 12 && len > innerLen) {
          inner = el;
          innerLen = len;
        }
      }
      if (inner) best = inner;
    }
    return { element: best, text: best.textContent?.trim() ?? '' };
  }

  /**
   * The group's name when this is a group post, else undefined. A group post is
   * proven by the presence of a `/groups/<gid>/user/` poster link (the same
   * signal `_extractAuthor` uses to recover the human poster); on those posts
   * the `[data-ad-rendering-role="profile_name"]` actor is the GROUP. Returns
   * the cleaned group name so the forensic record can carry
   * `accountType:'group'` + `sourceContainer`. Non-group posts skip the branch
   * (zero regression) — the `/user/` link exists only inside groups.
   */
  private _extractGroupContainer(article: HTMLElement): string | undefined {
    const scope = article.closest<HTMLElement>('[aria-posinset]') ?? article;
    const isGroupPost = !!scope.querySelector(
      'a[role="link"][href*="/groups/"][href*="/user/"]',
    );
    if (!isGroupPost) return undefined;
    const profileName = scope.querySelector<HTMLElement>(
      '[data-ad-rendering-role="profile_name"]',
    );
    const raw = profileName?.textContent?.trim() ?? '';
    if (!raw || raw.length >= 200) return undefined;
    // Strip the " · Follow" / " · Urmărește" status suffix FB appends.
    const cleaned = raw.split(/\s+·\s+/)[0].trim();
    return cleaned || undefined;
  }

  /**
   * Extract the Reel creator's name from the page outside the complementary panel.
   * FB Reels show the author in a profile_name element or a prominent link above
   * the comment panel. Returns 'unknown' when not reliably extractable.
   */
  private _extractReelAuthor(_comp: HTMLElement): string {
    const profileName = document.querySelector<HTMLElement>(
      '[data-ad-rendering-role="profile_name"]',
    );
    if (profileName) {
      const raw = profileName.textContent?.trim() ?? '';
      if (raw && raw.length < 200) {
        return raw.split(/\s+·\s+/)[0].trim() || 'unknown';
      }
    }
    // Fallback: the first strong/heading-like element in the main reel area
    // (outside the complementary panel) that looks like a display name.
    const main = document.querySelector<HTMLElement>('[role="main"]');
    if (main) {
      const headings = main.querySelectorAll<HTMLElement>('h2 a, h3 a, [role="link"] strong');
      for (const h of headings) {
        if (_comp.contains(h)) continue;
        const name = h.textContent?.trim() ?? '';
        if (name.length > 0 && name.length < 80) return name;
      }
    }
    return 'unknown';
  }

  /**
   * Extract the Reel caption text. FB Reels often show a short description
   * near the author name. Returns '' when not extractable.
   */
  private _extractReelCaption(_comp: HTMLElement): string {
    // Captions on FB Reels sit in a container outside the complementary panel,
    // typically in a <span> block under the author area. We look for visible
    // text blocks in the main content that aren't inside the comment panel.
    const main = document.querySelector<HTMLElement>('[role="main"]');
    if (!main) return '';
    // FB Reels caption is commonly in a div/span with dir="auto" adjacent to
    // the profile_name element — try the first reasonable text block.
    const candidates = main.querySelectorAll<HTMLElement>(
      '[data-ad-rendering-role="story_message"], [dir="auto"] > span',
    );
    for (const el of candidates) {
      if (_comp.contains(el)) continue;
      const txt = el.textContent?.trim() ?? '';
      // "Facebook" alone is the site's own brand/chrome text, not a caption
      // (record-feed-study/C-NOTES.md, #3875-#3883: a reel's roomCaption came
      // out "Facebook" instead of its real caption -- the generic selector
      // above matched a chrome span before it reached the real one). Same
      // exact-string chrome exclusion instagram.ts already uses for its own
      // nav labels ("For you" / "Pentru tine").
      if (txt === 'Facebook') continue;
      if (txt.length > 3 && txt.length < 2000) return txt;
    }
    return '';
  }

  private _extractAuthor(article: HTMLElement): string {
    // Strategy 0: group posts surfaced in the feed (or on a group page).
    // Facebook renders the GROUP as the
    // [data-ad-rendering-role="profile_name"] actor and puts the human
    // poster only in a "/groups/<gid>/user/<uid>/" link. Read on a live
    // group post (2026-06-23): profile_name holds the group's name while the
    // real author's name appears only as the text of the user link. Without
    // this branch the group name is stored as the author and the dashboard
    // prints "@<group name>" as if the group itself were a user.
    //
    // These "/user/" links exist ONLY on group posts, so non-group page /
    // profile posts skip this branch entirely (zero regression). The first
    // such link in document order is the poster's (the header precedes the
    // comment list); the avatar link carries no text and is skipped by the
    // non-empty check, leaving the name link.
    const groupScope = article.closest<HTMLElement>('[aria-posinset]') ?? article;
    const groupUserLinks = groupScope.querySelectorAll<HTMLAnchorElement>(
      'a[role="link"][href*="/groups/"][href*="/user/"]',
    );
    for (const link of groupUserLinks) {
      const name = link.textContent?.trim() ?? '';
      if (name.length > 0 && name.length < 50) return name;
    }

    // primary author anchor on modern FB DOM (validated via
    // dom-mapper Stage 1 live capture). Strip multi-language status
    // suffixes ("· Urmărește", "· Follow") so the stored author is the
    // bare page/profile name.
    const profileName =
      article.querySelector<HTMLElement>('[data-ad-rendering-role="profile_name"]')
      ?? article
        .closest<HTMLElement>('[aria-posinset]')
        ?.querySelector<HTMLElement>('[data-ad-rendering-role="profile_name"]')
      ?? null;
    if (profileName) {
      // The name is the link inside the actor element. What follows it in
      // the element's text is the verified badge's accessible text (after a
      // no-break space: "Ilinca Model Verified account") or a
      // relationship the header narrates ("Sarah is with Ralph", "Moon
      // recommends a page" on a page's reviews tab); a real
      // 2026-09-05 export carried those whole sentences as authors.
      const nameLink = Array.from(profileName.querySelectorAll<HTMLElement>('a'))
        .map(a => a.textContent?.trim() ?? '')
        .find(name => name.length > 0 && name.length < 200);
      const raw = nameLink ?? (profileName.textContent?.trim() ?? '');
      if (raw && raw.length < 200) {
        // FB renders the name + secondary metadata separated by " · ".
        // The author name is the first segment; subsequent segments are
        // status badges ("Cont confirmat") or follow CTAs ("Urmărește").
        const cleaned = raw.split(/\s+·\s+/)[0].split('\u00a0')[0].trim();
        if (cleaned) return cleaned;
      }
    }

    // Strategy 1: strong tag inside a link (common Facebook pattern for author names)
    const strongLink = article.querySelector<HTMLElement>('a[role="link"] strong');
    if (strongLink?.textContent?.trim()) {
      return strongLink.textContent.trim();
    }

    // Strategy 2: first link in header area with a user-like href.
    // Three patterns FB uses for an author link:
    //   /<handle>                          — simple username profile
    //   /profile.php?id=<numericId>        — numeric-ID fallback
    //   /groups/<groupId>/user/<userId>/   — group-context user link, used
    //                                        for nickname posts and replies
    //                                        in groups (DOM capture, 2026-05-24,
    //                                        of a nickname-post in a test
    //                                        FB group).
    //                                        Without this branch the author
    //                                        falls through to Strategy 4
    //                                        and stamps as "unknown",
    //                                        cascading to every reply
    //                                        record as "commented under
    //                                        Unknown author".
    const links = article.querySelectorAll<HTMLAnchorElement>('a[role="link"]');
    for (const link of links) {
      const href = link.getAttribute('href') ?? '';
      if (
        href.match(/^\/[a-zA-Z0-9.]+\/?$/)
        || href.includes('/profile.php?id=')
        || href.match(/^\/groups\/[^/]+\/user\/[^/]+/)
      ) {
        const text = link.textContent?.trim();
        if (text && text.length > 0 && text.length < 50) {
          return text;
        }
      }
    }

    // Strategy 3: profile/reel links with aria-label/title
    const profileLink = article.querySelector<HTMLAnchorElement>('a[href*="/profile.php"], a[href*="/reel/"], a[href*="/posts/"]');
    const profileText =
      profileLink?.getAttribute('aria-label')?.trim()
      || profileLink?.getAttribute('title')?.trim()
      || profileLink?.textContent?.trim();
    if (profileText && profileText.length > 0 && profileText.length < 80) {
      return profileText;
    }

    // Strategy 4: fallback to accessible actor labels on the article
    const actorEl = article.querySelector<HTMLElement>('[aria-label*=\"profile\" i], [aria-label*=\"profil\" i]');
    const actorText = actorEl?.getAttribute('aria-label')?.trim();
    if (actorText && actorText.length < 80) return actorText;

    // Strategy 5: language-agnostic structural extraction for anonymous /
    // unlinked posters. Captured live 2026-05-24 on the Claude Community
    // group: "Anonymous participant 340" posts have no <a> link to a
    // profile (FB privacy — no profile exists to navigate to) and so fall
    // through Strategies 1-4. FB still renders the author region as
    // <div role="button"> containing a <span dir="auto"> with the
    // visible name, AND the article's aria-label contains that same name
    // ("Comment by Anonymous participant 340 about …").
    //
    // We exploit two language-independent signals:
    //   1. ARIA role="button" + dir="auto" — W3C/HTML spec, not text
    //   2. aria-label SUBSTRING containment — the author name is the
    //      only token that appears both in aria-label AND as visible text
    //      inside a button-span inside the article.
    //
    // This catches Anonymous + d4ault3-style nicknames in ANY locale of
    // FB without us maintaining a per-language list of "the word for
    // Like / Reply / Share" — those action buttons don't appear in the
    // article's aria-label so the cross-check rejects them.
    const ariaLabel = (article.getAttribute('aria-label') || '').toLowerCase();
    if (ariaLabel) {
      const buttonSpans = article.querySelectorAll<HTMLElement>('div[role="button"] span[dir="auto"]');
      for (const span of buttonSpans) {
        const text = span.textContent?.trim() ?? '';
        if (text.length < 4 || text.length > 80) continue;
        if (ariaLabel.includes(text.toLowerCase())) {
          return text;
        }
      }
    }

    return 'unknown';
  }

  private _extractPostId(article: HTMLElement): string | null {
    const links = article.querySelectorAll<HTMLAnchorElement>('a[href]');
    for (const link of links) {
      const href = link.getAttribute('href') ?? '';

      // /posts/ID
      const postMatch = href.match(/\/posts\/(\w+)/);
      if (postMatch) return postMatch[1];

      // /permalink/ID
      const permalinkMatch = href.match(/\/permalink\/(\w+)/);
      if (permalinkMatch) return permalinkMatch[1];

      // story_fbid parameter
      const storyMatch = href.match(/story_fbid=(\d+)/);
      if (storyMatch) return storyMatch[1];

      // /reel/ID
      const reelMatch = href.match(/\/reel\/(\d+)/);
      if (reelMatch) return reelMatch[1];

      // /share/p/ID and /share/v/ID — modern per-post share permalinks.
      const shareMatch = href.match(/\/share\/[pv]\/([\w-]+)/);
      if (shareMatch) return shareMatch[1];
    }

    // Modern home-feed posts expose no static post anchor (the timestamp href
    // stays '#' / '/' until a real pointer hover, which a synthetic event does
    // not trigger — probed live 2026-06-11), so the loop above returns null and
    // the caller falls to crypto.randomUUID(). When FW landed on a single-post
    // permalink the post id is in location.pathname; derive it so the chain id
    // is stable across re-entry instead of a fresh UUID each tick. Restricted to
    // path forms that identify ONE post — never a bare group/profile feed path
    // (that would collide every post on the page into one chain id).
    const pageId = this._extractPostIdFromPath();
    if (pageId) return pageId;

    return null;
  }

  /** Per-post id from the current page URL, only when the path identifies a
   *  single post (permalink / share / story). Returns null for feed pages. */
  private _extractPostIdFromPath(): string | null {
    if (typeof window === 'undefined' || !window.location) return null;
    const path = window.location.pathname || '';
    const search = window.location.search || '';

    const groupPermalink = path.match(/\/groups\/[\w.]+\/(?:posts|permalink)\/(\w+)/);
    if (groupPermalink) return groupPermalink[1];

    const userPermalink = path.match(/\/[\w.]+\/posts\/(\w+)/);
    if (userPermalink) return userPermalink[1];

    const sharePath = path.match(/\/share\/[pv]\/([\w-]+)/);
    if (sharePath) return sharePath[1];

    const storyFbid = search.match(/[?&]story_fbid=(\d+)/);
    if (storyFbid) return storyFbid[1];

    return null;
  }

  private _extractPostUrl(article: HTMLElement): string {
    const links = article.querySelectorAll<HTMLAnchorElement>('a[href]');
    // Modern home-feed posts expose NO static /posts/ or /permalink/ anchor
    // (the timestamp href stays '#' / '/' until a real pointer hover, which a
    // synthetic event does not trigger — probed live 2026-06-11). Permalink
    // patterns are kept first; photo posts carry a durable /photo/?fbid=
    // anchor; then a permalink derived from the post id + the article's own
    // actor anchor; otherwise the surface URL captured AT MOUNT.
    let photoUrl = '';
    let containerUrl = '';
    for (const link of links) {
      const href = link.getAttribute('href') ?? '';
      if (
        href.includes('/posts/')
        || href.includes('/permalink/')
        || href.includes('permalink.php')
        || href.includes('story_fbid=')
        || href.includes('/reel/')
        || href.includes('/videos/')
        || href.includes('/share/p/')
        || href.includes('/share/v/')
        || href.includes('watch/?v=')
      ) {
        return this._cleanFacebookUrl(href);
      }
      if (!photoUrl && href.includes('/photo') && href.includes('fbid=')) {
        photoUrl = href;
      }
      if (!containerUrl) {
        const m = href.match(/^(?:https:\/\/www\.facebook\.com)?(\/groups\/[\w.]+\/?)(?:[?#]|$)/);
        if (m) containerUrl = m[1];
      }
    }
    if (photoUrl) return this._cleanFacebookUrl(photoUrl);

    // M36 — permalink-derivation fallback. When no static permalink anchor is
    // present (modern feeds hide it behind a hover-only '#' href) but a real
    // post id is recoverable (in-article anchor or single-post path) AND the
    // article carries its author/group anchor, build the canonical permalink
    // from id + actor. Cleaner than location.href (drops ?comment_id/__cft__
    // tracking) and, critically, captured AT MOUNT so the record never falls
    // back to a stale log-time location.href after the SPA navigates.
    const derived = this._derivePostPermalink(article);
    if (derived) return derived;

    if (containerUrl) return this._cleanFacebookUrl(containerUrl);

    // M36 final fallback — the surface URL captured at observation time. On a
    // single-post page this IS the permalink; on a feed it's the honest
    // surface the child saw. Returning this at MOUNT (not '') is what stops
    // buildPostUrl from re-reading a post-navigation homepage at log time.
    return this._currentSurfaceUrl();
  }

  /** The current page's address, read at mount, without what a search box put in it. */
  private _currentSurfaceUrl(): string {
    return currentPageAddress();
  }

  /**
   * M36 — build the canonical FB permalink from the post id + the article's own
   * actor anchor when the timestamp permalink isn't rendered. Group posts →
   * `/groups/<gid>/posts/<id>` (gated on the group `/user/` link, the same
   * group-exclusive signal `_extractAuthor` uses). User/Page posts →
   * `<slug>/posts/<id>` or `permalink.php?story_fbid=<id>&id=<pid>`. Returns ''
   * when no real id is recoverable (home-feed UUID case) or no usable actor
   * anchor is found — the caller then falls to the surface URL.
   */
  private _derivePostPermalink(article: HTMLElement): string {
    const postId = this._extractPostId(article);
    if (!postId) return '';
    const scope = article.closest<HTMLElement>('[aria-posinset]') ?? article;

    // Group post → /groups/<gid>/posts/<id>. The `/groups/<gid>/user/<uid>/`
    // link exists ONLY on group posts (same signal as Strategy 0 / source
    // container), so a user post that merely links to a group in its body
    // won't be misrouted into the group permalink form.
    const groupUserHref = scope
      .querySelector<HTMLAnchorElement>('a[href*="/groups/"][href*="/user/"]')
      ?.getAttribute('href') ?? '';
    const gid = groupUserHref.match(/\/groups\/(\d+)/)?.[1];
    if (gid) return this._cleanFacebookUrl(`/groups/${gid}/posts/${postId}/`);

    // User / Page post → <slug>/posts/<id> or permalink.php?story_fbid=<id>&id=<pid>.
    for (const link of scope.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      const href = link.getAttribute('href') ?? '';
      const pid = href.match(/\/profile\.php\?id=(\d+)/)?.[1];
      if (pid) {
        return this._cleanFacebookUrl(`/permalink.php?story_fbid=${postId}&id=${pid}`);
      }
      const slug = href.match(/^\/([\w.]+)\/?$/)?.[1];
      if (slug && !FB_NON_PROFILE_SLUGS.has(slug) && !slug.endsWith('.php')) {
        return this._cleanFacebookUrl(`/${slug}/posts/${postId}/`);
      }
    }
    return '';
  }

  /** Absolutize + strip FB click-tracking params (__cft__, __tn__) while
   *  keeping load-bearing ones (fbid, set, story_fbid, id, v). */
  private _cleanFacebookUrl(href: string): string {
    const abs = href.startsWith('http') ? href : `https://www.facebook.com${href}`;
    try {
      const u = new URL(abs);
      for (const k of [...u.searchParams.keys()]) {
        if (k.startsWith('__') || k === 'idorvanity') u.searchParams.delete(k);
      }
      return u.toString();
    } catch {
      return abs;
    }
  }

  private _detectFeedSource(): FeedSource {
    const path = window.location.pathname;
    if (path.includes('/groups/')) return 'following';
    if (path.includes('/watch')) return 'for-you';
    if (path.includes('/profile') || path.match(/^\/[a-zA-Z0-9.]+\/?$/)) return 'profile';
    // (FACEBOOK_CRITERIA F5-1): home and /home are the
    // algorithmically-served News Feed = `for-you` semantically. Pre-
    // (V1=Adult/Evidence) this tagged `unknown` as a conservative call —
    // post- (V1=Family) Facebook is a primary surface and the home
    // feed dominates parent usage, so accurate tagging matters for
    // dashboard analytics + calibration filtering.
    if (path === '/' || path === '/home' || path === '') return 'for-you';
    return 'unknown';
  }
}
