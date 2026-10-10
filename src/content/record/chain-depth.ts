// Coordinate-system Adapter between two depth schemas:
//   - PostContent.depth is 1-indexed (1=top-comment, 2=reply, 3=reply-to-reply)
//   - ForensicRecord.commentDepth is 0-indexed (0=top-comment, 1=reply, 2=reply-to-reply)
// Used at the chain-write site so recipient-facing depth values reflect the
// actual conversation tree rather than a hardcoded 0. VISION §1.1 chain-mirror
// invariant: the chain mirrors what the child saw, including reply nesting.

export function chainCommentDepth(postDepth: number | undefined): number {
  if (typeof postDepth !== 'number' || postDepth < 1) return 0;
  return postDepth - 1;
}
