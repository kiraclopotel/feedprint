// What the page carried against what the screen showed, for one item's text.
//
// A long post is shortened one of two ways. Facebook, Instagram and X cut the
// string, append an ellipsis and place a control that loads the rest on a
// press: the DOM holds the fragment and nothing else. YouTube and TikTok keep
// the whole string in the DOM, clamp it by style and show a control that
// unfolds it: the DOM holds everything and the screen showed the first lines.
// The adapters read textContent, so the record already holds the whole text in
// the second case and a fragment in the first; until 2026-09-05 it could not
// say which (docs/research/RESEARCH-LOG.md entry 5: 36.8 percent of Facebook
// items are fragments, and fragments are judged more often charged and less
// often severe).
//
// This module reads the DOM once per item at onPostDetected and stamps
// `textCapture` on the post: 'whole' (no fold control), 'folded' (a control and
// a whole string) or 'cut' (a control and a string that ends in an ellipsis).
// It never presses a control, never reads innerText or layout, and never
// changes the text. Design: docs/design/TEXT-CAPTURE-2026-09-05.md.

import type { PostContent, Platform } from '../../types/post';
import type { TextCapture } from '../../types/forensic';
import { TEXT_SCOPE_SELECTORS } from '../engagement/emoji-stripper';
import { FOLD_LABELS, normalizeLabel, squash } from '../../core/fold-labels';

export { normalizeLabel };

export type { TextCapture };

/**
 * Where a fold control can be. YouTube's `#more` is matched by attribute
 * because YouTube repeats the id across threads and a scoped `#id` query hits
 * the engine's first-in-document fast path (see yt-watch-comments.ts).
 */
const CONTROL_SELECTOR = 'button, [role="button"], a[role="link"], [id="more"], summary';

/** Structural anchors that are fold controls regardless of their label. */
const STRUCTURAL_CONTROL_SELECTOR = '[data-testid="tweet-text-show-more-link"], [data-testid$="show-more-link"], [id="more"]';

/**
 * The item's own box: the nearest of these above the text element bounds the
 * search for a sibling control. A nested one of these that does not hold the
 * text element is another item (a comment under a post, a reply under a
 * comment, a quoted card inside a tweet) and its controls are not this item's.
 */
const CONTAINER_SELECTOR = 'li, article, [role="article"], [aria-posinset], ytd-comment-view-model, ytd-comment-thread-renderer, ytd-backstage-post-renderer, [data-e2e$="item-container"]';
const NESTED_ITEM_SELECTOR = 'ul, [role="article"], article, li, div[role="link"], ytd-comment-replies-renderer';

const MAX_LABEL_LENGTH = 32;
/** How far above the text element the search may climb before giving up. */
const MAX_ANCESTOR_DEPTH = 4;

function isHidden(el: Element): boolean {
  return el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true';
}

/** True when the element is a fold control: a structural anchor, or a button-like element carrying a fold word. */
export function isFoldControl(el: Element): boolean {
  if (isHidden(el)) return false;
  try {
    if (el.matches(STRUCTURAL_CONTROL_SELECTOR)) return true;
  } catch {
    // An unsupported selector in the host: fall through to the label.
  }
  const own = normalizeLabel(el.textContent ?? '');
  if (own.length > 0 && own.length <= MAX_LABEL_LENGTH && FOLD_LABELS.has(own)) return true;
  const aria = normalizeLabel(el.getAttribute('aria-label') ?? '');
  return aria.length > 0 && aria.length <= MAX_LABEL_LENGTH && FOLD_LABELS.has(aria);
}

/**
 * The first fold control inside `scope` that belongs to the same item as
 * `textEl`: not inside a nested list, article, card or reply block that does
 * not itself hold the text element.
 */
