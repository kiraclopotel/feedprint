// FeelingWise — TikTok thread-bundle extractor.
//
// Produces a ThreadSnapshot for a single TikTok video: post description
// + top N comments in surface_order. Runs alongside the per-post
// `TiktokAdapter` when the bundle pipeline is enabled.
//
// Scope:
//   • Flat extraction — TikTok comments are single-level; parent_id is
//     always null.
//   • Top N comments in DOM order (TikTok surfaces "most relevant" by
//     default; if the user switches to "newest" the DOM order reflects
//     that — either way we capture what the viewer SEES, which is the
//     cascade that matters).
//   • Best-effort engagement counts (likes on comments). Missing
//     counts are undefined, not 0 — 0 would lie to L1 about actual
//     signal.
//   • Locale hint = 'unknown' for now. Hardcoded 'unknown' is safe —
//     the L1 prompt degrades to bilingual mode when locale_hint is
//     'unknown' or 'mixed'.
//
// Not in scope:
//   • Comment replies (Twitter-style nested trees).
//   • Author cross-post stats.
//   • Engagement-driven cascade weighting.
//   • Retry-on-pagination (when comments are lazy-loaded). Caller must
//     ensure the comment panel is open before calling; otherwise
//     N_actual < N_requested and a warning is recorded.
//
// Design notes:
//   • Pure function of a container element — no DOM side effects, no dataset
//     mutation. Safe to call repeatedly.
//   • Selectors mirror `src/content/platforms/tiktok.ts` so selector updates
//     happen in ONE place when TikTok rotates DOM (FIND-049 risk). When the
//     old adapter retires post-Phase-1-cleanup, selectors move here.

import { Platform } from '../../types/post';
import {
  ThreadSnapshot,
  PostSnapshot,
  CommentNode,
  PIPELINE_VERSION,
} from '../../types/thread-snapshot';
import { detectThreadLanguage } from '../../core/lang-detect';
import { isTrivial } from '../../core/triviality';
import { readTikTokVideoIdFromXgWrapper } from './tiktok-video-id';
import { findChatOverlayAncestor } from '../platforms/adapter';
import { parseCountText } from './count-text';

/**
 * Default number of top comments included per bundle. Mirrors the popup
 * `comments-to-analyze-per-video` feature default (src/storage/presets.ts) of 25.
 * The synchronous PlatformAdapter contract cannot await getSettings(), so the
 * adapter uses this shared default to stay consistent with the popup setting.
 */
export const DEFAULT_BUNDLE_COMMENT_CAP = 15;

// ─────────────────────────────────────────────────────────────────────────────
// TikTok comment-panel DOM substring-class selectors.
//
// The current TikTok build wraps each comment row in a styled-components
// class of the form `css-XXXXX-7937d88b--<Name> eYYYYY` where `<Name>`
// (the unhashed segment) is preserved across hash rotations. The substring
// match on `<Name>` is therefore the stable selector surface. Single source
// of truth — both the platform adapter and this extractor reference these
// constants; the platform adapter re-imports them.
//
// Historical context: pre-rotation TikTok marked rows with
// `data-e2e="comment-level-1"` and `comment-level-2`. Those attributes were
// stripped from the comment panel; the substring-class anchors below are
// the replacement surface.
// ─────────────────────────────────────────────────────────────────────────────

export const TT_COMMENT_PANEL_SELECTOR = '[class*="DivCommentListContainer"]';
export const TT_COMMENT_LIST_SELECTOR = '[class*="DivCommentObjectWrapper"]';
export const TT_COMMENT_ROW_SELECTOR = '[class*="DivCommentItemWrapper"]';

/**
 * Reply-tier wrapper class. Excluded from the row selector when narrowing
 * to L1 (top-level) comments — the class-substring match would otherwise
 * also capture reply rows whose class includes `DivCommentReplyItemWrapper`
 * as well as `DivCommentItemWrapper`.
 */
