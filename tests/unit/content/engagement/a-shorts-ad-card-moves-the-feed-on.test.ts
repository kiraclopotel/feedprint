// @vitest-environment jsdom
//
// A hidden Shorts ad card must not leave the person on a blank card (the head's
// fresh check of aba7c504, 9 Oct 2026): the feed moves on from it, past a second
// hidden ad card; a card hidden while off screen moves the feed on when the
// person lands on it, once; a card the site reuses for a real Short is shown
// again; the kept-box hide is the Shorts ad card's, Instagram's and, since 13 Oct
// 2026, TikTok's For-You card's; and an ad delivered before its slot is recorded once.
// The head's recheck of eff1e046 (9 Oct 2026) added four: a move held while the
// person scrolls, which then gives up, still leaves the landing move; a person
// going back up lands past the card upwards; TikTok and Instagram with boxes;
// the same checks in Feedprint.
// jsdom draws no boxes, so each card is given one: a card holds the window's
// middle line when it is the one on screen.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const recorded: { blockReason: string }[] = [];
vi.mock('../../../../src/content/engagement/recorder-sink', () => ({
  recordBlocked: (p: { blockReason: string }) => { recorded.push(p); },
}));
vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return { ...actual, incrementMetricsHidden: vi.fn(() => Promise.resolve()) };
});

import { scanFeedAds, FEED_AD_HIDDEN_MARKER } from '../../../../src/content/engagement/feed-ad-blocker';
import { _resetAdvanceBreakerForTesting, _setHostForTesting } from '../../../../src/content/protection/video-feed-hide';

const BADGE = '<ad-badge-view-model><badge-shape><div>Sponsored</div></badge-shape></ad-badge-view-model>';
const AD = `<div id="experiment-overlay"><ytd-ad-slot-renderer><ytd-in-feed-ad-layout-renderer>${BADGE}</ytd-in-feed-ad-layout-renderer></ytd-ad-slot-renderer></div>`;
const card = (id: string, ad: boolean) => `<ytd-reel-video-renderer id="${id}"><video></video>${ad ? AD : '<div id="experiment-overlay"></div>'}</ytd-reel-video-renderer>`;

const byId = (id: string) => document.getElementById(id)!;
const hidden = (id: string) => byId(id).getAttribute(FEED_AD_HIDDEN_MARKER) === 'true';

