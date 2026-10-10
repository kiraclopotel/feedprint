import { describe, it, expect } from 'vitest';
import { chainCommentDepth } from '../../../../src/content/record/chain-depth';

describe('chainCommentDepth', () => {
  it('translates 1-indexed top-comment to 0-indexed', () => {
    expect(chainCommentDepth(1)).toBe(0);
  });

  it('translates 1-indexed reply (depth=2) to 0-indexed (1)', () => {
    expect(chainCommentDepth(2)).toBe(1);
  });

  it('translates 1-indexed reply-to-reply (depth=3) to 0-indexed (2)', () => {
    expect(chainCommentDepth(3)).toBe(2);
  });

  it('returns 0 for undefined (back-compat with extractors that did not set depth)', () => {
    expect(chainCommentDepth(undefined)).toBe(0);
  });

  it('returns 0 for non-positive depth (defensive against malformed input)', () => {
    expect(chainCommentDepth(0)).toBe(0);
    expect(chainCommentDepth(-1)).toBe(0);
  });

  it('returns 0 for non-number input (defensive against type drift)', () => {
    // @ts-expect-error - intentional bad input for the runtime guard
    expect(chainCommentDepth('1')).toBe(0);
    // @ts-expect-error - intentional bad input
    expect(chainCommentDepth(null)).toBe(0);
  });
});
