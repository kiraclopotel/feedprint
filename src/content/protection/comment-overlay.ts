// FeelingWise - Comment Overlay
//
// In-place text-node swap for comment rewrites. The original comment row
// (author, avatar, like count, timestamp) stays as-is; only the text content
// is replaced. No yellow frames, no header, no category chip — native UI
// preserved.
//
// Originally introduced as the child path for stealth educational
// rewrites (feature retired 2026-04-28). The  refactor // extended the in-place mechanic to the teen path per memory
// `feedback_tiktok_overlay_shape.md` ("in-place native, not yellow-frame
// card"). Both paths now use `findCommentEntries` → `swapCommentTextInPlace`.

import { isInspectionTab } from '../post-path/inspection-mode';
import { clearRewriteMarks } from '../markers/ai-mark';
import { fwDebug } from '../fw-log';

// --- Platform text size detection ---

function getPlatformFontSize(): number {
  const host = window.location.hostname;
  if (host.includes('tiktok.com')) return 14;
  if (host.includes('youtube.com')) return 13;
  if (host.includes('instagram.com')) return 14;
  return 13;
}

// ─── In-place comment-text swap (origin; -extended to teen) ───

// Platform DOM conventions. Kept in sync with the extractors in
// `src/content/platforms/comment-extractors.ts` and
// `src/content/platforms/tiktok-bundle.ts`.
const UI_LABEL_RE = /^(Reply|Răspunde|Replies|Pinned|Fixat|Like|Share|Report|Vezi .* de r[aă]spunsuri|See \d+ repl|View \d+ repl|\u2026)$/i;
const NUMERIC_ONLY_RE = /^[\d,.KkMm\s]+$/;
// TikTok engagement notification cards ("X ți-a apreciat
// videoclipul", "Y liked your video") render INSIDE the comments list and
// the structural walk mistakes them for real comments. The patterns are
// CONTAIN-style (not START-with) because TikTok glues multiple names in
// front of the notification phrase ("Ana, RaduEx ți-a apreciat
// videoclipul. 3-25"). Filter applied to candidate text after it survives
// the author / UI / numeric checks.
const NOTIFICATION_RE = /(?:ți-a\s+apreciat\s+(?:videoclipul|comentariul)|și\s+alți\s+\d+\s+ți-a\s+apreciat|a\s+apreciat\s+videoclipul|liked\s+your\s+(?:video|comment)|really\s+liked\s+your|(?:started\s+following|followed\s+you)|a\s+început\s+să\s+urmăre(?:ște|sc))/i;

export interface CommentEntry {
  /** Comment row element (the `<li>` or equivalent container). */
  rootEl: HTMLElement;
  /** The inner element whose `textContent` IS the visible comment text. */
  textEl: HTMLElement;
  /** Author handle as it appears in the DOM (may include leading `@`). */
  author: string;
  /** Current visible text. */
  text: string;
}

/**
 * Walk a comments container and return one `CommentEntry` per visible comment.
 *
 * Mirrors the extractor heuristics used by `extractTikTokComments` + the
 * YouTube/Instagram/Facebook extractors, but also carries the DOM refs
 * needed for in-place text-node swaps. Skips entries already marked with
 * `data-fw-rewritten` (idempotence across observer re-runs). Empty array
 * when the container shape isn't recognized — caller should no-op, not crash.
 */
