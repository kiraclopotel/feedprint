// @vitest-environment jsdom
//
// F47 site B (the hold): after a hide of a card that is NOT on screen, holdWatchedItem scrolls the watched card back to the top
// it had in the snapshot whenever its top moved. A person who is scrolling moves the watched card too (the feed is snapping to
// the next card), so a hide that landed in that moment read the person's own scroll as the collapse's shift and scrolled the
// feed BACK: the jump-back the owner saw on TikTok. The live run could not reproduce it (team/VERIFY.md 1 Oct 04:02, fact c: no
// hide happened on a guest feed), so this unit test is the proof. Now the hold does nothing while the person is scrolling
// (a wheel, a touch move or a navigation key within the last 800 ms), and still puts the card back when nobody is. The
// existing hold check (video-feed-hide.test.ts, 'when the hidden card above moved the one on screen, it is put back, once')
// is not edited: it is the no-scroll control here too.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { injectHardHide, injectAdHide } from '../../../../src/content/injector';
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

function feedList(): HTMLElement {
  const list = document.createElement('div');
  document.body.appendChild(list);
  return list;
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
  const list = feedList();
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
  // Each test starts well after the last one's scroll input, so nothing carries over from it.
  testClock += 60_000;
  vi.setSystemTime(testClock);
});
afterEach(() => {
  vi.useRealTimers();
  _setHostForTesting(null);
});

describe('F47 site B: the hold does nothing while the person is scrolling', () => {
  it('control: nobody is scrolling, the watched card is put back, once', () => {
    const { past, back } = feedWhereTheHideMovesTheWatchedCard();
    injectHardHide(past.desc, 'tiktok');
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('a wheel just before the hide: the feed is not scrolled back', () => {
    const { past, back } = feedWhereTheHideMovesTheWatchedCard();
    document.body.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 120 }));
    injectHardHide(past.desc, 'tiktok');
    expect(past.item.style.getPropertyValue('display'), 'the hide still landed').toBe('none');
    expect(back, 'the feed is not scrolled back while the person scrolls').not.toHaveBeenCalled();
  });

  it('a touch move just before the hide: the feed is not scrolled back', () => {
    const { past, back } = feedWhereTheHideMovesTheWatchedCard();
    document.body.dispatchEvent(new Event('touchmove', { bubbles: true }));
    injectHardHide(past.desc, 'tiktok');
    expect(back).not.toHaveBeenCalled();
  });

  it('a navigation key just before the hide: the feed is not scrolled back', () => {
    const { past, back } = feedWhereTheHideMovesTheWatchedCard();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
    injectHardHide(past.desc, 'tiktok');
    expect(back).not.toHaveBeenCalled();
  });

  it('a key that does not scroll does not count: the card is put back', () => {
    const { past, back } = feedWhereTheHideMovesTheWatchedCard();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
    injectHardHide(past.desc, 'tiktok');
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('once the person has stopped for a second the hold works again', () => {
    const { past, back } = feedWhereTheHideMovesTheWatchedCard();
    document.body.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 120 }));
    vi.advanceTimersByTime(1000);
    injectHardHide(past.desc, 'tiktok');
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('the ad hide path holds the same way: put back when nobody scrolls, left alone when someone does', () => {
    const quiet = feedWhereTheHideMovesTheWatchedCard();
    injectAdHide(quiet.past.desc, 'tiktok');
    expect(quiet.back, 'nobody scrolling: put back').toHaveBeenCalledTimes(1);

    document.body.innerHTML = '';
    const busy = feedWhereTheHideMovesTheWatchedCard();
    document.body.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 120 }));
    injectAdHide(busy.past.desc, 'tiktok');
    expect(busy.back, 'someone scrolling: left alone').not.toHaveBeenCalled();
  });
});
