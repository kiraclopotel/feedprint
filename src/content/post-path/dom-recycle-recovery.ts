// FeelingWise — DOM-recycle anchor recovery helpers.
//
// Sits ABOVE `verifyAnchorMatch` (see `src/forensics/anchor-revalidation.ts`).
// When the platform's virtualizer recycles a tweet/comment node between
// enqueue and verdict-arrival, the WeakRef's deref returns a still-connected
// node whose text content no longer matches the original. The render-gate
// previously cancelled in that case; these helpers attempt to re-locate the
// original element by content fingerprint among currently-mounted
// descendants of the WeakRef's nearest matching ancestor.
//
// `tryRecoverDomRecycledAnchor` — generic post-path variant; the caller
// supplies a CSS selector that scopes the sibling walk.
//
// `tryRecoverCommentAnchor` — comment-batch variant; per-platform wrapper +
// text-element selectors are baked in so the marker host (the inner text
// element where the rewrite text lives) can be located across the recycle.
//
// `tryRecoverCommentHideAnchor` — stricter hide-only variant. Facebook
// recovery stays inside one exact parent post and requires a unique full
// text + depth match, plus author when available, before hiding can move.
//
// `tryRecoverExactPostInterventionAnchor` — post-intervention re-apply
// variant (caller: content/index.ts). Re-locates the exact post by
// platform-stable id plus author guard inside the post's
// `recoveryScopeRef` after a platform rerender.
//
// Pure module: no DOM mutation, no chain writes. Caller decides whether to
// proceed with the recovered element or cancel.

import type { Platform, PostContent } from '../../types/post';
import { readTikTokVideoIdFromXgWrapper } from '../platforms/tiktok-video-id';

function normalizedAuthor(value: string): string {
  return value.trim().replace(/^@/, '').toLowerCase();
}

function xAuthor(article: HTMLElement): string {
  for (const link of article.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')) {
    if (link.closest('[data-testid="tweetText"]')) continue;
    if (link.closest('article') !== article) continue;
    const match = (link.getAttribute('href') ?? '').match(/^\/([A-Za-z0-9_]+)$/);
    if (match) return match[1];
  }
  return '';
}

function tiktokCaption(card: HTMLElement): string {
  const desc = card.querySelector<HTMLElement>('[data-e2e="video-desc"], [data-e2e="browse-video-desc"]');
  if (desc) return desc.textContent?.trim() ?? '';
  return Array.from(card.querySelectorAll<HTMLElement>('[data-e2e^="desc-span-"]'))
    .map((span) => span.textContent?.trim() ?? '').filter(Boolean).join(' ').trim();
}

