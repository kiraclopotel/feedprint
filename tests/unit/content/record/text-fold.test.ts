// @vitest-environment jsdom
//
// What the page carried against what the screen showed, read from the DOM
// (docs/design/TEXT-CAPTURE-2026-09-05.md; research-log entry 5). Three
// answers: 'whole' (no fold control), 'folded' (a control and a whole string,
// the clamp is style), 'cut' (a control and a string that ends in an ellipsis,
// the rest never on the page). Never a press, never a layout read.

import { describe, expect, it } from 'vitest';
import {
  detectTextFold,
  endsCut,
  findFoldControl,
  isFoldControl,
  normalizeLabel,
  resolveTextElement,
  stampTextFold,
} from '../../../../src/content/record/text-fold';
import type { PostContent } from '../../../../src/types/post';

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body.firstElementChild as HTMLElement;
}

function post(el: HTMLElement | null, text: string, platform: PostContent['platform'] = 'facebook'): PostContent {
  return {
    id: 'p1', text, author: 'a', timestamp: '2026-09-05T00:00:00.000Z', platform,
    domRef: { deref: () => el ?? undefined } as unknown as WeakRef<HTMLElement>,
  } as PostContent;
}

describe('a fold control', () => {
  it('is a button-like element carrying a fold word, in the languages the users read', () => {
    for (const label of ['See more', 'Show more', 'Vezi mai mult', 'Ver más', 'Ver mais', 'Mostrar mais', 'Read more', '…more', '... See more']) {
      const el = mount(`<div role="button">${label}</div>`);
      expect(isFoldControl(el), label).toBe(true);
    }
  });

  it('is not a control with another job, even when the word is inside it', () => {
    for (const label of ['View all 12 comments', 'See more comments', 'Show less', 'Like', 'Reply', 'Follow', '']) {
      const el = mount(`<div role="button">${label}</div>`);
      expect(isFoldControl(el), label).toBe(false);
    }
  });

  it('reads an icon-only control by its aria-label', () => {
    const el = mount('<button aria-label="See more"><svg></svg></button>');
    expect(isFoldControl(el)).toBe(true);
  });

  it("is off when the page marks it hidden, as YouTube's #more is when the comment fits", () => {
    expect(isFoldControl(mount('<tp-yt-paper-button id="more" hidden="">Read more</tp-yt-paper-button>'))).toBe(false);
    expect(isFoldControl(mount('<tp-yt-paper-button id="more">Read more</tp-yt-paper-button>'))).toBe(true);
    expect(isFoldControl(mount('<div role="button" aria-hidden="true">See more</div>'))).toBe(false);
  });

  it("is X's show-more link by its test id whatever the label", () => {
    expect(isFoldControl(mount('<a role="link" data-testid="tweet-text-show-more-link" href="/u/status/1">Afișează</a>'))).toBe(true);
  });

  it('normalises a label the way the list carries it', () => {
    expect(normalizeLabel('… See more')).toBe('see more');
    expect(normalizeLabel('  Vezi mai mult...  ')).toBe('vezi mai mult');
    expect(normalizeLabel('MORE')).toBe('more');
  });
});