export function findCommentEntries(
  commentsContainer: HTMLElement,
  platform: string,
): CommentEntry[] {
  const out: CommentEntry[] = [];

  if (platform === 'tiktok') {
    // Path A: anchor on the comment ROW. Modern TikTok DOM exposes each
    // comment as a `[class*="DivCommentItemWrapper"]` DIV; legacy variants
    // still use `[data-e2e="comment-level-1"]` as the row. Prefer the
    // modern selector; fall back to legacy when the modern returns zero so
    // pre-rotation TikTok pages and test fixtures continue to extract.
    let eNodes = Array.from(
      commentsContainer.querySelectorAll<HTMLElement>('[class*="DivCommentItemWrapper"]'),
    );
    let nodeSourceLabel = 'DivCommentItemWrapper';
    if (eNodes.length === 0) {
      eNodes = Array.from(
        commentsContainer.querySelectorAll<HTMLElement>('[data-e2e="comment-level-1"]'),
      );
      nodeSourceLabel = 'comment-level-1';
    }
    if (eNodes.length > 0) {
      let pathABuilt = 0;
      let pathAFailed = 0;
      let firstFailureSample: string | null = null;
      for (const node of eNodes) {
        const entry = buildEntryFromTikTokNode(node);
        if (entry) {
          out.push(entry);
          pathABuilt++;
        } else {
          pathAFailed++;
          if (firstFailureSample === null) {
            // Dump the first failing node so its structure can be inspected.
            // Truncated to 800 chars to keep the console readable.
            firstFailureSample = node.outerHTML.slice(0, 800);
          }
        }
      }
      if (out.length === 0 || pathAFailed > 0) {
        console.log(
          `[FeelingWise] findCommentEntries tiktok Path A: ${eNodes.length} ${nodeSourceLabel} nodes, built ${pathABuilt} entries, ${pathAFailed} failed.`,
        );
        if (firstFailureSample) {
          // The node's HTML carries the comment and its author: only behind the debug switch.
          fwDebug('[FeelingWise] findCommentEntries first failing node outerHTML (truncated):\n' + firstFailureSample);
        }
      }
      return out;
    }
    // Path B: structural fallback — iterate UL children.
    const children = Array.from(commentsContainer.children) as HTMLElement[];
    let pathBBuilt = 0;
    let pathBSkippedRewritten = 0;
    let pathBSkippedEmpty = 0;
    let pathBFailed = 0;
    for (const child of children) {
      if (child.dataset.fwRewritten === 'true') { pathBSkippedRewritten++; continue; }
      if (child.childElementCount === 0) { pathBSkippedEmpty++; continue; }
      const entry = buildEntryFromStructuralChild(child);
      if (entry) { out.push(entry); pathBBuilt++; } else { pathBFailed++; }
    }
    if (eNodes.length === 0 && children.length > 0 && out.length === 0) {
      console.log(
        `[FeelingWise] findCommentEntries tiktok Path B: container has ${children.length} children — no data-e2e="comment-level-1" found, structural walk found ${pathBBuilt} entries (${pathBSkippedRewritten} already-rewritten, ${pathBSkippedEmpty} empty children, ${pathBFailed} no-author-or-no-text). Selectors may need update for current TikTok DOM.`,
      );
    }
    return out;
  }

  if (platform === 'youtube') {
    const threads = commentsContainer.querySelectorAll<HTMLElement>(
      'ytd-comment-thread-renderer',
    );
    for (const thread of threads) {
      if (thread.dataset.fwRewritten === 'true') continue;
      const textEl = thread.querySelector<HTMLElement>('#content-text');
      const authorEl = thread.querySelector<HTMLElement>('#author-text');
      if (!textEl) continue;
      const text = textEl.textContent?.trim() ?? '';
      if (!text) continue;
      out.push({
        rootEl: thread,
        textEl,
        author: authorEl?.textContent?.trim() ?? '',
        text,
      });
    }
    return out;
  }

  if (platform === 'instagram' || platform === 'facebook') {
    // Both flat-UL platforms: each LI is a comment row. Use the structural picker.
    const items = commentsContainer.querySelectorAll<HTMLElement>(':scope > li, li');
    const seenRoots = new Set<HTMLElement>();
    for (const item of items) {
      if (item.dataset.fwRewritten === 'true') continue;
      if (seenRoots.has(item)) continue;
      if (item.childElementCount === 0) continue;
      seenRoots.add(item);
      const entry = buildEntryFromStructuralChild(item);
      if (entry) out.push(entry);
    }
    return out;
  }

  return out;
}

