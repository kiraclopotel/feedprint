// @vitest-environment jsdom
//
// Q27 — counting-only probe of the Facebook block-comment-posting selector
// surface. The probe must classify a matched element that carries post
// content (media or long text) as RISKY, and must never mutate the DOM.

import { beforeEach, describe, expect, it } from 'vitest';
import { probeCommentBlockMatches } from '../../../../src/content/engagement/facebook-engagement';

beforeEach(() => { document.body.replaceChildren(); });

describe('probeCommentBlockMatches', () => {
  it('counts a plain comment aria-label as bare, not risky', () => {
    const comment = document.createElement('div');
    comment.setAttribute('aria-label', 'Comentariu de la Ana');
    comment.textContent = 'scurt';
    document.body.appendChild(comment);

    const r = probeCommentBlockMatches();
    expect(r.bare).toBeGreaterThanOrEqual(1);
    expect(r.bareRisky).toBe(0);
  });

  it('flags a matched element containing media as risky', () => {
    const postButton = document.createElement('div');
    postButton.setAttribute('aria-label', 'Lasă un comentariu');
    const media = document.createElement('video');
    postButton.appendChild(media);
    document.body.appendChild(postButton);

    const r = probeCommentBlockMatches();
    expect(r.bareRisky).toBeGreaterThanOrEqual(1);
  });

  it('flags a matched element with long text as risky and mutates nothing', () => {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('aria-label', 'Comment by Bob');
    wrapper.textContent = 'x'.repeat(600);
    document.body.appendChild(wrapper);

    const before = document.body.innerHTML;
    const r = probeCommentBlockMatches();
    expect(r.bareRisky).toBeGreaterThanOrEqual(1);
    expect(document.body.innerHTML).toBe(before);
  });
});
