// @vitest-environment jsdom
//
// Facebook post-level engagement metrics. FB renders the engagement row as
// separate leaf spans ("All reactions:" + count, "N comments", "N shares"); the
// row's combined textContent glues the reaction + comment numbers together
// ("966" + "84 comments" → "96684 comments"), and the reaction-summary button's
// aria-label dropped its count. extractFacebookPostMetrics scans the leaf spans.
// Structure + values captured from the live facebook.com DOM on 2026-06-15.

import { describe, it, expect } from 'vitest';
import { extractFacebookPostMetrics } from '../../../../src/content/platforms/facebook';

function article(html: string): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('role', 'article');
  el.innerHTML = html;
  return el;
}

// The live engagement row: a "See who reacted" button, then leaf spans.
const ENGAGEMENT_ROW = `
  <div>
    <div role="button" aria-label="See who reacted to this"></div>
    <div>All reactions:</div><span>966</span><span>966</span>
    <span>84 comments</span><span>18 shares</span>
  </div>`;

describe('extractFacebookPostMetrics', () => {
  it('reads reactions / comments / shares from the leaf spans (not the glued row text)', () => {
    expect(extractFacebookPostMetrics(article(ENGAGEMENT_ROW))).toEqual({
      postReactions: 966,
      postCommentsCount: 84,
      postShares: 18,
    });
  });

  it('expands compressed counts and handles Romanian labels', () => {
    const ro = `<div>Toate reacţiile:</div><span>1.2K</span>
      <span>340 comentarii</span><span>57 distribuiri</span>`;
    expect(extractFacebookPostMetrics(article(ro))).toEqual({
      postReactions: 1200,
      postCommentsCount: 340,
      postShares: 57,
    });
  });

  it('does not mistake a stray number for the reaction count (must follow the label)', () => {
    // A timestamp-like "2" leaf with no "All reactions:" before it must be ignored.
    const noReact = `<span>2</span><span>12 comments</span><span>3 shares</span>`;
    expect(extractFacebookPostMetrics(article(noReact))).toEqual({
      postCommentsCount: 12,
      postShares: 3,
    });
  });

  it('falls back to the legacy reaction-toolbar aria-label when present', () => {
    const legacy = `<div role="toolbar" aria-label="Toate reacţiile: 412"></div>
      <span>9 comments</span>`;
    expect(extractFacebookPostMetrics(article(legacy))).toEqual({
      postReactions: 412,
      postCommentsCount: 9,
    });
  });

  it('returns all-undefined when the post has no engagement row', () => {
    expect(extractFacebookPostMetrics(article('<div>just a caption</div>'))).toEqual({
      postReactions: undefined,
      postCommentsCount: undefined,
      postShares: undefined,
    });
  });
});