/**
 * single-root variant of `findCommentEntries` for the
 * comment-batch FORENSIC_LOG rewrite-application path in `content/index.ts:
 * flushBatch`. Pre-the batch path generated a per-comment rewrite via
 * `neutralizeText` and stamped it on the chain record but NEVER applied it to
 * the comment DOM — `renderTeenMarker` then mounted on a comment whose body
 * still showed the original toxic text. The marker v2 toggle (designed
 * to swap between rewrite/original on click) had nothing to swap to, and
 * VISION §1.2 protection mandate ("manipulation softened in delivery") was
 * violated for every batch-flagged comment on FB / X / IG / YT.
 *
 * Mirrors the per-platform dispatch of `findCommentEntries`:
 * - 'twitter' → `[data-testid="tweetText"]` (X comments are articles whose
 *   text holder follows the same DOM contract as posts)
 * - 'tiktok'  → `buildEntryFromTikTokNode` (data-e2e selectors first)
 * - 'facebook' / 'instagram' / 'youtube' / fallback → structural picker
 *   (longest non-author / non-UI / non-numeric / non-notification span)
 *
 * Returns null when the root has no recognizable text holder. Caller must
 * no-op on null (graceful fallback — chain record still landed).
 */
export function buildCommentEntryForRoot(
  rootEl: HTMLElement,
  platform: string,
): CommentEntry | null {
  if (rootEl.dataset.fwRewritten === 'true') return null;

  // per-platform production-shape map of `domRef`.
  // Per a reading of each adapter's PostContent.push() site:
  //   • twitter (`twitter.ts:659`)   → domRef = tweetEl, the
  //     `[data-testid="tweetText"]` element (TEXT-level)
  //   • facebook (`facebook.ts:240` + _extractComments push at 426/449)
  //                                  → domRef = textEl (TEXT-level)
  //   • youtube (`youtube.ts:182`)   → domRef = result.element from
  //     `extractTextWithFallback` (TEXT-level, e.g. `#content-text`)
  //   • instagram (`instagram.ts:246`) → domRef = li (ROW-level — descend
  //     via `buildEntryFromStructuralChild` to find the longest text span)
  //   • tiktok (`tiktok.ts:238/295/344`) → comment domRef varies; use
  //     `buildEntryFromTikTokNode` which handles both data-e2e nodes
  //     and structural children.
  //
  // Live verification on an X profile with mixed top-comments confirmed
  // the initial `querySelector('[data-testid="tweetText"]')`-only path
  // returned null for every X comment because the rootEl IS the tweetText
  // element (not a wrapper). Fix: treat text-level rootEls directly as
  // textEl.

  if (platform === 'twitter') {
    const textEl = rootEl.matches('[data-testid="tweetText"]')
      ? rootEl
      : rootEl.querySelector<HTMLElement>('[data-testid="tweetText"]');
    if (!textEl) return null;
    const text = textEl.textContent?.trim() ?? '';
    if (!text) return null;
    return { rootEl, textEl, author: '', text };
  }

  if (platform === 'facebook' || platform === 'youtube') {
    const text = rootEl.textContent?.trim() ?? '';
    if (!text) return null;
    return { rootEl, textEl: rootEl, author: '', text };
  }

  if (platform === 'tiktok') {
    return buildEntryFromTikTokNode(rootEl);
  }

  // instagram + fallback — descend to find longest non-author span.
  return buildEntryFromStructuralChild(rootEl);
}