function foldControlWithin(scope: Element, textEl: Element): Element | null {
  let candidates: Element[];
  try {
    candidates = Array.from(scope.querySelectorAll(CONTROL_SELECTOR));
  } catch {
    return null;
  }
  for (const c of candidates) {
    if (!isFoldControl(c)) continue;
    // Walk from the control up to the scope; any nested item boundary on the
    // way that does not hold the text element makes this another item's control.
    let belongs = true;
    for (let n: Element | null = c.parentElement; n && n !== scope; n = n.parentElement) {
      if (n === textEl || n.contains(textEl)) break;
      let nested = false;
      try { nested = n.matches(NESTED_ITEM_SELECTOR); } catch { nested = false; }
      if (nested) { belongs = false; break; }
    }
    if (belongs) return c;
  }
  return null;
}

/** The fold control for this item, or null when the page shows it whole. */
export function findFoldControl(textEl: Element): Element | null {
  const inside = foldControlWithin(textEl, textEl);
  if (inside) return inside;
  let node: Element | null = textEl.parentElement;
  for (let depth = 0; node && depth < MAX_ANCESTOR_DEPTH; depth++, node = node.parentElement) {
    const found = foldControlWithin(node, textEl);
    if (found) return found;
    let isContainer = false;
    try { isContainer = node.matches(CONTAINER_SELECTOR); } catch { isContainer = false; }
    if (isContainer) break;
  }
  return null;
}

/**
 * A cut string ends with an ellipsis in the DOM (Facebook, Instagram, X). A
 * fold by style leaves the string whole; its ellipsis is drawn by CSS, which
 * textContent never sees (YouTube, TikTok). When the platform nests the
 * control's label in the body (Facebook's "See more"), the label is stripped
 * before the test.
 */
export function endsCut(text: string, control: Element): boolean {
  let t = squash(text).toLowerCase();
  const label = squash(control.textContent ?? '').toLowerCase();
  if (label && t.endsWith(label)) t = t.slice(0, -label.length).trim();
  return /(?:…|\.\.\.)$/.test(t);
}

/** What the page carried against what the screen showed, for the text in `textEl`. */
export function detectTextFold(textEl: Element, text: string): TextCapture {
  const control = findFoldControl(textEl);
  if (!control) return 'whole';
  return endsCut(text, control) ? 'cut' : 'folded';
}

/**
 * The element whose text the adapter extracted. The adapter's own element on
 * Facebook, Instagram, X and YouTube community posts; on TikTok and YouTube
 * watch comments the adapter hands over the item's container, so the text
 * body is found through the platform's text scopes (the structure map's
 * "text body" anchor) by equality with the extracted text.
 */
export function resolveTextElement(root: Element, text: string, platform: Platform): Element {
  const want = squash(text);
  if (!want) return root;
  if (squash(root.textContent ?? '') === want) return root;
  for (const sel of TEXT_SCOPE_SELECTORS[platform] ?? []) {
    let found: Element[] = [];
    try { found = Array.from(root.querySelectorAll(sel)); } catch { continue; }
    for (const el of found) {
      if (squash(el.textContent ?? '') === want) return el;
    }
  }
  return root;
}

/**
 * Stamp `textCapture` on the post from its live element. A post whose element
 * is gone gets no stamp: an absent field means "not checked", never "whole".
 */
export function stampTextFold(post: PostContent): void {
  // A text taken from the platform's own data is not what this element shows, so the element cannot describe it.
  if (post.textCapture === 'platform') return;
  // X leaves no ellipsis on a long post, so this reading would call the fragment folded; the adapter saw the page cut it
  // (twitter.ts, the "Show more" link) and said so, and the platform's text did not complete it.
  if (post.textCapture === 'cut') return;
  const el = post.domRef?.deref();
  if (!el || !post.text) return;
  try {
    const textEl = resolveTextElement(el, post.text, post.platform);
    post.textCapture = detectTextFold(textEl, post.text);
  } catch {
    // A DOM that throws on query is a DOM this stamp cannot read; leave the field absent.
  }
}
