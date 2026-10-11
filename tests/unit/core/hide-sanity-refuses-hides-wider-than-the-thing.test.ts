// @vitest-environment jsdom
//
// A hide that is far wider than the thing it was meant for is refused (11 Oct 2026, the owner's report and the audit
// of our own finders).
//
// Every finder in Off is a guess about a page: a selector, a word, a climb to a parent. The door already refuses menus
// and the controls for blocking and reporting by what they are. This is the second kind of refusal, by how much a hide
// would take: an action bar, a count or an emoji is a small thing inside a post and never holds a page landmark, a
// text box or a post; an ad or a filtered post is one unit and never holds the feed, a landmark or several posts. When
// a climb goes one level too far on a redesigned page, the answer is a stray button left on screen, not a missing page.
// Only the features that hide small things or single units are judged; a switch that hides a whole surface on purpose
// (Reels, Shorts, Marketplace) is not.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hideSanityProblem } from '../../../src/core/hide-sanity';

function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

function sized(el: Element, width: number, height: number): void {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
}

const ONE_POST = (inner = '') => `<div role="article"><p>Hello</p><div id="bar"><button>Like</button><button>Share</button></div>${inner}</div>`;

beforeEach(() => {
  document.body.replaceChildren();
  Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('a small thing (action buttons, counts, emoji) is judged', () => {
  for (const feature of ['hide-action-buttons', 'hide-engagement-metrics', 'strip-emojis']) {
    describe(feature, () => {
      it('the bar inside a post is fine', () => {
        const host = mount(ONE_POST());
        expect(hideSanityProblem(host.querySelector<HTMLElement>('#bar')!, feature)).toBeNull();
      });

      it('a wrapper that has climbed to a page landmark is too wide', () => {
        for (const landmark of ['<main>', '<div role="main">', '<nav>', '<div role="navigation">', '<div role="banner">', '<div role="feed">']) {
          document.body.replaceChildren();
          const close = landmark.startsWith('<main') ? '</main>' : landmark.startsWith('<nav') ? '</nav>' : '</div>';
          const host = mount(`<div id="wrap">${landmark}${ONE_POST()}${close}</div>`);
          expect(hideSanityProblem(host.querySelector<HTMLElement>('#wrap')!, feature), landmark).toBe('landmark');
        }
      });

      it('a wrapper that is itself a landmark is too wide', () => {
        const host = mount(`<main id="m">${ONE_POST()}</main>`);
        expect(hideSanityProblem(host.querySelector<HTMLElement>('#m')!, feature)).toBe('landmark');
      });

      it('a wrapper that has picked up a text box is too wide', () => {
        for (const box of ['<textarea></textarea>', '<input type="text">', '<div contenteditable="true"></div>', '<div role="textbox"></div>', '<input type="search">']) {
          document.body.replaceChildren();
          const host = mount(`<div id="wrap"><div id="bar"><button>Like</button></div>${box}</div>`);
          expect(hideSanityProblem(host.querySelector<HTMLElement>('#wrap')!, feature), box).toBe('text-input');
        }
      });

      it('a hidden input does not count as a text box', () => {
        const host = mount('<div id="wrap"><button>Like</button><input type="hidden" name="x"></div>');
        expect(hideSanityProblem(host.querySelector<HTMLElement>('#wrap')!, feature)).toBeNull();
      });

      it('a wrapper that is a post, or holds one, is too wide', () => {
        const host = mount(`<div id="wrap">${ONE_POST()}</div><div id="post" role="article"><p>x</p></div><div id="art"><article><p>y</p></article></div>`);
        expect(hideSanityProblem(host.querySelector<HTMLElement>('#wrap')!, feature)).toBe('post-sized');
        expect(hideSanityProblem(host.querySelector<HTMLElement>('#post')!, feature)).toBe('post-sized');
        expect(hideSanityProblem(host.querySelector<HTMLElement>('#art')!, feature)).toBe('post-sized');
      });

      it('a box that fills the window is too wide', () => {
        const host = mount('<div id="wrap"><button>Like</button></div>');
        const wrap = host.querySelector<HTMLElement>('#wrap')!;
        sized(wrap, 900, 700);
        expect(hideSanityProblem(wrap, feature)).toBe('whole-page');
        sized(wrap, 900, 300);
        expect(hideSanityProblem(wrap, feature)).toBeNull();
      });

      it('a box with no size yet is not judged on size', () => {
        const host = mount('<div id="wrap"><button>Like</button></div>');
        expect(hideSanityProblem(host.querySelector<HTMLElement>('#wrap')!, feature)).toBeNull();
      });
    });
  }
});

describe('one unit (an ad, a filtered post) is judged', () => {
  for (const feature of ['block-ads', 'word-filter']) {
    describe(feature, () => {
      it('a single post, with its comments inside it, is fine', () => {
        const host = mount(`<div id="post" role="article"><p>ad</p><div role="article"><p>comment</p></div><div role="article"><p>comment</p></div></div>`);
        expect(hideSanityProblem(host.querySelector<HTMLElement>('#post')!, feature)).toBeNull();
      });

      it('a wrapper around one post is fine', () => {
        const host = mount(`<div id="wrap">${ONE_POST()}</div>`);
        expect(hideSanityProblem(host.querySelector<HTMLElement>('#wrap')!, feature)).toBeNull();
      });

      it('a wrapper around several posts is the feed, not an ad', () => {
        const host = mount(`<div id="wrap">${ONE_POST()}${ONE_POST()}${ONE_POST()}</div>`);
        expect(hideSanityProblem(host.querySelector<HTMLElement>('#wrap')!, feature)).toBe('many-posts');
      });

      it('several units found by their own marks count too', () => {
        const host = mount('<div id="wrap"><div aria-posinset="1"><p>a</p></div><div aria-posinset="2"><p>b</p></div></div>');
        expect(hideSanityProblem(host.querySelector<HTMLElement>('#wrap')!, feature)).toBe('many-posts');
        document.body.replaceChildren();
        const tweets = mount('<div id="wrap"><div data-testid="tweet"><p>a</p></div><div data-testid="tweet"><p>b</p></div></div>');
        expect(hideSanityProblem(tweets.querySelector<HTMLElement>('#wrap')!, feature)).toBe('many-posts');
      });

      it('a wrapper that holds a page landmark is too wide', () => {
        const host = mount(`<div id="wrap"><div role="feed">${ONE_POST()}</div></div>`);
        expect(hideSanityProblem(host.querySelector<HTMLElement>('#wrap')!, feature)).toBe('landmark');
      });

      it('a post with a comment box in it is fine: a text box is not a fault here', () => {
        const host = mount('<div id="post" role="article"><p>x</p><div role="textbox" contenteditable="true"></div></div>');
        expect(hideSanityProblem(host.querySelector<HTMLElement>('#post')!, feature)).toBeNull();
      });

      it('a unit as big as the window is fine: a video feed item is one screen', () => {
        const host = mount('<div id="item" role="article"><video></video></div>');
        const item = host.querySelector<HTMLElement>('#item')!;
        sized(item, 1000, 800);
        expect(hideSanityProblem(item, feature)).toBeNull();
      });
    });
  }
});

describe('a unit hidden under a small-thing switch', () => {
  it('an empty comment is judged as a unit: one comment is fine, the feed is not', () => {
    const host = mount('<div id="one" role="article"><p></p></div><div id="many"><div role="article">a</div><div role="article">b</div></div>');
    expect(hideSanityProblem(host.querySelector<HTMLElement>('#one')!, 'strip-emojis', 'strip-emojis:empty-comment')).toBeNull();
    expect(hideSanityProblem(host.querySelector<HTMLElement>('#many')!, 'strip-emojis', 'strip-emojis:empty-comment')).toBe('many-posts');
    expect(hideSanityProblem(host.querySelector<HTMLElement>('#one')!, 'strip-emojis', 'strip-emojis:emoji-img')).toBe('post-sized');
  });
});

describe('what is not judged', () => {
  it('a switch that hides a whole surface on purpose', () => {
    const host = mount(`<main id="m">${ONE_POST()}${ONE_POST()}</main>`);
    const m = host.querySelector<HTMLElement>('#m')!;
    sized(m, 1000, 800);
    for (const feature of ['block-reels', 'block-shorts', 'hide-marketplace', 'block-comment-posting', 'block-ai-content', 'anything-else']) {
      expect(hideSanityProblem(m, feature), feature).toBeNull();
    }
  });
});