function buildEntryFromTikTokNode(node: HTMLElement): CommentEntry | null {
  if (node.dataset.fwRewritten === 'true') return null;

  // Modern TikTok DOM (live MCP-confirmed): the row is a
  // `[class*="DivCommentItemWrapper"]` DIV; the username link sits as a
  // sibling of `[data-e2e="comment-level-1"]` inside the row, and the inner
  // text element is `.TUXText.TUXText--tiktok-sans` nested inside the
  // `comment-level-1` SPAN. Author scan picks the FIRST `a[href^="/@"]` with
  // non-empty trimmed text — the avatar link's text is empty, the username
  // link carries the handle.
  //
  // Legacy fallback: when `node` is the `comment-level-1` text-wrapper itself
  // (older TikTok variant or test fixtures), the `comment-text-1` /
  // `comment-username-1` selectors still resolve inside `node`. The author
  // pickup walks via `a[href*="/@"]` which still matches.
  let textEl: HTMLElement | null =
    node.querySelector<HTMLElement>('[data-e2e="comment-level-1"] .TUXText') ??
    node.querySelector<HTMLElement>('[data-e2e="comment-text-1"] span') ??
    node.querySelector<HTMLElement>('[data-e2e="comment-text-1"]') ??
    node.querySelector<HTMLElement>('[data-e2e="comment-text"] span') ??
    node.querySelector<HTMLElement>('[data-e2e="comment-text"]') ??
    node.querySelector<HTMLElement>('span[data-e2e*="comment-text"]');

  let author = '';
  const profileLinks = node.querySelectorAll<HTMLAnchorElement>('a[href^="/@"], a[href*="/@"]');
  for (const link of profileLinks) {
    const t = link.textContent?.trim() ?? '';
    if (t.length > 0) {
      author = t;
      break;
    }
  }
  if (!author) {
    author =
      node.querySelector<HTMLElement>('[data-e2e="comment-username-1"]')?.textContent?.trim() ??
      node.querySelector<HTMLElement>('[data-e2e="comment-username"]')?.textContent?.trim() ??
      '';
  }

  if (textEl) {
    const text = textEl.textContent?.trim() ?? '';
    // drop engagement-notification cards masquerading as comments.
    if (text && text !== author && !NOTIFICATION_RE.test(text)) {
      return { rootEl: node, textEl, author, text };
    }
  }

  // Fallback: data-e2e text attr missing/renamed. Find longest
  // non-author / non-UI / non-numeric / non-notification span|p|div.
  const candidates = node.querySelectorAll<HTMLElement>('span, p, div');
  let best: HTMLElement | null = null;
  let bestLen = 0;
  for (const c of candidates) {
    const content = c.textContent?.trim() ?? '';
    if (!content || content.length < 2) continue;
    if (author && content === author) continue;
    if (NUMERIC_ONLY_RE.test(content)) continue;
    if (UI_LABEL_RE.test(content)) continue;
    if (NOTIFICATION_RE.test(content)) continue; //
    // Skip elements whose text is just the union of all their children —
    // we want a LEAF-ish element so assigning textContent doesn't nuke the
    // author/like-row chrome around it.
    const hasDescendantMatch = Array.from(c.children).some(ch => {
      const cc = (ch as HTMLElement).textContent?.trim() ?? '';
      return cc.length > 0 && cc === content;
    });
    if (hasDescendantMatch) continue;
    if (content.length > bestLen) {
      best = c;
      bestLen = content.length;
    }
  }
  if (!best) {
    // Leaf-node path: `node` IS the body text element (no descendant
    // beats it). TT adapter's findTikTokRowBodyEl points domRef at the
    // longest TUXText span by design — when that span is itself a leaf,
    // the descendant scan returns nothing and the swap would silently
    // skip. Treat node as its own textEl so the rewrite lands.
    const ownText = node.textContent?.trim() ?? '';
    if (
      ownText.length >= 2 &&
      (!author || ownText !== author) &&
      !NUMERIC_ONLY_RE.test(ownText) &&
      !UI_LABEL_RE.test(ownText) &&
      !NOTIFICATION_RE.test(ownText)
    ) {
      return { rootEl: node, textEl: node, author, text: ownText };
    }
    return null;
  }
  return {
    rootEl: node,
    textEl: best,
    author,
    text: best.textContent?.trim() ?? '',
  };
}

