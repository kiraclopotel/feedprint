// @vitest-environment jsdom
//
// A small floating card is not feed content, whatever role it carries (11 Oct 2026, the owner's report).
//
// The card that opens when the pointer rests on an account name on Facebook is a small box laid over the page with a
// row of buttons in it (a userscript that works on it describes it as a dialog or tooltip layer 230 to 520 pixels
// wide and 100 to 480 high holding "Send Message" and "See Options"). The action-bar scan takes a row of buttons for
// an engagement bar on two weak signals, and it scans every dialog on purpose, because a post opened in a dialog has
// a bar worth hiding. The door already refuses menus, tooltips and the block/unfollow controls by name. This is the
// third refusal, by what the layer is: a dialog that is small and holds no post. Size is read from the box on screen;
// a box with no size (not laid out yet) is not judged, which leaves the answer as it was.
//
// A stamp that marks Facebook comments for the comment-block sheet used to be set straight on the element. It now asks
// the door like every other stamp.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/storage/settings', () => ({
  incrementMetricsHidden: vi.fn(() => Promise.resolve()),
}));

import { hideElement } from '../../../../src/content/engagement/mark-hidden';
import { markCommentArticles } from '../../../../src/content/engagement/facebook-engagement';

const opts = () => ({ marker: 'data-fw-test', value: 'true', reason: 'hide-action-buttons:structural-bar' });

function sized(el: Element, width: number, height: number): void {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
}

function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

const CARD = `
  <div id="card" role="dialog">
    <a href="/jane"><span>Jane Doe</span></a>
    <div id="row">
      <div id="send" role="button" tabindex="0" aria-label="Send Message"><span>Message</span></div>
      <div id="more" role="button" tabindex="0" aria-label="See Options"><span>...</span></div>
    </div>
  </div>`;

beforeEach(() => {
  document.body.replaceChildren();
});

describe('a small dialog with no post in it is left alone', () => {
  it('refuses the card, its row of buttons, and each button', () => {
    const host = mount(CARD);
    sized(host.querySelector('#card')!, 360, 220);
    for (const id of ['card', 'row', 'send', 'more']) {
      const el = host.querySelector<HTMLElement>(`#${id}`)!;
      expect(hideElement(el, opts()), id).toBe(false);
      expect(el.style.display, id).not.toBe('none');
    }
  });

  it('a big dialog (a photo viewer) is still open to a bar hide', () => {
    const host = mount(CARD);
    sized(host.querySelector('#card')!, 1280, 800);
    expect(hideElement(host.querySelector<HTMLElement>('#row')!, opts())).toBe(true);
  });

  it('a small dialog that holds a post is still open to a bar hide', () => {
    const host = mount(`<div id="card" role="dialog"><div role="article"><div id="row"><button aria-label="Like">Like</button><button aria-label="Share">Share</button></div></div></div>`);
    sized(host.querySelector('#card')!, 480, 400);
    expect(hideElement(host.querySelector<HTMLElement>('#row')!, opts())).toBe(true);
  });

  it('a dialog with no size yet (not laid out) is not judged: the answer is as it was', () => {
    const host = mount(CARD);
    expect(hideElement(host.querySelector<HTMLElement>('#row')!, opts())).toBe(true);
  });

  it('the edge: 520 wide and 480 high is still a card, one pixel more is not', () => {
    const host = mount(CARD);
    const card = host.querySelector('#card')!;
    sized(card, 520, 480);
    expect(hideElement(host.querySelector<HTMLElement>('#row')!, opts())).toBe(false);
    sized(card, 521, 480);
    expect(hideElement(host.querySelector<HTMLElement>('#row')!, opts())).toBe(true);
  });
});

describe('the Facebook comment stamp asks the door', () => {
  const COMMENT = '<div role="article" aria-label="Comment by Jane Doe 2 hours ago"><span>nice</span></div>';

  it('stamps a comment article on the page', () => {
    const host = mount(`<div id="feed">${COMMENT}</div>`);
    markCommentArticles(host);
    expect(host.querySelector('[role="article"]')!.getAttribute('data-fw-fb-comment')).toBe('1');
  });

  it('does not stamp one inside a tooltip or a menu', () => {
    const host = mount(`<div role="tooltip">${COMMENT}</div><div role="menu">${COMMENT}</div>`);
    markCommentArticles(host);
    for (const article of Array.from(host.querySelectorAll('[role="article"]'))) {
      expect(article.hasAttribute('data-fw-fb-comment')).toBe(false);
    }
  });
});
