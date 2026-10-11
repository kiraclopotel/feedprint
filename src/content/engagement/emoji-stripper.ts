// FeelingWise — runtime emoji stripper.
//
// Product requirement: strip all emoji, offered as an opt-in toggle;
// automatic in child mode. Applies to TikTok / X.com / Facebook.
//
// This module walks the DOM, strips emoji codepoints from visible text nodes
// and hides emoji <img> elements (X uses <img src="…twemoji…"> for some
// emoji glyphs; the unicode-class regex doesn't catch those). The aim is
// purely cosmetic — it does NOT alter any data the pipeline reads (the
// pipeline already runs on the original text before any DOM mutation here).
//
// Why per-platform allowlist: the LLM rewrite path strips emoji from
// rewrites in `core/text-sanitize.ts` (called by the neutralizer); this
// module covers the *un-flagged* posts and the comments / replies that
// don't go through the full rewrite pipeline. It is gated on the
// `strip-emojis` feature (per-platform overrides honored) and only runs
// on the platforms specifically called out.
//
// Discipline:
//   • Only mutate text nodes; never touch node structure (preserves React
//     reconciliation; avoids defeating ARIA labels).
//   • Mark touched nodes with a WeakSet so MutationObserver re-fires don't
//     re-process the same node infinitely.
//   • Hide emoji <img> via inline `display:none`; mark the parent with a
//     data-attr so cleanup can restore.

import type { FWSettings } from '../../storage/settings';
import { isFeatureEnabled } from '../../storage/settings';
import type { Platform } from '../../types/post';
import { stripEmojis } from '../../core/text-sanitize';
import { observeAddedRoots } from './added-roots';
import { countHiddenFor, markHidden } from './mark-hidden';
import { ensureStyleTag, removeStyleTag } from './style-tag';
import { isInPrivateChatSubtree } from '../platforms/adapter';
import { OWN_CHROME_SELECTOR } from '../text-box';
import { isEmojiAltPicture } from '../../core/emoji-picture';

const EMOJI_HIDDEN_MARKER = 'data-fw-emoji-hidden';
const STYLE_TAG_ID = 'fw-emoji-stripper-css';