function buildEntryFromStructuralChild(child: HTMLElement): CommentEntry | null {
  const authorLink = child.querySelector<HTMLAnchorElement>(
    'a[href*="/@"], a[href^="/"], a[role="link"]',
  );
  const author = authorLink?.textContent?.trim() ?? '';

  // Longest non-author, non-UI, non-numeric, non-notification span/p/div
  // BELONGING TO THIS COMMENT (2026-09-19).
  //
  // The walk is over child.querySelectorAll, which is the whole subtree, and
  // Facebook and Instagram nest a comment's replies inside its own row. So the
  // longest text under a parent comment could be a REPLY's text, or a wrapper
  // holding both. Either way the entry came back with rootEl belonging to one
  // comment and textEl belonging to another.
  //
  // What followed: applyCommentRewriteTerminal writes the rewrite into textEl
  // and then verifies textEl.textContent equals what it just wrote, which is
  // true by construction. So the flagged comment stayed untouched and visible,
  // an unrelated reply was overwritten with a rewrite meant for somebody else,
  // and the terminal returned 'rewritten'.
  //
  // Two guards, both bounded to this subtree: skip a candidate that sits inside
  // a nested comment root, and skip one that contains a nested comment root,
  // which is the wrapper case and the one that wins on length.
  const insideThisCommentOnly = (node: HTMLElement): boolean => {
    const nestedAbove = node.closest('li, [role="article"]');
    if (nestedAbove && nestedAbove !== child && child.contains(nestedAbove)) return false;
    const nestedBelow = node.querySelector('li, [role="article"]');
    if (nestedBelow && child.contains(nestedBelow)) return false;
    return true;
  };

  const candidates = child.querySelectorAll<HTMLElement>('span, p, div');
  let best: HTMLElement | null = null;
  let bestLen = 0;
  for (const node of candidates) {
    const content = node.textContent?.trim() ?? '';
    if (!content || content.length < 2) continue;
    if (!insideThisCommentOnly(node)) continue;
    if (author && content === author) continue;
    if (NUMERIC_ONLY_RE.test(content)) continue;
    if (UI_LABEL_RE.test(content)) continue;
    if (NOTIFICATION_RE.test(content)) continue; //
    if (content.length > bestLen) {
      best = node;
      bestLen = content.length;
    }
  }
  if (!best) {
    // Leaf-rootEl path: rootEl IS the text-bearing element (no longer
    // descendant carries text). IG permalink + TT body pickers point
    // domRef at a leaf span by design — the structural-child walk has
    // nothing to descend to. Treat the rootEl itself as the textEl so the
    // text-swap path (`swapCommentTextInPlace`) runs against it directly.
    // Reapply the same filters used for the descendant scan — author
    // strings, numeric-only labels, UI chrome, and notification cards
    // must not pass through this fallback.
    const ownText = child.textContent?.trim() ?? '';
    if (
      ownText.length >= 2 &&
      (!author || ownText !== author) &&
      !NUMERIC_ONLY_RE.test(ownText) &&
      !UI_LABEL_RE.test(ownText) &&
      !NOTIFICATION_RE.test(ownText)
    ) {
      return { rootEl: child, textEl: child, author, text: ownText };
    }
    return null;
  }

  return {
    rootEl: child,
    textEl: best,
    author,
    text: best.textContent?.trim() ?? '',
  };
}

/**
 * Find the deepest descendant of `root` whose first child is a non-empty
 * text node. Returns `root` itself when no descendant matches (root is the
 * leaf), or when `root` has no children at all.
 *
 * Used by `swapCommentTextInPlace` to anchor the typography snapshot on the
 * element that actually paints the visible text. On TikTok Path A the
 * `[data-e2e="comment-text-1"] span` outer wrapper may carry display rules
 * (e.g. font-size 0 to collapse inline-block whitespace) that DON'T reflect
 * the inner span's rendered font. Snapshotting the outer would lock the
 * wrong typography on the rewrite.
 */