/** Give a card a box: `onScreen` puts it across the window's middle line, else below the window. */
function box(id: string, onScreen: boolean): void {
  const top = onScreen ? 0 : 2000;
  byId(id).getBoundingClientRect = () => ({ top, bottom: top + 800, height: 800, left: 0, right: 400, width: 400, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
}

function shorts(cards: string): void {
  document.body.innerHTML = `<div id="shorts-inner-container">${cards}</div>`;
  for (const el of document.querySelectorAll<HTMLElement>('ytd-reel-video-renderer')) {
    box(el.id, false);
    el.scrollIntoView = vi.fn();
  }
}

beforeEach(() => { _resetAdvanceBreakerForTesting(); recorded.length = 0; });
afterEach(() => { _setHostForTesting(null); document.body.innerHTML = ''; });

describe('the feed moves on from a hidden Shorts ad card', () => {
  it('the ad card on screen is hidden and the next card is scrolled into view', () => {
    shorts(card('ad', true) + card('real', false));
    box('ad', true);
    scanFeedAds(document, 'youtube');
    expect(hidden('ad')).toBe(true);
    expect(byId('real').scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('it walks past a second hidden ad card to the next real one', () => {
    shorts(card('ad1', true) + card('ad2', true) + card('real', false));
    scanFeedAds(document, 'youtube'); // both hidden while off screen: nothing moves
    expect(hidden('ad1') && hidden('ad2')).toBe(true);
    box('ad1', true); // the person lands on the first one
    scanFeedAds(document, 'youtube');
    expect(byId('ad2').scrollIntoView).not.toHaveBeenCalled();
    expect(byId('real').scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('a card hidden off screen moves the feed on when the person lands on it, once', () => {
    shorts(card('ad', true) + card('real', false));
    scanFeedAds(document, 'youtube');
    expect(byId('real').scrollIntoView).not.toHaveBeenCalled();
    box('ad', true);
    scanFeedAds(document, 'youtube');
    scanFeedAds(document, 'youtube');
    expect(byId('real').scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('a hidden card whose ad slot leaves (the box reused for a real Short) is shown again and released', () => {
    shorts(card('ad', true) + card('real', false));
    scanFeedAds(document, 'youtube');
    expect(byId('ad').getAttribute('data-fw-silenced')).toBe('true');
    byId('ad').querySelector('ytd-ad-slot-renderer')!.remove();
    scanFeedAds(document, 'youtube');
    expect(hidden('ad')).toBe(false);
    expect(byId('ad').style.visibility).toBe('');
    expect(byId('ad').hasAttribute('data-fw-silenced')).toBe(false);
  });
});

describe('the kept-box hide is the Shorts ad card\'s alone', () => {
  it('a TikTok For-You ad on screen keeps its box with a line, and the feed moves on once (13 Oct 2026)', () => {
    _setHostForTesting('www.tiktok.com');
    document.body.innerHTML = `<div><div data-e2e="recommend-list-item-container" id="tt"><video></video>
      <div><span>Sponsored</span></div></div><div data-e2e="recommend-list-item-container" id="tt2"><video></video></div></div>`;
    box('tt', true);
    box('tt2', false);
    byId('tt2').scrollIntoView = vi.fn();
    scanFeedAds(document, 'tiktok');
    expect(hidden('tt')).toBe(true);
    // display:none took the card's box away, the snapping column put the person back on the card before it, and TikTok
    // redrew the card so it was hidden again: the owner's report of 13 Oct 2026.
    expect(byId('tt').style.display).toBe('');
    expect(byId('tt').style.visibility).toBe('hidden');
    expect(byId('tt').querySelector('[data-fw-ad-slot-note]')?.textContent).toBe('Skipped this video. Scroll on to keep going.');
    expect(byId('tt2').scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('an Instagram feed ad on screen keeps its box with a note, no feed move from this rule', () => {
    _setHostForTesting('www.instagram.com');
    document.body.innerHTML = `<main><div><article id="ig"><video></video><span>Sponsored</span></article>
      <article id="ig2"><video></video></article></div></main>`;
    box('ig', true);
    box('ig2', false);
    byId('ig2').scrollIntoView = vi.fn();
    scanFeedAds(document, 'instagram');
    expect(hidden('ig')).toBe(true);
    expect(byId('ig').style.visibility).toBe('hidden');
    expect(byId('ig').style.display).toBe('');
    expect(byId('ig2').scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('the landing move after a held one, and its direction', () => {
  it('a move held while the person scrolls, which gives up, leaves the landing move to be made', () => {
    // A clock well behind the real one, so the scroll noted here is long past for the tests after this one.
    vi.useFakeTimers({ now: Date.now() - 600_000 });
    try {
      shorts(card('ad', true) + card('real', false));
      box('ad', true);
      document.dispatchEvent(new Event('wheel'));
      scanFeedAds(document, 'youtube'); // hidden under the person's scroll: the move is held
      expect(hidden('ad')).toBe(true);
      for (let i = 0; i < 15; i += 1) { vi.advanceTimersByTime(400); document.dispatchEvent(new Event('wheel')); }
      vi.advanceTimersByTime(3000); // the held move gave up after its waits
      expect(byId('real').scrollIntoView).not.toHaveBeenCalled();
      scanFeedAds(document, 'youtube'); // still on the blank card, quiet now
      expect(byId('real').scrollIntoView).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a person going back up who lands on a hidden ad card is moved on upwards, not down', () => {
    shorts(card('above', false) + card('ad', true) + card('below', false));
    scanFeedAds(document, 'youtube'); // hidden while off screen
    box('below', true);
    scanFeedAds(document, 'youtube'); // the person is on the card below it
    box('below', false);
    box('ad', true);
    scanFeedAds(document, 'youtube'); // and scrolls back up onto it
    expect(byId('above').scrollIntoView).toHaveBeenCalledTimes(1);
    expect(byId('below').scrollIntoView).not.toHaveBeenCalled();
  });

  it('a person going down who lands on it is moved on downwards', () => {
    shorts(card('above', false) + card('ad', true) + card('below', false));
    box('above', true);
    scanFeedAds(document, 'youtube');
    box('above', false);
    box('ad', true);
    scanFeedAds(document, 'youtube');
    expect(byId('below').scrollIntoView).toHaveBeenCalledTimes(1);
    expect(byId('above').scrollIntoView).not.toHaveBeenCalled();
  });

  it('at the top of the feed, with nothing above, a person going back up is moved on downwards', () => {
    shorts(card('ad', true) + card('below', false));
    box('below', true);
    scanFeedAds(document, 'youtube');
    box('below', false);
    box('ad', true);
    scanFeedAds(document, 'youtube');
    expect(byId('below').scrollIntoView).toHaveBeenCalledTimes(1);
  });
});

describe('the hidden-card checks in Feedprint', () => {
  const feedprint = () => scanFeedAds(document, 'youtube', 'en', { mode: 'adult' });

  it('a card hidden off screen moves the feed on when the person lands on it, once, and is recorded once', () => {
    shorts(card('ad', true) + card('real', false));
    feedprint();
    expect(hidden('ad')).toBe(true);
    box('ad', true);
    feedprint();
    feedprint();
    expect(byId('real').scrollIntoView).toHaveBeenCalledTimes(1);
    expect(recorded).toHaveLength(1);
  });

  it('a hidden card whose ad slot leaves is shown again and released', () => {
    shorts(card('ad', true) + card('real', false));
    feedprint();
    byId('ad').querySelector('ytd-ad-slot-renderer')!.remove();
    feedprint();
    expect(hidden('ad')).toBe(false);
    expect(byId('ad').style.visibility).toBe('');
    expect(byId('ad').hasAttribute('data-fw-silenced')).toBe(false);
  });
});

describe('one record per ad in Feedprint', () => {
  it('an in-feed ad layout delivered before its slot is recorded once', () => {
    document.body.innerHTML = `<ytd-search><ytd-item-section-renderer id="sec"><ytd-in-feed-ad-layout-renderer id="layout">${BADGE}</ytd-in-feed-ad-layout-renderer></ytd-item-section-renderer></ytd-search>`;
    scanFeedAds(document, 'youtube', 'en', { mode: 'adult' });
    expect(recorded).toHaveLength(1);
    const slot = document.createElement('ytd-ad-slot-renderer');
    byId('sec').appendChild(slot);
    slot.appendChild(byId('layout'));
    scanFeedAds(document, 'youtube', 'en', { mode: 'adult' });
    expect(recorded).toHaveLength(1);
  });
});
