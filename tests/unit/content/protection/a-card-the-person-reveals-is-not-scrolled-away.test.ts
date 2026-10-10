// @vitest-environment jsdom
//
// F47 site D, the critic's HOLD (board/units/F47D-CRITIC.md item 2, and item 3 for the AI filter's own case). Site D holds the move
// to the next card while the person is scrolling and runs it once they have been quiet. A card the person reveals ("Show anyway")
// in that wait is still marked hidden by us (the reveal sets data-fw-user-revealed and leaves the hide's own marker), so the held
// move went on to scroll the feed off the card they had just chosen to see. The held move now stands down for a revealed card.
// This file adopts the critic's probe cases (run/critic/f47d/critic-f47d-probe.test.ts): the reveal is the red case; the AI
// filter's own shape (visibility hidden, the box kept, the case the hold exists for) and the three ways the held move must do
// nothing (the filter lifts its block, the card leaves the page, the person keeps scrolling) are guards that pass before and after.
// The earlier test files are not edited.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { injectHardHide } from '../../../../src/content/injector';
import {
  _resetAdvanceBreakerForTesting,
  _setHostForTesting,
  afterFeedItemHidden,
  snapshotWatched,
  videoFeedItemOf,
} from '../../../../src/content/protection/video-feed-hide';

interface TikTokItem { item: HTMLElement; desc: HTMLElement }

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

/** A real collapse: hidden with display:none, the card has no box and the next card takes the screen. */
function feed(): { a: TikTokItem; advanced: ReturnType<typeof vi.fn> } {
  const list = document.createElement('div');
  document.body.appendChild(list);
  const a = tiktokItem(list, 'the card on screen');
  const b = tiktokItem(list, 'the next card');
  const h = window.innerHeight;
  const aGone = (): boolean => a.item.style.getPropertyValue('display') === 'none';
  a.item.getBoundingClientRect = () => {
    const height = aGone() ? 0 : h;
    return { top: 0, bottom: height, height, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  };
  b.item.getBoundingClientRect = () => {
    const t = aGone() ? 0 : h;
    return { top: t, bottom: t + h, height: h, left: 0, right: 0, width: 0, x: 0, y: t, toJSON: () => ({}) } as DOMRect;
  };
  const advanced = vi.fn();
  (b.item as unknown as { scrollIntoView: unknown }).scrollIntoView = advanced;
  return { a, advanced };
}

/** The AI-content filter's shape (ai-content-blocker.ts): visibility hidden, data-fw-blocked, the box stays (a black card). */
function aiHide(item: HTMLElement): void {
  const feedOf = videoFeedItemOf(item);
  expect(feedOf, 'the card is a feed item').not.toBeNull();
  const watch = snapshotWatched(item, feedOf!.surface);
  item.setAttribute('data-fw-blocked', 'ai-content');
  item.style.setProperty('visibility', 'hidden', 'important');
  afterFeedItemHidden(item, feedOf!.surface, { open: false }, watch);
}

const opts = { noticeText: 'hidden', showLabel: 'Show anyway', hideLabel: 'Hide again' };
const wheel = (): void => { document.body.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 120 })); };

let testClock = Date.now() + 10_000_000;

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

describe('F47 site D rework: the held move stands down for a card the person reveals', () => {
  it('control: no reveal, a real collapse: the next card already holds the screen, so the held move does nothing', () => {
    const { a, advanced } = feed();
    wheel();
    injectHardHide(a.desc, 'tiktok', opts);
    vi.advanceTimersByTime(1500);
    expect(advanced).not.toHaveBeenCalled();
  });

  it('the person presses "Show anyway" 300 ms after the hide: the revealed card is not scrolled away', () => {
    const { a, advanced } = feed();
    wheel();
    injectHardHide(a.desc, 'tiktok', opts);
    vi.advanceTimersByTime(300);
    const button = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Show anyway');
    expect(button, 'the notice has its button').toBeTruthy();
    button!.click();
    expect(a.item.getAttribute('data-fw-user-revealed'), 'the reveal took').toBe('true');
    vi.advanceTimersByTime(1500);
    expect(advanced, 'the feed was moved off the card the person chose to see').not.toHaveBeenCalled();
  });
});

describe('F47 site D rework: the AI filter, the case the hold exists for', () => {
  it('held during the scroll, then moved once when the person is quiet and still on the black card', () => {
    const { a, advanced } = feed();
    wheel();
    aiHide(a.item);
    expect(advanced, 'nothing moves during the scroll').not.toHaveBeenCalled();
    vi.advanceTimersByTime(1500);
    expect(advanced, 'one move once they are quiet').toHaveBeenCalledTimes(1);
  });

  it('the filter lifts its block before the person is quiet: nothing moves', () => {
    const { a, advanced } = feed();
    wheel();
    aiHide(a.item);
    vi.advanceTimersByTime(300);
    a.item.removeAttribute('data-fw-blocked');
    vi.advanceTimersByTime(1500);
    expect(advanced).not.toHaveBeenCalled();
  });

  it('the card leaves the page (an SPA navigation) before the person is quiet: nothing moves, no timer left', () => {
    const { a, advanced } = feed();
    wheel();
    aiHide(a.item);
    vi.advanceTimersByTime(300);
    a.item.remove();
    vi.advanceTimersByTime(1500);
    expect(advanced).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
