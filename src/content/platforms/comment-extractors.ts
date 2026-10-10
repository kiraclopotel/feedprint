// FeelingWise - Comment Extractors
// Reads comments FROM the DOM into RawComment objects for scoring/rewriting.
// Platform selectors are fragile — all extractors degrade gracefully (empty array, never throw).

import type { RawComment } from '../../analysis/comment-scorer';
import { isInPrivateChatSubtree } from './adapter';
import { parseCountText } from './count-text';

// --- Helpers ---

// The shared reader of the count text (count-text.ts). A comment with no readable like count is 0 here, as it always
// was: the caller adds the likes into the comment's signals and has no "unknown".
function parseLikeCount(text: string | null | undefined): number {
  return parseCountText(text) ?? 0;
}

// --- TikTok ---

/**
 * (post-followup-3) — universal wrapper-concat scrubber.
 *
 * MCP run #4 evidence: TikTok 2026's virtualized DOM exposes many comment
 * rows where the row wrapper textContent fuses
 * `username + body + timestamp + Răspunde + reply-count` into one string
 * — and BOTH the [data-e2e="comment-text"] direct path AND the longest-
 * span fallback can produce that wrapper text (the run-#3 startsWith
 * filter only addressed the fallback path).
 *
 * This scrubber runs on the FINAL chosen text regardless of source path.
 * It is GUARDED — only fires when the text actually looks like wrapper-
 * concat (starts with author handle) or has FW panel-header bleed; clean
 * comment bodies are passed through unchanged. This avoids false-positive
 * stripping on legitimate comments that happen to end with a timestamp-
 * like phrase.
 *
 * Strips, in order:
 *   1. FW panel-header text leak ("✦ Comentarii rescriseArată toate
 *      originalele…") — defensive; root-cause is overlay-vs-extraction
 *      contention, fixed separately.
 *   2. Leading author-handle prefix.
 *   3. Trailing "Răspunde<N>" / "Reply<N>" reply-count.
 *   4. Trailing timestamp (RO "În urmă cu N z/h/m/s/...", EN "N <unit> ago",
 *      compact "Nz"/"Nh"/etc., date abbreviation "MM-DD").
 */
function sanitizeTikTokCommentBody(raw: string, authorDisplayName: string): string {
  let cleaned = raw.trim();
  if (!cleaned) return '';

  // Step 1: strip leading FW panel-header bleed (very specific pattern,
  // safe to run unconditionally — only matches FW's own UI text).
  cleaned = cleaned
    .replace(
      /^(?:✦\s*Comentarii\s+rescrise\s*Arată\s+toate\s+originalele\s*|Arată\s+toate\s+(?:originalele|rescrise)\s*)+/u,
      '',
    )
    .trim();
  if (!cleaned) return '';

  // Step 2: gate the rest of the scrub. If text doesn't start with the
  // author's visible display name, treat it as already clean — don't
  // risk stripping a legitimate body that ends with a timestamp-shaped
  // phrase. This needs the VISIBLE display name (emojis and all) because
  // the wrapper-concat text in the DOM uses the visible form, not the
  // @handle — see the extractor loop's parallel authorHandle/
  // authorDisplayName split.
  const looksLikeWrapper = !!(
    authorDisplayName
    && authorDisplayName.length > 1
    && cleaned.startsWith(authorDisplayName)
    && cleaned.length > authorDisplayName.length
  );
  if (!looksLikeWrapper) return cleaned;

  // Step 3: strip leading display-name prefix and any joining punctuation.
  cleaned = cleaned
    .slice(authorDisplayName.length)
    .replace(/^[\s:·•\-—–]+/u, '')
    .trim();

  // Step 4: strip trailing reply-count: "Răspunde<N>" / "Reply<N>" /
  // bare "Răspunde" / bare "Reply".
  cleaned = cleaned.replace(/\s*(?:Răspunde|Reply)\s*\d*\s*$/iu, '').trim();

  // Step 5: strip trailing timestamp. Patterns:
  //   - Romanian: "În urmă cu N z/h/m/s/zile/ore/minute/secunde"
  //   - English: "N second(s)/minute(s)/hour(s)/day(s)/week(s)/year(s) ago"
  //   - Compact: "Nz" / "Nh" / "Nm" / "Ns" / "Nd" / "Nw" / "Ny"
  //   - Date abbreviation: "MM-DD" (e.g. "2-26")
  cleaned = cleaned
    .replace(
      /\s*(?:În\s+urmă\s+cu\s+)?\d+\s*(?:z(?:ile)?|h|ore|m(?:in(?:ute)?)?|s(?:ec(?:unde)?)?|d(?:ays?)?|w(?:eeks?)?|y(?:ears?)?)(?:\s+ago)?\s*$/iu,
      '',
    )
    .trim();
  cleaned = cleaned.replace(/\s*\d+-\d+\s*$/, '').trim();

  return cleaned;
}