describe('the answer', () => {
  it("is 'whole' when the page carries no control for the item", () => {
    const el = mount('<div data-ad-rendering-role="story_message"><div dir="auto">A short post that fits.</div></div>');
    expect(detectTextFold(el, el.textContent!.trim())).toBe('whole');
  });

  it("is 'cut' on a Facebook post: the string ends in an ellipsis and the label is nested in the body", () => {
    const el = mount('<div data-ad-rendering-role="story_message"><div dir="auto">The opener of a long post that the page cut…</div><div role="button">See more</div></div>');
    const text = el.textContent!.trim();
    expect(text.endsWith('See more')).toBe(true);
    expect(detectTextFold(el, text)).toBe('cut');
  });

  it("is 'cut' in Romanian and with three dots", () => {
    const ro = mount('<div data-ad-rendering-role="story_message"><div dir="auto">Începutul unei postări lungi…</div><div role="button">Vezi mai mult</div></div>');
    expect(detectTextFold(ro, ro.textContent!.trim())).toBe('cut');
    const dots = mount('<div data-ad-rendering-role="story_message"><div dir="auto">Three dots instead...</div><div role="button">See more</div></div>');
    expect(detectTextFold(dots, dots.textContent!.trim())).toBe('cut');
  });

  it("is 'cut' on an Instagram caption whose control is a sibling", () => {
    mount('<article><div><span dir="auto">A caption the page shortened…</span><div role="button">more</div></div><ul><li>a comment</li></ul></article>');
    const span = document.querySelector('span[dir="auto"]')!;
    expect(detectTextFold(span, span.textContent!.trim())).toBe('cut');
  });

  it("is 'folded' on a YouTube comment: the whole string is in the DOM and #more is visible two levels up", () => {
    mount('<ytd-comment-view-model><div id="expander"><div id="content"><span id="content-text">The whole comment, every word of it, clamped by style and unfolded by a button.</span></div><tp-yt-paper-button id="more">Read more</tp-yt-paper-button></div></ytd-comment-view-model>');
    const span = document.querySelector('[id="content-text"]')!;
    expect(detectTextFold(span, span.textContent!.trim())).toBe('folded');
  });

  it("is 'whole' on a YouTube comment whose #more the page marked hidden", () => {
    mount('<ytd-comment-view-model><div id="expander"><div id="content"><span id="content-text">Fits.</span></div><tp-yt-paper-button id="more" hidden="">Read more</tp-yt-paper-button></div></ytd-comment-view-model>');
    const span = document.querySelector('[id="content-text"]')!;
    expect(detectTextFold(span, span.textContent!.trim())).toBe('whole');
  });

  it("does not let a comment's control fold its post, nor the post's control fold a comment", () => {
    mount('<div aria-posinset="1"><div data-ad-rendering-role="story_message"><div dir="auto">The post, whole.</div></div><ul><li><div dir="auto">A comment the page cut…<div role="button">See more</div></div></li></ul></div>');
    const body = document.querySelector('[data-ad-rendering-role="story_message"]')!;
    const comment = document.querySelector('li > div[dir="auto"]')!;
    expect(detectTextFold(body, body.textContent!.trim())).toBe('whole');
    expect(detectTextFold(comment, comment.textContent!.trim())).toBe('cut');
  });

  it("does not let a quoted tweet's show-more fold the tweet that quotes it", () => {
    mount('<article><div data-testid="tweetText">The outer tweet, whole.</div><div role="link"><div data-testid="tweetText">The quoted one, cut…<a role="link" data-testid="tweet-text-show-more-link" href="/q/status/2">Show more</a></div></div></article>');
    const [outer, quoted] = Array.from(document.querySelectorAll('[data-testid="tweetText"]'));
    expect(detectTextFold(outer, outer.textContent!.trim())).toBe('whole');
    expect(detectTextFold(quoted, quoted.textContent!.trim())).toBe('cut');
  });

  it('stops climbing at the item\'s own box and never reaches a neighbour', () => {
    mount('<main><article><div><span dir="auto">First item, whole.</span></div></article><article><div><span dir="auto">Second, cut…</span><div role="button">more</div></div></article></main>');
    const [first, second] = Array.from(document.querySelectorAll('span[dir="auto"]'));
    expect(detectTextFold(first, first.textContent!.trim())).toBe('whole');
    expect(detectTextFold(second, second.textContent!.trim())).toBe('cut');
    expect(findFoldControl(first)).toBeNull();
  });

  it('reads the trailing ellipsis with the nested label stripped, and only there', () => {
    const control = mount('<div role="button">See more</div>');
    expect(endsCut('A post the page cut… See more', control)).toBe(true);
    expect(endsCut('A post the page cut…See more', control)).toBe(true);
    expect(endsCut('A whole post that ends in a sentence. See more', control)).toBe(false);
    expect(endsCut('An ellipsis in the middle… and then more words', control)).toBe(false);
  });
});

describe('the stamp at onPostDetected', () => {
  it("stamps 'cut' on a Facebook post from the adapter's own element", () => {
    const el = mount('<div data-ad-rendering-role="story_message"><div dir="auto">Cut…</div><div role="button">See more</div></div>');
    const p = post(el, el.textContent!.trim());
    stampTextFold(p);
    expect(p.textCapture).toBe('cut');
  });

  it("finds the text body inside a container the adapter handed over, through the platform's text scopes", () => {
    const thread = mount('<ytd-comment-thread-renderer><ytd-comment-view-model><div id="expander"><div id="content"><span id="content-text">The top comment, whole in the DOM.</span></div><tp-yt-paper-button id="more">Read more</tp-yt-paper-button></div></ytd-comment-view-model><ytd-comment-replies-renderer><ytd-comment-view-model><div id="expander"><div id="content"><span id="content-text">A reply.</span></div><tp-yt-paper-button id="more" hidden="">Read more</tp-yt-paper-button></div></ytd-comment-view-model></ytd-comment-replies-renderer></ytd-comment-thread-renderer>');
    const text = 'The top comment, whole in the DOM.';
    expect(resolveTextElement(thread, text, 'youtube').id).toBe('content-text');
    const p = post(thread, text, 'youtube');
    stampTextFold(p);
    expect(p.textCapture).toBe('folded');
  });

  it("stamps 'whole' when the page holds nothing to unfold", () => {
    const el = mount('<div data-testid="tweetText">A tweet that fits.</div>');
    const p = post(el, 'A tweet that fits.', 'twitter');
    stampTextFold(p);
    expect(p.textCapture).toBe('whole');
  });

  it('leaves the field absent when the element is gone: absent is "not checked", never "whole"', () => {
    const p = post(null, 'Text of an item whose node was collected.');
    stampTextFold(p);
    expect(p.textCapture).toBeUndefined();
  });
});
