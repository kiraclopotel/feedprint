// @vitest-environment jsdom
//
// The door asks the size question too, and says so in the ledger (11 Oct 2026).
//
// hide-sanity.ts decides what is too wide for a switch; this file checks the door acts on it for both ways to hide
// (hideElement and markHidden), that a refusal leaves no mark and no inline style, that a switch that hides a surface
// on purpose is not judged, and that each refused element is counted once however often a sweep meets it again.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/storage/settings', () => ({
  incrementMetricsHidden: vi.fn(() => Promise.resolve()),
}));

import { hideElement, markHidden, BLOCK_REASON_ATTR } from '../../../../src/content/engagement/mark-hidden';
import { __pendingFinderEventsForTest, __resetFinderLedgerForTest } from '../../../../src/diagnostics/finder-ledger';

const opts = (reason: string) => ({ marker: 'data-fw-test', value: 'true', reason });

function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

beforeEach(() => {
  document.body.replaceChildren();
  __resetFinderLedgerForTest();
});

afterEach(() => {
  __resetFinderLedgerForTest();
});

describe('a bar hide that has climbed too far is refused', () => {
  const WRAP = '<div id="wrap"><div role="article"><button>Like</button></div><textarea></textarea></div>';

  it('hideElement and markHidden both refuse, and leave nothing behind', () => {
    const host = mount(WRAP);
    const wrap = host.querySelector<HTMLElement>('#wrap')!;
    expect(hideElement(wrap, opts('hide-action-buttons:structural-bar'))).toBe(false);
    expect(markHidden(wrap, opts('hide-action-buttons:structural-bar'))).toBe(false);
    expect(wrap.style.display).not.toBe('none');
    expect(wrap.hasAttribute('data-fw-test')).toBe(false);
    expect(wrap.hasAttribute(BLOCK_REASON_ATTR)).toBe(false);
  });

  it('counts the refusal once however often the element is met again', () => {
    const host = mount(WRAP);
    const wrap = host.querySelector<HTMLElement>('#wrap')!;
    for (let i = 0; i < 5; i++) hideElement(wrap, opts('hide-action-buttons:structural-bar'));
    expect(__pendingFinderEventsForTest()).toEqual({ 'refused.hide-action-buttons.text-input': 1 });
  });

  it('counts the other refusals under their own names', () => {
    const host = mount('<div role="menu"><div id="item" role="menuitem">Save</div></div><div id="feed"><div role="article">a</div><div role="article">b</div></div>');
    hideElement(host.querySelector<HTMLElement>('#item')!, opts('hide-action-buttons:structural-bar'));
    hideElement(host.querySelector<HTMLElement>('#feed')!, opts('block-ads:feed-ad'));
    expect(__pendingFinderEventsForTest()).toEqual({
      'refused.hide-action-buttons.popup-layer': 1,
      'refused.block-ads.many-posts': 1,
    });
  });
});

describe('what the door still lets through', () => {
  it('a bar inside a post', () => {
    const host = mount('<div role="article"><p>Hi</p><div id="bar"><button>Like</button><button>Share</button></div></div>');
    expect(hideElement(host.querySelector<HTMLElement>('#bar')!, opts('hide-action-buttons:structural-bar'))).toBe(true);
    expect(__pendingFinderEventsForTest()).toEqual({});
  });

  it('a switch that hides a whole surface on purpose, over any size', () => {
    const host = mount('<main id="m"><div role="article">a</div><div role="article">b</div><textarea></textarea></main>');
    expect(hideElement(host.querySelector<HTMLElement>('#m')!, { ...opts('block-reels:reel-surface'), feature: 'block-reels' })).toBe(true);
  });

  it('the feature named in the options wins over the reason prefix', () => {
    const host = mount('<div id="feed"><div role="article">a</div><div role="article">b</div></div>');
    expect(hideElement(host.querySelector<HTMLElement>('#feed')!, { ...opts('x:y'), feature: 'block-ads' })).toBe(false);
  });
});
