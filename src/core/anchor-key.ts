// How a post is recognised again when the platform reuses its page element for another post. In
// core because the revalidation gate, the render gate and the result-apply path all read it.

import type { PostContent } from '../types/post';

/**
 * The post id plus the first 200 characters of text, since two posts can share an empty or made-up
 * id. Before a verdict is shown, this is compared with the same key read from the live page; a
 * mismatch means the element now holds another post, and the verdict would land on the wrong one.
 * Not cryptographic: it detects reuse, it does not secure anything.
 *
 * A post with no caption (TikTok music-only, some Instagram and Shorts posts) uses the author
 * instead, or every creator's empty post would share one key. recomputeAnchorFromDom in
 * src/forensics/anchor-revalidation.ts builds the same shape.
 */
export function computeAnchorKey(post: PostContent): string {
  const id = post.id ?? '';
  const slice = (post.text ?? '').slice(0, 200).trim();
  if (slice) return `${id}::${slice}`;
  const author = (post.author ?? '').trim();
  return `${id}::${author}::__nocaption__`;
}

/**
 * True when computeAnchorKey fell back to the author. A separate function so computeAnchorKey,
 * called from several places in the render gate, keeps returning a plain string.
 */
export function isAnchorDegenerate(post: PostContent): boolean {
  const slice = (post.text ?? '').slice(0, 200).trim();
  return slice.length === 0;
}