function findInnermostTextHost(root: HTMLElement): HTMLElement {
  let current: HTMLElement = root;
  // Bounded walk so a degenerate DOM can't loop indefinitely.
  for (let depth = 0; depth < 8; depth++) {
    const first = current.firstChild;
    if (first && first.nodeType === Node.TEXT_NODE) {
      const txt = first.nodeValue ?? '';
      if (txt.trim().length > 0) return current;
    }
    // Descend into the first element child whose textContent matches the
    // current node's textContent (i.e. the content actually flows through
    // that child, not a sibling). If no element child carries the text,
    // current is the host.
    const target = (current.textContent ?? '').trim();
    let next: HTMLElement | null = null;
    for (const child of Array.from(current.children)) {
      if (!(child instanceof HTMLElement)) continue;
      const childText = (child.textContent ?? '').trim();
      if (childText === target && childText.length > 0) {
        next = child;
        break;
      }
    }
    if (!next) return current;
    current = next;
  }
  return current;
}

/**
 * Resolve a non-zero font-size by walking outward from `start` toward
 * `entry.textEl`'s ancestors until a parsable, non-zero value is found.
 * Falls back to the empty string when nothing usable is found — caller skips
 * applying that property so the browser's natural inheritance takes over.
 */
function resolveNonZeroFontSize(start: HTMLElement, ceiling: HTMLElement | null): string {
  let cursor: HTMLElement | null = start;
  for (let depth = 0; depth < 10 && cursor; depth++) {
    try {
      const cs = window.getComputedStyle(cursor);
      const fs = cs.fontSize;
      const px = parseFloat(fs);
      if (!Number.isNaN(px) && px > 0) return fs;
    } catch {
      /* defensive — jsdom can throw on detached nodes */
    }
    if (ceiling && cursor === ceiling) break;
    cursor = cursor.parentElement;
  }
  return '';
}

/**
 * Swap a single comment's visible text to `rewrittenText` in place. Preserves
 * author, avatar, like count, timestamp, and any other chrome — only the text
 * element's `textContent` changes. Marks the root with `data-fw-rewritten`
 * so repeat walks skip it.
 *
 * Intentionally NOT touching child nodes beyond `textContent` assignment —
 * preserves the caret position / selection behavior that a real edit would
 * also trigger, and avoids wiping platform-injected tracking attributes we
 * don't own.
 */
export function swapCommentTextInPlace(entry: CommentEntry, rewrittenText: string): void {
  // Inspection pass (dashboard-opened tab): observe only, never mutate. The
  // caller's terminal proof then reads 'unresolved', which records honestly.
  if (isInspectionTab()) return;
  // Preserve color + font so the rewrite text matches the platform's native
  // typography. Setting `textEl.textContent` nukes nested spans, leaving the
  // rewrite as a plain text-node that inherits styles from the textEl
  // itself. On X tweetText / FB story_message / YT #content-text, the inner
  // spans often carry color, font-family, font-weight, line-height — losing
  // them produces visible differences from neighboring native text.
  //
  // Snapshot strategy: walk INWARD from `entry.textEl` to find the deepest
  // descendant element whose first child is a Text node. That element is the
  // one that actually paints the visible characters; its computed style IS
  // the typography the rewrite needs to inherit. The textEl itself can be a
  // wrapper (TikTok Path A: `[data-e2e="comment-text-1"] span` outer wrapper
  // may carry font-size 0 to collapse inline-block whitespace, with the
  // inner span declaring the real 14px font). Snapshotting the wrapper
  // would lock font-size 0 onto the rewrite.
  //
  // The WRITE target stays `entry.textEl` (caller-provided contract; on
  // structural-fallback paths the longest-text picker already chose the
  // leaf, so the inward walk returns textEl itself — no change in behavior).
  //
  // Defensive: when the resolved font-size is '0px' or unparsable, walk
  // OUTWARD from the snapshot host until a non-zero value surfaces. Avoids
  // applying font-size:0 inline which would render the rewrite invisible.
  //
  // Also preserves font-style / font-variant / text-transform so italic /
  // small-caps / uppercase native-text styling survives the swap.
  const preservedStyle = (() => {
    try {
      const snapshotHost = findInnermostTextHost(entry.textEl);
      const cs = window.getComputedStyle(snapshotHost);
      const rawFontSize = cs.fontSize;
      const rawPx = parseFloat(rawFontSize);
      const fontSize = !Number.isNaN(rawPx) && rawPx > 0
        ? rawFontSize
        : resolveNonZeroFontSize(snapshotHost.parentElement ?? entry.textEl, entry.textEl);
      return {
        color: cs.color,
        fontFamily: cs.fontFamily,
        fontSize,
        fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight,
        fontStyle: cs.fontStyle,
        fontVariant: cs.fontVariant,
        textTransform: cs.textTransform,
      };
    } catch { /* defensive: jsdom or weird DOM */ }
    return null;
  })();

  entry.textEl.textContent = rewrittenText;
  entry.rootEl.dataset.fwRewritten = 'true';
  // This also writes hide notices, the original on a reveal and swear masks;
  // only the rewrite caller puts the AI mark back, after the swap.
  clearRewriteMarks(entry.textEl);

  if (preservedStyle) {
    entry.textEl.style.color = preservedStyle.color;
    entry.textEl.style.fontFamily = preservedStyle.fontFamily;
    if (preservedStyle.fontSize) entry.textEl.style.fontSize = preservedStyle.fontSize;
    entry.textEl.style.fontWeight = preservedStyle.fontWeight;
    entry.textEl.style.lineHeight = preservedStyle.lineHeight;
    entry.textEl.style.fontStyle = preservedStyle.fontStyle;
    entry.textEl.style.fontVariant = preservedStyle.fontVariant;
    entry.textEl.style.textTransform = preservedStyle.textTransform;
  }
}

