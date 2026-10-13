// @vitest-environment jsdom
//
// A hidden TikTok card keeps its box (video-feed-hide.ts keepsItemBox). The owner's report of 13 Oct 2026: scrolling down TikTok's
// For-You feed snapped back up to the previous post two or three times, and the console showed the same card hidden nine times.
// A card of that feed is one slide of a column that snaps slide by slide, and the hide took its box away with display:none (the
// AI-content filter and the Shorts ad card keep their box for that reason, and say so). Now every way Feedprint and Off hide such
// a card keeps its height and its place in the column, pauses its video, and leaves one quiet line (or, for Teen and Adult, the
// notice with its "show anyway") inside the card. What the live feed does with it is for the owner's eyes on a rebuilt dist.
// jsdom draws no boxes, so the column is modelled: a slide has no height only when it is display:none, a column re-snaps to the
// nearest slide after any change, and the control shows the model does see the old shape.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { injectAdHide, injectHardHide } from '../../../../src/content/injector';
import { _resetAdvanceBreakerForTesting } from '../../../../src/content/protection/video-feed-hide';
import { collapseCard } from '../../../helpers/collapse-a-card';

const SLIDE = 800;

interface Slide { item: HTMLElement; desc: HTMLElement; video: HTMLVideoElement }

interface Column {
  column: HTMLElement;
  slides: Slide[];
  scrollTop: () => number;
  scrollTo: (top: number) => void;
  /** What the browser does after any change to the column: keep the scroll inside it and snap to the nearest slide. */
  relayout: () => void;
  height: (slide: Slide) => number;
  total: () => number;
}