function tiktokAuthor(card: HTMLElement): string {
  const named = card.querySelector<HTMLElement>('[data-e2e="video-author-uniqueid"], [data-e2e="browse-username"]');
  if (named?.textContent?.trim()) return named.textContent.trim();
  const href = card.querySelector<HTMLAnchorElement>('a[href^="/@"]')?.getAttribute('href') ?? '';
  return href.match(/^\/@([^/?#]+)/)?.[1] ?? '';
}

export function tryRecoverExactPostInterventionAnchor(post: PostContent): HTMLElement | null {
  const scope = post.recoveryScopeRef?.deref() ?? null;
  if (!scope?.isConnected) return null;
  const expectedAuthor = normalizedAuthor(post.author);
  const matches: HTMLElement[] = [];

  if (post.platform === 'twitter' && /^\d+$/.test(post.id)) {
    for (const article of scope.querySelectorAll<HTMLElement>('article')) {
      if (!article.isConnected) continue;
      const ids = Array.from(article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]'))
        .map((link) => (link.getAttribute('href') ?? '').match(/\/status\/(\d+)/)?.[1]);
      if (!ids.includes(post.id)) continue;
      const body = article.querySelector<HTMLElement>('[data-testid="tweetText"]');
      if ((body?.textContent?.trim() ?? '') !== post.text.trim()) continue;
      if (expectedAuthor && expectedAuthor !== 'unknown' && normalizedAuthor(xAuthor(article)) !== expectedAuthor) continue;
      if (body) matches.push(body);
    }
  } else if (post.platform === 'tiktok' && /^\d+$/.test(post.parentVideoId ?? '') && post.id === `tk-vid-${post.parentVideoId}`) {
    for (const card of scope.querySelectorAll<HTMLElement>('[data-e2e="recommend-list-item-container"]')) {
      if (!card.isConnected) continue;
      const ids = Array.from(card.querySelectorAll<HTMLAnchorElement>('a[href*="/video/"]'))
        .map((link) => (link.getAttribute('href') ?? '').match(/\/video\/(\d+)/)?.[1]);
      const candidateId = ids.length > 0
        ? (ids.includes(post.parentVideoId) ? post.parentVideoId : null)
        : readTikTokVideoIdFromXgWrapper(card);
      if (candidateId !== post.parentVideoId) continue;
      if (tiktokCaption(card) !== post.text.trim()) continue;
      if (expectedAuthor && expectedAuthor !== 'unknown' && normalizedAuthor(tiktokAuthor(card)) !== expectedAuthor) continue;
      matches.push(card);
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Trim + 200-char slice fingerprint that mirrors `recomputeAnchorFromDom`'s
 * shape (without the post-id prefix — fingerprint match is text-content only).
 */
function fingerprint(raw: string): string {
  return (raw ?? '').trim().slice(0, 200);
}

/**
 * Recover a recycled DOM anchor by content-fingerprint match.
 *
 * Behavior:
 *   1. If `domRef.deref()` returns a still-connected element AND that element's
 *      live text fingerprint matches `originalText`, return it (fast path —
 *      no recycle has occurred).
 *   2. Otherwise walk the deref'd element's nearest `parentSelector` ancestor
 *      and search that ancestor's parent for descendants matching
 *      `parentSelector` whose text fingerprint matches. Return the match only
 *      when there is exactly one.
 *   3. Return `null` when no match is found, when more than one mounted
 *      candidate carries the same fingerprint, when the inputs are malformed,
 *      or when the recovery walk would have unbounded scope.
 *
 * @param domRef          WeakRef captured at enqueue time (PostContent.domRef)
 * @param originalText    Text content captured at enqueue time (PostContent.text)
 * @param parentSelector  CSS selector identifying the ancestor + sibling shape
 *                        to scope the recovery walk (e.g. 'article' for X
 *                        tweets). Required — open-scope walks are rejected.
 */
export function tryRecoverDomRecycledAnchor(
  domRef: WeakRef<HTMLElement>,
  originalText: string,
  parentSelector: string,
): HTMLElement | null {
  const fp = fingerprint(originalText);
  if (!fp) return null;
  if (!parentSelector) return null;

  const derefEl = domRef.deref() ?? null;

  if (derefEl && derefEl.isConnected) {
    const liveFp = fingerprint(derefEl.textContent ?? '');
    if (liveFp === fp) return derefEl;
  }

  // Scope the recovery walk to the parent of the nearest matching ancestor of
  // the deref'd element so the candidate set includes the deref'd element's
  // siblings under that selector.
  //
  // A cleared or detached WeakRef leaves no ancestor to scope to, and the
  // earlier code fell back to document.body — which is not recovery, it is a
  // page-wide text search on a 200-character prefix. A copypasta, a repost and
  // two replies quoting the same block all carry that prefix, so the verdict
  // or the intervention could land on a stranger's post. The docblock above
  // has always promised null for an unbounded scope; the code now keeps that
  // promise. The two sibling helpers below (tryRecoverCommentAnchor,
  // tryRecoverCommentHideAnchor) were already strict on exactly this point,
  // which is what established the shape of the refusal here. The caller's
  // answer to null is a cancel record (post-path/result-apply.ts), so the
  // encounter is still stated on the chain; the wrong-post apply was not.
  if (!derefEl || !derefEl.isConnected) return null;

  let scope: HTMLElement;
  try {
    const ancestor = derefEl.closest(parentSelector);
    // No ancestor the selector names means the same unbounded walk by another
    // road; refuse it for the same reason.
    if (!ancestor?.parentElement) return null;
    scope = ancestor.parentElement;
  } catch {
    return null;
  }

  let candidates: NodeListOf<HTMLElement>;
  try {
    candidates = scope.querySelectorAll<HTMLElement>(parentSelector);
  } catch {
    return null;
  }

  // Exactly one, never the first of several. Two mounted candidates carrying
  // one fingerprint means the fingerprint does not identify the post, and
  // picking the earlier one in document order is picking at random.
  let match: HTMLElement | null = null;
  for (const candidate of candidates) {
    if (!candidate.isConnected) continue;
    const candidateFp = fingerprint(candidate.textContent ?? '');
    if (candidateFp !== fp) continue;
    if (match) return null;
    match = candidate;
  }

  return match;
}

/**
 * Per-platform selector pair used by `tryRecoverCommentAnchor`:
 *   - `wrapper` = the article / list-item container whose parent scopes the
 *     sibling search.
 *   - `textEl`  = the descendant element that holds the comment body text
 *     (the marker host). Returned by recovery so the marker is appended to
 *     the same kind of element the platform extractor captured at enqueue
 *     time.
 */
const COMMENT_RECOVERY_SELECTORS: Record<Platform, { wrapper: string; textEl: string }> = {
  twitter:   { wrapper: 'article',                              textEl: '[data-testid="tweetText"]' },
  facebook:  { wrapper: '[role="article"]',                     textEl: '[data-ad-comet-preview="message"], [dir="auto"]' },
  instagram: { wrapper: 'article, ul > li',                     textEl: 'span' },
  tiktok:    { wrapper: '[class*="DivCommentItemWrapper"]',      textEl: '[data-e2e="comment-text"], span.TUXText, span[class*="TUXText"]' },
  // The THREAD, not the view-model inside it. The walk takes the wrapper's
  // PARENT as the scope and looks for sibling wrappers there, and a
  // view-model's parent is its own thread, so the scope held exactly one
  // comment: the recycled one. Every sibling comment on the page is a sibling
  // of the THREAD. Measured 2026-09-19 on a two-comment page, where recovery
  // returned null with the body text sitting on the comment next door. The
  // thread is also an ancestor of the view-model, so a caller anchored on
  // either one still finds it.
  youtube:   { wrapper: 'ytd-comment-thread-renderer',           textEl: '#content-text' },
};

/**
 * Recover a recycled COMMENT text-element anchor by content-fingerprint match.
 * Mirror of `tryRecoverDomRecycledAnchor` for the comment-batch render-gate.
 * Per-platform selector pairs scope the sibling walk to the right comment
 * container shape and locate the marker host inside the matched comment.
 *
 * Behavior:
 *   1. Fast path — if `domRef.deref()` is connected and its live text
 *      fingerprint matches `originalText`, return it.
 *   2. Sibling walk — descend from the deref'd element's nearest wrapper
 *      ancestor's parent to find sibling wrappers; for each, query the
 *      platform's `textEl` selector and fingerprint-compare its text.
 *      Return the first match.
 *   3. Return null when no sibling match is found, the inputs are malformed,
 *      or the WeakRef has been fully cleared.
 */
export function tryRecoverCommentAnchor(
  domRef: WeakRef<HTMLElement>,
  originalText: string,
  platform: Platform,
): HTMLElement | null {
  const fp = fingerprint(originalText);
  if (!fp) return null;

  const selectors = COMMENT_RECOVERY_SELECTORS[platform];
  if (!selectors) return null;

  const derefEl = domRef.deref() ?? null;

  if (derefEl && derefEl.isConnected) {
    const liveFp = fingerprint(derefEl.textContent ?? '');
    if (liveFp === fp) return derefEl;
  }

  // Scope the recovery walk to the parent of the nearest wrapper of the
  // deref'd element so the candidate set includes sibling comments under
  // that container. Cleared / detached WeakRef has no usable scope — skip.
  if (!derefEl || !derefEl.isConnected) return null;

  let scope: HTMLElement;
  try {
    const wrapper = derefEl.closest(selectors.wrapper);
    const parent = wrapper?.parentElement;
    if (!parent) return null;
    scope = parent as HTMLElement;
  } catch {
    return null;
  }

  let wrappers: NodeListOf<HTMLElement>;
  try {
    wrappers = scope.querySelectorAll<HTMLElement>(selectors.wrapper);
  } catch {
    return null;
  }

  for (const wrapper of wrappers) {
    if (!wrapper.isConnected) continue;
    // Check ALL text-element candidates per wrapper, not just the first.
    // On TikTok a comment row carries several `span.TUXText` siblings
    // (username, body, timestamp); the body is not the first match, so a
    // single `querySelector` would fingerprint the username and miss. Match
    // by content fingerprint across every candidate to locate the body.
    const textEls = wrapper.querySelectorAll<HTMLElement>(selectors.textEl);
    for (const textEl of textEls) {
      if (!textEl.isConnected) continue;
      const candidateFp = fingerprint(textEl.textContent ?? '');
      if (candidateFp === fp) return textEl;
    }
  }

  return null;
}

export interface CommentHideRecoveryIdentity {
  parentId: string;
  author: string;
  depth?: number;
}

function exactCommentText(raw: string): string {
  return (raw ?? '').trim();
}

function facebookCommentCandidate(
  wrapper: HTMLElement,
  parentScope: HTMLElement,
): { text: string; author: string; depth: number; textEl: HTMLElement } | null {
  const ownDirAutos = Array.from(
    wrapper.querySelectorAll<HTMLElement>('div[dir="auto"]'),
  ).filter((el) => el.closest('[role="article"][aria-label]') === wrapper);
  if (ownDirAutos.length === 0) return null;

  const paragraphs = ownDirAutos
    .map((el) => exactCommentText(el.textContent ?? ''))
    .filter(Boolean);
  const text = paragraphs.join('\n');
  if (!text) return null;

  let textEl: HTMLElement;
  if (ownDirAutos.length === 1) {
    textEl = ownDirAutos[0];
  } else {
    const parent = ownDirAutos[0].parentElement;
    const allShareParent = !!parent && ownDirAutos.every((el) => el.parentElement === parent);
    const onlyDirAutoChildren = !!parent && Array.from(parent.children).every((child) =>
      (child as HTMLElement).matches?.('div[dir="auto"]'),
    );
    textEl = parent && allShareParent && onlyDirAutoChildren
      ? parent
      : ownDirAutos.reduce(
          (best, current) =>
            (current.textContent?.length ?? 0) > (best.textContent?.length ?? 0)
              ? current
              : best,
          ownDirAutos[0],
        );
  }

  let author = '';
  for (const link of wrapper.querySelectorAll<HTMLElement>('a[role="link"]')) {
    const candidate = exactCommentText(link.textContent ?? '');
    if (candidate.length > 0 && candidate.length < 80) {
      author = candidate;
      break;
    }
  }

  let depth = 1;
  let ancestor = wrapper.parentElement;
  while (ancestor && ancestor !== parentScope) {
    if (ancestor.matches('[role="article"][aria-label]')) depth = Math.min(depth + 1, 3);
    ancestor = ancestor.parentElement;
  }

  return { text, author, depth, textEl };
}

/**
 * Resolve a comment HIDE target under a stricter contract than marker recovery.
 * Hiding the wrong row is irreversible UI damage, so Facebook recovery is
 * limited to one exact parent post and requires one unique full-text + depth
 * match, plus author when available. A cleared/detached reference never
 * triggers a document-wide text walk.
 */
export function tryRecoverCommentHideAnchor(
  domRef: WeakRef<HTMLElement>,
  originalText: string,
  platform: Platform,
  identity: CommentHideRecoveryIdentity,
): HTMLElement | null {
  const expectedText = exactCommentText(originalText);
  if (!expectedText) return null;

  if (platform !== 'facebook') {
    const current = domRef.deref() ?? null;
    return current?.isConnected ? current : null;
  }

  const expectedAuthor = exactCommentText(identity.author);
  if (!identity.parentId) return null;
  const requireAuthor = expectedAuthor.length > 0 && expectedAuthor !== 'unknown';

  const current = domRef.deref() ?? null;
  const connectedScope = current?.isConnected
    ? current.closest<HTMLElement>('[data-fw-post-id]')
    : null;
  let parentScope: HTMLElement;
  if (connectedScope?.dataset.fwPostId === identity.parentId) {
    parentScope = connectedScope;
  } else {
    const parentScopes = Array.from(
      document.querySelectorAll<HTMLElement>('[data-fw-post-id]'),
    ).filter((scope) => scope.isConnected && scope.dataset.fwPostId === identity.parentId);
    if (parentScopes.length !== 1) return null;
    parentScope = parentScopes[0];
  }

  const matches: HTMLElement[] = [];
  for (const wrapper of parentScope.querySelectorAll<HTMLElement>('[role="article"][aria-label]')) {
    if (!wrapper.isConnected) continue;
    if (wrapper.closest<HTMLElement>('[data-fw-post-id]') !== parentScope) continue;
    const candidate = facebookCommentCandidate(wrapper, parentScope);
    if (!candidate) continue;
    if (candidate.text !== expectedText) continue;
    if (requireAuthor && candidate.author !== expectedAuthor) continue;
    if (identity.depth !== undefined && candidate.depth !== identity.depth) continue;
    matches.push(candidate.textEl);
    if (matches.length > 1) return null;
  }

  return matches.length === 1 ? matches[0] : null;
}
