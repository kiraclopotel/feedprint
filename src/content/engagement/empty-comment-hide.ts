// FeelingWise — hide comment wrappers whose visible body text is empty
// after upstream sanitization (emoji strip / sticker placeholder hide).
//
// Product requirement: if a comment has just emoji or a sticker, remove
// that comment including the name of the one who posted it, since leaving
// an empty comment behind would look strange.
//
// The existing surface — `engagement/emoji-stripper.ts` and TikTok's
// sticker hider in `tiktok-engagement.ts` — strip the body text but
// leave the wrapping comment node (avatar, @handle, like / reply
// buttons) in the DOM. This module catches the dangling chrome by
// hiding the wrapper when the body element under it is empty.
//
// Gated on `strip-emojis` per-platform: by definition the "newly
// empty" case appears only after the upstream stripper runs. With
// stripping off, an emoji-only comment is not empty — it's emoji —
// and the parent's intent is to keep it.
//
// Discipline:
//   • Only operates on the platforms emoji-stripper covers (twitter,
//     tiktok, facebook). Adding a platform requires adding a body
//     selector here AND a scope selector in emoji-stripper.
//   • Never sets the marker on a wrapper whose body selector matched
//     no element — a missing selector is "we don't know", not "empty".
//     Without that guard a TikTok DOM rotation that breaks the body
//     selector would silently hide the entire comment list.
//   • Cleanup restores the wrapper visibility on toggle-off.

import type { FWSettings } from '../../storage/settings';
import { isFeatureEnabled } from '../../storage/settings';
import type { Platform } from '../../types/post';
import { observeAddedRoots } from './added-roots';
import { hideElement, unmarkHidden } from './mark-hidden';
import { ensureStyleTag, removeStyleTag } from './style-tag';
import { isInPrivateChatSubtree } from '../platforms/adapter';

const EMPTY_MARKER = 'data-fw-empty-comment';
const STYLE_TAG_ID = 'fw-empty-comment-css';

interface PlatformDescriptor {
  /** Selector for the wrapper element whose body will be checked + hidden. */
  wrapper: string;
  /** Selector(s) inside the wrapper that hold the comment's text body. The
   *  longest matching node's text is taken as the body. */
  textBody: string[];
  /**
   * Extra whole-post guard (wiring Q28). On FB and X the wrapper selector
   * matches POSTS as well as comments, and a media-only post whose text
   * nodes are all empty used to qualify as an "empty comment" and vanish.
   * When present, a wrapper must pass this predicate before it is eligible
   * to hide; returning false means "this looks like content, leave it".
   */
  eligible?: (wrapper: HTMLElement) => boolean;
}

const FB_COMMENT_ARIA_RE = /coment|comment|r[ăa]spuns|reply|antwort|commentaire|commento/i;

const PLATFORM_DESCRIPTORS: Partial<Record<Platform, PlatformDescriptor>> = {
  tiktok: {
    // Live-probed 2026-07-02: `[data-e2e="comment-level-1"]` is the text
    // SPAN itself, not the row — hiding it left the avatar + username row
    // dangling (the empty-comment-with-username-still-showing defect). The row
    // is the `--DivCommentItemWrapper` container (substring class match,
    // same convention as the adapter: the css-hash prefix rotates, the
    // trailing component name is the stable anchor). The text span becomes
    // the BODY probe, so the null-guard still protects against rotation.
    wrapper: '[class*="DivCommentItemWrapper"]',
    textBody: ['[data-e2e^="comment-level-"]', '[data-e2e^="comment-text-"]'],
  },
  twitter: {
    // Twitter inline replies + main tweets share the article wrapper. An
    // emoji-only TEXT tweet is "no information after strip" and hides; a
    // tweet carrying photo/video is information regardless of its text, so
    // the media guard keeps it (Q28: a photo tweet with an emoji-only
    // caption used to vanish whole).
    wrapper: 'article[data-testid="tweet"]',
    textBody: ['[data-testid="tweetText"]'],
    eligible: (wrapper) =>
      !wrapper.querySelector('[data-testid="tweetPhoto"], [data-testid="videoPlayer"], video'),
  },
  facebook: {
    // FB comments + posts both render as `div[role="article"]`. Body text
    // lives in the deepest `[dir="auto"]`; we pick the longest one inside.
    // Q28 guard: only a wrapper that LOOKS like a comment is eligible.
    // FB stamps comment/reply articles with an aria-label carrying a
    // comment stem in every locale we ship ("Comment by X", "Comentariu de
    // la X", "Răspuns de la X"); posts carry author/date labels instead.
    // A media-only POST whose [dir=auto] nodes are all empty layout shims
    // used to qualify and vanish whole.
    wrapper: 'div[role="article"]',
    textBody: ['[dir="auto"]'],
    eligible: (wrapper) =>
      FB_COMMENT_ARIA_RE.test(wrapper.getAttribute('aria-label') ?? '')
      && !wrapper.querySelector('video'),
  },
};