/** A snap-scroll column of `count` TikTok slides, `SLIDE` px each; a slide has no height only when it is display:none. */
function snapColumn(count: number): Column {
  const column = document.createElement('div');
  document.body.appendChild(column);
  const slides: Slide[] = [];
  for (let i = 0; i < count; i++) {
    const item = document.createElement('div');
    item.setAttribute('data-e2e', 'recommend-list-item-container');
    const desc = document.createElement('div');
    desc.setAttribute('data-e2e', 'video-desc');
    desc.textContent = `caption ${i + 1}`;
    const video = document.createElement('video');
    const rail = document.createElement('button');
    rail.setAttribute('data-e2e', 'comment-icon');
    item.append(desc, video, rail);
    column.appendChild(item);
    slides.push({ item, desc, video });
  }
  let scroll = 0;
  const gone = (s: Slide): boolean => s.item.style.getPropertyValue('display') === 'none';
  const height = (s: Slide): number => (gone(s) ? 0 : SLIDE);
  const total = (): number => slides.reduce((n, s) => n + height(s), 0);
  const topOf = (index: number): number => slides.slice(0, index).reduce((n, s) => n + height(s), 0);
  slides.forEach((s, index) => {
    s.item.getBoundingClientRect = () => {
      const top = topOf(index) - scroll;
      const h = height(s);
      return { top, bottom: top + h, height: h, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    };
    Object.defineProperty(s.item, 'offsetHeight', { configurable: true, get: () => height(s) });
    s.item.scrollIntoView = vi.fn();
  });
  const relayout = (): void => {
    const max = Math.max(0, total() - SLIDE);
    scroll = Math.min(Math.max(scroll, 0), max);
    const points = slides.filter((s) => !gone(s)).map((s) => topOf(slides.indexOf(s)));
    scroll = points.reduce((best, p) => (Math.abs(p - scroll) < Math.abs(best - scroll) ? p : best), points[0] ?? 0);
  };
  return { column, slides, scrollTop: () => scroll, scrollTo: (top) => { scroll = top; }, relayout, height, total };
}

beforeEach(() => {
  document.body.innerHTML = '';
  _resetAdvanceBreakerForTesting();
});
afterEach(() => {
  document.body.innerHTML = '';
});

describe('a hidden TikTok card keeps its place in the snapping column', () => {
  it('control: taking the box away (display:none) is what the model sees as a change', () => {
    const feed = snapColumn(3);
    feed.scrollTo(SLIDE);
    collapseCard(feed.slides[2].item);
    feed.relayout();
    expect(feed.height(feed.slides[2])).toBe(0);
    expect(feed.total()).toBe(2 * SLIDE);
  });

  it('Child: the card after the one on screen is hidden; the scroll position and the card\'s height are unchanged', () => {
    const feed = snapColumn(3);
    feed.scrollTo(SLIDE);
    const third = feed.slides[2];
    expect(injectHardHide(third.desc, 'tiktok')).toBe(true);
    feed.relayout();
    expect(feed.scrollTop()).toBe(SLIDE);
    expect(feed.height(third)).toBe(SLIDE);
    expect(feed.total()).toBe(3 * SLIDE);
    expect(third.item.style.getPropertyValue('visibility')).toBe('hidden');
    expect(third.item.style.getPropertyValue('display')).toBe('');
    expect(feed.column.children.length, 'nothing was added to the column itself').toBe(3);
    const note = third.item.querySelector('[data-fw-ad-slot-note]');
    expect(note?.textContent).toBe('Skipped at your Silent level. Keep scrolling.');
    expect(third.item.getAttribute('data-fw-silenced'), 'its video is paused and kept paused').toBe('true');
  });

  it('Teen and Adult: the notice stands inside the card, with its button; showing the card keeps the box too', () => {
    const feed = snapColumn(3);
    feed.scrollTo(SLIDE);
    const third = feed.slides[2];
    const opts = { noticeText: 'A post is hidden here', showLabel: 'show anyway', hideLabel: 'hide again' };
    expect(injectHardHide(third.desc, 'tiktok', opts)).toBe(true);
    feed.relayout();
    expect(feed.scrollTop()).toBe(SLIDE);
    expect(feed.height(third)).toBe(SLIDE);
    expect(feed.column.children.length, 'a sibling notice would add a block to the column').toBe(3);
    const notice = third.item.querySelector('[data-fw-hide-notice]') as HTMLElement;
    expect(notice.textContent).toContain('A post is hidden here');
    const button = notice.querySelector('button')!;
    button.click();
    feed.relayout();
    expect(third.item.style.getPropertyValue('visibility')).toBe('');
    expect(feed.height(third)).toBe(SLIDE);
    expect(feed.scrollTop()).toBe(SLIDE);
    expect(button.textContent).toBe('hide again');
    button.click();
    expect(third.item.style.getPropertyValue('visibility')).toBe('hidden');
    expect(feed.height(third)).toBe(SLIDE);
  });

  it('an advertisement: hidden by visibility with the line, the box kept, the feed unmoved', () => {
    const feed = snapColumn(3);
    feed.scrollTo(SLIDE);
    const third = feed.slides[2];
    expect(injectAdHide(third.desc, 'tiktok')).toBe(true);
    feed.relayout();
    expect(feed.scrollTop()).toBe(SLIDE);
    expect(feed.height(third)).toBe(SLIDE);
    expect(third.item.style.getPropertyValue('visibility')).toBe('hidden');
    expect(third.item.querySelector('[data-fw-ad-slot-note]')?.textContent).toBe('Skipped this video. Scroll on to keep going.');
  });

  it('TikTok redraws the card and drops the line: the hide is applied again, once, with no layout change and no extra move', () => {
    const feed = snapColumn(3);
    feed.scrollTo(SLIDE);
    const third = feed.slides[2];
    injectHardHide(third.desc, 'tiktok');
    third.item.querySelector('[data-fw-ad-slot-note]')!.remove();
    expect(injectHardHide(third.desc, 'tiktok')).toBe(true);
    expect(injectHardHide(third.desc, 'tiktok')).toBe(true);
    feed.relayout();
    expect(third.item.querySelectorAll('[data-fw-ad-slot-note]').length).toBe(1);
    expect(feed.height(third)).toBe(SLIDE);
    expect(feed.scrollTop()).toBe(SLIDE);
    for (const s of feed.slides) expect(s.item.scrollIntoView).not.toHaveBeenCalled();

    const ad = snapColumn(3);
    ad.scrollTo(SLIDE);
    injectAdHide(ad.slides[2].desc, 'tiktok');
    ad.slides[2].item.querySelector('[data-fw-ad-slot-note]')!.remove();
    injectAdHide(ad.slides[2].desc, 'tiktok');
    injectAdHide(ad.slides[2].desc, 'tiktok');
    expect(ad.slides[2].item.querySelectorAll('[data-fw-ad-slot-note]').length).toBe(1);
    expect(ad.height(ad.slides[2])).toBe(SLIDE);
  });

  it('the card on screen is hidden: the feed moves on to the next card once, and the hidden card still has its height', () => {
    const feed = snapColumn(3);
    feed.scrollTo(SLIDE);
    injectHardHide(feed.slides[1].desc, 'tiktok');
    feed.relayout();
    expect(feed.height(feed.slides[1])).toBe(SLIDE);
    expect(feed.slides[2].item.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(feed.slides[0].item.scrollIntoView).not.toHaveBeenCalled();
  });
});
