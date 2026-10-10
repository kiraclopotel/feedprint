// FeelingWise - Instagram platform adapter
// Uses structural patterns (tag hierarchy, roles, attributes) instead of
// class names because Meta aggressively obfuscates them.

import { PostContent, FeedSource, PlatformSpecificMeta } from '../../types/post';
import { cardForRecord } from '../record/card-context';
import {
  findChatOverlayAncestor,
  isInPrivateChatSubtree,
  PlatformAdapter,
} from './adapter';
import { requestReExtract, setupScrollExtractionTrigger } from '../post-path/scroll-trigger';
// Universal DOM Master: shared row extractor (tier fallback + structural-
// shape detection + content-aware rotation diagnostic). See
// `src/content/platforms/dom-master/types.ts` for the architecture overview.
import { extractCommentRows, type DomMasterAdapter } from './dom-master';
import { parseCountText } from './count-text';
import { isForeignPostUrlHost } from '../record/post-url-host';
import { currentPageAddress } from '../record/post-url';
import { bumpCounter } from '../../diagnostics/diagnostics';

// Instagram surface kinds per PER_PLATFORM_V1_SPEC §5.3.
type InstagramSurfaceKind = NonNullable<
  Extract<PlatformSpecificMeta, { platform: 'instagram' }>['surfaceKind']
>;

// Structural ad-badge words IG uses, matched EXACTLY against a single
// element's trimmed text — never against whole-article prose. IG renders the
// ad marker as a short standalone label in the post's header / actor row
// (e.g. `<span>Sponsored</span>` under the username), so the badge element's
// entire text IS the label word. Anchoring here is what stops an organic
// caption ("this is not sponsored") or any comment ("is this sponsored?")
// from collapsing the post — see META-3 (audit 2026-07-13).
const IG_SPONSORED_LABEL_RE =
  /^(Sponsored|Sponsorizat|Patrocinado|Sponsorisé|Werbung|Реклама|Sponsorenne)$/i;
// IG's CURRENT feed ad unit (live-attested 2026-08-11, an atvrom.ro ad found
// via MCP inspection of a live feed): no <header>, no <time>, and the badge is a bare
// <span>Ad</span> in the actor row — the word "Sponsored" no longer appears.
// Matched case-sensitively and exactly ("Ad", never "ad"/"AD") to keep the
// caption false-positive surface at zero; the same anchoring rules (outside
// comment lists / chat overlays, entire trimmed text) apply.
const IG_AD_SHORT_LABEL = 'Ad';

/** Minimum gap between two full walks of a dialog that had no scroller. */
const SCROLLER_PROBE_RETRY_MS = 2000;

/**
 * True when the IG article is a sponsored post, detected DETERMINISTICALLY
 * from the platform's own structural badge: an element (`span`/`a`) whose
 * ENTIRE trimmed text is exactly a sponsored-label word, located OUTSIDE the
 * comment list and OUTSIDE any chat overlay. This is a superset of the old
 * `header span, h2 + div span, [role="button"] span` scan (all spans are now
 * considered) minus the whole-article `textContent` regex that produced
 * false positives on incidental caption/comment mentions (META-3).
 */
export function extractIsInstagramSponsored(article: Element): boolean {
  const labels = article.querySelectorAll('span, a');
  for (const el of labels) {
    // Skip comment rows — a viewer's comment mentioning "sponsored" is not an
    // ad marker.
    if (el.closest('ul, li')) continue;
    // Skip anything inside a private chat overlay.
    if (findChatOverlayAncestor(el)) continue;
    const t = el.textContent?.trim() ?? '';
    if (IG_SPONSORED_LABEL_RE.test(t) || t === IG_AD_SHORT_LABEL) return true;
  }
  return false;
}

/**
 * True when the URL pathname is an Instagram tile-grid surface: /explore/,
 * a profile grid (/<user>/), or a tagged grid (/<user>/tagged/). These
 * surfaces render a grid of preview tiles (each an `a[href*="/p/"]` or
 * `a[href*="/reel/"]` wrapping an `img[alt]`) with NO `<article>` wrapper, so
 * the article-based extractPosts loop sees zero posts on them. The tile-grid
 * extractor (`_extractTileGridSurface`) fills this gap.
 *
 * Excludes the surfaces that already have dedicated paths: /p/<id>/ permalink
 * (handled by _extractPermalinkSurface), /reel(s)/<id>/ (handled by
 * _extractReelSurface), /stories/, /direct/ (DMs), and the home feed (`/`,
 * which renders <article> posts).
 */
function isInstagramTileGridSurface(): boolean {
  const path = typeof window !== 'undefined' && window.location?.pathname || '/';
  if (path === '/' || path === '') return false;
  if (path.startsWith('/explore')) return true;
  // /p/<id>/ and /reel(s)/<id>/ permalinks and /stories/ have their own paths.
  if (/^\/(p|reel|reels|stories|direct)\b/.test(path)) return false;
  // Profile grid: /<user>/ or /<user>/tagged/ (handle = 1-30 chars,
  // alphanumeric + dot + underscore — IG's username grammar).
  if (/^\/[a-zA-Z0-9_.]{1,30}\/(tagged\/?)?$/.test(path)) return true;
  return false;
}

/**
 * IG auto-generates `img[alt]` values that are NOT real captions: the
 * accessibility description ("Photo by X on…", "May be an image of…", "Reel
 * by…"), placeholder text ("No photo description available"), and ML-derived
 * scene descriptions ("Blue text on a black background."). Scanning these
 * wastes classifier calls and risks over-flagging noise, so tiles whose alt
 * matches these stems are skipped — only a real human-authored caption emits
 * a tile post record.
 */
const IG_AUTO_ALT_REGEX = new RegExp(
  [
    '^Photo by\\b',
    '^Photo shared by\\b',
    '^Video by\\b',
    '^Reel by\\b',
    '^May be an? (image|illustration|graphic|drawing|cartoon|art|meme|close-up|closeup)\\b',
    '^No photo description available',
    '^.{0,80}\\bon a (black|white|grey|gray|blue|red|green|yellow|pink|purple|orange)\\b.{0,30}\\bbackground\\b',
  ].join('|'),
  'i',
);

/** True when the alt text is IG-auto-generated rather than a human caption. */
function isInstagramAutoAlt(alt: string): boolean {
  return IG_AUTO_ALT_REGEX.test(alt.trim());
}

/** Detect Instagram surface from URL pathname. */
function detectInstagramSurface(): InstagramSurfaceKind {
  const path = typeof window !== 'undefined' && window.location?.pathname || '/';
  // .B (hotfix) — IG uses BOTH `/reel/<id>/` (older permalink
  // shape) AND `/reels/<id>/` (newer feed-style Reels surface, observed live
  // in a browser session). The singular-only check missed the
  // plural /reels/ surface entirely → surfaceKind defaulted to 'instagram-
  // post' on the Reels feed → the .B Session 3 `_extractReelSurface`
  // fallback never fired because its gate is `surfaceKind === 'instagram-
  // reel'`. Now matches both URL shapes.
  if (path.includes('/reel/') || path.includes('/reels/')) return 'instagram-reel';
  if (path.includes('/stories/')) return 'instagram-story';
  // Default = post (covers /p/<id>/, profile feeds, explore — all post-shaped)
  return 'instagram-post';
}

/**
 * extract per-comment signals (likes, reply_count, verified).
 *
 * IG's comment DOM in the modal is approximately:
 *   <li>
 *     <a href="/handle/" role="link"><img alt="..."/></a>
 *     <div>
 *       <a href="/handle/"><span>handle</span></a>
 *       <svg aria-label="Verified"/>  (optional)
 *       <span>...comment text...</span>
 *       <button>Like</button> <span>N de aprecieri</span> ...
 *       <button>Vezi răspunsurile (N)</button>  (optional)
 *     </div>
 *   </li>
 */
// Cross-language "edit marker" regex (mirrors twitter.ts).
// Unicode-aware boundaries, not \b: see the note on FB_EDIT_MARKER_REGEX in
// facebook.ts (2026-09-19). \b is defined by \w, which excludes é and Cyrillic,
// so "Modifié" and "Изменено" were never read by any of the three copies of
// this list.
const IG_EDIT_MARKER_REGEX = /(?<!\p{L})\(?\s*(?:Edited|Editat|Editado|Modifi[éeè]e?|Bearbeitet|Modificato|Изменено)\s*\)?(?!\p{L})/iu;

/**
 * True when `pid` looks like a real IG post shortcode (e.g. `DExAmPle0a1`)
 * rather than a synthetic id generated by the adapter's fallbacks.
 * Excludes:
 *   • `ig-<timestamp>` produced by `_walkCommentsContainer`'s caller when
 *     `_extractPostId(article)` returns null
 *   • UUID v4 produced by `extractPosts`'s caption push when extraction
 *     fails (`crypto.randomUUID()`)
 * Real IG shortcodes are alphanumeric + `_` / `-`, typically 11 chars
 * (8-15 is the safe band). Used to gate the parent-post URL fallback
 * — building `instagram.com/p/<synthetic-id>/` would 404, so we fall
 * through to `location.href` instead.
 */
function isRealIgPostId(pid: string): boolean {
  if (pid.startsWith('ig-')) return false;
  if (/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i.test(pid)) return false;
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(pid)) return false;
  return true;
}

/**
 * True when `el` sits inside a comment row nested within `row`, rather than in
 * `row` itself.
 *
 * Instagram renders a comment's replies as `<li>` rows INSIDE the parent
 * comment's own `<li>`, and all four body pickers below take the longest text
 * span in the subtree. So a reply longer than its parent became the parent's
 * text: the parent's record carried the reply's words under the PARENT's
 * author, and the parent's `domRef` is the parent's body, so a verdict on those
 * words was applied to the wrong person's comment while the reply that earned
 * it stayed on screen. The reply is separately extracted with its own record,
 * so nothing is lost by stopping at the boundary. Found 2026-09-19.
 *
 * Walking up to `row` rather than asking `closest('li')` is deliberate: two of
 * the four pickers are handed a row that is not itself an `li`, and `closest`
 * would then answer with an ancestor outside the row entirely.
 */
