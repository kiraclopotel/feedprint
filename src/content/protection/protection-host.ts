import type { Platform } from '../../types/post';

const HOST_SELECTORS: Partial<Record<Platform, string>> = {
  twitter: '[data-testid="cellInnerDiv"], article[data-testid="tweet"], article[role="article"]',
  facebook: '[role="article"][aria-label], div[role="article"]',
  tiktok: '[class*="DivCommentItemWrapper"], [data-e2e="recommend-list-item-container"], [data-e2e="video-detail"]',
  instagram: '[data-fw-comment-row="true"], li[role="listitem"], article, main, a[href*="/p/"], a[href*="/reel/"]',
  youtube: 'ytd-comment-view-model, ytd-backstage-post-renderer, ytd-rich-item-renderer, ytd-video-renderer, ytd-reel-video-renderer, ytd-watch-flexy',
};

const COMMENT_HOST_SELECTORS: Partial<Record<Platform, string>> = {
  twitter: 'article[data-testid="tweet"], article[role="article"]',
  facebook: 'li, [data-fw-comment-seen="true"], div[role="article"]',
  tiktok: '[class*="DivCommentItemWrapper"]',
  instagram: '[data-fw-comment-row="true"], li[role="listitem"]',
  youtube: 'ytd-comment-view-model',
};

const REPLACED_OR_VOID = new Set(['IMG', 'VIDEO', 'AUDIO', 'SOURCE', 'TRACK', 'INPUT', 'BR', 'HR']);
const INLINE_FALLBACK = new Set(['SPAN', 'YT-FORMATTED-STRING', 'YT-ATTRIBUTED-STRING']);

/** Resolve a paintable card/row while leaving PostContent.domRef as the mutation anchor. */
export function resolveProtectionHost(
  anchor: HTMLElement,
  platform?: Platform,
  kind?: string,
): HTMLElement {
  const isComment = kind === 'comment' || kind === 'top-comment' || kind === 'reply' || kind === 'reply-to-reply';
  if (platform === 'facebook' && !isComment) {
    const feedUnit = anchor.closest<HTMLElement>('[aria-posinset]');
    if (feedUnit) return feedUnit;
  }
  const selector = platform
    ? (isComment ? COMMENT_HOST_SELECTORS[platform] : undefined) ?? HOST_SELECTORS[platform]
    : undefined;
  const selected = selector ? anchor.closest<HTMLElement>(selector) : null;
  if (selected) return selected;

  if (!REPLACED_OR_VOID.has(anchor.tagName) && !INLINE_FALLBACK.has(anchor.tagName)) return anchor;

  let candidate = anchor.parentElement;
  for (let depth = 0; candidate && depth < 5; depth++, candidate = candidate.parentElement) {
    if (candidate === document.body || candidate === document.documentElement) break;
    if (!REPLACED_OR_VOID.has(candidate.tagName) && !INLINE_FALLBACK.has(candidate.tagName)) return candidate;
  }
  return anchor.parentElement ?? anchor;
}