/**
 * safety-gap fallback: hide the comment row when a rewrite fails
 * (LLM error, timeout, detector trip on rogue output). The parent who opted
 * into `replace-toxic-with-educational` expects ZERO un-rewritten content to
 * reach the child reader — leaving the original visible would defeat the
 * feature's promise. Hidden rows carry BOTH `data-fw-rewritten="true"`
 * (prevents repeat-walks from reprocessing) and `data-fw-hidden-fallback="true"`
 * (distinguishes hide-on-failure from swap-on-success in forensic audit).
 *
 * We use `display: none !important` because TikTok's inline styles can
 * override class-based selectors; the `!important` is the simplest lock.
 */
export function hideCommentAsFallback(entry: CommentEntry): void {
  // Inspection pass (dashboard-opened tab): observe only, never mutate.
  if (isInspectionTab()) return;
  entry.rootEl.dataset.fwRewritten = 'true';
  entry.rootEl.dataset.fwHiddenFallback = 'true';
  entry.rootEl.style.setProperty('display', 'none', 'important');
}

/** Apply the hide and prove the terminal DOM state before callers record it. */
export function hideCommentAsFallbackTerminal(entry: CommentEntry): boolean {
  hideCommentAsFallback(entry);
  return entry.rootEl.dataset.fwRewritten === 'true'
    && entry.rootEl.dataset.fwHiddenFallback === 'true'
    && entry.rootEl.style.getPropertyValue('display') === 'none'
    && entry.rootEl.style.getPropertyPriority('display') === 'important';
}

/**
 * What a hidden comment shows in Teen and Adult
 * (docs/design/HIDE-NOTICE-2026-09-07.md): one sentence in the row's own
 * words, with a reveal. Child passes null and gets the silent row close above.
 */
export interface CommentHideNotice {
  /** The full sentence, e.g. "FeelingWise hid this comment: an identity slur". */
  text: string;
  showLabel: string;
  hideLabel: string;
}

const COMMENT_NOTICE_ATTR = 'data-fw-comment-notice';
const COMMENT_REVEALED_ATTR = 'data-fw-user-revealed';

/** Media inside the row that is not an avatar: anything drawn larger than an avatar is. */
function commentMedia(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('img, video')).filter((m) => {
    const w = m.getBoundingClientRect().width || Number(m.getAttribute('width')) || 0;
    return w === 0 || w > 64;
  });
}

