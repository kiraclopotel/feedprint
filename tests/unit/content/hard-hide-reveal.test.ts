// @vitest-environment jsdom
//
// Hard-hide reveal affordance (M33 follow-up, live report 2026-08-02: "posts that
// are hidden due to them being marked can't be revisited because they get
// hidden again"). Teen/Adult callers pass revealOpts → a sibling notice with
// a show-anyway/hide-again toggle mounts; the user's reveal outranks every
// re-apply path (guard re-assert, cache replay, rescan). Child mode passes
// no revealOpts and keeps the fully silent hide.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { injectHardHide, type HardHideRevealOpts } from '../../../src/content/injector';

function makeXPost(): { article: HTMLElement; text: HTMLElement } {
  const article = document.createElement('article');
  article.setAttribute('role', 'article');
  const text = document.createElement('div');
  text.setAttribute('data-testid', 'tweetText');
  text.textContent = 'threat post text';
  const video = document.createElement('video');
  article.append(text, video);
  document.body.appendChild(article);
  return { article, text };
}

function opts(over: Partial<HardHideRevealOpts> = {}): HardHideRevealOpts {
  return {
    noticeText: 'FeelingWise hid this post',
    showLabel: 'show anyway',
    hideLabel: 'hide again',
    ...over,
  };
}

const noticeOf = (article: HTMLElement): HTMLElement | null => {
  const prev = article.previousElementSibling;
  return prev instanceof HTMLElement && prev.getAttribute('data-fw-hide-notice') === 'true'
    ? prev : null;
};
const buttonOf = (article: HTMLElement): HTMLButtonElement =>
  noticeOf(article)!.querySelector('button')!;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('injectHardHide reveal affordance', () => {
  it('without revealOpts (Child mode) hides silently — no notice', () => {
    const { article, text } = makeXPost();
    expect(injectHardHide(text, 'twitter')).toBe(true);
    expect(article.style.getPropertyValue('display')).toBe('none');
    expect(noticeOf(article)).toBeNull();
  });

  it('with revealOpts hides the post and mounts one notice with the show label', () => {
    const { article, text } = makeXPost();
    expect(injectHardHide(text, 'twitter', opts())).toBe(true);
    expect(article.style.getPropertyValue('display')).toBe('none');
    const notice = noticeOf(article);
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toContain('FeelingWise hid this post');
    expect(buttonOf(article).textContent).toBe('show anyway');
    // Idempotent re-apply mounts no second notice.
    expect(injectHardHide(text, 'twitter', opts())).toBe(true);
    expect(document.querySelectorAll('[data-fw-hide-notice]')).toHaveLength(1);
  });

  it('reveal restores display, flips the label, reports the change, and survives re-apply', () => {
    const { article, text } = makeXPost();
    const onRevealChange = vi.fn();
    injectHardHide(text, 'twitter', opts({ onRevealChange }));
    buttonOf(article).click();
    expect(article.style.getPropertyValue('display')).toBe('');
    expect(article.getAttribute('data-fw-user-revealed')).toBe('true');
    expect(buttonOf(article).textContent).toBe('hide again');
    expect(onRevealChange).toHaveBeenCalledWith(true);
    // Guard re-assert / cache replay path: must NOT re-hide a revealed post.
    // CONTRACT SHIFT (M97, 2026-08-04): the re-apply carries the POST's own
    // reveal truth (`initiallyRevealed`, derived fresh from the session
    // reveal set by the only production caller) — the element attribute
    // alone no longer exempts, because a recycled element's stale attribute
    // was leaving NEW posts visible. A re-apply without the post's truth now
    // re-hides; hard-hide-notice-truthfulness.test.ts locks both directions.
    expect(injectHardHide(text, 'twitter', opts({ onRevealChange, initiallyRevealed: true }))).toBe(true);
    expect(article.style.getPropertyValue('display')).toBe('');
  });

  it('revealed media stays muted', () => {
    const { article, text } = makeXPost();
    injectHardHide(text, 'twitter', opts());
    buttonOf(article).click();
    const video = article.querySelector('video')!;
    expect(video.muted).toBe(true);
  });

  it('hide again re-hides and reports the change', () => {
    const { article, text } = makeXPost();
    const onRevealChange = vi.fn();
    injectHardHide(text, 'twitter', opts({ onRevealChange }));
    buttonOf(article).click();
    buttonOf(article).click();
    expect(article.style.getPropertyValue('display')).toBe('none');
    expect(article.getAttribute('data-fw-user-revealed')).toBeNull();
    expect(buttonOf(article).textContent).toBe('show anyway');
    expect(onRevealChange).toHaveBeenLastCalledWith(false);
  });

  it('initiallyRevealed replays a prior reveal onto a fresh remount', () => {
    const { article, text } = makeXPost();
    expect(injectHardHide(text, 'twitter', opts({ initiallyRevealed: true }))).toBe(true);
    expect(article.style.getPropertyValue('display')).toBe('');
    expect(article.getAttribute('data-fw-user-revealed')).toBe('true');
    expect(buttonOf(article).textContent).toBe('hide again');
  });
});