const HIDDEN_CSS = `
    [${EMPTY_MARKER}="true"] {
      display: none !important;
      visibility: hidden !important;
    }
  `;

/**
 * Returns the longest body text found under the wrapper, or `null` when no
 * body element matched any of the descriptor's selectors. The null vs ""
 * distinction matters: null = "selector didn't match, don't hide", empty
 * string = "selector matched, body is empty, hide".
 */
function bodyText(wrapper: HTMLElement, selectors: string[]): string | null {
  let longest: string | null = null;
  for (const sel of selectors) {
    wrapper.querySelectorAll<HTMLElement>(sel).forEach(el => {
      const t = el.textContent?.trim() ?? '';
      if (longest === null || t.length > longest.length) longest = t;
    });
  }
  return longest;
}

function runOnce(descriptor: PlatformDescriptor, roots?: Element[]): void {
  // Full pass over the document, or (incremental path) the wrappers inside
  // each inserted subtree plus the nearest wrapper above it.
  let wrappers: Iterable<HTMLElement>;
  if (roots) {
    const seen = new Set<HTMLElement>();
    for (const root of roots) {
      const above = root.closest<HTMLElement>(descriptor.wrapper);
      if (above) seen.add(above);
      root.querySelectorAll<HTMLElement>(descriptor.wrapper).forEach((w) => seen.add(w));
    }
    wrappers = seen;
  } else {
    wrappers = document.querySelectorAll<HTMLElement>(descriptor.wrapper);
  }
  let touched = false;
  for (const wrapper of wrappers) {
    if (wrapper.getAttribute(EMPTY_MARKER) === 'true') continue;
    // Private conversations are outside every filter's scope (item 3a, 2026-09-13).
    if (isInPrivateChatSubtree(wrapper)) continue;
    if (descriptor.eligible && !descriptor.eligible(wrapper)) continue;
    const text = bodyText(wrapper, descriptor.textBody);
    if (text === '') {
      hideElement(wrapper, {
        marker: EMPTY_MARKER, value: 'true',
        reason: 'strip-emojis:empty-comment',
      });
      touched = true;
    }
  }
  if (touched) ensureStyleTag(STYLE_TAG_ID, HIDDEN_CSS);
}

function resetDOM(): void {
  document.querySelectorAll<HTMLElement>(`[${EMPTY_MARKER}="true"]`).forEach(el => {
    unmarkHidden(el, EMPTY_MARKER);
    el.style.removeProperty('display');
  });
  removeStyleTag(STYLE_TAG_ID);
}

export function startEmptyCommentHider(
  platform: Platform,
  settings: FWSettings,
): () => void {
  if (!isFeatureEnabled(settings, 'strip-emojis', platform)) {
    return () => {};
  }
  const descriptor = PLATFORM_DESCRIPTORS[platform];
  if (!descriptor) return () => {};

  runOnce(descriptor);

  // Inserted subtrees at mutation time (shared observer, added-roots.ts).
  const stopAdded = observeAddedRoots((roots) => runOnce(descriptor, roots));

  // Polling fallback — same trade-off as the emoji-stripper: some SPAs swap
  // text in place via React state without firing useful mutation records.
  const interval = setInterval(() => runOnce(descriptor), 2000);

  return () => {
    stopAdded();
    clearInterval(interval);
    resetDOM();
  };
}

// Exported so the engagement controller's master DOM reset path can drop
// our marker + style tag without needing to import the runtime entrypoint.
export const EMPTY_COMMENT_STYLE_TAG_ID = STYLE_TAG_ID;
export const EMPTY_COMMENT_MARKER = EMPTY_MARKER;
