// FeelingWise (Off) — the word filter.
//
// The free, deterministic text rules, applied straight to the page with no
// pipeline, no AI and no record. Three rules, in this order:
//
//   1. The user's own list (words, phrases, accounts) hides the post or
//      comment that matches. This is the one rule where the person decides
//      and no model has a say.
//   2. Slurs hide the post or comment, in every mode.
//   3. Swearing is replaced with asterisks inside the text, in Child mode and
//      whenever "no swearing" (strictLanguage) is on.
//
// The recorder product does the same three things inside the pipeline so it
// can write a record of each one; this module exists so the Off build can do
// them without carrying the pipeline. It only runs in the Off build
// (see controller.ts).
//
// Discipline, same as the other engagement modules:
//   • Reads settings once at start; the engagement controller restarts the
//     module on any settings change.
//   • Hides by inline display:none plus a marker attribute, because Meta's
//     StyleX rules carry their own !important and beat a stylesheet rule.
//   • Never touches private chat surfaces (role="log" and the chat overlays).
//   • Text-node mutations are irreversible without a reload; the hides are
//     reversed by the controller's reset.

import type { FWSettings } from '../../storage/settings';
import type { Platform } from '../../types/post';
import {
  activeParentBlocklist,
  isParentBlocklistEmpty,
  matchParentBlocklist,
  ruleTallyKey,
  type ParentBlocklistValue,
  type BlocklistCard,
} from '../../core/parent-blocklist';
import { readCardContext } from '../record/card-context';
import { filterProfanity } from '../../core/profanity-filter';
import { observeAddedRoots } from './added-roots';
import { isInPrivateChatSubtree } from '../platforms/adapter';
import { countHiddenFor, markHidden, hideElement } from './mark-hidden';
import { ensureStyleTag, removeStyleTag } from './style-tag';
import { TEXT_SCOPE_SELECTORS } from './emoji-stripper';

export const WORD_FILTER_STYLE_TAG_ID = 'fw-word-filter-css';
export const WORD_FILTER_HIDDEN_MARKER = 'data-fw-word-filter';
const WORD_FILTER_HIDDEN_VALUE = 'hidden';

// Instagram keeps the box (Q87, injector.ts, measured live 2026-08-11 and
// again 2026-09-03): its windowed feed positions and loads from its own
// height bookkeeping, and a removed box parks the reader in a feed of grey
// placeholders that never fill. The ad hide and the AI-content blocker
// already hide by visibility there; this filter did not until 2026-09-05
// (known-issues M135). The blank slot is the price of a working feed.
const HIDDEN_CSS = `
    [${WORD_FILTER_HIDDEN_MARKER}="${WORD_FILTER_HIDDEN_VALUE}"]:not([data-fw-hide-mode="visibility"]) {
      display: none !important;
    }
    [${WORD_FILTER_HIDDEN_MARKER}="${WORD_FILTER_HIDDEN_VALUE}"][data-fw-hide-mode="visibility"] {
      visibility: hidden !important;
      pointer-events: none !important;
    }
  `;

// The nearest post or comment boundary above a text scope. `closest` picks
// the nearest ancestor that matches any selector in the list, so a comment
// row wins over the post that contains it. Nothing page-sized is listed: a
// scope with no boundary hides itself, never its page.
export const CONTAINER_SELECTORS: Record<Platform, string> = {
  twitter: 'article[data-testid="tweet"], article[role="article"], article',
  facebook: 'div[role="article"], [role="article"]',
  instagram: 'article ul > li, article',
  tiktok: '[data-e2e^="comment-level-"], [data-e2e="recommend-list-item-container"]',
  youtube: [
    'ytd-comment-view-model',
    'ytd-comment-thread-renderer',
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-grid-video-renderer',
  ].join(', '),
};

// Best-effort author handle inside the container, for the account rule.
const AUTHOR_SELECTORS: Record<Platform, string> = {
  twitter: '[data-testid="User-Name"] a[href^="/"]',
  facebook: 'h2 a[role="link"], h3 a[role="link"], h4 a[role="link"], strong a[role="link"]',
  instagram: 'header a[role="link"], a[href^="/"][role="link"]',
  tiktok: '[data-e2e="video-author-uniqueid"], [data-e2e="browse-username"], [data-e2e^="comment-username-"]',
  youtube: 'ytd-channel-name a, #author-text, #channel-name a',
};

