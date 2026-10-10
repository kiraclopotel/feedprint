// @vitest-environment jsdom
//
// armPick is the crosshair both products share (Off's "block this", the
// recorder's "read this for me"): the outline follows the pointer, a click
// hands the caller the boundary under it, Esc disarms, and `many` keeps the
// picker armed after a pick. Named by no test until 2026-09-06.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { armPick } from '../../../../src/content/engagement/picker';

const TWEET = (h: string, id: string) =>
  `<div data-testid="cellInnerDiv" id="${id}"><article data-testid="tweet"><div data-testid="User-Name"><a href="/${h}">${h}</a></div><div data-testid="tweetText">hi</div></article></div>`;

function fire(el: Element, type: string, init: MouseEventInit | KeyboardEventInit = {}): void {
  const ev = type === 'keydown'
    ? new KeyboardEvent(type, { bubbles: true, cancelable: true, ...(init as KeyboardEventInit) })
    : new MouseEvent(type, { bubbles: true, cancelable: true, ...(init as MouseEventInit) });
  el.dispatchEvent(ev);
}

const outline = () => document.querySelector<HTMLElement>('[data-fw-picker-outline]');

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = `<main>${TWEET('alice', 'c1')}${TWEET('bob', 'c2')}<section id="bare"><p id="p">plain</p></section></main>`;
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('armPick', () => {
  it('mounts the outline, the crosshair cursor and the hint; a click on a post picks it and disarms', () => {
    const onPick = vi.fn();
    const onDone = vi.fn();
    armPick('twitter', { hint: 'Click a post', onPick, onDone });

    expect(outline()).not.toBeNull();
    // jsdom does not parse the whole cssText block; what matters is that the
    // outline is not shown before the pointer reaches something.
    expect(outline()!.style.display).not.toBe('block');
    expect(document.querySelector('[data-fw-picker-toast]')?.textContent).toBe('Click a post');
    expect(Array.from(document.querySelectorAll('style')).some(s => s.textContent?.includes('crosshair'))).toBe(true);

    const text = document.querySelector('#c1 [data-testid="tweetText"]')!;
    fire(text, 'mousemove');
    expect(outline()!.style.display).toBe('block');

    fire(text, 'click');
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0]).toMatchObject({ kind: 'post', author: 'alice' });
    expect(onPick.mock.calls[0][0].el).toBe(document.getElementById('c1'));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(outline()).toBeNull();
    expect(Array.from(document.querySelectorAll('style')).some(s => s.textContent?.includes('crosshair'))).toBe(false);
  });

  it('a click with nothing safe under it hands the caller null, and still disarms', () => {
    const onPick = vi.fn();
    const onDone = vi.fn();
    armPick('twitter', { hint: 'h', onPick, onDone });

    fire(document.getElementById('p')!, 'mousemove');
    expect(outline()!.style.display).toBe('none');
    fire(document.getElementById('p')!, 'click');
    expect(onPick).toHaveBeenCalledWith(null);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('the picker\'s own outline is never a target', () => {
    const onPick = vi.fn();
    armPick('twitter', { hint: 'h', onPick, onDone: () => {} });
    fire(document.querySelector('#c1 [data-testid="tweetText"]')!, 'mousemove');
    expect(outline()!.style.display).toBe('block');
    fire(outline()!, 'mousemove');
    expect(outline()!.style.display).toBe('none');
  });

  it('Escape disarms without a pick; the returned function disarms too', () => {
    const onPick = vi.fn();
    const onDone = vi.fn();
    armPick('twitter', { hint: 'h', onPick, onDone });
    fire(document.body, 'keydown', { key: 'Escape' });
    expect(onPick).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(outline()).toBeNull();

    const onDone2 = vi.fn();
    const stop = armPick('twitter', { hint: 'h', onPick, onDone: onDone2 });
    stop();
    expect(onDone2).toHaveBeenCalledTimes(1);
    expect(outline()).toBeNull();
  });

  it('with many, every click is a pick and only Escape ends it', () => {
    const onPick = vi.fn();
    const onDone = vi.fn();
    armPick('twitter', { hint: 'h', many: true, onPick, onDone });

    fire(document.querySelector('#c1 [data-testid="tweetText"]')!, 'click');
    fire(document.querySelector('#c2 [data-testid="tweetText"]')!, 'click');
    expect(onPick).toHaveBeenCalledTimes(2);
    expect(onPick.mock.calls.map(c => c[0].author)).toEqual(['alice', 'bob']);
    expect(onDone).not.toHaveBeenCalled();
    expect(outline()).not.toBeNull();
    expect(outline()!.style.display).toBe('none');

    fire(document.body, 'keydown', { key: 'Escape' });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(outline()).toBeNull();
  });

  it('the click never reaches the page', () => {
    armPick('twitter', { hint: 'h', onPick: () => {}, onDone: () => {} });
    const text = document.querySelector('#c1 [data-testid="tweetText"]')!;
    const pageHandler = vi.fn();
    text.addEventListener('click', pageHandler);
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    text.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(pageHandler).not.toHaveBeenCalled();
  });

  it('the hint leaves on its own after a moment', () => {
    armPick('twitter', { hint: 'h', onPick: () => {}, onDone: () => {} });
    expect(document.querySelector('[data-fw-picker-toast]')).not.toBeNull();
    vi.advanceTimersByTime(3000);
    expect(document.querySelector('[data-fw-picker-toast]')).toBeNull();
  });
});
