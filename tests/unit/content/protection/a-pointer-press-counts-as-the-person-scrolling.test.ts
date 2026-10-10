// @vitest-environment jsdom
//
// F47 site B2 (the critic's close of site B, board/units/F47B-CRITIC.md item 1): the hold does nothing while the person is
// scrolling, and site B counted a wheel, a touch move and a navigation key as scrolling. Two ways to scroll TikTok left no stamp:
// dragging the scrollbar and pressing TikTok's own up and down buttons. Both begin with a pointer press, so a press now counts as
// the person scrolling too (the same 800 ms), and a hide that lands just after it does not scroll the feed back against them.
// Site B's test file is not edited; this one carries the new inputs and the two controls.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { injectHardHide } from '../../../../src/content/injector';
import {
  _resetAdvanceBreakerForTesting,
  _setHostForTesting,
} from '../../../../src/content/protection/video-feed-hide';

interface TikTokItem { item: HTMLElement; desc: HTMLElement }

/** One TikTok feed card: container > (caption, video, comment icon). */
function tiktokItem(list: HTMLElement, caption: string): TikTokItem {
  const item = document.createElement('div');
  item.setAttribute('data-e2e', 'recommend-list-item-container');
  const desc = document.createElement('div');
  desc.setAttribute('data-e2e', 'video-desc');
  desc.textContent = caption;
  const video = document.createElement('video');
  const commentIcon = document.createElement('button');
  commentIcon.setAttribute('data-e2e', 'comment-icon');
  item.append(desc, video, commentIcon);
  list.appendChild(item);
  return { item, desc };
}

function scrollSpy(el: HTMLElement): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  (el as unknown as { scrollIntoView: unknown }).scrollIntoView = fn;
  return fn;
}

/** jsdom lays nothing out: give `el` a full-window box whose top is `top` (a function reads it afresh). */
function placeAt(el: HTMLElement, top: number | (() => number)): void {
  const h = window.innerHeight;
  el.getBoundingClientRect = () => {
    const t = typeof top === 'function' ? top() : top;
    return { top: t, bottom: t + h, height: h, left: 0, right: 0, width: 0, x: 0, y: t, toJSON: () => ({}) } as DOMRect;
  };
}

/** A feed that does not hold its place: the collapse of the card above pulls the watched card up a screen. */
function feedWhereTheHideMovesTheWatchedCard(): { past: TikTokItem; back: ReturnType<typeof vi.fn> } {
  const list = document.createElement('div');
  document.body.appendChild(list);
  const past = tiktokItem(list, 'marked late');
  const watching = tiktokItem(list, 'the one on screen');
  placeAt(past.item, -window.innerHeight);
  placeAt(watching.item, () => (past.item.style.getPropertyValue('display') === 'none' ? -window.innerHeight : 0));
  return { past, back: scrollSpy(watching.item) };
}

let testClock = Date.now();

beforeEach(() => {
  document.body.innerHTML = '';
  _resetAdvanceBreakerForTesting();
  vi.useFakeTimers();
  // Each test starts well after the last one's input, so nothing carries over from it.
  testClock += 60_000;
  vi.setSystemTime(testClock);
});
afterEach(() => {
  vi.useRealTimers();
  _setHostForTesting(null);
});

describe('F47 site B2: a pointer press counts as the person scrolling', () => {
  it('control: no input at all, the watched card is put back, once', () => {
    const { past, back } = feedWhereTheHideMovesTheWatchedCard();
    injectHardHide(past.desc, 'tiktok');
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('a press on the scrollbar just before the hide: the feed is not scrolled back', () => {
    const { past, back } = feedWhereTheHideMovesTheWatchedCard();
    document.documentElement.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    injectHardHide(past.desc, 'tiktok');
    expect(past.item.style.getPropertyValue('display'), 'the hide still landed').toBe('none');
    expect(back, 'the feed is not scrolled back after a press').not.toHaveBeenCalled();
  });

  it("a press on TikTok's own next button just before the hide: the feed is not scrolled back", () => {
    const { past, back } = feedWhereTheHideMovesTheWatchedCard();
    const nextButton = document.createElement('button');
    document.body.appendChild(nextButton);
    nextButton.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    injectHardHide(past.desc, 'tiktok');
    expect(back).not.toHaveBeenCalled();
  });

  it('once a second has passed since the press the hold works again', () => {
    const { past, back } = feedWhereTheHideMovesTheWatchedCard();
    document.documentElement.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    vi.advanceTimersByTime(1000);
    injectHardHide(past.desc, 'tiktok');
    expect(back).toHaveBeenCalledTimes(1);
  });
});