export interface WordFilterPolicy {
  blocklist: ParentBlocklistValue;
  /** Replace swearing with asterisks (Child mode, or "no swearing" on). */
  starSwearing: boolean;
  /** Hide slurs. Off beside a Feedprint that hides them itself leaves them to it, so a slur is hidden once. */
  hideSlurs?: boolean;
}

/** Which of the rules with no switch of their own this filter runs; Off's controller leaves slurs to Feedprint. */
export interface WordFilterRules {
  slurs?: boolean;
}

export function wordFilterPolicy(settings: FWSettings, rules: WordFilterRules = {}): WordFilterPolicy {
  return {
    blocklist: activeParentBlocklist(settings.features),
    starSwearing: settings.mode === 'child' || settings.strictLanguage === true,
    hideSlurs: rules.slurs ?? true,
  };
}

export type WordFilterHideReason = 'account' | 'word' | 'phrase' | 'slur';

export interface WordFilterDecision {
  reason: WordFilterHideReason;
  /** The user's rule that fired (its normalized text), absent for the slur tier. */
  rule?: string;
}

/**
 * Pure decision: should a post or comment with this text and author be
 * hidden, why, and by which of the user's rules. Exported so the rule order
 * is testable without a DOM.
 */
export function decideHideRule(
  text: string,
  author: string | undefined,
  policy: WordFilterPolicy,
  card?: BlocklistCard,
): WordFilterDecision | null {
  const match = matchParentBlocklist(policy.blocklist, text, author, card);
  if (match) return { reason: match.kind, rule: match.rule };
  // Mode is irrelevant for the slur tier: it always replaces, and the
  // caller hides rather than showing the asterisked text.
  if (policy.hideSlurs !== false && filterProfanity(text, 'adult', { tier: 'slurs' }).filtered) return { reason: 'slur' };
  return null;
}

export function decideHide(
  text: string,
  author: string | undefined,
  policy: WordFilterPolicy,
): WordFilterHideReason | null {
  return decideHideRule(text, author, policy)?.reason ?? null;
}


export function readAuthor(container: Element, platform: Platform): string | undefined {
  const el = container.querySelector<HTMLElement>(AUTHOR_SELECTORS[platform]);
  if (!el) return undefined;
  const href = el.getAttribute('href');
  if (href) {
    try {
      const path = new URL(href, location.origin).pathname.replace(/\/+$/, '');
      const last = path.split('/').filter(Boolean).pop()?.replace(/^@+/, '');
      if (last && !last.includes('.')) return last;
    } catch {
      // fall through to the visible text
    }
  }
  const text = el.textContent?.trim().replace(/^@+/, '');
  return text && text.length > 0 ? text : undefined;
}

function muteMedia(container: Element): void {
  container.querySelectorAll<HTMLMediaElement>('video, audio').forEach((m) => {
    try { m.pause(); } catch { /* detached player */ }
    m.muted = true;
  });
}

/**
 * The box to collapse for a hidden post. X lays its timeline out as
 * `[data-testid="cellInnerDiv"]` cells; hiding only the article inside one
 * leaves the cell's height as an empty stripe (seen on a blocked account's
 * profile, where the hidden posts left layered gaps), while a
 * hidden cell reflows, as the ad hiders already rely on.
 */
export function hideTargetFor(container: HTMLElement, platform: Platform): HTMLElement {
  if (platform === 'twitter') return container.closest<HTMLElement>('[data-testid="cellInnerDiv"]') ?? container;
  if (platform === 'tiktok') return tiktokCommentItem(container) ?? container;
  return container;
}

/**
 * TikTok marks a comment's parts, not the comment: `comment-level-N` is the
 * text paragraph, `comment-username-N` and `comment-avatar-N` sit beside it.
 * The comment is their nearest common ancestor; hiding the paragraph alone
 * left the name and picture standing and put them outside every rule (on
 * TikTok a comment could be picked but not its username or picture). Null when `el` is not part of a comment.
 */