export const TT_COMMENT_REPLY_WRAPPER_NAME_RE = /DivCommentReplyItemWrapper/;

export interface ExtractOptions {
  /** Max comments to include. Default 10. */
  maxComments?: number;
  /**
   * Optional per-row predicate. When provided, rows for which it returns
   * `true` are excluded from extraction BEFORE the `maxComments` cap is
   * applied. The adapter passes a "row already carries fwCommentSeen"
   * predicate so the cap window SLIDES past already-processed comments on
   * each scroll pass instead of permanently re-examining the first
   * `maxComments` DOM rows. Default (undefined) keeps the extractor a pure
   * function of the container — unit tests and the formatter call it without
   * a predicate and see byte-identical behavior.
   *
   * MUST mirror the filter the adapter applies in `findTikTokCommentRows`
   * so `comments[i].surface_order` indexes the SAME post-filter row list.
   */
  skipRow?: (row: HTMLElement) => boolean;
}

export interface ExtractResult {
  snapshot: ThreadSnapshot | null;
  warnings: string[];
}

/**
 * Extract a ThreadSnapshot from a TikTok video detail container or feed item.
 *
 * Caller contract:
 *   • `container` should be the `[data-e2e="video-detail"]` or
 *     `[data-e2e="recommend-list-item-container"]` element.
 *   • Returns `{ snapshot: null, warnings }` if the container doesn't contain
 *     a recognizable post — caller should skip, not crash.
 *   • Non-throwing; all extraction errors become warnings.
 */