// (post-audit) — wrapper-tail metadata-only matcher. Used to
// skip candidate text nodes whose contents are PURELY composed of comment-
// row metadata (date abbreviation, RO/EN timestamp, Răspunde<N>/Reply<N>
// reply-count) — i.e. there's no actual comment body left.  Pre-fix, when
// the comment-body element was missing on a row (sticker comment, deleted
// content, etc.) the longest-span fallback grabbed whatever non-empty text
// existed in the row — usually the metadata. That fed the LLM with junk
// input ("4-10Răspunde0") which it couldn't rewrite, so no card rendered.
// Post-fix: rejected here, the row falls through to `if (!text) continue;`
// and skips entirely. MCP run #7 evidence: 8 of 12 sanitizer calls saw
// pure metadata-tail input on dramafarastop / vixaa_pn permalinks.
const METADATA_TAIL_RE =
  /^(?:\s*(?:\d+-\d+|\d+\s*(?:z(?:ile)?|h|ore|m(?:in(?:ute)?)?|s(?:ec(?:unde)?)?|d(?:ays?)?|w(?:eeks?)?|y(?:ears?)?)(?:\s+ago)?|În\s+urmă\s+cu\s+\d+\s+\w+|Răspunde\s*\d*|Reply\s*\d*)\s*)+$/iu;

