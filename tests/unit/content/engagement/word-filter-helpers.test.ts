// @vitest-environment jsdom
//
// The word filter's three DOM helpers and the ad-label element reader, each
// exported and used on the hide path but named by no test until 2026-09-06:
// readAuthor (the handle behind a post, per platform), hideTargetFor (which
// box collapses), tiktokCommentItem (a comment from any of its three parts),
// isAdLabelElement (every channel a label can be drawn through).

import { beforeEach, describe, expect, it } from 'vitest';
import { hideTargetFor, readAuthor, tiktokCommentItem } from '../../../../src/content/engagement/word-filter';
import { isAdLabelElement } from '../../../../src/content/engagement/ad-labels';

function html(markup: string): HTMLElement {
  const holder = document.createElement('div');
  holder.innerHTML = markup;
  document.body.appendChild(holder);
  return holder;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('readAuthor', () => {
  it('X: the handle is the last path segment of the User-Name link, @ stripped', () => {
    const post = html('<div data-testid="User-Name"><a href="/@synth_handle/">@synth_handle</a></div>');
    expect(readAuthor(post, 'twitter')).toBe('synth_handle');
  });

  it('TikTok: the browse-username text when the element carries no href', () => {
    const post = html('<span data-e2e="browse-username">@synth.creator</span>');
    expect(readAuthor(post, 'tiktok')).toBe('synth.creator');
  });

  it('Facebook: a dotted last segment (a file-like path) falls back to the visible name', () => {
    const post = html('<h3><a role="link" href="/profile.php?id=100000000000001">Synth Person</a></h3>');
    expect(readAuthor(post, 'facebook')).toBe('Synth Person');
  });

  it('YouTube: the channel handle from the channel-name link', () => {
    const post = html('<ytd-channel-name><a href="/@SynthChannel">Synth Channel</a></ytd-channel-name>');
    expect(readAuthor(post, 'youtube')).toBe('SynthChannel');
  });

  it('is undefined when the platform shape has no author element', () => {
    const post = html('<div><span>no author here</span></div>');
    expect(readAuthor(post, 'instagram')).toBeUndefined();
  });
});

describe('tiktokCommentItem', () => {
  it('finds the box holding text, name and picture from any of the three parts', () => {
    const holder = html(`
      <div id="item">
        <div id="avatar-box"><a data-e2e="comment-avatar-3"><img alt=""></a></div>
        <div id="body">
          <a data-e2e="comment-username-3">synth_viewer</a>
          <p data-e2e="comment-level-3">a comment</p>
        </div>
      </div>`);
    const item = holder.querySelector('#item')!;
    expect(tiktokCommentItem(holder.querySelector('[data-e2e="comment-level-3"]')!)).toBe(item);
    expect(tiktokCommentItem(holder.querySelector('[data-e2e="comment-username-3"]')!)).toBe(item);
    expect(tiktokCommentItem(holder.querySelector('[data-e2e="comment-avatar-3"] img')!)).toBe(item);
  });

  it('settles for the box with name and text when the comment has no picture', () => {
    const holder = html(`
      <div id="outer">
        <div id="body">
          <a data-e2e="comment-username-4">synth_viewer</a>
          <p data-e2e="comment-level-4">a comment</p>
        </div>
      </div>`);
    expect(tiktokCommentItem(holder.querySelector('[data-e2e="comment-level-4"]')!)).toBe(holder.querySelector('#body'));
  });

  it('does not cross into a neighbouring comment with another index', () => {
    const holder = html(`
      <div id="list">
        <div id="c5"><a data-e2e="comment-username-5">a</a><p data-e2e="comment-level-5">x</p></div>
        <div id="c6"><a data-e2e="comment-username-6">b</a><p data-e2e="comment-level-6">y</p><span data-e2e="comment-avatar-6"></span></div>
      </div>`);
    expect(tiktokCommentItem(holder.querySelector('[data-e2e="comment-level-5"]')!)).toBe(holder.querySelector('#c5'));
    expect(tiktokCommentItem(holder.querySelector('[data-e2e="comment-level-6"]')!)).toBe(holder.querySelector('#c6'));
  });

  it('is null outside a comment', () => {
    const holder = html('<div><p data-e2e="browse-video-desc">caption</p></div>');
    expect(tiktokCommentItem(holder.querySelector('p')!)).toBeNull();
  });
});

describe('hideTargetFor', () => {
  it('X: the timeline cell, so no empty stripe is left', () => {
    const holder = html('<div data-testid="cellInnerDiv"><article id="a">post</article></div>');
    const article = holder.querySelector<HTMLElement>('#a')!;
    expect(hideTargetFor(article, 'twitter')).toBe(holder.querySelector('[data-testid="cellInnerDiv"]'));
  });

  it('X: the element itself when it is not inside a cell', () => {
    const holder = html('<article id="a">post</article>');
    const article = holder.querySelector<HTMLElement>('#a')!;
    expect(hideTargetFor(article, 'twitter')).toBe(article);
  });

  it('TikTok: the whole comment from its text paragraph, the element itself when it is not a comment', () => {
    const holder = html(`
      <div id="item"><a data-e2e="comment-username-1">n</a><p data-e2e="comment-level-1" id="p">t</p><span data-e2e="comment-avatar-1"></span></div>
      <div id="video">caption</div>`);
    expect(hideTargetFor(holder.querySelector<HTMLElement>('#p')!, 'tiktok')).toBe(holder.querySelector('#item'));
    expect(hideTargetFor(holder.querySelector<HTMLElement>('#video')!, 'tiktok')).toBe(holder.querySelector('#video'));
  });

  it('other platforms: the element itself', () => {
    const holder = html('<div><article id="a">post</article></div>');
    const article = holder.querySelector<HTMLElement>('#a')!;
    for (const platform of ['facebook', 'instagram', 'youtube'] as const) {
      expect(hideTargetFor(article, platform)).toBe(article);
    }
  });
});

describe('isAdLabelElement', () => {
  it('reads a leaf text, an aria-label, a title and an alt', () => {
    const holder = html(`
      <span id="leaf">Sponsored</span>
      <div id="aria" aria-label="Sponsored"><span>x</span></div>
      <a id="title" title="Ad">link</a>
      <img id="alt" alt="Sponsored">
      <span id="plain">Hello there</span>
      <div id="parent"><span>Sponsored</span></div>`);
    expect(isAdLabelElement(holder.querySelector('#leaf')!)).toBe(true);
    expect(isAdLabelElement(holder.querySelector('#aria')!)).toBe(true);
    expect(isAdLabelElement(holder.querySelector('#title')!)).toBe(true);
    expect(isAdLabelElement(holder.querySelector('#alt')!)).toBe(true);
    expect(isAdLabelElement(holder.querySelector('#plain')!)).toBe(false);
    // A parent's concatenated text is not a label: only a leaf's own text counts.
    expect(isAdLabelElement(holder.querySelector('#parent')!)).toBe(false);
  });

  it('reads the word an SVG <use> stands for, through the chain, same document only', () => {
    const holder = html(`
      <svg id="chain-b"><text id="word">Ad</text></svg>
      <svg id="chain-a"><use href="#word"></use></svg>
      <span id="post"><svg><use id="use" href="#chain-a"></use></svg></span>
      <svg><use id="broken" href="#nowhere"></use></svg>`);
    expect(isAdLabelElement(holder.querySelector('#use')!)).toBe(true);
    expect(isAdLabelElement(holder.querySelector('#broken')!)).toBe(false);
  });

  it('ignores long strings even when they carry the word', () => {
    const holder = html('<span id="long">Sponsored content is what this long sentence is about today</span>');
    expect(isAdLabelElement(holder.querySelector('#long')!)).toBe(false);
  });
});