export function extractTikTokBundle(
  container: HTMLElement,
  options: ExtractOptions = {},
): ExtractResult {
  const requestedComments = options.maxComments ?? 10;
  const warnings: string[] = [];

  const post = extractPost(container, warnings);
  if (!post) {
    return { snapshot: null, warnings };
  }

  const comments = extractComments(container, requestedComments, warnings, options.skipRow);

  // Faza 4 (PLAN_v3-rollout): tag trivial comments so L1 treats them as
  // cascade-only. Counts contribute to diagnostics so forensics can audit the
  // trivial-to-substantive ratio per thread.
  let trivialCount = 0;
  for (const c of comments) {
    const triv = isTrivial(c.text);
    if (triv.trivial) {
      c.trivial = true;
      trivialCount++;
    }
  }
  if (trivialCount > 0) {
    warnings.push(`trivial:${trivialCount}/${comments.length}`);
  }

  // Faza 2: detect thread language from post + top comments.
  // Falls back to 'unknown' on sparse input — L1 prompt degrades gracefully.
  const langResult = detectThreadLanguage(post.text, comments.map(c => c.text));
  if (langResult.language !== 'unknown') {
    warnings.push(`lang:${langResult.language}(ro=${langResult.ro_score},en=${langResult.en_score})`);
  }

  const snapshot: ThreadSnapshot = {
    pipeline_version: PIPELINE_VERSION,
    extracted_at: Date.now(),
    platform: 'tiktok' satisfies Platform,
    post,
    comments,
    locale_hint: langResult.language,
    extraction_meta: {
      requested_comments: requestedComments,
      warnings,
    },
  };

  return { snapshot, warnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────

function extractPost(container: HTMLElement, warnings: string[]): PostSnapshot | null {
  // TikTok For You feed (`recommend-list-item-container`)
  // renders the caption as multiple `data-e2e="desc-span-{group}_{idx}"`
  // children INSIDE `data-e2e="video-desc"`. On initial container mount the
  // outer `video-desc` element may not be queryable yet (React lazy-hydrate)
  // even when the desc-span-* children are already present. recon
  // confirmed: containers with `childKeys: ["feed-video"]` only at first
  // observation, then populated `["video-desc", "desc-span-0_-1", ...]`
  // milliseconds later. Pre-fix: extractor returned null on first observation
  // and never re-tried (caller's MutationObserver only fires on insertion,
  // not on async content population). Result: 5 of 8 containers per scroll
  // tick produced 0 posts on a live For You feed (smoking-gun console:
  // `[FW tiktok-adapter] mutated=99 containers=8 (already=3, empty-split=5) posts=0`).
  //
  // Fix: walk caption-bearing locations in order of specificity. Start with
  // the canonical `video-desc`/`browse-video-desc`; if neither is queryable,
  // aggregate the desc-span-* children directly. The desc-span-* selector is
  // safe (TikTok-specific, no false matches in adjacent components) and
  // produces the SAME caption text as the outer video-desc would. Periodic
  // rescan in interceptor.ts catches containers that hadn't even hydrated
  // their spans yet on a given tick.
  let descEl: HTMLElement | null =
    container.querySelector<HTMLElement>('[data-e2e="video-desc"]') ??
    container.querySelector<HTMLElement>('[data-e2e="browse-video-desc"]');

  let text = '';
  if (descEl) {
    text = descEl.textContent?.trim() ?? '';
  } else {
    const spans = container.querySelectorAll<HTMLElement>('[data-e2e^="desc-span-"]');
    if (spans.length > 0) {
      text = Array.from(spans)
        .map((s) => s.textContent?.trim() ?? '')
        .filter((t) => t.length > 0)
        .join(' ');
    }
  }

  if (text.length === 0) {
    warnings.push(descEl ? 'post-desc:empty' : 'post-desc:not-found');
    return null;
  }

  const author = extractAuthor(container) ?? 'unknown';
  if (author === 'unknown') warnings.push('post-author:fallback-unknown');

  const id = extractVideoId(container) ?? fallbackVideoIdFromUrl() ?? synthId();
  const source_url = buildVideoUrl(container, author, id);

  return {
    id,
    author,
    text,
    source_url,
    likes: undefined,
    comments_count: undefined,
    shares: undefined,
    timestamp: undefined,
  };
}

function extractAuthor(container: HTMLElement): string | null {
  const detailAuthor = container.querySelector<HTMLElement>('[data-e2e="video-author-uniqueid"]');
  if (detailAuthor?.textContent?.trim()) {
    return detailAuthor.textContent.trim();
  }
  const browseUsername = container.querySelector<HTMLElement>('[data-e2e="browse-username"]');
  if (browseUsername?.textContent?.trim()) {
    return browseUsername.textContent.trim();
  }
  const profileLink = container.querySelector<HTMLAnchorElement>('a[href^="/@"]');
  if (profileLink?.textContent?.trim()) {
    return profileLink.textContent.trim();
  }
  // URL fallback: on a profile page (`/@handle`) or a video permalink
  // (`/@handle/video/123`) the path owner IS the video author. Feed
  // surfaces (`/`, `/foryou`, search) don't match and stay null.
  if (typeof window !== 'undefined') {
    const m = window.location.pathname.match(/^\/@([^/?#]+)/);
    if (m) return m[1];
  }
  return null;
}

function extractVideoId(container: HTMLElement): string | null {
  const links = container.querySelectorAll<HTMLAnchorElement>('a[href]');
  for (const link of links) {
    const href = link.getAttribute('href') ?? '';
    const match = href.match(/\/video\/(\d+)/);
    if (match) return match[1];
  }
  return readTikTokVideoIdFromXgWrapper(container);
}

function fallbackVideoIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const match = window.location.pathname.match(/\/video\/(\d+)/);
  return match?.[1] ?? null;
}

function buildVideoUrl(container: HTMLElement, author: string, id: string): string {
  const direct = container
    .querySelector<HTMLAnchorElement>('a[href*="/video/"]')
    ?.getAttribute('href') ?? '';
  if (direct) {
    return direct.startsWith('http') ? direct : `https://www.tiktok.com${direct}`;
  }
  const cleanAuthor = author.replace(/^@/, '');
  if (cleanAuthor && cleanAuthor !== 'unknown' && id) {
    return `https://www.tiktok.com/@${cleanAuthor}/video/${id}`;
  }
  return '';
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMENT EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────

function extractComments(
  container: HTMLElement,
  maxComments: number,
  warnings: string[],
  skipRow?: (row: HTMLElement) => boolean,
): CommentNode[] {
  // Resolve search scope: TikTok's permalink layout renders the comment panel
  // (`DivCommentListContainer`) as a SIBLING of the video container, not
  // nested inside. When `container.querySelector(row)` returns zero, look up
  // the visible comment panel at document scope. Only one panel is open at
  // a time (TikTok closes the panel on card switch / nav), so the resolution
  // is unambiguous on permalink. On the For-You feed where the panel may
  // belong to a different active card, the caller (TikTokAdapter) is
  // responsible for pairing the container to the active video — this helper
  // resolves the panel only.
  const scope = resolveTikTokCommentSearchScope(container);

  // ── Path A: row-class fast path ───────────────────────────────────────────
  // The current TikTok build wraps each comment row in a styled-components
  // class whose unhashed segment is `DivCommentItemWrapper`. Reply rows are
  // excluded via the `DivCommentReplyItemWrapper` filter so this path
  // surfaces L1 (top-level) comments only. When the substring match returns
  // zero — e.g. when comments use an unforeseen wrapper variant — Path B
  // (structural <ul> fallback ported from v2 `extractTikTokComments`) takes
  // over. We record which path ran so forensics can catch "silently on
  // fallback" drift.
  let eNodes = Array.from(
    scope.querySelectorAll<HTMLElement>(TT_COMMENT_ROW_SELECTOR),
  ).filter((el) => !TT_COMMENT_REPLY_WRAPPER_NAME_RE.test(el.className || ''));

  // Slide the cap window past already-processed rows. The TikTok comment
  // list is virtualized: querySelectorAll returns rows in DOM order, so
  // without this filter the `maxComments` cap always re-examines the SAME
  // first N rows — all stamped fwCommentSeen by the adapter on the prior
  // pass — and the adapter then skips every one, producing 0 new comments
  // on every scroll past the first batch (the "frozen at 14" freeze). With
  // the predicate the cap applies to the UNSEEN rows so each scroll surfaces
  // the next window. The adapter applies the identical filter in
  // findTikTokCommentRows so surface_order stays index-aligned.
  if (skipRow) eNodes = eNodes.filter((el) => !skipRow(el));

  if (eNodes.length > 0) {
    const viaE2e = extractCommentsFromRowNodes(eNodes, maxComments);
    if (viaE2e.length > 0) {
      warnings.push(scope === container ? 'comments-path:row-class' : 'comments-path:row-class-sibling');
      if (viaE2e.length < maxComments) {
        warnings.push(`comments:only-${viaE2e.length}-of-${maxComments}`);
      }
      return viaE2e;
    }
  }

  // ── Path B: structural fallback (ported from v2 extractTikTokComments) ────
  const listContainer = findCommentListContainer(scope);
  if (!listContainer) {
    warnings.push('comments:container-not-found');
    return [];
  }

  const viaStructural = extractCommentsFromListChildren(listContainer, maxComments, skipRow);
  warnings.push('comments-path:structural-fallback');
  if (viaStructural.length < maxComments) {
    warnings.push(`comments:only-${viaStructural.length}-of-${maxComments}`);
  }
  return viaStructural;
}

/**
 * Resolve the DOM scope to query comments from. Returns `container` when the
 * legacy nested layout still applies; otherwise returns the visible comment
 * panel at document scope (TikTok's current sibling layout).
 *
 * Exported so the adapter's per-row lookup (`findTikTokCommentRows`) can use
 * the same scope as the bundle extractor — keeping `bundle.comments[i]` and
 * `rows[i]` indexable against each other.
 *
 * Chat-overlay exclusion: mirrors `resolvePublicTikTokCommentSearchScope`
 * (`../platforms/tiktok.ts`) exactly — both resolvers must never choose a
 * private chat/DM dialog's panel over the real video's comment panel. The
 * exclusion logic itself lives in ONE place (`findChatOverlayAncestor`,
 * `../platforms/adapter.ts`) and both resolvers call it; this is the
 * snapshot/LLM/forensic-record path, so picking the wrong panel here is the
 * higher-severity outcome (private chat text entering a public record).
 */
export function resolveTikTokCommentSearchScope(container: HTMLElement): HTMLElement {
  if (container.querySelector(TT_COMMENT_ROW_SELECTOR)) return container;
  if (typeof document === 'undefined') return container;
  return Array.from(document.querySelectorAll<HTMLElement>(TT_COMMENT_PANEL_SELECTOR))
    .find(panel => !findChatOverlayAncestor(panel)) ?? container;
}

/**
 * Pick the comment body element from a row. The username sits in a `<p>`
 * element with `TUXText--weight-medium`, the body in a `<span>` with
 * `TUXText--weight-normal`. Chrome (Reply label, timestamp, like count) also
 * uses `TUXText--weight-normal` spans but with short texts ("Reply", "3-28",
 * "8"). The body is reliably the longest of the candidates. Longest-wins is
 * resilient to TikTok rotating modifier class names (e.g. swapping
 * `weight-normal` to a new modifier) — the body remains the longest text in
 * the row by structural property.
 */
export function findTikTokRowBodyEl(row: HTMLElement): HTMLElement | null {
  // First try data-e2e if TT exposes it on this variant.
  const dataE2eDeep = row.querySelector<HTMLElement>('[data-e2e="comment-text"] span');
  if (dataE2eDeep && (dataE2eDeep.textContent?.trim().length ?? 0) > 0) return dataE2eDeep;
  const dataE2e = row.querySelector<HTMLElement>('[data-e2e="comment-text"]');
  if (dataE2e && (dataE2e.textContent?.trim().length ?? 0) > 0) return dataE2e;

  // Otherwise pick the longest TUXText span inside the row. Excludes `<p>`
  // because the username lives in a `<p>` element and short labels like
  // "Reply" also use `<p>`. The body is reliably a `<span>`.
  const spans = row.querySelectorAll<HTMLElement>('span.TUXText, span[class*="TUXText"]');
  let longestEl: HTMLElement | null = null;
  let longestLen = 0;
  for (const el of spans) {
    const t = el.textContent?.trim() ?? '';
    if (t.length > longestLen) {
      longestLen = t.length;
      longestEl = el;
    }
  }
  if (longestEl) return longestEl;

  // Last-ditch fallback to any `<p>` then the row itself.
  return row.querySelector<HTMLElement>('p') ?? row;
}

function extractRowBodyText(node: HTMLElement): string {
  const el = findTikTokRowBodyEl(node);
  return el?.textContent?.trim() ?? '';
}

/**
 * Path A helper — iterate row nodes (DivCommentItemWrapper substring-class
 * matches) and mine body text + author + like count from within. The row
 * is the wrapper DIV; the body text lives in an inner
 * `span.TUXText--weight-normal` (see `extractRowBodyText` for selector
 * rationale). The username link sits as a sibling of the body, both
 * children of the row.
 */
function extractCommentsFromRowNodes(
  nodes: HTMLElement[],
  maxComments: number,
): CommentNode[] {
  const comments: CommentNode[] = [];
  const effectiveLimit = Math.min(maxComments, nodes.length);

  for (let i = 0; i < effectiveLimit; i++) {
    const node = nodes[i];
    const rawText = extractRowBodyText(node);
    if (rawText.length === 0) continue;
    if (STICKER_PLACEHOLDER_RE.test(rawText)) continue; // sticker-only → drop
    // Sticker + text → keep the real words, drop the placeholder chrome.
    const text = stripStickerPlaceholders(rawText);
    if (text.length === 0) continue;

    // Author: the row carries two `<a href="/@...">` anchors — avatar
    // (empty text) first, username second. Read the handle from the SECOND
    // anchor's `href`, not its visible text: the text is sometimes the
    // account's display name instead of its handle (seen in a real record:
    // the row's own link read a display name with spaces in it, not a
    // handle), and tiktok.ts's own comment path prefixes
    // this value with "@" downstream, on the assumption it already is one.
    let author = '';
    const profileLinks = node.querySelectorAll<HTMLAnchorElement>('a[href^="/@"], a[href*="/@"]');
    for (const link of profileLinks) {
      const href = link.getAttribute('href') ?? '';
      const m = href.match(/\/@([^/?#]+)/);
      if (m && m[1]) {
        author = m[1];
        break;
      }
    }
    if (!author) author = 'unknown';

    const likes = readLikeCount(node);

    comments.push({
      id: synthId(),
      author,
      text,
      surface_order: comments.length,
      parent_id: null,
      likes,
      replies_count: undefined,
    });
  }

  return comments;
}

/**
 * Find the <ul> that holds comments. Prefers the `[data-e2e="comment-list"]`
 * attribute; falls back to the structural heuristic (first UL with ≥2 direct
 * children each containing a profile link).
 */
function findCommentListContainer(container: HTMLElement): HTMLElement | null {
  const labeled = container.querySelector<HTMLElement>('[data-e2e="comment-list"]');
  if (labeled && labeled.children.length >= 1) return labeled;

  const allULs = container.querySelectorAll<HTMLElement>('ul');
  for (const ul of allULs) {
    if (ul.children.length < 2) continue;
    let commentLike = 0;
    for (const child of Array.from(ul.children).slice(0, 5)) {
      if (child instanceof HTMLElement && child.querySelector('a[href*="/@"]')) {
        commentLike++;
      }
    }
    if (commentLike >= 2) return ul;
  }
  return null;
}

// UI chrome that must not be mistaken for comment text. Multi-language to
// match what a RO/EN TikTok viewer sees.
const UI_LABEL_RE = /^(Reply|Răspunde|Replies|Pinned|Fixat|Like|Share|Report|Vezi .* de r[aă]spunsuri|See \d+ repl|View \d+ repl|\u2026)$/i;
const NUMERIC_ONLY_RE = /^[\d,.KkMm\s]+$/;
// L0-A TikTok image-sticker comments render as a literal placeholder string
// "[Sticker]" (localized: "[Autocolant]" RO, "[Aufkleber]" DE, "[贴纸]" ZH,
// etc.). The image itself carries no text the LLM can score. Two cases:
//   • placeholder ALONE  → drop the row (nothing to record).
//   • placeholder + text → strip the placeholder, keep the real text, so the
//     chain shows "Pentru voi" not "[Sticker] Pentru voi" (the sticker-plus-text
//     noise observed live).
// Language coverage mirrors the engagement-hider's STICKER_COMMENT_RE
// (tiktok-engagement.ts) so the two layers agree on what a sticker is.
const STICKER_TOKEN_RE =
  /\[\s*(?:Sticker|Autocolant|Autocollant|Aufkleber|Pegatina|Adesivo|Стикер|Naklejka|ステッカー|貼り紙|贴纸|貼圖|스티커|이모티콘|GIF|Image|Imagine|Photo)\s*\]/gi;
const STICKER_PLACEHOLDER_RE =
  /^\s*\[\s*(?:Sticker|Autocolant|Autocollant|Aufkleber|Pegatina|Adesivo|Стикер|Naklejka|ステッカー|貼り紙|贴纸|貼圖|스티커|이모티콘|GIF|Image|Imagine|Photo)\s*\]\s*$/i;

/**
 * Strip leading/embedded sticker-placeholder tokens from a comment body.
 * Returns the residual text (may be empty when the comment was sticker-only).
 * Used so a "[Sticker] real words" comment records as "real words" — the
 * placeholder is image chrome, not content.
 */
function stripStickerPlaceholders(text: string): string {
  return text.replace(STICKER_TOKEN_RE, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Path B core — iterate UL children, for each child mine author + the longest
 * span/p/div text that isn't a UI label, the author handle, or a numeric count.
 * This algorithm is the one v2 has validated in production (comment-extractors.ts).
 */
function extractCommentsFromListChildren(
  listContainer: HTMLElement,
  maxComments: number,
  skipRow?: (row: HTMLElement) => boolean,
): CommentNode[] {
  const comments: CommentNode[] = [];
  const children = Array.from(listContainer.children) as HTMLElement[];

  for (const child of children) {
    if (comments.length >= maxComments) break;
    if (child.childElementCount === 0) continue;
    // Slide the cap window past already-processed rows (see Path A note).
    if (skipRow && skipRow(child)) continue;

    // The handle comes from the link's `href`, not its visible text: TikTok
    // sometimes renders the account's display name there instead of its
    // handle (a real record, gem 80's study, #6666), and the comment path
    // downstream prefixes this value with "@" on the assumption it already
    // is a handle. `authorLinkText` (the visible text, whichever it is)
    // stays for the exclusion check below, so that text is still kept out
    // of the comment body regardless of which of the two it turned out to be.
    const authorLink = child.querySelector<HTMLAnchorElement>('a[href*="/@"]');
    const authorLinkText = authorLink?.textContent?.trim() ?? '';
    const authorHrefMatch = (authorLink?.getAttribute('href') ?? '').match(/\/@([^/?#]+)/);
    const author = authorHrefMatch?.[1] ?? 'unknown';

    // Longest non-author, non-UI, non-numeric text from among spans/p/div.
    const textCandidates = child.querySelectorAll<HTMLElement>('span, p, div');
    let text = '';
    for (const node of textCandidates) {
      const content = node.textContent?.trim() ?? '';
      if (!content || content.length < 2) continue;
      if (authorLinkText && content === authorLinkText) continue;
      if (NUMERIC_ONLY_RE.test(content)) continue;
      if (UI_LABEL_RE.test(content)) continue;
      if (content.length > text.length) text = content;
    }
    if (!text) continue;
    // L0-A: sticker-only → drop; sticker + text → strip placeholder, keep text.
    if (STICKER_PLACEHOLDER_RE.test(text)) continue;
    text = stripStickerPlaceholders(text);
    if (!text) continue;

    // Likes: first numeric-looking span that isn't a prefix of the text.
    let likes: number | undefined = undefined;
    const spans = child.querySelectorAll<HTMLElement>('span');
    for (const el of spans) {
      const t = el.textContent?.trim() ?? '';
      if (/^\d+(\.\d+)?[KkMm]?$/.test(t) && t !== text.slice(0, t.length)) {
        likes = parseEngagementNumber(t);
        break;
      }
    }

    comments.push({
      id: synthId(),
      author,
      text,
      surface_order: comments.length,
      parent_id: null,
      likes,
      replies_count: undefined,
    });
  }

  return comments;
}

function readLikeCount(commentNode: HTMLElement): number | undefined {
  // TikTok renders the like count near the comment. Selector is best-effort;
  // if TikTok rotates DOM, undefined is the correct fallback.
  const el =
    commentNode.querySelector<HTMLElement>('[data-e2e="comment-like-count"]') ??
    commentNode.querySelector<HTMLElement>('[data-e2e*="like-count"]');
  if (!el) return undefined;
  const raw = el.textContent?.trim() ?? '';
  return parseEngagementNumber(raw);
}

/**
 * TikTok compresses large counts: "1.2K", "3M". Returns undefined if unparsable
 * (better than lying with 0).
 */
export function parseEngagementNumber(raw: string): number | undefined {
  if (!raw) return undefined;
  if (!/^[\d.,]+\s*[KMB]?$/i.test(raw)) return undefined;
  // One reader for every platform (count-text.ts): a decimal comma ("1,2K") is 1200, not 12000.
  return parseCountText(raw);
}

// ─────────────────────────────────────────────────────────────────────────────
// UTIL
// ─────────────────────────────────────────────────────────────────────────────

function synthId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `syn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
