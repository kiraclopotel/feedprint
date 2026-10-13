// @vitest-environment jsdom
//
// F47 site D (the critic's close of site C, F47C-CRITIC.md item 2, and the drag note of F47B2-CRITIC.md item 1).
//
// 1. The forward move after a hide of the card on screen did not read the 800 ms scroll stamp, so a card hidden while the person
//    was scrolling moved the feed during their own scroll. It now waits: while the person's input is recent the move is held, and
//    once they have been quiet it runs only if they are still on nothing, or on the hidden card (a blank screen). If they have
//    scrolled on to another card the move does nothing, and a person who keeps scrolling for several seconds is left alone. It is
//    held, not dropped, because a scroll that lands on a card the filter then hides is the common case: skipping the move there
//    would leave the person on a black screen.
// 2. A scrollbar drag held longer than 800 ms was covered only at its start. A pointer move with a button held now stamps too.
//
// Site B, B2 and C's test files are not edited; their cases are the controls here.

// Since 13 Oct 2026 a TikTok card is hidden with its box kept (video-feed-hide.ts keepsItemBox), so a test of the move or the
// hold that needs a card to lose its box makes the collapse itself (tests/helpers/collapse-a-card.ts): the timing belongs to
// any hide that moves the feed, whichever card takes it.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { injectHardHide, injectAdHide } from '../../../../src/content/injector';
import { collapseCard } from '../../../helpers/collapse-a-card';
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

/** A card whose box goes away when it is hidden with display:none, as a real one does. */
function placeCollapsing(el: HTMLElement, top: number | (() => number)): void {
  const h = window.innerHeight;
  el.getBoundingClientRect = () => {
    const t = typeof top === 'function' ? top() : top;
    const collapsed = el.style.getPropertyValue('display') === 'none';
    const height = collapsed ? 0 : h;
    return { top: t, bottom: t + height, height, left: 0, right: 0, width: 0, x: 0, y: t, toJSON: () => ({}) } as DOMRect;
  };
}

/** The card on screen, the card the person would be moved to below it. `moved` puts the next card on screen. */
function feedWithTheCardOnScreen(): { a: TikTokItem; next: HTMLElement; advanced: ReturnType<typeof vi.fn>; moveOn: () => void } {
  const list = document.createElement('div');
  document.body.appendChild(list);
  const a = tiktokItem(list, 'the card on screen');
  const b = tiktokItem(list, 'the next card');
  let moved = false;
  placeCollapsing(a.item, () => (moved ? -window.innerHeight : 0));
  placeAt(b.item, () => (moved ? 0 : window.innerHeight));
  return { a, next: b.item, advanced: scrollSpy(b.item), moveOn: () => { moved = true; } };
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

const wheel = (): void => { document.body.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 120 })); };
const press = (): void => { document.documentElement.dispatchEvent(new Event('pointerdown', { bubbles: true })); };

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
  vi.clearAllTimers();
  vi.useRealTimers();
  _setHostForTesting(null);
});

describe('F47 site D: the advance waits while the person is scrolling', () => {
  it('control: nobody is scrolling, the card on screen is left at once, once', () => {
    const { a, advanced } = feedWithTheCardOnScreen();
    injectHardHide(a.desc, 'tiktok');
    expect(advanced).toHaveBeenCalledTimes(1);
  });

  it('a wheel just before the hide: the feed is not moved during the scroll', () => {
    const { a, advanced } = feedWithTheCardOnScreen();
    wheel();
    injectHardHide(a.desc, 'tiktok');
    expect(a.item.style.getPropertyValue('visibility'), 'the hide still landed, the box kept').toBe('hidden');
    expect(advanced, 'no move while the person scrolls').not.toHaveBeenCalled();
  });

  it('a press just before the hide: the feed is not moved yet', () => {
    const { a, advanced } = feedWithTheCardOnScreen();
    press();
    injectHardHide(a.desc, 'tiktok');
    expect(advanced).not.toHaveBeenCalled();
  });

  it('the ad hide path waits the same way, and moves on once, when the person is quiet', () => {
    const { a, advanced } = feedWithTheCardOnScreen();
    wheel();
    injectAdHide(a.desc, 'tiktok');
    expect(advanced).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1500);
    expect(advanced).toHaveBeenCalledTimes(1);
  });

  it('held, not dropped: once the person has been quiet and is still on the blank card, the feed moves on, once', () => {
    const { a, advanced } = feedWithTheCardOnScreen();
    wheel();
    injectHardHide(a.desc, 'tiktok');
    expect(advanced).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1500);
    expect(advanced, 'moved on after the scroll ended, so no black screen is left').toHaveBeenCalledTimes(1);
  });

  it('if the person scrolled on to another card meanwhile, nothing moves at all', () => {
    const { a, advanced, moveOn } = feedWithTheCardOnScreen();
    wheel();
    injectHardHide(a.desc, 'tiktok');
    moveOn();
    vi.advanceTimersByTime(1500);
    expect(advanced).not.toHaveBeenCalled();
  });

  it('a person who keeps scrolling for seconds is left alone: it gives up and moves nothing', () => {
    const { a, advanced } = feedWithTheCardOnScreen();
    wheel();
    injectHardHide(a.desc, 'tiktok');
    for (let i = 0; i < 24; i++) {
      vi.advanceTimersByTime(500);
      wheel();
    }
    vi.advanceTimersByTime(5000);
    expect(advanced).not.toHaveBeenCalled();
  });
});

describe('F47 site D: a scrollbar drag held past 800 ms still counts as scrolling', () => {
  it('control: a pointer move with no button held, long after the press, does not count: the card is put back', () => {
    const { past, back } = feedWhereTheHideMovesTheWatchedCard();
    press();
    vi.advanceTimersByTime(1000);
    document.documentElement.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, buttons: 0 }));
    collapseCard(past.item);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('a pointer move with a button held, a second after the press: the feed is not scrolled back', () => {
    const { past, back } = feedWhereTheHideMovesTheWatchedCard();
    press();
    vi.advanceTimersByTime(1000);
    document.documentElement.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, buttons: 1 }));
    collapseCard(past.item);
    expect(back, 'the drag is still going').not.toHaveBeenCalled();
  });
});