function isInNestedRow(el: Element, row: Element): boolean {
  let node = el.parentElement;
  while (node && node !== row) {
    if (node.tagName === 'LI') return true;
    node = node.parentElement;
  }
  return false;
}

/**
 * True when an element's direct children are all text nodes (no nested
 * elements). Used by the permalink body picker to prefer leaf text spans
 * over outer wrappers. An outer wrapper containing `<a>@mention</a>` plus
 * an inner body span would otherwise be selected as the marker mount
 * target — and the 3-state toggle's findTextHolder would then swap the
 * @-mention link's text instead of the body, doubling the visible content.
 */
function isLeafTextNode(el: HTMLElement): boolean {
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType !== Node.TEXT_NODE) return false;
  }
  return true;
}

/**
 * The comment's chrome: what the platform drew around it, without the words the
 * person wrote and without the replies underneath them (2026-09-19).
 *
 * Three of the four signals below are text scans, and they were run over the
 * whole row's `textContent`. So the comment body was being read as metadata
 * about itself: "got 12 likes on my last post" set `likes: 12`, and
 * "view 3 replies from my lawyer" set `reply_count: 3`. Both ride into the
 * signed record. Facebook had exactly this and it was closed there on
 * 2026-09-19 with `commentChromeText`; Instagram was not carried, so this is
 * that rule arriving where it was already due.
 *
 * Instagram needs one thing Facebook did not: a parent comment's row CONTAINS
 * its replies, as nested rows, so subtracting the body alone would leave
 * somebody else's sentence in the string. The reply lists come out first, on a
 * detached clone so the live page is never touched.
 *
 * `isVerified` was right all along, because it asks an element
 * (`svg[aria-label*="erif"]`) rather than a blob of words.
 *
 * Both removals can only cost a missed signal, never an invented one: the
 * counters and badges Instagram draws sit outside the body and outside the
 * reply list, and a row whose body repeats itself loses a match rather than
 * gaining a false one.
 */
function instagramCommentChromeText(el: Element, bodyText: string): string {
  let all: string;
  try {
    const clone = el.cloneNode(true) as Element;
    clone.querySelectorAll('ul').forEach((replyList) => replyList.remove());
    all = clone.textContent ?? '';
  } catch {
    all = el.textContent ?? '';
  }
  const body = bodyText.trim();
  if (!body) return all;
  const at = all.indexOf(body);
  return at < 0 ? all : `${all.slice(0, at)} ${all.slice(at + body.length)}`;
}

/**
 * A reply-count/reply-toggle control's own label, exactly (never a
 * substring test — a genuine comment can mention "4 replies" mid-sentence).
 * "View all N replies" (en) / "Vezi răspunsurile (N)" (ro) /
 * "Antworten anzeigen" (de) / "Ver (todas las) respuestas" (es) /
 * "Ver (todas as) respostas" (pt), plus each language's own "Hide replies"
 * form (cold read COLD-READ-ee35374f-74c9ea6a-2026-09-28.md #2: the first
 * pass only covered en/ro/de and had no "Hide replies" form at all).
 */
const IG_REPLY_CONTROL_LABEL_RE = /^(?:Vezi\s+r[ăa]spunsurile|Ascunde\s+r[ăa]spunsurile|View(?:\s+all)?(?:\s+\d+)?\s+repl(?:y|ies)|Hide\s+repl(?:y|ies)|Antworten?\s+anzeigen|Antworten?\s+ausblenden|Ver\s+(?:todas\s+las\s+)?respuestas|Ocultar\s+respuestas|Ver\s+(?:todas\s+as\s+)?respostas|Ocultar\s+respostas)[\s(]*\d*\)?$/i;