// Same character class as `core/text-sanitize.ts` — used here for a fast
// presence test. Re-declared rather than exported from text-sanitize to
// keep the sanitizer file's contract narrow (in: string, out: string).
//
// Ship #34 additions (found 2026-05-24, "strip emoji does not fully work"):
//   • \u{2500}-\u{25FF} — geometric shapes (□ ■ ▢ ▣ ◯ ◯ etc.) used in some
//     decorative emoji bursts and platform comment overlays.
//   • \u{20E3}          — COMBINING ENCLOSING KEYCAP for digit keycaps
//                          like 1️⃣ 2️⃣ — without it, FE0F was stripped but
//                          the digit+⃣ glyph remained.
//   • \u{E0020}-\u{E007F} — TAG characters used in subdivision flags
//                            (England 🏴󠁧󠁢󠁥󠁮󠁧󠁿, Scotland, Wales).
const EMOJI_PRESENCE_RE =
  /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2500}-\u{25FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/u;

// Per-platform DOM scopes. We do NOT walk `document.body` wholesale because
// that would also strip emoji from the extension's own injected UI (popup,
// dashboard) on rare cross-origin frames. Selectors below are conservative
// — better to miss a stray emoji on the page chrome than to mutate an
// unrelated UI surface.
//
// Ship #34: instagram + youtube keys added. Pre-fix the module returned a
// silent no-op for platforms not in this map, so "Strip emojis" on IG / YT
// did nothing despite the toggle being on (reported 2026-05-24).
const SCOPE_SELECTORS: Partial<Record<Platform, string[]>> = {
  twitter: [
    '[data-testid="tweetText"]',
    '[data-testid="User-Name"]',
    'article [lang]',                     // tweet body + reply body
    '[aria-label*="Reply" i] [lang]',
  ],
  tiktok: [
    '[data-e2e="video-desc"]',
    '[data-e2e="browse-video-desc"]',
    '[data-e2e^="comment-level-"]',
    '[data-e2e="comment-text-1"]',
    '[data-e2e^="comment-text-"]',
  ],
  facebook: [
    '[data-ad-comet-preview="message"]',
    '[data-ad-preview="message"]',
    // The home feed's units are [aria-posinset] and the role=article inside
    // is an empty shell; the body is [data-ad-rendering-role="story_message"]
    // (owner's live tab, 2026-09-03). The right column carries ad and
    // contact text with emoji of its own.
    '[data-ad-rendering-role="story_message"]',
    '[aria-posinset] [dir="auto"]',
    '[role="complementary"] span[dir="auto"]',
    '[role="complementary"] a span',
    'div[role="article"] [dir="auto"]',
    'div[role="comment"] [dir="auto"]',
  ],
  instagram: [
    'article h1',                          // caption on /p/<id>/
    'article [data-testid*="caption"]',
    'article ul li [dir="auto"]',          // per-comment text rows
    'article div[role="button"] span[dir="auto"]',
    'main article span[dir="auto"]',       // home-feed caption
  ],
  youtube: [
    '#content-text',                       // each comment body (matches
                                           // comment-extractors.ts:34 pattern)
    'ytd-comment-view-model #content-text',
    '#description-inline-expander',        // /watch caption
    'ytd-watch-metadata yt-formatted-string',
    '#video-title',                        // tile titles, the older grid
    // The home grid's tiles are yt-lockup-view-model since the 2026 rollout
    // (owner's live tab, 2026-09-03): the title is h3 > a > span inside
    // yt-lockup-metadata-view-model and #video-title matches nothing there,
    // so the word filter and the stripper read every home title through this.
    'yt-lockup-metadata-view-model h3',
  ],
};

const processedNodes = new WeakSet<Text>();

// Where the stripper never works, whatever the page is (11 Oct 2026). The switch means "no emoji on my screen", so
// it cleans every text on the page and these are the exceptions: what the person types, code and styles, and
// FeelingWise's own words. A private conversation is refused separately (isInPrivateChatSubtree).
const NEVER_CLEANED_SELECTOR = [
  'script', 'style', 'noscript', 'template', 'textarea', 'code', 'pre', 'title', 'input', 'select',
  '[contenteditable]:not([contenteditable="false"])', '[role="textbox"]', '[role="combobox"]',
  OWN_CHROME_SELECTOR,
].join(', ');

function isOutOfBounds(el: Element | null): boolean {
  return !el || isInPrivateChatSubtree(el) || el.closest(NEVER_CLEANED_SELECTOR) !== null;
}

const HIDDEN_CSS = `
    [${EMOJI_HIDDEN_MARKER}] {
      display: none !important;
      visibility: hidden !important;
    }
  `;

function stripEmojisInScope(scope: Element): void {
  // Private conversations are never touched (owner's report, 2026-09-13: the
  // Messenger chat dock on the feed page lost its emoji). The URL gate cannot
  // see the dock because it lives on the feed URL, so the check is per
  // element: the scope itself, and every text node under it, because a
  // broad scope such as the right column can contain the dock.
  if (isInPrivateChatSubtree(scope)) return;
  // Walk text nodes via TreeWalker so we don't disturb element structure.
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!(node instanceof Text)) return NodeFilter.FILTER_REJECT;
      if (processedNodes.has(node)) return NodeFilter.FILTER_REJECT;
      const value = node.nodeValue;
      if (!value || value.length === 0) return NodeFilter.FILTER_REJECT;
      if (!EMOJI_PRESENCE_RE.test(value)) return NodeFilter.FILTER_REJECT;
      if (isOutOfBounds(node.parentElement)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const toRewrite: Text[] = [];
  let cur: Node | null = walker.nextNode();
  while (cur) {
    if (cur instanceof Text) toRewrite.push(cur);
    cur = walker.nextNode();
  }

  for (const node of toRewrite) {
    const before = node.nodeValue ?? '';
    const after = stripEmojis(before);
    if (after !== before) {
      node.nodeValue = after;
      // One firing per text node cleaned: the popup's "emoji" line. Nothing
      // is hidden, so the total hidden counter does not move.
      countHiddenFor('strip-emojis', 1, false);
    }
    processedNodes.add(node);
  }

  // Twitter/X uses <img alt="🔥" src="…twemoji…"> for some emoji. The
  // text-node walk doesn't catch these because their text-equivalent is
  // in the `alt` attribute, not the visible text content. Hide them.
  // A picture is an emoji by what it is: its alt text is nothing but emoji (any file, any site). The older test by
  // file name is kept beside it. A picture with a name or no alt, an avatar or a photo, is never one.
  const emojiImgs = Array.from(scope.querySelectorAll<HTMLImageElement>('img[alt]'));
  if (scope instanceof HTMLImageElement && scope.hasAttribute('alt')) emojiImgs.push(scope);
  for (const img of emojiImgs) {
    if (img.hasAttribute(EMOJI_HIDDEN_MARKER)) continue;
    if (isOutOfBounds(img)) continue;
    const alt = img.getAttribute('alt') ?? '';
    const byAddress = /twemoji|emoji|abs-/.test(img.getAttribute('src') ?? '')
      && alt.length > 0 && alt.length <= 8 && EMOJI_PRESENCE_RE.test(alt);
    if (!byAddress && !isEmojiAltPicture(img)) continue;
    markHidden(img, {
      marker: EMOJI_HIDDEN_MARKER, value: 'true',
      reason: 'strip-emojis:emoji-img',
      // Emoji glyph hides are cosmetic; keep them out of the parent-facing
      // hidden counter (previous behavior).
      count: 0,
    });
  }
}

function runOnce(platform: Platform): void {
  const selectors = SCOPE_SELECTORS[platform];
  if (!selectors || selectors.length === 0) return;
  // The whole page, not the list of places the selectors name: a site redraws its page and the list is wrong.
  stripEmojisInScope(document.body);
}

// One inserted subtree: the scopes inside it and the nearest scope above it
// (closest includes the root). Bounded by the insert, runs before paint.
function runOnRoots(roots: Element[], platform: Platform): void {
  const selectors = SCOPE_SELECTORS[platform];
  if (!selectors || selectors.length === 0) return;
  for (const root of roots) stripEmojisInScope(root);
}

function resetEmojiStripperDOM(): void {
  // Un-hide images we hid.
  document.querySelectorAll<HTMLElement>(`[${EMOJI_HIDDEN_MARKER}]`).forEach(el => {
    el.removeAttribute(EMOJI_HIDDEN_MARKER);
  });
  removeStyleTag(STYLE_TAG_ID);
  // Text-node mutations cannot be reversed cheaply (we only stored that we
  // touched the node, not the original text). Restoration on toggle-off
  // requires a page reload — same trade-off the existing engagement
  // controllers make for irreversible visual mutations.
}

export function startEmojiStripper(
  platform: Platform,
  settings: FWSettings,
): () => void {
  // Per-platform allowlist gate. If the feature isn't enabled for this
  // platform (top-level off, or perPlatform override off) we don't run.
  if (!isFeatureEnabled(settings, 'strip-emojis', platform)) {
    return () => {};
  }
  if (!SCOPE_SELECTORS[platform]) {
    // Platform has no selector entry in SCOPE_SELECTORS above. No-op.
    // (twitter/tiktok/facebook/instagram/youtube are all covered since
    // Ship #34; this guard exists for any future platform id.)
    return () => {};
  }

  ensureStyleTag(STYLE_TAG_ID, HIDDEN_CSS);
  runOnce(platform);

  // Inserted subtrees are stripped at mutation time, before their first
  // paint (shared observer, engagement/added-roots.ts).
  const stopAdded = observeAddedRoots((roots) => runOnRoots(roots, platform));

  // Polling fallback — some SPAs swap node text in place via React state
  // updates, which doesn't always fire MutationObserver in the way our
  // text-node walker expects. Periodic re-scan catches those.
  const interval = setInterval(() => runOnce(platform), 2000);

  return () => {
    stopAdded();
    clearInterval(interval);
    resetEmojiStripperDOM();
  };
}

// The per-platform text scopes, shared with the word filter (Off) so both
// modules read the same post and comment bodies.
export const TEXT_SCOPE_SELECTORS = SCOPE_SELECTORS;

// Export for engagement controller's master DOM-reset step.
export const EMOJI_STRIPPER_STYLE_TAG_ID = STYLE_TAG_ID;
export const EMOJI_STRIPPER_HIDDEN_MARKER = EMOJI_HIDDEN_MARKER;