// X home-timeline cell anatomy (M96, 2026-08-04). The virtualizer positions
// every cellInnerDiv absolutely and never reflows around foreign height, so
// the hard hide must target the cell's content WRAPPER and the notice must
// mount INSIDE the cell — a cell-sibling notice renders at the rail's top,
// over an unrelated post's header (a real home-feed report).
function makeXCellPost(): {
  cell: HTMLElement; wrapper: HTMLElement; article: HTMLElement; text: HTMLElement;
} {
  const cell = document.createElement('div');
  cell.setAttribute('data-testid', 'cellInnerDiv');
  const wrapper = document.createElement('div');
  const article = document.createElement('article');
  article.setAttribute('role', 'article');
  const text = document.createElement('div');
  text.setAttribute('data-testid', 'tweetText');
  text.textContent = 'threat post text';
  article.appendChild(text);
  wrapper.appendChild(article);
  cell.appendChild(wrapper);
  document.body.appendChild(cell);
  return { cell, wrapper, article, text };
}

describe('injectHardHide on the X cell anatomy (M96)', () => {
  it('hides the content wrapper, not the cell, and mounts the notice inside the cell', () => {
    const { cell, wrapper, text } = makeXCellPost();
    expect(injectHardHide(text, 'twitter', opts())).toBe(true);
    expect(wrapper.style.getPropertyValue('display')).toBe('none');
    expect(wrapper.style.getPropertyPriority('display')).toBe('important');
    expect(wrapper.getAttribute('data-fw-hard-hidden')).toBe('true');
    expect(cell.style.getPropertyValue('display')).toBe('');
    const notice = cell.querySelector('[data-fw-hide-notice]') as HTMLElement;
    expect(notice).not.toBeNull();
    // Probe contract (hide-chip-probe.ts): the chip's next sibling is the
    // hidden, stamped anchor.
    expect(notice.nextElementSibling).toBe(wrapper);
    expect(notice.style.position).toBe('relative');
  });

  it('child mode hides the wrapper silently and leaves the cell unstyled', () => {
    const { cell, wrapper, text } = makeXCellPost();
    expect(injectHardHide(text, 'twitter')).toBe(true);
    expect(wrapper.style.getPropertyValue('display')).toBe('none');
    expect(cell.style.getPropertyValue('display')).toBe('');
    expect(cell.querySelector('[data-fw-hide-notice]')).toBeNull();
  });

  it('reveal restores the wrapper in place and floats the chip out of flow', () => {
    const { cell, wrapper, text } = makeXCellPost();
    injectHardHide(text, 'twitter', opts());
    const btn = cell.querySelector('button') as HTMLButtonElement;
    btn.click();
    expect(wrapper.style.getPropertyValue('display')).toBe('');
    expect(wrapper.getAttribute('data-fw-user-revealed')).toBe('true');
    const notice = cell.querySelector('[data-fw-hide-notice]') as HTMLElement;
    // Out of flow while revealed: the cell's content height matches what X
    // measured for the post, so the layout error stays inside this cell.
    expect(notice.style.position).toBe('absolute');
    expect(btn.textContent).toBe('hide again');
    // Revealed, the chip is the button alone, anchored top-right and clear of
    // the corner (2026-09-07: the full-width bar at top:0 had covered the
    // revealed post's header and first line of text). The sentence is hidden
    // because "hid this post" is no longer true while the post is shown.
    const label = notice.querySelector('span') as HTMLElement;
    expect(label.hidden).toBe(true);
    expect(notice.style.getPropertyValue('left')).toBe('');
    expect(notice.style.getPropertyValue('right')).toBe('44px');
    expect(notice.style.getPropertyValue('top')).toBe('6px');
    // Hide again returns the chip into the flow of the vacated cell, sentence back.
    btn.click();
    expect(wrapper.style.getPropertyValue('display')).toBe('none');
    expect(notice.style.position).toBe('relative');
    expect(label.hidden).toBe(false);
    expect(notice.style.getPropertyValue('padding')).toBe('10px 12px');
  });

  it('falls back to hiding the cell when the anatomy is not single-wrapper', () => {
    const { cell, wrapper, text } = makeXCellPost();
    const second = document.createElement('div');
    cell.appendChild(second);
    expect(injectHardHide(text, 'twitter', opts())).toBe(true);
    expect(cell.style.getPropertyValue('display')).toBe('none');
    expect(wrapper.style.getPropertyValue('display')).toBe('');
  });
});