function extractInstagramCommentSignals(li: Element, bodyText = ''): {
  likes?: number;
  reply_count?: number;
  isVerified: boolean;
  isEdited: boolean;
} {
  const text = instagramCommentChromeText(li, bodyText);

  // Likes: "N de aprecieri" (RO) / "N likes" (EN) / "Le gusta a N" (ES)
  // Match "N likes" / "N de aprecieri" / etc. Generous regex catches most localizations.
  const likesMatch = text.match(/(\d[\d.,\s]*[kmb]?)\s*(?:de\s+aprecieri|likes?|me\s+gusta|j[''']aimes?|gef[äa]llt)/i);
  const likes = likesMatch ? parseCountText(likesMatch[1]) : undefined;

  // Reply count: "Vezi răspunsurile (N)" / "View replies (N)" / "Show replies (N)"
  //
  // The parenthesised form is the only one this read, despite its own comment
  // naming "View N replies": that alternative consumes the digit and then the
  // pattern asks for another one after it, so "View 5 replies" matched nothing
  // (measured 2026-09-19 by driving it). Facebook's sibling has carried the
  // bare "N replies" form all along, and it is carried here now, second so the
  // parenthesised form still wins where both could match. It is only safe on a
  // string with the body and the replies taken out of it, which is what the
  // line above now hands over.
  const replyMatch = text.match(/(?:Vezi\s+r[ăa]spunsurile|View(?:\s+all)?(?:\s+\d+)?\s+repl(?:y|ies)|Antworten?\s+anzeigen)[\s(]*(\d+)/i)
    ?? text.match(/(\d+)\s+(?:r[ăa]spunsuri|repl(?:y|ies))/i)
    ?? text.match(/View(?:\s+all)?\s+(\d+)\s+repl(?:y|ies)/i);
  const reply_count = replyMatch ? parseInt(replyMatch[1], 10) : undefined;

  // Verified: svg with aria-label containing "erif" (Verified / Verificat / Verifizado / etc.)
  const isVerified = !!li.querySelector('svg[aria-label*="erif" i]');

  // edit-marker. IG places "Edited" near the timestamp area;
  // text-scan is sufficient at V1 since false-positive risk on legitimate
  // user-text mentioning "edited" is low + the flag only adds an EDITED
  // hint to the prompt + chain.
  const isEdited = IG_EDIT_MARKER_REGEX.test(text);

  return { likes, reply_count, isVerified, isEdited };
}

/**
 * Verified-author badge on the POST HEADER (not a comment). Reuses the
 * comment-path selector svg[aria-label*="erif" i], bounded to the post
 * author's header so a verified COMMENTER never mis-stamps the caption as a
 * page. Author anchor = the first /username/ link, the same element
 * _extractAuthor returns. Feeds deriveAccountType -> accountType:'page'.
 */
function extractInstagramPostVerified(article: Element): boolean {
  const links = article.querySelectorAll<HTMLAnchorElement>('a[href][role="link"]');
  for (const link of links) {
    const href = link.getAttribute('href') ?? '';
    if (/^\/[a-zA-Z0-9_.]{1,30}\/?$/.test(href)) {
      const scope =
        link.closest('header')
        ?? link.parentElement?.parentElement
        ?? link.parentElement
        ?? link;
      return !!scope.querySelector('svg[aria-label*="erif" i]');
    }
  }
  return false;
}

/**
 * Dom-master config for Instagram comment rows.
 *
 * Row unit: direct `<li>` children of a comment `<ul>`. The caller passes the
 * `<ul>` (from `article.querySelector('ul')` on the post path, or the reel
 * overlay detection on the Reels path) as the container scope.
 *
 * Tier order:
 *   1. `:scope > li` — direct LI children of the ul. Same as the legacy
 *      hand-rolled walk; fast path for current IG DOM.
 *
 * Shape anchors: if the structure rotates from `<ul><li>` to a different
 * shape (Meta obfuscates aggressively), the structural detector walks from
 * author markers (URL-pattern based — `/handle/` is dictated by IG's URL
 * routing) to the first text-marker-containing ancestor. The walk-up bounds
 * the row whether the wrapper is `<li>`, `<div>`, or whatever IG ships next.
 *
 * Content signals gate the rotation-diagnostic to fire only when the scanned
 * scope actually has content-shaped DOM (li elements or dir-auto spans).
 */
const INSTAGRAM_DOM_MASTER: DomMasterAdapter = {
  platform: 'instagram',
  commentRowTiers: [
    {
      name: 'ul-direct-li',
      selector: ':scope > li',
    },
  ],
  commentShapeAnchors: {
    authorMarkers: [
      'a[href^="/"][role="link"]',
      'a[href^="/"]',
    ],
    textMarkers: [
      'span[dir="auto"]',
      'span',
    ],
  },
  commentContentSignals: {
    contentSelectors: [
      'li',
      'span[dir="auto"]',
    ],
  },
};

// Top-level IG routes that match the /<handle> shape but are NOT profiles.
// Kept as a hard deny that page corroboration cannot override, NOT as the test
// for whether a path is a profile - see `instagramProfileOwner`.
const RESERVED_IG_PATHS: ReadonlySet<string> = new Set([
  'explore', 'reels', 'reel', 'p', 'stories', 'direct', 'accounts',
]);

/**
 * M123 - the profile owner a tile may be attributed to, or null.
 *
 * The tile grid used to read the owner straight off the URL: a single path
 * segment absent from `RESERVED_IG_PATHS` was assumed to be a username. That set
 * is an allowlist-by-omission over Instagram's single-segment routes, so any
 * route Meta adds, and every route the set never listed (saved, archive, topics,
 * tv, igtv, locations, favourites, inbox, settings, notifications,
 * your_activity, ai, about, legal, terms, qr, nametag, guide, s), was treated as
 * a person. Tiles on those pages are other people's posts, so the chain would
 * carry signed, immutable records naming an author who does not exist. Measured
 * on a real Chrome browser, 2026-08-24: `/reels/` satisfies the single-segment
 * predicate and is saved only by `reels` happening to be in the set.
 *
 * Inverted: the handle must be positively established by the page, so an
 * unknown future route fails safe and the set stops being something anyone has
 * to maintain against Meta's routing. The corroboration is the profile header's
 * own self-link - a profile page links to the account it is about. Site
 * navigation links to routes as well, so links inside a navigation landmark do
 * not count. When nothing corroborates, tiles stay `unknown`, which is what the
 * Explore grid already records and is honest: a tile carries no author of its
 * own.
 */
function instagramProfileOwner(): string | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  const match = window.location?.pathname?.match(/^\/([a-zA-Z0-9_.]{1,30})\/?$/);
  if (!match) return null;
  const handle = match[1];
  if (RESERVED_IG_PATHS.has(handle.toLowerCase())) return null;

  // The handle grammar above is [a-zA-Z0-9_.], so it cannot break out of the
  // quoted attribute selector.
  const selfLinks = document.querySelectorAll<HTMLAnchorElement>(
    `a[href="/${handle}/"], a[href="/${handle}"]`,
  );
  for (const link of selfLinks) {
    if (link.closest('nav, [role="navigation"]')) continue;
    if (findChatOverlayAncestor(link)) continue;
    return handle;
  }
  bumpCounter('m123ProfileOwnerUncorroborated');
  return null;
}

/**
 * M119 - which links may speak for THIS card's identity.
 *
 * `_extractAuthor`, `_extractPostId` and `_extractPostUrl` each scanned every
 * `a[href]` under the article and took the first match, from independent
 * scans. A preview comment row's author link, or a suggested post nested in
 * the same card, could therefore out-rank the card's own header and put one
 * card's author next to another card's shortcode. Two links may speak for the
 * card: those outside any comment list (`<ul>`, the shape both IG comment
 * walkers consume) and outside any nested `<article>`.
 *
 * Same filter shape M66 put on Twitter for body @-mentions and quote-tweet
 * author links (`src/content/platforms/twitter.ts`,
 * `resolveTwitterStatusIdentity`).
 */
function linkSpeaksForCard(link: Element, card: HTMLElement): boolean {
  if (link.closest('ul')) return false;
  const nearestArticle = link.closest('article');
  return !nearestArticle || nearestArticle === card;
}

/** One container's last trusted post id + body, for the M119 slot gate. */
interface IgSlotIdentity {
  id: string;
  bodyEl: HTMLElement;
  text: string;
}

export class InstagramAdapter implements PlatformAdapter {
  readonly platform = 'instagram' as const;

  // Modal-internal scroll trigger. The MutationObserver in interceptor.ts
  // catches lazy-load + tree mutations but does NOT fire on pure scroll
  // inside already-mounted DOM. When the user scrolls the IG post-modal's
  // inner scroll container past comments rendered on a prior pass, those
  // comments stay un-extracted because no MO event fires. The scroll
  // trigger wires a debounced passive listener on the dialog's scroller
  // that re-invokes _extractCommentsForArticle per article in the modal;
  // per-LI dedup via li.dataset.fwCommentSeen makes the re-invoke idempotent.
  //
  // One listener per scroll-container instance. WeakRef holds the container
  // so a closed/recycled modal lets the disposer fire on the next extract
  // pass, after which a fresh container can be discovered and wired.
  private _scrollContainerRef: WeakRef<HTMLElement> | null = null;
  private _disposeScrollTrigger: (() => void) | null = null;

  /**
   * M119 - last coherent identity + body per reused container.
   *
   * `_extractPermalinkSurface` and `_extractReelSurface` take the post id from
   * `window.location` and the body from a container Instagram REUSES across an
   * SPA route change. A read taken after the URL flips but before the container
   * re-renders signs the new shortcode with the previous post's author, which is
   * what the 2026-08-24 export recorded (see
   * `docs/audits/2026-08-23-objective-audit/browse-2026-08-24-export-analysis.md`,
   * Anomalies item 2).
   */
  private readonly _identityBySlot = new WeakMap<HTMLElement, IgSlotIdentity>();

  detectPlatform(): boolean {
    return window.location.hostname.includes('instagram.com');
  }

  getPostSelector(): string {
    return 'article';
  }

  extractPosts(nodes: NodeList): PostContent[] {
    const posts: PostContent[] = [];
    const feedSource = this._detectFeedSource();
    const surfaceKind = detectInstagramSurface();

    // Wire (or re-wire) the modal-scroll trigger so user-scroll inside an
    // already-mounted post dialog re-runs comment extraction. Cheap when the
    // listener is already attached to the same container; only does work on
    // the first call after a dialog opens or recycles.
    this._ensureScrollTrigger();

    nodes.forEach((node) => {
      if (!(node instanceof HTMLElement)) return;

      const articles = this._collectArticles(node);

      for (const article of articles) {
        // Direct-message dialogs can coexist with the public feed. Reject the
        // candidate before caption/comment reads or FW dedup stamps.
        if (findChatOverlayAncestor(article)) continue;

        // Per-record dedup. The article-level `fwProcessed` gate used to
        // short-circuit the entire article on re-entry — that locked out
        // lazy-loaded comments inside an already-processed article (Bug C
        // for IG, mirrors the TikTok fix). The caption is now gated by its
        // own `fwCaptionEmitted` flag and the comment-walker gates per <li>
        // via `fwCommentSeen`, so comments appended after the first scan
        // still flow through.
        const captionAlreadyEmitted = article.dataset.fwCaptionEmitted === 'true';

        const result = captionAlreadyEmitted ? null : this._extractTextElement(article);
        if (!result) {
          // No caption (or already emitted) — still walk comments. Some IG
          // modals render comments even when caption-extraction fails; and
          // lazy-loaded comments under an already-captioned article must
          // surface here.
          const pidFromArticle = this._extractPostId(article) ?? undefined;
          this._extractCommentsForArticle(article, posts, feedSource, surfaceKind, pidFromArticle);
          continue;
        }

        const { element, text } = result;

        const author = this._extractAuthor(article);
        const postId = this._extractPostId(article) ?? crypto.randomUUID();
        const sourceUrl = this._extractPostUrl(article);
        const hasCarousel = !!article.querySelector('button[aria-label*="ext"][aria-label*="carousel" i], [aria-label*="Next"][aria-label*="arousel"]');

        article.dataset.fwCaptionEmitted = 'true';

        // Sponsored/Ad detection on the caption record.
        const isSponsored = extractIsInstagramSponsored(article);
        const isVerifiedPost = extractInstagramPostVerified(article);

        // Caption record (the post itself).
        posts.push({
          id: postId,
          text,
          author,
          timestamp: new Date().toISOString(),
          platform: 'instagram',
          domRef: new WeakRef(element),
          feedSource,
          sourceUrl,
          kind: surfaceKind === 'instagram-reel' ? 'video' : 'post',
          parentVideoId: postId,
          // The card beyond the caption: a collab's second author, the audio line, a repost line.
          card: cardForRecord(article, 'instagram'),
          platform_specific: {
            platform: 'instagram',
            surfaceKind,
            hasCarousel,
            isVerified: isVerifiedPost || undefined,
          },
          is_sponsored: isSponsored || undefined,
        });

        // comment records.
        this._extractCommentsForArticle(article, posts, feedSource, surfaceKind, postId);
      }
    });

    // fallback for IG /reels surface where IG dropped
    // the <article> wrapper around 2026-05. Live MCP DOM probe confirmed:
    // `article` matches 0 elements on /reels/<id>/ even when the reel is
    // fully rendered + comments visible. The Reels surface is video-first
    // (similar to TikTok For You) — it lives under `main > div` containing
    // a <video> element. This block fires only when:
    //   1. We're on the /reels surface (URL pathname check)
    //   2. The article-based loop didn't extract anything for this surface
    // Caption + handle + post-id are derived from URL + DOM scan.
    if (surfaceKind === 'instagram-reel' && posts.length === 0) {
      this._extractReelSurface(posts, feedSource);
    }

    // Fallback for IG /p/<id>/ permalink surface where IG dropped the
    // <article> wrapper. The post + its comments are rendered as a stack of
    // <div>/<span> with rotated atomic Meta class names — no semantic
    // markers (no article, no role=dialog, no ul[role=presentation]). The
    // stable structural anchor is the per-comment timestamp link
    // `a[href*="/c/"]`: each top-level comment has exactly one such link,
    // and walking up from it stops at a parent that contains multiple /c/
    // links (the comment list). That stopping node IS the comment row.
    if (
      surfaceKind === 'instagram-post' &&
      posts.length === 0 &&
      /^\/p\/[A-Za-z0-9_-]+/.test(window.location.pathname)
    ) {
      this._extractPermalinkSurface(posts, feedSource);
    }

    // Tile-grid surfaces (/explore/, profile /<user>/, /<user>/tagged/) render
    // a grid of preview tiles with NO <article> wrapper, so the article loop
    // above extracts nothing. Each tile is an `a[href*="/p/"]` (or /reel/)
    // wrapping an `img[alt]` whose alt is the post caption (IG auto-alts
    // filtered out). One post record per tile; comments are not on the grid
    // (they live in the /p/<id>/ modal, which _extractPermalinkSurface and the
    // article path already cover — untouched here).
    if (posts.length === 0 && isInstagramTileGridSurface()) {
      this._extractTileGridSurface(posts, feedSource);
    }

    return posts;
  }

  /**
   * IG tile-grid surface extractor (/explore/, profile grid, /tagged/).
   *
   * Each tile is a link to a post/reel permalink wrapping a thumbnail image
   * whose `alt` carries the post caption. Emits one PostContent per tile:
   *   • text   = the `img[alt]` caption (IG auto-generated alts filtered out)
   *   • kind   = 'video' for /reel/ tiles, 'post' otherwise
   *   • id/url = the /p/<id>/ (or /reel/<id>/) permalink from the tile href
   *
   * Per-tile dedup via `dataset.fwTileSeen` on the link element so the
   * incrementally-loaded grid (Explore appends tiles as the user scrolls; the
   * interceptor MutationObserver + 3s rescan re-invoke this extractor) re-emits
   * each tile exactly once. The extractor itself is stateless beyond that
   * stamp — it just matches whatever tiles are present whenever called.
   */
  private _extractTileGridSurface(out: PostContent[], feedSource: FeedSource): void {
    const tiles = document.querySelectorAll<HTMLAnchorElement>(
      'a[href*="/p/"], a[href*="/reel/"]',
    );

    // Tiles carry no author in their own DOM, but on a PROFILE grid the page
    // owner IS the author of every tile (mirrors the TikTok profile fix,
    // 2026-06-12). M123: that owner must be corroborated by the page, never
    // assumed from the URL. Explore grids, and any page that does not name its
    // own account, stay 'unknown' - honest, the tile really doesn't say.
    // Resolved once per pass rather than per tile; the page cannot change
    // owner mid-loop.
    const tileAuthor = instagramProfileOwner() ?? 'unknown';

    for (const tile of tiles) {
      if (findChatOverlayAncestor(tile)) continue;
      if (tile.dataset.fwTileSeen === 'true') continue;

      const href = tile.getAttribute('href') ?? '';
      const postMatch = href.match(/\/p\/([A-Za-z0-9_-]+)/);
      const reelMatch = href.match(/\/reel\/([A-Za-z0-9_-]+)/);
      const match = postMatch ?? reelMatch;
      if (!match) continue;
      const postId = match[1];
      const isReel = !postMatch && !!reelMatch;

      // Caption from the tile's descendant thumbnail alt. A tile with no
      // img[alt], or whose alt is an IG auto-generated description, is skipped
      // (no human caption to classify) — over-flag safety per the auto-alt
      // filter. Stamp it seen so the next pass doesn't re-examine it.
      const img = tile.querySelector<HTMLImageElement>('img[alt]');
      const alt = img?.getAttribute('alt')?.trim() ?? '';
      if (!alt || isInstagramAutoAlt(alt)) {
        tile.dataset.fwTileSeen = 'true';
        continue;
      }

      const path = isReel ? `reel/${postId}` : `p/${postId}`;
      tile.dataset.fwTileSeen = 'true';

      out.push({
        id: postId,
        text: alt,
        author: tileAuthor,
        timestamp: new Date().toISOString(),
        platform: 'instagram',
        domRef: new WeakRef(img ?? tile),
        feedSource,
        sourceUrl: `https://www.instagram.com/${path}/`,
        kind: isReel ? 'video' : 'post',
        parentVideoId: postId,
        // Q53 (W56): the tile path skipped sponsored detection while the
        // article and permalink paths run it; same proven extractor.
        is_sponsored: extractIsInstagramSponsored(tile) || undefined,
        platform_specific: {
          platform: 'instagram',
          surfaceKind: isReel ? 'instagram-reel' : 'instagram-post',
          hasCarousel: false,
        },
      });
    }
  }

  /**
   * IG /reels surface extractor. The Reels feed has no
   * <article> wrapper post-2026-05 DOM rotation. Each reel is a `main > div`
   * containing a <video>. URL is /reels/<reel-id>/ and rotates as user
   * scrolls. We extract the ACTIVE reel (the one whose URL matches the
   * current location).
   *
   * Minimal V1 scope: caption record only. Comments-on-Reels are extracted
   * by the existing `_extractCommentsForArticle` logic when the comment
   * overlay opens; that path uses `<ul>` lookup which still works on Reels
   * comment modal. The article-based extraction skips Reels entirely
   * because there's no <article> wrapper, so this method fills the gap.
   */
  private _extractReelSurface(out: PostContent[], feedSource: FeedSource): void {
    const main = document.querySelector('main');
    if (!main) return;

    // Match URL post-id: /reels/<id>/ or /reel/<id>/. Active reel = current URL.
    const urlMatch = window.location.pathname.match(/\/reels?\/([A-Za-z0-9_-]+)/);
    if (!urlMatch) return;
    const postId = urlMatch[1];

    // Find the active reel container — direct child of main containing a video.
    let reelContainer: HTMLElement | null = null;
    for (const child of Array.from(main.children)) {
      if (!(child instanceof HTMLElement)) continue;
      if (findChatOverlayAncestor(child)) continue;
      if (child.querySelector('video')) {
        reelContainer = child;
        break;
      }
    }
    if (!reelContainer) return;
    if (reelContainer.dataset.fwReelProcessed === postId) return;

    // Caption — find the longest non-button, non-link span[dir="auto"] inside
    // the reel container. IG Reels caption is rendered as overlay below the
    // video. Skip spans inside the navigation toolbar (top-left "For you" /
    // "Following" tabs concatenate text with the caption).
    let bestText = '';
    let bestEl: HTMLElement | null = null;
    const spans = reelContainer.querySelectorAll<HTMLElement>('span[dir="auto"]');
    for (const s of spans) {
      if (s.closest('button')) continue;
      if (s.closest('a')) continue;
      if (s.closest('[role="toolbar"]')) continue;
      if (s.closest('header')) continue;
      const t = s.textContent?.trim() ?? '';
      if (t.length < 5) continue;
      if (t === 'Pentru tine' || t === 'For you' || t === 'Urmăriri' || t === 'Following') continue;
      if (t.length > bestText.length) {
        bestText = t;
        bestEl = s;
      }
    }
    if (!bestEl || bestText.length < 5) {
      // The outcome gate for a reel caption: below this the reel is not
      // recorded at all, so a real short caption left no trace anywhere. The
      // candidate loop above is a different thing and is not counted: a short
      // span there is simply not the longest, not a dropped item.
      // Counted, not changed (2026-09-19). The floor stays; the silence stops.
      if (bestText.length > 0) bumpCounter('shortDrop.instagram.reelCaption');
      return;
    }

    // Author handle — first profile-link in the reel container. IG Reels
    // displays handle below the video as `<a href="/<handle>/">` next to the
    // Follow/Urmărește button.
    const author = (() => {
      const links = reelContainer.querySelectorAll<HTMLAnchorElement>('a[href]');
      for (const link of links) {
        const href = link.getAttribute('href') ?? '';
        if (/^\/[a-zA-Z0-9_.]{1,30}\/?$/.test(href)) {
          const text = link.textContent?.trim() ?? '';
          if (text && text.length > 0 && text.length < 40) return text;
          // Fall back to extracting from href when text is empty (icon-only).
          const handle = href.replace(/^\/|\/$/g, '');
          if (handle) return handle;
        }
      }
      return 'unknown';
    })();

    // M119 - same URL-id / DOM-body split as the /p/ permalink path: the reel
    // container is reused while the URL rotates on scroll, so a read taken
    // between the two would sign the new reel id with the previous reel's
    // author. Refuse it; the next read, once the container catches up, records
    // the reel honestly.
    if (this._containerFellBehind(reelContainer, postId, bestEl, bestText)) return;
    this._identityBySlot.set(reelContainer, { id: postId, bodyEl: bestEl, text: bestText });

    reelContainer.dataset.fwReelProcessed = postId;

    out.push({
      id: postId,
      text: bestText,
      author,
      timestamp: new Date().toISOString(),
      platform: 'instagram',
      domRef: new WeakRef(bestEl),
      feedSource,
      sourceUrl: `https://www.instagram.com/reels/${postId}/`,
      kind: 'video',
      parentVideoId: postId,
      // Q53 (W56): the reels feed is where sponsored reels actually appear
      // and it skipped detection entirely; same proven extractor as the
      // article and permalink paths.
      is_sponsored: extractIsInstagramSponsored(reelContainer) || undefined,
      // The card beyond the caption: the audio line, a collab's second author.
      card: cardForRecord(reelContainer, 'instagram'),
      platform_specific: {
        platform: 'instagram',
        surfaceKind: 'instagram-reel',
        hasCarousel: false,
      },
    });

    // Reels comment-overlay extraction. The overlay `<ul>` lives under `main`
    // outside the reel container's subtree, so the article-path lookup misses
    // it — `_extractCommentsForReel` scans `main` for the overlay shape and
    // delegates to the shared `_walkCommentsContainer` walker.
    this._extractCommentsForReel(main, postId, feedSource, out);
  }

  // ── permalink helpers ─────────────────────────────────────────────────────

  /**
   * IG /p/<id>/ permalink surface extractor. The permalink layout has no
   * `<article>` wrapper, no `[role="dialog"]`, no `ul[role="presentation"]`
   * — caption + comments live in a stack of obfuscated `<div>` / `<span>`
   * with rotated Meta atomic class names. Stable structural anchor: each
   * top-level comment carries an `a[href*="/c/"]` timestamp link. Walking
   * up from such a link until the ancestor contains more than one `/c/`
   * link yields the row container.
   *
   * Caption + comment-author handles use the same span/link conventions as
   * the home-feed article path (`<span dir="auto">` for body text,
   * `a[href^="/<handle>/"]` for username). Body picker prefers LEAF text
   * spans (children are all text nodes) so the marker toggle's
   * findTextHolder swaps the actual body content rather than an outer
   * wrapper's `@`-mention sibling.
   */
  private _extractPermalinkSurface(out: PostContent[], feedSource: FeedSource): void {
    const main = document.querySelector('main');
    if (!main) return;

    const urlMatch = window.location.pathname.match(/^\/p\/([A-Za-z0-9_-]+)/);
    if (!urlMatch) return;
    const postId = urlMatch[1];

    // Collect comment rows by walking up from each /c/ link.
    const cLinks = Array.from(
      main.querySelectorAll<HTMLAnchorElement>('a[href*="/c/"]'),
    ).filter(link => !findChatOverlayAncestor(link));
    const rowToTimestamp = new Map<HTMLElement, HTMLAnchorElement>();
    for (const link of cLinks) {
      let cur: HTMLElement = link;
      let hops = 0;
      while (cur.parentElement && hops < 16) {
        const parent = cur.parentElement;
        if (parent.querySelectorAll('a[href*="/c/"]').length > 1) {
          if (!rowToTimestamp.has(cur)) rowToTimestamp.set(cur, link);
          break;
        }
        cur = parent;
        hops++;
      }
    }

    const rowSet = new Set(rowToTimestamp.keys());
    const isInsideRow = (el: HTMLElement): boolean => {
      let cur: HTMLElement | null = el;
      while (cur) {
        if (rowSet.has(cur)) return true;
        cur = cur.parentElement;
      }
      return false;
    };

    // Caption: the longest LEAF body-shaped span/h1 in main that's not in a
    // comment row and not in a button/link. Leaf-only filter for the same
    // reason as the comment-body picker — outer wrappers cause toggle swap
    // doubling.
    let captionText = '';
    let captionEl: HTMLElement | null = null;
    const captionCandidates = main.querySelectorAll<HTMLElement>(
      'span[dir="auto"], h1',
    );
    for (const s of captionCandidates) {
      if (findChatOverlayAncestor(s)) continue;
      if (s.closest('button')) continue;
      if (s.closest('a')) continue;
      if (isInsideRow(s)) continue;
      if (!isLeafTextNode(s)) continue;
      const t = s.textContent?.trim() ?? '';
      if (t.length < 5) continue;
      if (t === 'Pentru tine' || t === 'For you' || t === 'Urmăriri' || t === 'Following') continue;
      if (t.length > captionText.length) {
        captionText = t;
        captionEl = s;
      }
    }

    const mainEl = main as HTMLElement;
    const captionAlreadyEmitted = mainEl.dataset.fwPermalinkPostId === postId;

    // M119 - the post id here comes from the URL while the caption, the author
    // and the comment rows come from a <main> that Instagram reuses across an
    // SPA route change. A read taken after the route flips but before <main>
    // re-renders signs the new shortcode with the previous post's author, which
    // is what the 2026-08-24 export recorded. Every mounted comment permalink
    // carries its own post's shortcode (`/p/<code>/c/<id>/`), so when they all
    // name a different post than the URL, <main> still belongs to that post and
    // the URL id cannot be trusted for anything read out of it.
    const mountedShortcodes = new Set<string>();
    for (const link of cLinks) {
      const owner = (link.getAttribute('href') ?? '').match(/\/p\/([A-Za-z0-9_-]+)\/c\//);
      if (owner) mountedShortcodes.add(owner[1]);
    }
    const untrusted = mountedShortcodes.size > 0 && !mountedShortcodes.has(postId);
    if (untrusted) bumpCounter('m119PermalinkCommentsNameAnotherPost');

    // Which post the comment rows hang off: the URL's shortcode, unless the
    // mounted permalinks disagree, in which case the DOM's own answer when it
    // is unambiguous and nothing when it is not. Never a shortcode this read
    // cannot vouch for.
    const commentOwnerId: string | undefined = untrusted
      ? (mountedShortcodes.size === 1 ? Array.from(mountedShortcodes)[0] : undefined)
      : postId;

    if (!captionAlreadyEmitted && captionEl && captionText.length >= 5) {
      let author = 'unknown';
      const headerLinks = main.querySelectorAll<HTMLAnchorElement>('a[href^="/"]');
      for (const link of headerLinks) {
        if (findChatOverlayAncestor(link)) continue;
        if (isInsideRow(link)) continue;
        const href = link.getAttribute('href') ?? '';
        if (!/^\/[a-zA-Z0-9_.]{1,30}\/?$/.test(href)) continue;
        const text = link.textContent?.trim() ?? '';
        if (text && text.length > 0 && text.length < 40) { author = text; break; }
        const handle = href.replace(/^\/|\/$/g, '');
        if (handle) { author = handle; break; }
      }

      // `fellBehind`: this body was already recorded under a different id, so it
      // is in the chain honestly and there is nothing new to protect. Emit
      // nothing and leave `fwPermalinkPostId` unset so the real read still lands
      // once <main> catches up. `untrusted`: nothing has recorded this body yet,
      // so it stays protectable under a synthetic local id with no named author,
      // no external URL and no parent binding. Never guess an author.
      const fellBehind = this._containerFellBehind(mainEl, postId, captionEl, captionText);

      if (!fellBehind) {
        const isSponsored = extractIsInstagramSponsored(mainEl);

        out.push({
          id: untrusted ? crypto.randomUUID() : postId,
          text: captionText,
          author: untrusted ? 'unknown' : author,
          timestamp: new Date().toISOString(),
          platform: 'instagram',
          domRef: new WeakRef(captionEl),
          feedSource,
          sourceUrl: untrusted ? '' : `https://www.instagram.com/p/${postId}/`,
          kind: 'post',
          parentVideoId: untrusted ? undefined : postId,
          // The card beyond the caption: a collab's second author, the audio line, a repost line.
          card: cardForRecord(mainEl, 'instagram'),
          platform_specific: {
            platform: 'instagram',
            surfaceKind: 'instagram-post',
            hasCarousel: false,
          },
          is_sponsored: isSponsored || undefined,
        });
        if (!untrusted) {
          this._identityBySlot.set(mainEl, { id: postId, bodyEl: captionEl, text: captionText });
          mainEl.dataset.fwPermalinkPostId = postId;
        }
      }
    }

    // Emit comment records.
    const ts = new Date().toISOString();
    for (const [row, cLink] of rowToTimestamp) {
      if (row.dataset.fwCommentSeen === 'true') continue;

      // Collect candidate author handles FIRST so the body picker can
      // reject spans whose text matches a known handle. IG renders the
      // comment-author handle both inside the clickable <a> link AND as
      // a separate non-<a>-wrapped leaf span on the new /p/<id>/ layout —
      // the body picker's "longest qualifying leaf span" used to select
      // the handle span because actual comment bodies often contain
      // nested @-mentions / emoji-<img> elements and fail isLeafTextNode.
      // Chain forensics surfaced multiple records on a public permalink
      // where originalText was exactly the comment-author handle
      // (for example, synthetic_commenter_a / synthetic_commenter_b) — protection
      // ran on the username instead of the actual comment text.
      const rowAuthorHandles = new Set<string>();
      let cmtAuthor = 'unknown';
      const authorLinks = row.querySelectorAll<HTMLAnchorElement>('a[href^="/"]');
      for (const link of authorLinks) {
        const href = link.getAttribute('href') ?? '';
        if (href.includes('/c/')) continue;
        if (!/^\/[a-zA-Z0-9_.]{1,30}\/?$/.test(href)) continue;
        const text = link.textContent?.trim() ?? '';
        if (text && text.length > 0 && text.length < 40) {
          rowAuthorHandles.add(text.toLowerCase());
          if (cmtAuthor === 'unknown') cmtAuthor = text;
        }
        const handle = href.replace(/^\/|\/$/g, '');
        if (handle) {
          rowAuthorHandles.add(handle.toLowerCase());
          if (cmtAuthor === 'unknown') cmtAuthor = handle;
        }
      }

      // Body text: longest LEAF text span (children are text nodes only)
      // inside the row, excluding chrome ("Reply", "N likes", username
      // link, timestamp link). Outer wrappers that contain both an
      // `<a>@mention</a>` and an inner body span are skipped — they cause
      // text-swap doubling at marker-toggle time because the toggle's
      // findTextHolder picks the @-link as the first text-bearing child
      // and replaces its text, leaving the inner body span untouched.
      const spans = Array.from(row.querySelectorAll<HTMLElement>('span'));
      let bodyText = '';
      let bodyEl: HTMLElement | null = null;
      for (const s of spans) {
        if (s.closest('button')) continue;
        if (s.closest('a')) continue;
        if (isInNestedRow(s, row)) continue;
        if (!isLeafTextNode(s)) continue;
        const t = s.textContent?.trim() ?? '';
        if (t.length < 2) continue;
        if (/^\d+\s+(likes?|aprecier|j'aime|me gusta)/i.test(t)) continue;
        if (/^(Reply|Răspunde|Responder|Répondre)$/i.test(t)) continue;
        if (rowAuthorHandles.has(t.toLowerCase())) continue;
        if (t.length > bodyText.length) {
          bodyText = t;
          bodyEl = s;
        }
      }
      if (bodyText.length < 2) {
        // Counted, not changed (2026-09-19). The floor stays; what stops is
        // the silence. See youtube.ts and facebook.ts for the same decision,
        // and the findings entry for why no number was invented here.
        if (bodyText.length > 0) bumpCounter('shortDrop.instagram.comment');
        continue;
      }

      const cHref = cLink.getAttribute('href') ?? '';
      const cMatch = cHref.match(/\/c\/(\d+)/);
      // Fallback when the /c/ href carries no numeric id (unseen to date):
      // a per-pass `out.length` restarts at 0 while the fwCommentSeen row
      // stamps persist, so a row found on a later lazy-load pass would reuse
      // an earlier pass's id and downstream id-level dedup would drop it (the
      // D3 collision class). `cLink` IS this comment's own /c/ permalink, so
      // its href path is a stable per-comment key across passes — derive the
      // fallback from it rather than a pass-relative counter.
      const commentId = cMatch?.[1]
        ?? `${postId}-${(cHref.split('?')[0] || '').replace(/[^\w-]/g, '') || out.length}`;

      // Tag the row with `data-fw-comment-row="true"` so the viewport
      // tracker's SHELL_SELECTOR can find it via the universal self-tag
      // (IG permalink rows have no stable class or role identifier — the
      // ancestor walk over `/c/` links is the only structural locator).
      row.dataset.fwCommentRow = 'true';

      out.push({
        id: `ig-cmt-${commentId}`,
        text: bodyText,
        author: cmtAuthor,
        timestamp: ts,
        platform: 'instagram',
        // Anchor domRef on the body span so the marker mounts inline next
        // to the visible text (matching X / FB / TT). The SHELL_SELECTOR
        // walk picks up the row via the `data-fw-comment-row` self-tag so
        // viewport-tracker still clears `fwCommentSeen` on re-entry.
        domRef: new WeakRef(bodyEl ?? row),
        feedSource,
        sourceUrl: cLink.href,
        // anchorUrl — `cLink` is the row's `/c/<id>` timestamp link, which IS
        // the comment's own permalink. Reuses the same href already read for
        // sourceUrl; no new selector.
        anchorUrl: cLink.href,
        kind: 'top-comment',
        depth: 1,
        parent_id: commentOwnerId,
        parentVideoId: commentOwnerId,
        platform_specific: {
          platform: 'instagram',
          surfaceKind: 'instagram-post',
          commentLevel: 1,
        },
      });
      row.dataset.fwCommentSeen = 'true';
    }
  }

  /**
   * Detect the open Reels comment overlay and emit per-comment records.
   *
   * Two overlay shapes exist:
   *   1. `<ul>` with `<li>` children — legacy shape, handled by
   *      `_walkCommentsContainer`.
   *   2. `[role="dialog"]` containing a `<div>` container whose direct
   *      `<div>` children each carry a `<time>` element + profile link +
   *      `span[dir="auto"]` body text. Observed live 2026-06-28 on
   *      `/reels/<id>/` — IG dropped `<ul>/<li>` entirely for a pure
   *      div-based layout. Handled by `_walkReelsDialogComments`.
   *
   * When neither shape is found the method is a no-op (overlay closed).
   */
  private _extractCommentsForReel(
    main: Element,
    reelId: string,
    feedSource: FeedSource,
    out: PostContent[],
  ): void {
    // Path 1: legacy <ul>-based overlay.
    const candidateUls = main.querySelectorAll('ul');
    let overlayUl: Element | null = null;
    for (const ul of candidateUls) {
      if (findChatOverlayAncestor(ul)) continue;
      if (ul.closest('article')) continue;
      const lis = ul.querySelectorAll(':scope > li');
      if (lis.length === 0) continue;
      let hasCommentShape = false;
      for (const li of lis) {
        const hasAnchor = !!li.querySelector('a[href^="/"]');
        const hasText = Array.from(li.querySelectorAll('span')).some(
          (s) => !s.closest('button') && !s.closest('a') && (s.textContent?.trim().length ?? 0) >= 2,
        );
        if (hasAnchor && hasText) {
          hasCommentShape = true;
          break;
        }
      }
      if (hasCommentShape) {
        overlayUl = ul;
        break;
      }
    }
    if (overlayUl) {
      this._walkCommentsContainer(overlayUl, reelId, 'instagram-reel', feedSource, out);
      return;
    }

    // Path 2: dialog-based div overlay (2026-06 IG rotation).
    this._walkReelsDialogComments(reelId, feedSource, out);
  }

  /**
   * Walk the div-based Reels comment dialog overlay.
   *
   * Structure (observed 2026-06-28):
   *   [role="dialog"]
   *     └ div (wrapper)
   *       └ div (comment-list container — ≥5 direct div children)
   *         ├ div (comment row: <img> avatar + <a href="/<handle>/"> +
   *         │       <span dir="auto"> body + <time> + likes/reply)
   *         ├ div ...
   *         └ div ...
   *
   * Anchor: `<time>` elements inside the dialog. Walk up from each `<time>`
   * to find the container whose direct children each hold one comment.
   * Row identification: the div whose parent has ≥5 children (the comment
   * list). Body text: longest leaf `span[dir="auto"]` not inside an anchor
   * or button, not matching the author handle, not matching likes/reply
   * chrome patterns.
   */
  private _walkReelsDialogComments(
    reelId: string,
    feedSource: FeedSource,
    out: PostContent[],
  ): void {
    const dialog = Array.from(
      document.querySelectorAll<HTMLElement>('[role="dialog"]'),
    ).find(candidate => !findChatOverlayAncestor(candidate)) ?? null;
    if (!dialog) return;

    const times = dialog.querySelectorAll('time');
    if (times.length === 0) return;

    // Find the comment-list container: the ancestor div with ≥5 children
    // that contains the most <time>-bearing rows.
    const containerVotes = new Map<HTMLElement, number>();
    for (const time of times) {
      let cur: HTMLElement | null = time as HTMLElement;
      let hops = 0;
      while (cur && cur.parentElement && cur.parentElement !== dialog && hops < 15) {
        const parent: HTMLElement = cur.parentElement;
        if (parent.children.length >= 5) {
          containerVotes.set(parent, (containerVotes.get(parent) ?? 0) + 1);
          break;
        }
        cur = parent;
        hops++;
      }
    }
    let container: HTMLElement | null = null;
    let bestVotes = 0;
    for (const [el, votes] of containerVotes) {
      if (votes > bestVotes) { bestVotes = votes; container = el; }
    }
    if (!container || bestVotes < 2) return;

    const ts = new Date().toISOString();
    const reelSourceUrl = `https://www.instagram.com/reels/${reelId}/`;
    // Persistent counter across re-walks (same fwCommentNextIdx idiom as
    // `_walkCommentsContainer`): the reel container remounts (losing
    // `fwReelProcessed`) while this dialog — and the `fwCommentSeen` stamps
    // on its rows — persists, so a per-call index restarting at 0 would
    // re-mint ids already used by earlier rows for the lazy-loaded ones.
    // Lives on the comment-list container so counter and row stamps share
    // a lifetime.
    let idx = parseInt(container.dataset.fwCommentNextIdx ?? '0', 10);

    for (const row of Array.from(container.children)) {
      if (!(row instanceof HTMLElement)) continue;
      if (row.dataset.fwCommentSeen === 'true') continue;
      if (!row.querySelector('time')) continue;

      // Author: first profile-pattern link in the row.
      const authorHandles = new Set<string>();
      let author = 'unknown';
      const profileLinks = row.querySelectorAll<HTMLAnchorElement>('a[href^="/"]');
      for (const link of profileLinks) {
        const href = link.getAttribute('href') ?? '';
        if (!/^\/[a-zA-Z0-9_.]{1,30}\/?$/.test(href)) continue;
        const handle = href.replace(/^\/|\/$/g, '');
        if (handle) {
          authorHandles.add(handle.toLowerCase());
          if (author === 'unknown') author = handle;
        }
      }

      // Body text: longest leaf span[dir="auto"] not in anchor/button,
      // not matching author handle, not matching likes/reply chrome.
      const spans = Array.from(row.querySelectorAll<HTMLElement>('span[dir="auto"]'));
      let bodyText = '';
      let bodyEl: HTMLElement | null = null;
      for (const s of spans) {
        if (s.closest('button')) continue;
        if (s.closest('a')) continue;
        if (isInNestedRow(s, row)) continue;
        if (!isLeafTextNode(s)) continue;
        const t = s.textContent?.trim() ?? '';
        if (t.length < 2) continue;
        if (authorHandles.has(t.toLowerCase())) continue;
        if (/^\d+\s*(likes?|aprecier|j'aime|me gusta)/i.test(t)) continue;
        if (/^(Reply|Răspunde|Responder|Répondre|See translation|Vezi traducerea)$/i.test(t)) continue;
        if (/^\d+[dhwms]?$/i.test(t)) continue;
        if (t.length > bodyText.length) {
          bodyText = t;
          bodyEl = s;
        }
      }
      if (bodyText.length < 2) {
        // Counted, not changed (2026-09-19). The floor stays; what stops is
        // the silence. See youtube.ts and facebook.ts for the same decision,
        // and the findings entry for why no number was invented here.
        if (bodyText.length > 0) bumpCounter('shortDrop.instagram.comment');
        continue;
      }

      const signals = extractInstagramCommentSignals(row, bodyText);

      row.dataset.fwCommentSeen = 'true';
      row.dataset.fwCommentRow = 'true';

      const commentId = `ig-cmt-${reelId}-${idx}`;
      out.push({
        id: commentId,
        text: bodyText,
        author: author !== 'unknown' ? `@${author}` : 'unknown',
        timestamp: ts,
        platform: 'instagram',
        domRef: new WeakRef(bodyEl ?? row),
        feedSource,
        sourceUrl: reelSourceUrl,
        kind: 'top-comment',
        depth: 1,
        parent_id: reelId,
        parentVideoId: reelId,
        platform_specific: {
          platform: 'instagram',
          surfaceKind: 'instagram-reel' as InstagramSurfaceKind,
          commentLevel: 1,
          metrics: {
            likes: signals.likes,
            reply_count: signals.reply_count,
          },
          isVerified: signals.isVerified,
          isEdited: signals.isEdited,
        },
      });
      idx++;
    }
    // Persist the counter so the next walk continues from where this one
    // left off, keeping `ig-cmt-<reelId>-<idx>` chain IDs unique.
    container.dataset.fwCommentNextIdx = String(idx);
  }

  /**
   * Extract visible top-level comments from an IG article container.
   *
   * Defensive: when the article doesn't contain a comment list at all (caption-
   * only feed view, no modal open), this is a no-op. The same article re-fires
   * extraction on every pass because the article-level gate is now
   * `fwCaptionEmitted` (caption-only) — the comment-walker re-runs and per-LI
   * `fwCommentSeen` keeps comments single-emit while letting lazy-loaded
   * additions surface.
   */
  private _extractCommentsForArticle(
    article: HTMLElement,
    out: PostContent[],
    feedSource: FeedSource,
    surfaceKind: InstagramSurfaceKind,
    parentPostId?: string,
  ): void {
    const ul = article.querySelector('ul');
    if (!ul) return;

    // On /p/<id>/ URLs, skip the article-path comment walker when the
    // article's first <ul> has no direct <li> children. 2026-05-23 chain
    // forensics showed the new IG /p/ layout puts a non-comment <ul>
    // inside the article (suggestions / nav / liked-by row with <div>
    // wrappers, not <li>) — dom-master tier-1 + shape-detector both
    // correctly return zero on that scope, which fires the rotation
    // alert on every visit. Comments live outside the article and are
    // handled by _extractPermalinkSurface later in extractPosts. Pre-
    // rotation /p/ layouts that still have `<ul><li>...</li></ul>`
    // comment shape walk normally — they pass the :scope > li gate.
    if (
      typeof window !== 'undefined'
      && /^\/p\/[A-Za-z0-9_-]+/.test(window.location?.pathname ?? '')
      && ul.querySelector(':scope > li') === null
    ) {
      return;
    }

    const pid = parentPostId ?? this._extractPostId(article) ?? `ig-${Date.now()}`;
    this._walkCommentsContainer(ul, pid, surfaceKind, feedSource, out);
  }

  /**
   * Shared comment-walker. Consumes a `<ul>` element, drops the first `<li>`
   * (which IG renders as the caption row in both article and Reels overlay
   * shapes), and emits PostContent records for each remaining comment LI.
   */
  private _walkCommentsContainer(
    ul: Element,
    parentPostId: string,
    surfaceKind: InstagramSurfaceKind,
    feedSource: FeedSource,
    out: PostContent[],
  ): void {
    // Universal DOM Master path: tier 1 catches `:scope > li`, shape detector
    // + rotation diagnostic provide the resilient fallback when IG rotates
    // away from `<ul><li>`. Replaces the bespoke `:scope > li` walk so IG
    // shares the same rotation resilience as TikTok + YouTube.
    const lis = extractCommentRows(ul as HTMLElement, INSTAGRAM_DOM_MASTER);
    // First row is the caption (matches both article + reel overlay shapes);
    // skip it. Remaining are L1 comments.
    const commentLis = lis.length > 1 ? lis.slice(1) : [];
    if (commentLis.length === 0) return;

    const ts = new Date().toISOString();
    // sourceUrl fallback chain for comment records under this <ul>:
    //   1. `a[href*="/c/"]` inside the li (modal layouts that expose
    //      timestamp links — yields the canonical comment permalink)
    //   2. `https://www.instagram.com/p/<parentPostId>/` when the parent
    //      post id is a real IG shortcode (not synthetic)
    //   3. `location.href` (the surface FW saw the comment on)
    // Prior behavior left sourceUrl unset, which forced buildPostUrl
    // through `instagram.com/p/<comment-record-id>/` — a 404 like
    // `instagram.com/p/ig-cmt-ig-<ts>-0/` for the reported comment case.
    const fallbackParentPostUrl = isRealIgPostId(parentPostId)
      ? `https://www.instagram.com/p/${parentPostId}/`
      : currentPageAddress();

    // Persistent counter across re-entries (mirrors the facebook.ts
    // fwCommentNextIdx fix): lazy-loaded comments arrive on scroll, the
    // MutationObserver re-fires extractPosts, and this walker re-runs while
    // the per-li `fwCommentSeen` stamps persist. Pre-fix the local index
    // reset to 0 each call, so a comment extracted on a later pass re-minted
    // an id already used by an earlier comment — id-level dedup downstream
    // then silently dropped or overwrote one of the two forensic records.
    // Per-li dedup stops re-pushing already-extracted comments; the counter
    // only advances on NEW pushes, and lives on the <ul> so counter and row
    // stamps share a lifetime.
    const ulEl = ul as HTMLElement;
    let idx = parseInt(ulEl.dataset.fwCommentNextIdx ?? '0', 10);
    for (const li of commentLis) {
      // Per-comment dedup so lazy-loaded comments inside an already-walked
      // container surface exactly once across re-extractions. Mirrors the
      // facebook.ts and tiktok.ts pattern: stamp on the comment row AFTER
      // push. Uses `fwCommentSeen` (not `fwProcessed`) so the comment-level
      // gate stays disjoint from the article-level + interceptor-level
      // `fwProcessed` namespace — cross-talk would silently re-emit (or
      // silently swallow) comments when future interceptor logic touches
      // `fwProcessed` on parent elements.
      if ((li as HTMLElement).dataset.fwCommentSeen === 'true') continue;

      // A "View all N replies" / "Vezi răspunsurile (N)" reply-count control
      // read as if it were the comment itself (record-feed-study/C-NOTES.md,
      // #8339: both originalText and roomCaption came out "View all 4
      // replies"). IG renders this control as a `div[role="button"]`, never a
      // real `<button>` tag, so the exclusions below let its span through.
      // Checked per SPAN, not on the row's already-picked longest span
      // (cold read COLD-READ-ee35374f-74c9ea6a-2026-09-28.md #2): the control
      // can sit in the same row as a genuine shorter comment ("so true" +
      // "View all 4 replies"), and a row-level check let the control's own
      // longer text win the comparison and lose the real comment. Anchored
      // end-to-end (not a substring test) because a genuine comment could
      // still mention "4 replies" mid-sentence and must not be dropped for
      // that.
      const spans = Array.from(li.querySelectorAll('span'));
      let bestText = '';
      let sawReplyControl = false;
      for (const s of spans) {
        if (s.closest('button')) continue;
        if (s.closest('a')) continue;
        if (isInNestedRow(s, li)) continue;
        const t = s.textContent?.trim() ?? '';
        if (IG_REPLY_CONTROL_LABEL_RE.test(t)) { sawReplyControl = true; continue; }
        if (t.length > bestText.length) bestText = t;
      }

      if (bestText.length < 2) {
        // Counted, not changed (2026-09-19). The floor stays; what stops is
        // the silence. See youtube.ts and facebook.ts for the same decision,
        // and the findings entry for why no number was invented here.
        if (sawReplyControl) bumpCounter('replyExpander.instagram.comment');
        else if (bestText.length > 0) bumpCounter('shortDrop.instagram.comment');
        continue;
      }

      const handleLink = li.querySelector('a[href^="/"]') as HTMLAnchorElement | null;
      const handle = handleLink?.getAttribute('href')?.replace(/^\/|\/$/g, '') ?? 'unknown';

      const flags = extractInstagramCommentSignals(li, bestText);

      // Prefer the comment permalink when the li exposes a /c/ link
      // (modal layouts), else use the precomputed parent-post fallback.
      const cLink = (li as HTMLElement).querySelector<HTMLAnchorElement>('a[href*="/c/"]');
      const sourceUrl = cLink?.href || fallbackParentPostUrl;

      (li as HTMLElement).dataset.fwCommentSeen = 'true';

      const commentId = `ig-cmt-${parentPostId}-${idx}`;
      out.push({
        id: commentId,
        text: bestText,
        author: handle && handle !== 'unknown' ? `@${handle.split('/')[0]}` : 'unknown',
        timestamp: ts,
        platform: 'instagram',
        domRef: new WeakRef(li as HTMLElement),
        feedSource,
        sourceUrl,
        // anchorUrl — only when the li exposed a `/c/<id>` link (the comment's
        // own permalink). Undefined when we fell back to the parent-post URL,
        // so the export does not mislabel a post URL as the exact-comment link.
        anchorUrl: cLink?.href,
        kind: 'top-comment',
        depth: 1,
        parent_id: parentPostId,
        parentVideoId: parentPostId,
        platform_specific: {
          platform: 'instagram',
          surfaceKind,
          commentLevel: 1,
          metrics: {
            likes: flags.likes,
            reply_count: flags.reply_count,
          },
          isVerified: flags.isVerified,
          isEdited: flags.isEdited,
        },
      });

      // L2 replies — only when the user has expanded them (IG renders a nested
      // reply <ul> under the comment li with content present). Chain-mirror:
      // emit only what was actually rendered, never force-expand.
      const replyUl = (li as HTMLElement).querySelector(':scope > ul');
      if (replyUl) {
        this._walkReplyRows(
          replyUl as HTMLElement,
          commentId,
          parentPostId,
          surfaceKind,
          feedSource,
          ts,
          out,
        );
      }
      idx++;
    }
    // Persist the counter so the next call continues from where this one
    // left off, keeping `ig-cmt-<pid>-<idx>` chain IDs unique.
    ulEl.dataset.fwCommentNextIdx = String(idx);
  }

  /**
   * Walk an expanded reply `<ul>` nested under an L1 comment li and emit each
   * rendered reply as a depth-2 `kind:'reply'` record tied to its parent
   * comment. No first-row caption skip (reply lists carry no caption row).
   */
  private _walkReplyRows(
    replyUl: HTMLElement,
    parentCommentId: string,
    parentPostId: string,
    surfaceKind: InstagramSurfaceKind,
    feedSource: FeedSource,
    ts: string,
    out: PostContent[],
  ): void {
    const replyLis = extractCommentRows(replyUl, INSTAGRAM_DOM_MASTER);
    // Persistent counter across re-walks (same fwCommentNextIdx idiom as
    // `_walkCommentsContainer`): viewport re-entry un-stamps the parent li,
    // the parent re-walks this reply <ul>, and already-emitted reply rows
    // stay stamped — a per-call index restarting at 0 would re-mint an id
    // already used by an earlier reply.
    let rIdx = parseInt(replyUl.dataset.fwCommentNextIdx ?? '0', 10);
    for (const rLi of replyLis) {
      if ((rLi as HTMLElement).dataset.fwCommentSeen === 'true') continue;

      const spans = Array.from(rLi.querySelectorAll('span'));
      let bestText = '';
      for (const s of spans) {
        if (s.closest('button')) continue;
        if (s.closest('a')) continue;
        if (isInNestedRow(s, rLi)) continue;
        const t = s.textContent?.trim() ?? '';
        if (t.length > bestText.length) bestText = t;
      }
      if (bestText.length < 2) {
        // Counted, not changed (2026-09-19). The floor stays; what stops is
        // the silence. See youtube.ts and facebook.ts for the same decision,
        // and the findings entry for why no number was invented here.
        if (bestText.length > 0) bumpCounter('shortDrop.instagram.comment');
        continue;
      }

      const handleLink = rLi.querySelector('a[href^="/"]') as HTMLAnchorElement | null;
      const handle = handleLink?.getAttribute('href')?.replace(/^\/|\/$/g, '') ?? 'unknown';

      const flags = extractInstagramCommentSignals(rLi as HTMLElement, bestText);

      const cLink = (rLi as HTMLElement).querySelector<HTMLAnchorElement>('a[href*="/c/"]');
      const sourceUrl = cLink?.href
        || (isRealIgPostId(parentPostId)
          ? `https://www.instagram.com/p/${parentPostId}/`
          : currentPageAddress());

      (rLi as HTMLElement).dataset.fwCommentSeen = 'true';

      out.push({
        id: `${parentCommentId}-r${rIdx}`,
        text: bestText,
        author: handle && handle !== 'unknown' ? `@${handle.split('/')[0]}` : 'unknown',
        timestamp: ts,
        platform: 'instagram',
        domRef: new WeakRef(rLi as HTMLElement),
        feedSource,
        sourceUrl,
        anchorUrl: cLink?.href,
        kind: 'reply',
        depth: 2,
        parent_id: parentCommentId,
        parentVideoId: parentPostId,
        platform_specific: {
          platform: 'instagram',
          surfaceKind,
          commentLevel: 2,
          metrics: {
            likes: flags.likes,
            reply_count: flags.reply_count,
          },
          isVerified: flags.isVerified,
          isEdited: flags.isEdited,
        },
      });
      rIdx++;
    }
    // Persist the counter so a later re-walk continues from where this one
    // left off, keeping `<parentCommentId>-r<idx>` chain IDs unique.
    replyUl.dataset.fwCommentNextIdx = String(rIdx);
  }

  /**
   * Wire (or re-wire) the modal-internal scroll trigger.
   *
   * The MutationObserver in interceptor.ts fires on lazy-load + tree mutations
   * but NOT on pure scroll inside already-mounted DOM. When the user scrolls
   * the IG post-modal's inner scroll container past comments rendered on a
   * prior pass, those comments stay un-extracted because no MO event fires.
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
   * Silently no-op when no scroll container is found (e.g. /p/<id> rendered
   * as a feed page without modal, profile/explore grid, or modal not yet
   * mounted) — the existing MO path stays the only trigger for that surface.
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
   * absorbs IG's 1px scrollbar artifacts. Returns the first match across all
   * dialogs in the document; IG's post modal renders only one open dialog
   * at a time on standard surfaces.
   */
  private _scrollContainerCache: WeakMap<HTMLElement, HTMLElement> = new WeakMap();
  /** When a dialog was last walked without finding a scroller. */
  private _scrollProbeMissAt: WeakMap<HTMLElement, number> = new WeakMap();

  private _findDialogScrollContainer(): HTMLElement | null {
    // META-7: exclude chat/DM dialogs (IG DM window, chat overlay) so we
    // never attach a live scroll listener to, or walk the full DOM of, a
    // private conversation window — and never mis-select a chat's scroller
    // instead of the real post modal when both are mounted at once.
    const dialogs = Array.from(
      document.querySelectorAll<HTMLElement>('[role="dialog"]'),
    ).filter(dialog => !isInPrivateChatSubtree(dialog));
    for (const dialog of dialogs) {
      const cached = this._scrollContainerCache.get(dialog);
      if (cached && dialog.contains(cached)) return cached;
      // A dialog whose comment list fits its box has no scroller, and only a
      // hit is cached, so this getComputedStyle walk over every element ran
      // again on every extractPosts call (every MutationObserver batch) for
      // as long as that modal stayed open. Remember the miss and re-probe at
      // most every SCROLLER_PROBE_RETRY_MS (comments can load later).
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
   * article back to the interceptor through `requestReExtract`.
   *
   * The interceptor owns the routing into the comment-batch enqueue
   * (`onPost` lives in interceptor scope, not in the adapter). The re-walk
   * runs the adapter's re-entry path (article.dataset.fwCaptionEmitted ===
   * 'true' → skips caption push) and fans out `_extractCommentsForArticle`
   * whose per-LI dedup picks up only the comments that were un-stamped by
   * the viewport-gate's `unmarkPostsForReExtraction` after a prior
   * fail-closed flush.
   *
   * Only stamped articles (those that have already been caption-extracted in
   * a prior pass) are handed over — un-stamped articles are left to the MO's
   * first-pass extraction, which ran when they mounted.
   *
   * This used to detach and re-insert each article so the body
   * MutationObserver would fire. The modal's comment composer lives inside
   * that article, and a moved subtree loses focus without a `blur`; the
   * scrollTop restore after the move also fired a new `scroll` event that
   * re-armed the debounce, so the move repeated every ~258 ms and the
   * textarea could never hold focus (measured live 2026-09-02). Nothing in
   * this method touches the DOM any more; see scroll-trigger.ts.
   */
  private _reExtractCommentsInDialog(): void {
    const container = this._scrollContainerRef?.deref();
    if (!container) return;
    const dialog = container.closest<HTMLElement>('[role="dialog"]');
    if (!dialog) return;
    const roots: HTMLElement[] = [];
    for (const article of dialog.querySelectorAll<HTMLElement>('article')) {
      if (article.dataset.fwCaptionEmitted !== 'true') continue;
      roots.push(article);
    }
    requestReExtract(roots);
  }

  private _collectArticles(root: HTMLElement): HTMLElement[] {
    const results: HTMLElement[] = [];

    // Chat-log exclusion — defensive gate mirroring the Facebook adapter.
    // The IG selector is the bare `article` element, so any future IG
    // surface that nests `<article>` inside a `<div role="log">` (the
    // canonical ARIA live-region role for chat-message logs) would leak
    // private DMs into the forensic chain. Live probe of /direct/inbox/
    // on 2026-05-28 found zero articles in IG's current DM UI, but the
    // gate is forward-looking: IG's web build evolves and the cost of
    // the closest() walk is a single DOM lookup per article. Pattern
    // matches the FB Messenger fix; see src/content/platforms/facebook.ts.
    if (root.matches?.('article') && !root.closest('[role="log"]')) {
      results.push(root);
    }

    root.querySelectorAll<HTMLElement>('article').forEach((el) => {
      if (el.closest('[role="log"]')) return;
      results.push(el);
    });

    return results;
  }

  private _extractTextElement(article: HTMLElement): { element: HTMLElement; text: string } | null {
    const spans = article.querySelectorAll<HTMLElement>('span[dir="auto"]');

    let best: HTMLElement | null = null;
    let bestLen = 0;

    for (const span of spans) {
      // Skip if inside comments (ul elements)
      if (span.closest('ul')) continue;

      // Skip if inside a button (like/share/etc)
      if (span.closest('button')) continue;

      // Skip if it looks like a timestamp or metadata
      const text = span.textContent?.trim() ?? '';
      if (text.length < 20) continue;

      // Prefer the longest qualifying span (caption is usually longest)
      if (text.length > bestLen) {
        best = span;
        bestLen = text.length;
      }
    }

    if (!best) return null;
    return { element: best, text: best.textContent?.trim() ?? '' };
  }

  /**
   * M119 - has this reused container fallen behind the URL?
   *
   * True when the post id moved while the body stood still: the container is
   * still showing the previous post, whose body is already in the chain under
   * its real identity, so there is nothing new to record and the new shortcode
   * must not be signed with the old post's author.
   *
   * M66's rule on Twitter is the symmetric XOR - identity and body must move
   * together (`src/content/platforms/twitter.ts`,
   * `_coherentIdentityForArticle`). Only this arm is reachable on Instagram:
   * both URL-driven surfaces already refuse to re-emit a body under an
   * unchanged id (`fwPermalinkPostId`, `fwReelProcessed`), and the article path
   * emits one caption per node (`fwCaptionEmitted`), so a body that moves
   * under a frozen id never reaches a second push.
   *
   * The snapshot is advanced by the caller only on a trusted emit, so one
   * stale frame cannot poison the next read.
   */
  private _containerFellBehind(
    slot: HTMLElement,
    id: string,
    bodyEl: HTMLElement,
    text: string,
  ): boolean {
    const previous = this._identityBySlot.get(slot);
    if (!previous) return false;
    const fellBehind = previous.id !== id && previous.bodyEl === bodyEl && previous.text === text;
    if (fellBehind) bumpCounter('m119ContainerFellBehind');
    return fellBehind;
  }

  private _extractAuthor(article: HTMLElement): string {
    const links = article.querySelectorAll<HTMLAnchorElement>('a[href][role="link"]');
    for (const link of links) {
      // M119: a commenter's or a nested card's link never names this post.
      if (!linkSpeaksForCard(link, article)) continue;
      const href = link.getAttribute('href') ?? '';
      // Match /username/ pattern (1-30 chars, alphanumeric + dots + underscores)
      if (/^\/[a-zA-Z0-9_.]{1,30}\/?$/.test(href)) {
        const text = link.textContent?.trim();
        if (text && text.length > 0 && text.length < 40) {
          return text;
        }
      }
    }
    return 'unknown';
  }

  private _extractPostId(article: HTMLElement): string | null {
    const links = article.querySelectorAll<HTMLAnchorElement>('a[href]');
    for (const link of links) {
      // M119: the shortcode must come from the same card as the author.
      if (!linkSpeaksForCard(link, article)) continue;
      const href = link.getAttribute('href') ?? '';
      // Same rule as _extractPostUrl: `/p/` and `/reel/` are not Instagram's
      // alone (facebook.com/p/<Page>-<id>/), so an absolute link to another
      // host never names this card's shortcode.
      if (isForeignPostUrlHost(href, 'instagram.com')) continue;
      const postMatch = href.match(/\/p\/([A-Za-z0-9_-]+)/);
      if (postMatch) return postMatch[1];
      const reelMatch = href.match(/\/reel\/([A-Za-z0-9_-]+)/);
      if (reelMatch) return reelMatch[1];
    }
    return null;
  }

  private _extractPostUrl(article: HTMLElement): string {
    const links = article.querySelectorAll<HTMLAnchorElement>('a[href]');
    for (const link of links) {
      // M119: same-card rule as _extractPostId - the permalink this record
      // publishes must belong to the card whose author it names.
      if (!linkSpeaksForCard(link, article)) continue;
      const href = link.getAttribute('href') ?? '';
      if (!href.includes('/p/') && !href.includes('/reel/')) continue;
      if (!href.startsWith('http')) return `https://www.instagram.com${href}`;
      // An absolute href only counts when it is Instagram's own. `/p/` and
      // `/reel/` are not Instagram-exclusive path shapes — Facebook uses both
      // (`facebook.com/p/<Page>-<id>/`, `facebook.com/reel/<id>`) — so an
      // embedded cross-platform link would otherwise become this Instagram
      // record's permalink and send a parent to another platform's post.
      // Refuse it, count it, and keep scanning for a real Instagram link.
      if (isForeignPostUrlHost(href, 'instagram.com')) {
        bumpCounter('postUrlForeignHostRejected');
        continue;
      }
      return href;
    }
    return '';
  }

  private _detectFeedSource(): FeedSource {
    const path = window.location.pathname;
    if (path === '/' || path === '') return 'for-you';
    if (path.startsWith('/explore')) return 'for-you';
    if (path.includes('/p/') || path.includes('/reel/')) return 'unknown';
    if (/^\/[a-zA-Z0-9_.]{1,30}\/?$/.test(path)) return 'profile';
    return 'unknown';
  }
}