export function tiktokCommentItem(el: Element): HTMLElement | null {
  const part = el.closest<HTMLElement>('[data-e2e^="comment-level-"], [data-e2e^="comment-username-"], [data-e2e^="comment-avatar-"]');
  const m = /^comment-(?:level|username|avatar)-(\d+)$/.exec(part?.getAttribute('data-e2e') ?? '');
  if (!part || !m) return null;
  const n = m[1];
  // The box that holds every part: text and name always, the picture when
  // the comment has one (it sits a level above the name and text).
  const parts = [`[data-e2e="comment-level-${n}"]`, `[data-e2e="comment-username-${n}"]`, `[data-e2e="comment-avatar-${n}"]`];
  let withNameAndText: HTMLElement | null = null;
  let cur: HTMLElement | null = part.parentElement;
  for (let i = 0; cur && i < 8; i++) {
    const has = parts.map(s => !!cur!.querySelector(s));
    if (has[0] && has[1] && has[2]) return cur;
    if (has[0] && has[1] && !withNameAndText) withNameAndText = cur;
    cur = cur.parentElement;
  }
  return withNameAndText;
}

function hideContainer(post: HTMLElement, decision: WordFilterDecision, platform: Platform): void {
  const { reason, rule } = decision;
  const container = hideTargetFor(post, platform);
  if (!markHidden(container, {
    marker: WORD_FILTER_HIDDEN_MARKER,
    value: WORD_FILTER_HIDDEN_VALUE,
    reason: `word-filter:${reason}`,
    // The popup counts the slur rule on its own line, the three list rules
    // together under the user's rules.
    feature: reason === 'slur' ? 'slurs' : 'word-filter',
  })) return;
  // And the rule itself, so the editor can show which of the user's rules
  // does the work (owner 2026-09-03: a per-rule count). Not a hide of its
  // own: the total moved above.
  if (reason !== 'slur' && rule) countHiddenFor(ruleTallyKey(reason, rule), 1, false);
  // Keep the box on Instagram: see HIDDEN_CSS. Through the door since
  // 2026-09-20, so a refusal stops the mute as well: muting somebody's call is
  // not a smaller thing to do to them than hiding it.
  if (platform === 'instagram') container.setAttribute('data-fw-hide-mode', 'visibility');
  if (!hideElement(container, {
    marker: WORD_FILTER_HIDDEN_MARKER, value: WORD_FILTER_HIDDEN_VALUE,
    reason: `word-filter:${reason}`,
    count: 0,
    mode: platform === 'instagram' ? 'visibility' : 'display',
  })) return;
  muteMedia(container);
}

// A scope is re-read only when its text changed, so React re-renders that
// keep the same text cost nothing.
// Reset on every start: a restart after a settings write (a new account
// rule) must re-read scopes whose text did not change, or a post the picker
// hid comes back with the restart and stays (a blocked post stayed on screen
// until the page was refreshed).
let seenScopeText = new WeakMap<Element, string>();
const seenNodeText = new WeakMap<Text, string>();

function starSwearingIn(scope: Element): void {
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!(node instanceof Text)) return NodeFilter.FILTER_REJECT;
      const value = node.nodeValue;
      if (!value) return NodeFilter.FILTER_REJECT;
      if (seenNodeText.get(node) === value) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Text[] = [];
  let cur: Node | null = walker.nextNode();
  while (cur) {
    if (cur instanceof Text) nodes.push(cur);
    cur = walker.nextNode();
  }
  for (const node of nodes) {
    const before = node.nodeValue ?? '';
    // 'child' forces the asterisk replacement in the profanity tier; the
    // mode gate was already applied when the policy was built.
    const result = filterProfanity(before, 'child', { tier: 'profanity' });
    const after = result.filtered ? result.cleanText : before;
    if (after !== before) {
      node.nodeValue = after;
      // Starred words are the "no swearing" line in the popup; they hide
      // nothing, so the total hidden counter stays where it is.
      countHiddenFor('no-swearing', result.matches.length, false);
    }
    seenNodeText.set(node, after);
  }
}

// Feedprint's hide, on the post or a box around it. A second hide from Off would keep the post hidden after
// the person clicks Feedprint's Show, so Off leaves a post Feedprint hid, or hid and the person showed again.
// The attribute alone is not enough: a feed reuses its boxes, and Feedprint's mark can outlive its hide.
// Feedprint's fold sits on the post's text, inside the box Off would hide, and stays when the person opens it;
// a fold on a comment drawn inside the post's box (Facebook) is the comment's, not the post's.
const RECORDER_HIDE = '[data-fw-hard-hidden="true"], [data-fw-ad-hidden="true"]';
const RECORDER_FOLD = '[data-fw-action="collapse"], [data-fw-action="hide"]';
function hiddenByRecorder(container: HTMLElement, scope: HTMLElement, platform: Platform): boolean {
  if (scope.closest(RECORDER_FOLD)) return true;
  for (const fold of container.querySelectorAll(RECORDER_FOLD)) {
    if (fold.closest(CONTAINER_SELECTORS[platform]) === container) return true;
  }
  const box = container.closest<HTMLElement>(RECORDER_HIDE);
  if (!box) return false;
  return box.getAttribute('data-fw-user-revealed') === 'true'
    || box.style.display === 'none' || box.style.visibility === 'hidden';
}

