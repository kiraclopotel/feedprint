// @vitest-environment jsdom
//
// The Instagram blank-post probe (known issue M95: posts blank or "cut off" during fast scrolling,
// cause unknown). It changes nothing on the page; it names, for each post container that is blank,
// which FeelingWise mechanism left its mark there, so one live scroll can tell the six suspects apart.
// What it may write down is only style values, attribute names and short attribute codes: never a
// post's words or an account name, because the diagnostics it feeds are something a person shares.

import { describe, expect, it } from 'vitest';

import { describeBlankPosts } from '../../../../src/content/probes/instagram-blank-probe';

const inView = () => true;

function page(html: string): void {
  document.body.innerHTML = html;
}

describe('the Instagram blank-post probe', () => {
  it('names the AI-content blocker on a post it hid (suspects 1 and 2 leave the same mark)', () => {
    page(`<main><article id="a" data-fw-blocked="ai-content" data-fw-block-reason="ai-content:hashtag" style="visibility: hidden;">
      <a href="/ana.secret/">ana.secret</a><span>Ana's private words</span></article></main>`);
    const [hit] = describeBlankPosts(document, inView);
    expect(hit.reason).toBe('visibility');
    expect(hit.markers).toContainEqual({ on: 'self', name: 'data-fw-blocked', value: 'ai-content' });
    expect(hit.markers).toContainEqual({ on: 'self', name: 'data-fw-block-reason', value: 'ai-content:hashtag' });
  });

  it('names a hidden ancestor, the shape of the Reels page blackout left over on the feed (suspect 4)', () => {
    page(`<main data-fw-blocked="reel-surface" data-fw-block-reason="reel-surface:^\\/reels\\/" style="visibility: hidden;">
      <article id="b"><span>a post</span></article></main>`);
    const hit = describeBlankPosts(document, inView).find((h) => h.reason === 'ancestor-visibility')!;
    expect(hit.markers).toContainEqual({ on: 'ancestor', name: 'data-fw-block-reason', value: 'reel-surface:^\\/reels\\/' });
  });

  it('names a shield on an ancestor, the "cut off" suspect, with the post itself untouched (suspect 3)', () => {
    page(`<main><div data-fw-provisional-shield-token="t1" style="position: relative !important;">
      <article id="c"><span>a post</span></article></div></main>`);
    const hit = describeBlankPosts(document, inView).find((h) => h.reason === 'shield-ancestor')!;
    expect(hit.shieldedAncestor).toBe(true);
    expect(hit.shieldPositionKept).toBe(true);
  });

  it('still names the shield after Instagram rewrote the position it set', () => {
    page(`<main><div data-fw-provisional-shield-token="t1" style="position: static;">
      <article id="c2"><span>a post</span></article></div></main>`);
    const hit = describeBlankPosts(document, inView).find((h) => h.reason === 'shield-ancestor')!;
    expect(hit.shieldPositionKept).toBe(false);
  });

  it('sees a permalink page, where the AI-content blocker hides the whole main column and there is no article', () => {
    page(`<main id="m" data-fw-blocked="ai-content" data-fw-block-reason="ai-content:permalink" style="visibility: hidden;"><div>a post</div></main>`);
    const [hit] = describeBlankPosts(document, inView);
    expect(hit.reason).toBe('visibility');
    expect(hit.markers).toContainEqual({ on: 'self', name: 'data-fw-blocked', value: 'ai-content' });
  });

  it('names the orphan-label hider when a whole row went with a label (suspect 5)', () => {
    page(`<main><article id="d"><div data-fw-block-reason="hide-engagement-metrics:ig-orphan-label" style="display: none;">
      <span>the row</span></div></article></main>`);
    const hits = describeBlankPosts(document, inView);
    expect(hits).toHaveLength(1);
    expect(hits[0].reason).toBe('child-display');
    expect(hits[0].markers).toContainEqual({ on: 'child', name: 'data-fw-block-reason', value: 'hide-engagement-metrics:ig-orphan-label' });
  });

  it('writes down no words and no account names, even from an attribute that holds them', () => {
    page(`<main><article id="e" data-fw-blocked="ai-content" data-fw-original="Ana's private words" aria-label="ana.secret"
      style="visibility: hidden;"><a href="/ana.secret/">ana.secret</a><span>Ana's private words</span></article></main>`);
    const out = JSON.stringify(describeBlankPosts(document, inView));
    expect(out).not.toContain('private');
    expect(out).not.toContain('ana.secret');
    expect(out).toContain('data-fw-original');
  });

  it('reports nothing for a post FeelingWise did not touch, or one out of view', () => {
    page(`<main><article id="f"><span>a post</span></article>
      <article id="g" data-fw-blocked="ai-content" style="visibility: hidden;"><span>b</span></article></main>`);
    expect(describeBlankPosts(document, (el) => el.id !== 'g')).toEqual([]);
  });
});