function setCommentMediaHidden(root: HTMLElement, hidden: boolean): void {
  for (const m of commentMedia(root)) {
    if (hidden) {
      if (!m.hasAttribute('data-fw-prev-display')) m.setAttribute('data-fw-prev-display', m.style.display);
      m.style.setProperty('display', 'none', 'important');
      if (m instanceof HTMLVideoElement) { try { m.pause(); m.muted = true; } catch { /* not playing */ } }
    } else {
      const prev = m.getAttribute('data-fw-prev-display') ?? '';
      if (prev) m.style.setProperty('display', prev); else m.style.removeProperty('display');
      m.removeAttribute('data-fw-prev-display');
    }
  }
}

/**
 * Hide a comment by leaving the notice where its text was, in the platform's
 * own typography (the same in-place swap the rewrite uses), the row's media
 * folded, and one button that reveals the original and folds it again. The
 * original text is kept only in this closure; the record already holds it.
 * Returns true only when the notice is proven present in `textEl`, so a caller
 * that records `hide` records what the reader met. Inspection tabs: no-op.
 */
export function hideCommentWithNoticeTerminal(entry: CommentEntry, notice: CommentHideNotice): boolean {
  if (isInspectionTab()) return false;
  if (entry.rootEl.getAttribute(COMMENT_NOTICE_ATTR) === 'true') {
    return (entry.textEl.textContent ?? '') === notice.text;
  }
  const original = entry.text;
  const savedMarker = entry.textEl.querySelector('.fw-teen-marker');
  swapCommentTextInPlace(entry, notice.text);
  if ((entry.textEl.textContent ?? '') !== notice.text) return false;
  entry.rootEl.dataset.fwHiddenFallback = 'true';
  entry.rootEl.setAttribute(COMMENT_NOTICE_ATTR, 'true');
  entry.rootEl.removeAttribute(COMMENT_REVEALED_ATTR);
  setCommentMediaHidden(entry.rootEl, true);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('data-fw-comment-reveal', 'true');
  btn.style.cssText = 'margin-left:8px;font:11px system-ui,sans-serif;color:inherit;opacity:.75;'
    + 'background:none;border:1px solid rgba(136,136,136,.5);border-radius:5px;'
    + 'padding:1px 8px;cursor:pointer;white-space:nowrap;vertical-align:middle;';
  const revealed = (): boolean => entry.rootEl.getAttribute(COMMENT_REVEALED_ATTR) === 'true';
  const sync = (): void => { btn.textContent = revealed() ? notice.hideLabel : notice.showLabel; };
  btn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (revealed()) {
      swapCommentTextInPlace(entry, notice.text);
      entry.rootEl.removeAttribute(COMMENT_REVEALED_ATTR);
      setCommentMediaHidden(entry.rootEl, true);
    } else {
      swapCommentTextInPlace(entry, original);
      entry.rootEl.setAttribute(COMMENT_REVEALED_ATTR, 'true');
      setCommentMediaHidden(entry.rootEl, false);
    }
    // The swap replaces textEl's children; the button lives beside textEl and survives.
    if (savedMarker && revealed()) entry.textEl.appendChild(savedMarker);
    sync();
  });
  sync();
  entry.textEl.insertAdjacentElement('afterend', btn);
  return (entry.textEl.textContent ?? '') === notice.text
    && entry.rootEl.dataset.fwRewritten === 'true'
    && entry.rootEl.dataset.fwHiddenFallback === 'true';
}

/**
 * The one comment-hide terminal: with a notice (Teen, Adult) the sentence
 * stands where the text was; without one (Child) the row closes silently.
 */
export function hideCommentTerminal(entry: CommentEntry, notice: CommentHideNotice | null): boolean {
  return notice ? hideCommentWithNoticeTerminal(entry, notice) : hideCommentAsFallbackTerminal(entry);
}

/** A missed DOM hide is still a valid flag, but never a hidden record. */
export function recordedCommentHideAction(hideApplied: boolean): 'hide' | 'mark' {
  return hideApplied ? 'hide' : 'mark';
}