function processScope(scope: HTMLElement, platform: Platform, policy: WordFilterPolicy): void {
  if (isInPrivateChatSubtree(scope) || scope.closest('[role="log"]')) return;
  const container = (scope.closest(CONTAINER_SELECTORS[platform]) as HTMLElement | null) ?? scope;
  if (container.getAttribute(WORD_FILTER_HIDDEN_MARKER) === WORD_FILTER_HIDDEN_VALUE) return;

  const text = scope.textContent ?? '';
  if (seenScopeText.get(scope) !== text) {
    seenScopeText.set(scope, text);
    // The author is read from the box that will be hidden (on TikTok the
    // username sits beside the text paragraph, not inside it).
    // The card around the words counts too (2026-09-07): a quoted post, a
    // link card, a "From" line and the accounts they name.
    const decision = decideHideRule(text, readAuthor(hideTargetFor(container, platform), platform), policy, readCardContext(container, platform));
    if (decision && !hiddenByRecorder(container, scope, platform)) {
      hideContainer(container, decision, platform);
      return;
    }
  }
  if (policy.starSwearing) starSwearingIn(scope);
}

function runOnce(platform: Platform, policy: WordFilterPolicy): void {
  const selectors = TEXT_SCOPE_SELECTORS[platform];
  if (!selectors) return;
  for (const sel of selectors) {
    document.querySelectorAll<HTMLElement>(sel).forEach((scope) => processScope(scope, platform, policy));
  }
}

// One inserted subtree: the scopes inside it, the root itself if it is one,
// and the nearest scope above it (a node inserted into an existing scope
// changes that scope's text). Bounded by the insert, runs before paint.
function runOnRoots(roots: Element[], platform: Platform, policy: WordFilterPolicy): void {
  const selectors = TEXT_SCOPE_SELECTORS[platform];
  if (!selectors) return;
  const joined = selectors.join(', ');
  const seen = new Set<HTMLElement>();
  const take = (el: Element | null): void => {
    if (el instanceof HTMLElement && !seen.has(el)) {
      seen.add(el);
      processScope(el, platform, policy);
    }
  };
  for (const root of roots) {
    take(root.closest(joined));
    root.querySelectorAll<HTMLElement>(joined).forEach(take);
  }
}

export function resetWordFilterDOM(): void {
  document
    .querySelectorAll<HTMLElement>(`[${WORD_FILTER_HIDDEN_MARKER}="${WORD_FILTER_HIDDEN_VALUE}"]`)
    .forEach((el) => {
      el.removeAttribute(WORD_FILTER_HIDDEN_MARKER);
      el.removeAttribute('data-fw-block-reason');
      el.removeAttribute('data-fw-hide-mode');
      el.style.removeProperty('display');
      el.style.removeProperty('visibility');
    });
  removeStyleTag(WORD_FILTER_STYLE_TAG_ID);
}

/**
 * Start the word filter for one page. Returns the cleanup. Alone the slur
 * rule is always on; beside a Feedprint that hides slurs and stars swearing,
 * an empty own list leaves this filter nothing to do.
 */
export function startWordFilter(platform: Platform, settings: FWSettings, rules: WordFilterRules = {}): () => void {
  if (!TEXT_SCOPE_SELECTORS[platform]) return () => {};
  const policy = wordFilterPolicy(settings, rules);
  if (!policy.hideSlurs && !policy.starSwearing && isParentBlocklistEmpty(policy.blocklist)) return () => {};
  seenScopeText = new WeakMap<Element, string>();
  ensureStyleTag(WORD_FILTER_STYLE_TAG_ID, HIDDEN_CSS);
  runOnce(platform, policy);
  // Inserted subtrees are read at mutation time, so a matching post is
  // hidden before it is ever painted; the 2 s pass catches text a platform
  // swaps into an existing node.
  const stopAdded = observeAddedRoots((roots) => runOnRoots(roots, platform, policy));
  const interval = setInterval(() => runOnce(platform, policy), 2000);
  return () => {
    stopAdded();
    clearInterval(interval);
    resetWordFilterDOM();
  };
}