function extractTikTokComments(root: ParentNode = document): RawComment[] {
  // (post-G1.7) — TikTok 2026 build uses a virtualized div-tree:
  // [class*="DivCommentListContainer"] → DivVirtualItemContainer →
  // DivCommentObjectWrapper/DivCommentItemWrapper → [data-e2e^="comment-username-"]
  // items. Try the new container first; legacy [data-e2e="comment-list"]
  // remains second for backward-compat; structural <ul> fallback last.
  let container = root.querySelector<HTMLElement>(
    '[class*="DivCommentListContainer"]'
  );
  if (!container || container.children.length === 0) {
    container = root.querySelector<HTMLElement>('[data-e2e="comment-list"]');
  }

  // Structural fallback: find UL with comment-like children
  if (!container) {
    const allULs = root.querySelectorAll<HTMLElement>('ul');
    for (const ul of allULs) {
      if (ul.children.length < 2) continue;
      let commentLike = 0;
      for (const child of Array.from(ul.children).slice(0, 5)) {
        if (child instanceof HTMLElement && child.querySelector('a[href*="/@"]')) {
          commentLike++;
        }
      }
      if (commentLike >= 2) {
        container = ul;
        break;
      }
    }
  }

  if (!container) return [];

  // (post-G1.7) — on the virtualized DOM, container.children are
  // DivVirtualItemContainer wrappers; the actual comment row is nested as
  // DivCommentObjectWrapper / DivCommentItemWrapper, identifiable by
  // [data-e2e^="comment-username-"]. Walk up from each username marker to
  // the comment-row ancestor. When no markers are present (legacy DOM),
  // fall back to direct .children iteration.
  const usernameMarkers = container.querySelectorAll<HTMLElement>(
    '[data-e2e^="comment-username-"]'
  );
  let children: HTMLElement[];
  if (usernameMarkers.length > 0) {
    const rows: HTMLElement[] = [];
    const seen = new Set<HTMLElement>();
    for (const marker of usernameMarkers) {
      let row: HTMLElement | null = marker;
      while (
        row && row !== container
        && !/CommentObjectWrapper|CommentItemWrapper/.test(row.className || '')
      ) {
        row = row.parentElement;
      }
      if (row && row !== container && !seen.has(row)) {
        seen.add(row);
        rows.push(row);
      }
    }
    children = rows;
  } else {
    children = Array.from(container.children) as HTMLElement[];
  }

  const comments: RawComment[] = [];

  // Known UI labels to skip (multi-language)
  const UI_LABEL = /^(Reply|Răspunde|Replies|Pinned|Fixat|Like|Share|Report|Vezi .* de r[aă]spunsuri|See \d+ repl|View \d+ repl|\u2026)$/i;

  // TikTok engagement-notification cards rendered INSIDE the
  // comments list — "Ana, RaduEx ți-a apreciat
  // videoclipul. 3-25" style. They match the comment-container shape
  // (have author + timestamp) so the structural extractor treats them as
  // real comments and sends them to the rewriter. Filter them out: any row
  // whose longest-text candidate contains these notification phrases is
  // dropped entirely. Patterns cover EN + RO.
  const NOTIFICATION_PATTERNS = [
    /ți-a\s+apreciat\s+videoclipul/i,
    /ți-a\s+apreciat\s+comentariul/i,
    /și\s+alți\s+\d+\s+ți-a\s+apreciat/i,
    /a\s+apreciat\s+videoclipul/i,
    /liked\s+your\s+video/i,
    /liked\s+your\s+comment/i,
    /really\s+liked\s+your/i,
    /(?:started|a\s+început\s+să)\s+urmăre(?:ște|sc)\s+/i,
    /(?:started\s+following|followed\s+you)/i,
  ];
  function isNotificationRow(text: string): boolean {
    return NOTIFICATION_PATTERNS.some(p => p.test(text));
  }

  // L0-A TikTok renders sticker comments as the literal placeholder
  // string "[Sticker]" (or localized variants — RO "[Autocolant]", FR
  // "[Autocollant]"). The comment is a sticker image, not text — there's
  // nothing to scan, but the pipeline still saw it as a 9-char comment and
  // ran the LLM. Drop these rows entirely. Match: row whose text is JUST the
  // bracketed placeholder, possibly with surrounding whitespace.
  const STICKER_PLACEHOLDER = /^\s*\[(?:Sticker|Autocolant|Autocollant|Стикер|Naklejka|Sticker[a-z]*|Aufkleber|Pegatina|Adesivo)\]\s*$/i;
  function isStickerPlaceholder(text: string): boolean {
    return STICKER_PLACEHOLDER.test(text);
  }

  for (const child of children) {
    // Skip non-comment elements (loading spinners, etc.)
    if (child.childElementCount === 0) continue;

    // TikTok 2026 rows render two anchors with `/@user` hrefs: the avatar
    // link (img inside, empty text) and the username link (text content).
    // Two values are needed:
    //   • `authorDisplayName` — the VISIBLE text, often containing emojis
    //     and stylistic characters ("🐢 Example Name 🐢 ❤️"). The body sanitizer
    //     needs this to detect wrapper-concat where the DOM has merged
    //     "<displayname> <body> <timestamp>" into one text node.
    //   • `authorHandle` — the canonical @username from the link's href
    //     attribute (`/@example_commenter` → `example_commenter`), emoji-free. This is
    //     what the forensic record stores, since the chain entry must be a
    //     stable identifier that survives display-name changes and is
    //     legible to a court / school / parent reviewing the export.
    // Scan all `a[href*="/@"]` once and harvest BOTH; pick the first link
    // that yields each (text and href can come from different anchors —
    // avatar link has the href but empty text, name link has both).
    const authorLinks = child.querySelectorAll<HTMLAnchorElement>('a[href*="/@"]');
    let authorDisplayName = '';
    let authorHandle = '';
    for (const link of authorLinks) {
      if (!authorDisplayName) {
        const t = link.textContent?.trim() ?? '';
        if (t.length > 0) authorDisplayName = t;
      }
      if (!authorHandle) {
        const href = link.getAttribute('href') ?? '';
        // `/@example_commenter` or `/@example_commenter?lang=...` or
        // `/@example_commenter/video/123...` — capture the slug after the @.
        const m = href.match(/^\/@([^/?#]+)/);
        if (m && m[1]) authorHandle = m[1];
      }
      if (authorDisplayName && authorHandle) break;
    }

    // (post-G1.7) — new DOM exposes the clean comment body via
    // [data-e2e="comment-text"]. Prefer it directly to avoid the longest-
    // span heuristic picking a wrapper that concatenates author + body +
    // timestamp. Fall back to the longest-span scan when the marker is
    // absent (legacy DOM or A/B variant).
    let text = '';
    const directTextEl = child.querySelector<HTMLElement>('[data-e2e="comment-text"]');
    if (directTextEl) {
      text = directTextEl.textContent?.trim() ?? '';
    }
    if (!text) {
      // Legacy path: longest NON-author, NON-UI text node.
      const textNodes = child.querySelectorAll('span, p, div');
      for (const node of textNodes) {
        const content = node.textContent?.trim() ?? '';
        if (!content || content.length < 2) continue;
        // Skip if matches author's visible display name EXACTLY.
        if (authorDisplayName && content === authorDisplayName) continue;
        // (post-followup-2) — TikTok 2026 reply rows have
        // no [data-e2e="comment-text"] marker; the longest-span fallback
        // was picking the row wrapper whose textContent fuses
        // `username + body + timestamp + Răspunde + reply-count` into one
        // string (V2/V3/V4 in MCP run #3). The wrapper text always STARTS
        // WITH the visible display name — skip those candidates and let
        // the actual body span/p node win.
        if (
          authorDisplayName && authorDisplayName.length > 1
          && content.startsWith(authorDisplayName)
          && content.length > authorDisplayName.length
        ) continue;
        // Skip numeric-only (like counts, timestamps)
        if (/^[\d,.KkMm\s]+$/.test(content)) continue;
        // (post-audit) — skip wrapper-tail metadata-only candidates
        // (date abbrev / RO+EN timestamp / Răspunde<N> / Reply<N>). When the
        // comment-body element is missing on a row, the row's only non-empty
        // text is the metadata footer — selecting it as "longest" feeds the
        // LLM junk input. Reject here so the row falls through to skip.
        if (METADATA_TAIL_RE.test(content)) continue;
        // Skip known UI labels
        if (UI_LABEL.test(content)) continue;
        // Pick longest remaining
        if (content.length > text.length) {
          text = content;
        }
      }
    }
    if (!text) continue;

    // (post-followup-3) — universal scrub for wrapper-concat
    // artifacts (author prefix + timestamp suffix + Răspunde-N suffix +
    // FW panel-header bleed) regardless of which path produced the text.
    // Run #4 found the [data-e2e="comment-text"] direct path was also
    // returning wrapper concat for many rows, bypassing run-#3's filter.
    text = sanitizeTikTokCommentBody(text, authorDisplayName);
    if (!text || text.length < 2) continue;

    // skip TikTok engagement notification cards masquerading as
    // real comments.
    if (isNotificationRow(text)) continue;
    // L0-A: skip sticker placeholders ("[Sticker]" etc.) — image content.
    if (isStickerPlaceholder(text)) continue;

    // Like count: look for a number near a heart/like element
    let likes = 0;
    const countEls = child.querySelectorAll('span');
    for (const el of countEls) {
      const t = el.textContent?.trim() ?? '';
      if (/^\d+(\.\d+)?[KkMm]?$/.test(t) && t !== text.slice(0, t.length)) {
        likes = parseLikeCount(t);
        break;
      }
    }

    // Pinned: check for "Pinned" text
    const isPinned = child.textContent?.includes('Pinned') ?? false;

    comments.push({
      text,
      likes,
      replies: 0,
      isPinned,
      isCreatorReply: false,
      isHighlighted: false,
      authorHandle,
      timestamp: '',
      //  () — per-comment DOM WeakRef so consumers
      // can render against the actual comment row instead of the video
      // container. Falls back to container-level WeakRef in the consumer
      // when extractor wasn't updated for that platform.
      domRef: new WeakRef(child),
    });
  }

  return comments;
}

// --- Instagram ---

function extractInstagramComments(): RawComment[] {
  // META-1 DM gate: pick the first article that is NOT inside a private
  // conversation subtree (role="log" chat-log or a chat-overlay dialog).
  // Pre-fix `document.querySelector('article')` grabbed the first article in
  // document order — a Messenger/DM bubble rendered as an <article> would win
  // and its private text would flow into the rewrite/forensic pipeline.
  const article = Array.from(document.querySelectorAll('article'))
    .find((a) => !isInPrivateChatSubtree(a));
  if (!article) return [];

  const commentList = article.querySelector('ul');
  if (!commentList) return [];

  const items = commentList.querySelectorAll('li');
  const comments: RawComment[] = [];

  for (const item of items) {
    const authorLink = item.querySelector('a[href^="/"]');
    const authorHandle = authorLink?.textContent?.trim() ?? '';
    if (!authorHandle) continue;

    // Text: innerText of the comment span, excluding username
    const spans = item.querySelectorAll('span');
    let text = '';
    for (const span of spans) {
      const content = span.textContent?.trim() ?? '';
      if (content.length > text.length && content !== authorHandle) {
        text = content;
      }
    }
    if (!text) continue;

    comments.push({
      text,
      likes: 0, // Rarely visible in DOM on web
      replies: 0,
      isPinned: false,
      isCreatorReply: false,
      isHighlighted: false,
      authorHandle,
      timestamp: '',
    });
  }

  return comments;
}

// --- Facebook ---

function extractFacebookComments(): RawComment[] {
  // Facebook comments live inside UL elements within article containers
  const articles = document.querySelectorAll<HTMLElement>('div[role="article"]');
  const comments: RawComment[] = [];
  // NOTE: this is a SECONDARY path. It was instrumented once and the counters
  // never fired on a real Facebook browse, because the adapter's own
  // `_extractComments` (platforms/facebook.ts) is what actually runs. The
  // extraction-yield counters live there.

  for (const article of articles) {
    // META-1 DM gate: Messenger renders each chat bubble as a
    // `<div role="article" aria-label="">` nested in a `<div role="log">`
    // (and the pop-out chat window as a chat-overlay dialog). Skip any
    // article inside such a subtree so private DM text never enters the
    // comment-rewrite / forensic pipeline.
    if (isInPrivateChatSubtree(article)) continue;

    const lists = article.querySelectorAll<HTMLElement>('ul');
    for (const ul of lists) {
      const items = ul.querySelectorAll<HTMLElement>(':scope > li');
      if (items.length < 1) continue;

      for (const item of items) {
        // Author: link with profile-like href
        const authorLink = item.querySelector<HTMLAnchorElement>('a[role="link"]');
        const authorHandle = authorLink?.textContent?.trim() ?? '';
        if (!authorHandle) continue;

        // Text: longest div[dir="auto"] that isn't the author name
        const textNodes = item.querySelectorAll<HTMLElement>('div[dir="auto"]');
        let text = '';
        for (const node of textNodes) {
          const content = node.textContent?.trim() ?? '';
          if (content.length > text.length && content !== authorHandle) {
            text = content;
          }
        }
        if (!text || text.length < 3) continue;

        // Like count: look for aria-label with "like" and a number
        let likes = 0;
        const likeEl = item.querySelector<HTMLElement>('[aria-label*="like" i]');
        if (likeEl) {
          const match = likeEl.getAttribute('aria-label')?.match(/(\d+)/);
          if (match) likes = parseInt(match[1], 10);
        }

        comments.push({
          text,
          likes,
          replies: 0,
          isPinned: false,
          isCreatorReply: false,
          isHighlighted: false,
          authorHandle,
          timestamp: '',
        });
      }
    }
  }

  return comments;
}

// --- Main entry point ---

export function extractComments(platform: string, root?: ParentNode): RawComment[] {
  try {
    switch (platform) {
      case 'tiktok':
        return extractTikTokComments(root);
      case 'instagram':
        return extractInstagramComments();
      case 'facebook':
        return extractFacebookComments();
      default:
        return [];
    }
  } catch (e) {
    console.warn(`[FeelingWise] Comment extraction failed for ${platform}:`, e);
    return [];
  }
}
