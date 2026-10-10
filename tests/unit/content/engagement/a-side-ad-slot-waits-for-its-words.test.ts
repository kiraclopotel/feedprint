// @vitest-environment jsdom
//
// The tester's finding of 9 Oct 2026 (crew INBOX-head 15:2x): with no ad served, each of three loads wrote one
// "[blocked: ads]" record with no words. Read signed out the same day (scripts/verify/youtube-ad-shapes.mjs,
// kJQP7kiw5Fk, no ad served): the watch page carries its ad holders beside the video (ytd-player-legacy-desktop-watch-
// ads-renderer > ytd-companion-slot-renderer), on the page and not drawn. Both products hide them by name. A holder
// with no words is hidden at once and waits for what fills it, as the ad before a video waits for its words: it is
// counted the moment it shows an ad (words, a picture, a video) and, in Feedprint, recorded once, 2 s after its words
// last changed, with the last words it held; a holder still empty at the end of the wait showed nothing: no count, no
// record. Below: the tally, one count per ad whatever order the page builds its pieces in, and (Off only, the only
// product that judges list cards) a post holding an empty slot.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const recorded: { blockReason: string; matchedToken: string; caption: string; postUrl: string }[] = [];
vi.mock('../../../../src/content/engagement/recorder-sink', () => ({
  recordBlocked: (p: { blockReason: string; matchedToken: string; caption: string; postUrl: string }) => { recorded.push(p); },
}));
vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return { ...actual, incrementMetricsHidden: vi.fn(() => Promise.resolve()) };
});

import { _setProductForTesting } from '../../../../src/product';
import { startFeedAdBlocker, FEED_AD_HIDDEN_MARKER } from '../../../../src/content/engagement/feed-ad-blocker';
import { __flushHiddenCountForTest } from '../../../../src/content/engagement/mark-hidden';
import { incrementMetricsHidden, type FWSettings, CURRENT_SETTINGS_SCHEMA_VERSION } from '../../../../src/storage/settings';
import { adultPreset } from '../../../../src/storage/presets';

function settings(): FWSettings {
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    mode: 'adult',
    strictLanguage: false, hideUnrewritable: false, aiAnalysisEnabled: true,
    parentPin: '', dailyCap: 5000, monthlyUsdCapOverride: null, locale: 'en',
    outputLanguage: 'auto', uiLanguage: 'auto',
    totalChecksToday: 0, totalNeutralizedToday: 0, totalTokensToday: 0,
    estimatedCostToday: 0, lastResetDate: '',
    totalChecksThisMonth: 0, totalTokensThisMonth: 0, lastResetMonth: '',
    totalTokensAllTime: 0, totalChecksAllTime: 0,
    totalNeutralizedAllTime: 0, estimatedCostAllTime: 0,
    features: adultPreset(),
    presets: { appliedAt: '', appliedPreset: 'adult' },
    dashboardTheme: 'dark',
  };
}

/** A watch page whose ad slot beside the video is on the page before its words. */
const WATCH = `
  <ytd-watch-flexy><div id="columns">
    <div id="primary"><div id="player"><div id="movie_player"></div></div></div>
    <div id="secondary"><div id="secondary-inner">
      <div id="player-ads"><ytd-player-legacy-desktop-watch-ads-renderer id="slot"><ytd-companion-slot-renderer><div id="companion"></div></ytd-companion-slot-renderer></ytd-player-legacy-desktop-watch-ads-renderer></div>
      <div id="related"><ytd-compact-video-renderer><span>A related video</span></ytd-compact-video-renderer></div>
    </div></div>
  </div></ytd-watch-flexy>`;

const slot = (): HTMLElement => document.getElementById('slot')!;
const companion = (): HTMLElement => document.getElementById('companion')!;
const hidden = (): boolean => slot().getAttribute(FEED_AD_HIDDEN_MARKER) === 'true';
const ads = () => recorded.filter((r) => r.matchedToken === 'ad-slot');

let stop: () => void = () => {};

beforeEach(() => {
  recorded.length = 0;
  __flushHiddenCountForTest(); // a count an earlier test left pending is not this test's
  vi.mocked(incrementMetricsHidden).mockClear();
  vi.useFakeTimers();
  _setProductForTesting('receipts');
  history.replaceState(null, '', '/watch?v=first');
  document.body.innerHTML = WATCH;
});

afterEach(() => {
  stop();
  stop = () => {};
  vi.useRealTimers();
  document.body.innerHTML = '';
  history.replaceState(null, '', '/');
});

describe('Feedprint: an ad slot beside the video that is drawn before its words', () => {
  it('is hidden at once and written once, with its words, when they come late', async () => {
    stop = startFeedAdBlocker('youtube', settings());
    expect(hidden()).toBe(true);
    await vi.advanceTimersByTimeAsync(1500);
    expect(ads()).toHaveLength(0); // no words yet: no record yet
    companion().innerHTML = '<div><span>Sponsored</span></div><div>Raid: the new season</div><div>raid.example</div><button>Download</button>';
    await vi.advanceTimersByTimeAsync(2100);
    expect(ads()).toHaveLength(1);
    expect(ads()[0].caption).toContain('Raid: the new season raid.example');
    expect(ads()[0].caption).not.toContain('Download'); // the short button label is the page's, not the ad's
    await vi.advanceTimersByTimeAsync(20000);
    expect(ads()).toHaveLength(1);
  });

  it('words drawn in two steps: one record with both', async () => {
    stop = startFeedAdBlocker('youtube', settings());
    companion().innerHTML = '<div id="title">Raid: the new season</div>';
    await vi.advanceTimersByTimeAsync(800);
    companion().insertAdjacentHTML('beforeend', '<div>raid.example</div>');
    await vi.advanceTimersByTimeAsync(2100);
    expect(ads()).toHaveLength(1);
    expect(ads()[0].caption).toBe('Raid: the new season raid.example');
  });

  it('a short button label drawn first does not end the wait: the ad\'s own words, drawn after, are its record', async () => {
    stop = startFeedAdBlocker('youtube', settings());
    companion().innerHTML = '<button>Download</button>';
    await vi.advanceTimersByTimeAsync(2500);
    expect(ads()).toHaveLength(0);
    companion().insertAdjacentHTML('afterbegin', '<a role="button" href="https://raid.example/"><div>Raid: the new season, play free now</div></a>');
    await vi.advanceTimersByTimeAsync(2100);
    expect(ads()).toHaveLength(1);
    expect(ads()[0].caption).toBe('Raid: the new season, play free now'); // a long link-button keeps the ad's words
  });

  it('the empty holder of a page with no ad: hidden, and no record, through the page, its moving on, the tab closing and the stop', async () => {
    stop = startFeedAdBlocker('youtube', settings());
    expect(hidden()).toBe(true);
    await vi.advanceTimersByTimeAsync(30000);
    expect(ads()).toHaveLength(0);
    document.dispatchEvent(new Event('yt-navigate-start'));
    window.dispatchEvent(new Event('pagehide'));
    stop();
    stop = () => {};
    expect(ads()).toHaveLength(0);
  });

  it('a holder that fills a minute in (an ad started mid-video) is written then, once', async () => {
    stop = startFeedAdBlocker('youtube', settings());
    await vi.advanceTimersByTimeAsync(60000);
    expect(ads()).toHaveLength(0);
    companion().innerHTML = '<div>Raid: the new season</div>';
    await vi.advanceTimersByTimeAsync(2100);
    expect(ads()).toHaveLength(1);
    expect(ads()[0].caption).toBe('Raid: the new season');
  });

  it('an ad with a picture and no words is written once without words, 2 s after the picture, as words are', async () => {
    stop = startFeedAdBlocker('youtube', settings());
    companion().innerHTML = '<a href="https://raid.example/"><img src="https://i.ytimg.example/raid.jpg"></a>';
    await vi.advanceTimersByTimeAsync(1500);
    expect(ads()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(600);
    expect(ads()).toHaveLength(1);
    document.dispatchEvent(new Event('yt-navigate-start'));
    expect(ads()).toHaveLength(1);
    expect(ads()[0].caption).toBe('');
    stop();
    stop = () => {};
    expect(ads()).toHaveLength(1);
  });

  it('a slot that filled and was taken off the page while it waits is written once', async () => {
    stop = startFeedAdBlocker('youtube', settings());
    companion().innerHTML = '<div>Raid: the new season</div>';
    await vi.advanceTimersByTimeAsync(500);
    slot().remove();
    await vi.advanceTimersByTimeAsync(2100); // the 2 s pass
    expect(ads()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(20000);
    expect(ads()).toHaveLength(1);
  });

  it('YouTube moving to another page writes a waiting slot once, with the page it was hidden on', async () => {
    stop = startFeedAdBlocker('youtube', settings());
    companion().innerHTML = '<div>Raid: the new season</div>';
    await vi.advanceTimersByTimeAsync(500);
    document.dispatchEvent(new Event('yt-navigate-start'));
    history.pushState(null, '', '/results?search_query=next');
    await vi.advanceTimersByTimeAsync(2100);
    expect(ads()).toHaveLength(1);
    expect(ads()[0].postUrl).toMatch(/\/watch$/); // the record's address keeps the page, without its query
    await vi.advanceTimersByTimeAsync(20000);
    expect(ads()).toHaveLength(1);
  });

  it('the tab closing writes a waiting slot once', async () => {
    stop = startFeedAdBlocker('youtube', settings());
    companion().innerHTML = '<div>Raid: the new season</div>';
    await vi.advanceTimersByTimeAsync(500);
    window.dispatchEvent(new Event('pagehide'));
    expect(ads()).toHaveLength(1);
    stop();
    stop = () => {};
    expect(ads()).toHaveLength(1);
  });

  it('a slot that has its words when hidden is written at once, as before', async () => {
    companion().innerHTML = '<div>Raid: the new season</div><div>raid.example</div>';
    stop = startFeedAdBlocker('youtube', settings());
    expect(ads()).toHaveLength(1);
    expect(ads()[0].caption).toBe('Raid: the new season raid.example');
    await vi.advanceTimersByTimeAsync(20000);
    expect(ads()).toHaveLength(1);
  });
});

/** The hidden-ad tally written so far: the total hidden, and per switch. */
function tally(): { hidden: number; byFeature: Record<string, number> } {
  __flushHiddenCountForTest();
  const out = { hidden: 0, byFeature: {} as Record<string, number> };
  for (const [n, by] of vi.mocked(incrementMetricsHidden).mock.calls as unknown as [number, Record<string, number>][]) {
    out.hidden += n;
    for (const [k, v] of Object.entries(by)) out.byFeature[k] = (out.byFeature[k] ?? 0) + v;
  }
  return out;
}

// The popup's "ads hidden" grew by one or two on every watch page with no ad served: the empty holders were counted as
// hidden ads (the head's note on d5180c78, 9 Oct 2026). Both products hide them and count them only once they hold an ad.
describe.each(['off', 'receipts'] as const)('the hidden-ad tally in %s: an empty ad holder is hidden and not counted', (product) => {
  beforeEach(() => { _setProductForTesting(product); });

  it('an empty holder: hidden, and the tally counts 0, through the page, its moving on and the stop', async () => {
    stop = startFeedAdBlocker('youtube', settings());
    expect(hidden()).toBe(true);
    await vi.advanceTimersByTimeAsync(30000);
    document.dispatchEvent(new Event('yt-navigate-start'));
    stop();
    stop = () => {};
    const t = tally();
    expect(t.hidden).toBe(0);
    expect(t.byFeature['block-ads'] ?? 0).toBe(0);
    expect(t.byFeature['ads-found:youtube'] ?? 0).toBe(0);
  });

  it('a holder that fills with an ad is counted then, once', async () => {
    stop = startFeedAdBlocker('youtube', settings());
    await vi.advanceTimersByTimeAsync(5000);
    expect(tally().byFeature['block-ads'] ?? 0).toBe(0); // not before it holds an ad
    companion().innerHTML = '<div>Raid: the new season</div>';
    await vi.advanceTimersByTimeAsync(2100);
    companion().insertAdjacentHTML('beforeend', '<div>raid.example</div>');
    await vi.advanceTimersByTimeAsync(2100);
    const t = tally();
    expect(t.hidden).toBe(1);
    expect(t.byFeature['block-ads']).toBe(1);
    expect(t.byFeature['ads-found:youtube']).toBe(1);
  });

  it('a holder that fills with a picture and no words is counted once', async () => {
    stop = startFeedAdBlocker('youtube', settings());
    await vi.advanceTimersByTimeAsync(2100);
    expect(tally().byFeature['block-ads'] ?? 0).toBe(0); // not before it holds an ad
    companion().innerHTML = '<a href="https://raid.example/"><img src="https://i.ytimg.example/raid.jpg"></a>';
    await vi.advanceTimersByTimeAsync(2100);
    expect(tally().byFeature['block-ads']).toBe(1);
  });

  it('a picture drawn with no source, its source set later: counted then, once, while the page is still open', async () => {
    stop = startFeedAdBlocker('youtube', settings());
    companion().innerHTML = '<a href="https://raid.example/"><img src=""></a>';
    await vi.advanceTimersByTimeAsync(2100);
    expect(tally().byFeature['block-ads'] ?? 0).toBe(0);
    companion().querySelector('img')!.setAttribute('src', 'https://i.ytimg.example/raid.jpg');
    await vi.advanceTimersByTimeAsync(2100);
    expect(tally().byFeature['block-ads']).toBe(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(tally().byFeature['block-ads']).toBe(1);
  });

  it('a slot that holds its ad when hidden is counted at once, once', async () => {
    companion().innerHTML = '<div>Raid: the new season</div>';
    stop = startFeedAdBlocker('youtube', settings());
    companion().insertAdjacentHTML('beforeend', '<div>raid.example</div>');
    await vi.advanceTimersByTimeAsync(5000);
    const t = tally();
    expect(t.hidden).toBe(1);
    expect(t.byFeature['block-ads']).toBe(1);
    expect(t.byFeature['ads-found:youtube']).toBe(1);
  });
});

// The head's check of a336a043: the popup's number equals the records, never more. A slot is counted and recorded at
// one place, on the slot's own content, never on the card or panel hosting it.
describe.each(['off', 'receipts'] as const)('%s: the count equals the records', (product) => {
  beforeEach(() => { _setProductForTesting(product); });

  const records = (): number => (product === 'receipts' ? ads().length : tally().byFeature['block-ads'] ?? 0);

  it('an empty slot inside a host with unrelated media (an ads panel whose header slot is empty) counts 0', async () => {
    document.getElementById('secondary-inner')!.insertAdjacentHTML('afterbegin', `
      <ytd-engagement-panel-section-list-renderer id="panel" target-id="engagement-panel-ads">
        <div id="header"><panel-ad-header-image-lockup-view-model id="hdr"></panel-ad-header-image-lockup-view-model></div>
        <div id="content"><img src="https://i.ytimg.example/chapter.jpg"><span>Chapters</span></div>
      </ytd-engagement-panel-section-list-renderer>`);
    stop = startFeedAdBlocker('youtube', settings());
    await vi.advanceTimersByTimeAsync(30000);
    stop();
    stop = () => {};
    expect(tally().byFeature['block-ads'] ?? 0).toBe(0);
    expect(tally().byFeature['ads-found:youtube'] ?? 0).toBe(0);
    if (product === 'receipts') expect(ads()).toHaveLength(0);
  });

  it('nested: an in-feed layout hidden first, then its ad slot arriving around it, counts 1', async () => {
    document.body.innerHTML = '<ytd-search><div id="section"><ytd-in-feed-ad-layout-renderer id="layout"><div>Raid: the new season</div><div>raid.example</div></ytd-in-feed-ad-layout-renderer></div></ytd-search>';
    stop = startFeedAdBlocker('youtube', settings());
    await vi.advanceTimersByTimeAsync(100);
    const slotEl = document.createElement('ytd-ad-slot-renderer');
    const layout = document.getElementById('layout')!;
    layout.replaceWith(slotEl);
    slotEl.appendChild(layout);
    await vi.advanceTimersByTimeAsync(4100);
    stop();
    stop = () => {};
    expect(tally().byFeature['block-ads']).toBe(1);
    expect(tally().byFeature['ads-found:youtube']).toBe(1);
    if (product === 'receipts') expect(ads()).toHaveLength(1);
  });

  // One ad, one count, whatever order the page builds its pieces in (the fresh read of cd3602d4, 10 Oct 2026). Each case
  // hides a slot on its own first, then the page puts it inside a container (the node moved, as YouTube's renderers
  // do), and only then does the slot fill.
  const lone = (inner: string) => {
    document.body.innerHTML = `<ytd-watch-flexy><div id="secondary-inner"><div id="related">${inner}</div></div></ytd-watch-flexy>`;
  };
  const wrap = (el: HTMLElement, outer: HTMLElement) => { el.replaceWith(outer); outer.appendChild(el); };
  const fill = (el: HTMLElement) => {
    el.innerHTML = '<div><span>Sponsored</span></div><div>Raid: the new season</div><div>raid.example</div>';
  };
  const labelledCard = () => {
    const card = document.createElement('ytd-compact-video-renderer');
    card.innerHTML = '<div><span>Sponsored</span></div><div>Raid: the new season</div>';
    return card;
  };

  it('an empty slot hidden first, a named holder put around it, the slot filling later: counts 1', async () => {
    lone('<ytd-companion-slot-renderer id="inner"></ytd-companion-slot-renderer>');
    stop = startFeedAdBlocker('youtube', settings());
    await vi.advanceTimersByTimeAsync(100);
    const inner = document.getElementById('inner')!;
    wrap(inner, document.createElement('ytd-player-legacy-desktop-watch-ads-renderer'));
    await vi.advanceTimersByTimeAsync(2100);
    fill(inner);
    await vi.advanceTimersByTimeAsync(4100);
    stop();
    stop = () => {};
    expect(tally().byFeature['block-ads']).toBe(1);
    expect(tally().byFeature['ads-found:youtube']).toBe(1);
    expect(records()).toBe(1);
  });

  it('an empty slot hidden first, a card judged by its label put around it, the slot filling later: counts 1', async () => {
    lone('<ytd-companion-slot-renderer id="inner"></ytd-companion-slot-renderer>');
    stop = startFeedAdBlocker('youtube', settings());
    await vi.advanceTimersByTimeAsync(100);
    const inner = document.getElementById('inner')!;
    wrap(inner, labelledCard());
    await vi.advanceTimersByTimeAsync(2100);
    fill(inner);
    await vi.advanceTimersByTimeAsync(4100);
    stop();
    stop = () => {};
    expect(tally().byFeature['block-ads']).toBe(1);
    expect(tally().byFeature['ads-found:youtube']).toBe(1);
    expect(records()).toBe(1);
  });

  it('a slot with its words hidden first, a card judged by its label put around it: counts 1', async () => {
    lone('<ytd-companion-slot-renderer id="inner"><div>Raid: the new season</div><div>raid.example</div></ytd-companion-slot-renderer>');
    stop = startFeedAdBlocker('youtube', settings());
    await vi.advanceTimersByTimeAsync(100);
    wrap(document.getElementById('inner')!, labelledCard());
    await vi.advanceTimersByTimeAsync(4100);
    stop();
    stop = () => {};
    expect(tally().byFeature['block-ads']).toBe(1);
    expect(tally().byFeature['ads-found:youtube']).toBe(1);
    expect(records()).toBe(1);
  });

  it('an empty slot hidden first, a card judged by its label put around it, the slot never filling: counts what the card showed', async () => {
    lone('<ytd-companion-slot-renderer id="inner"></ytd-companion-slot-renderer>');
    stop = startFeedAdBlocker('youtube', settings());
    await vi.advanceTimersByTimeAsync(100);
    wrap(document.getElementById('inner')!, labelledCard());
    await vi.advanceTimersByTimeAsync(4100);
    stop();
    stop = () => {};
    // Off judges the card by its label: one ad. Feedprint does not read labels in this rule (its pipeline reads the
    // labelled posts), and the slot never showed an ad: none.
    const want = product === 'off' ? 1 : 0;
    expect(tally().byFeature['block-ads'] ?? 0).toBe(want);
    expect(tally().byFeature['ads-found:youtube'] ?? 0).toBe(want);
    expect(records()).toBe(want);
  });

  it('counted the moment the slot shows an ad, before the words settle; the count is in the batch when the tab goes (the batch\'s own one-second write is mark-hidden.ts\'s)', async () => {
    document.body.innerHTML = '<ytd-watch-flexy><div id="secondary-inner"><ytd-companion-slot-renderer id="inner"></ytd-companion-slot-renderer></div></ytd-watch-flexy>';
    stop = startFeedAdBlocker('youtube', settings());
    await vi.advanceTimersByTimeAsync(100);
    document.getElementById('inner')!.innerHTML = '<div>Raid: the new season</div><div>raid.example</div>';
    await vi.advanceTimersByTimeAsync(100);
    expect(tally().byFeature['block-ads']).toBe(1); // before the 2 s settle
    if (product === 'receipts') expect(ads()).toHaveLength(0); // the record waits for the words
    window.dispatchEvent(new Event('pagehide'));
    stop();
    stop = () => {};
    expect(tally().byFeature['block-ads']).toBe(1);
    expect(records()).toBe(1);
  });

  it('a slot that showed an ad and was emptied before its words settled: counted once and recorded once', async () => {
    document.body.innerHTML = '<ytd-watch-flexy><div id="secondary-inner"><ytd-companion-slot-renderer id="inner"></ytd-companion-slot-renderer></div></ytd-watch-flexy>';
    stop = startFeedAdBlocker('youtube', settings());
    await vi.advanceTimersByTimeAsync(100);
    const inner = document.getElementById('inner')!;
    inner.innerHTML = '<img src="https://i.ytimg.example/ad.jpg">';
    await vi.advanceTimersByTimeAsync(500);
    inner.innerHTML = '';
    await vi.advanceTimersByTimeAsync(4100);
    stop();
    stop = () => {};
    expect(tally().byFeature['block-ads']).toBe(1);
    expect(records()).toBe(1);
  });

  const SHORTS = (video: string) => `<div id="shorts-inner-container"><ytd-reel-video-renderer id="card">${video}<div id="experiment-overlay"><ytd-ad-slot-renderer id="sslot"></ytd-ad-slot-renderer></div></ytd-reel-video-renderer></div>`;

  it.each([['with no source', '<video></video>'], ['with a source', '<video src="https://v.example/short.mp4"></video>']])(
    'a Shorts card whose video is %s and whose ad slot is empty: hidden, counts 0 (the card\'s video is not the ad\'s own)',
    async (_name, video) => {
      document.body.innerHTML = SHORTS(video);
      stop = startFeedAdBlocker('youtube', settings());
      expect(document.getElementById('card')!.getAttribute(FEED_AD_HIDDEN_MARKER)).toBe('true');
      await vi.advanceTimersByTimeAsync(30000);
      stop();
      stop = () => {};
      expect(tally().byFeature['block-ads'] ?? 0).toBe(0);
      expect(records()).toBe(0);
    },
  );

  it('a Shorts card whose ad slot holds the ad\'s own words counts 1', async () => {
    document.body.innerHTML = SHORTS('<video></video>');
    document.getElementById('sslot')!.innerHTML = '<ytd-in-feed-ad-layout-renderer><div>Sponsored</div><div>Raid: the new season</div></ytd-in-feed-ad-layout-renderer>';
    stop = startFeedAdBlocker('youtube', settings());
    await vi.advanceTimersByTimeAsync(5000);
    expect(tally().byFeature['block-ads']).toBe(1);
  });

  it('a host reused for other content while its empty slot waits counts 0', async () => {
    document.body.innerHTML = SHORTS('<video></video>');
    stop = startFeedAdBlocker('youtube', settings());
    await vi.advanceTimersByTimeAsync(500);
    // The site reuses the card for a real Short: the ad slot goes, a title and the video's source come.
    const cardEl = document.getElementById('card')!;
    document.getElementById('sslot')!.remove();
    cardEl.insertAdjacentHTML('beforeend', '<span>A real Short</span>');
    cardEl.querySelector('video')!.setAttribute('src', 'https://v.example/real.mp4');
    await vi.advanceTimersByTimeAsync(2100); // the 2 s pass: the card is shown again, the slot's wait ends
    expect(cardEl.getAttribute(FEED_AD_HIDDEN_MARKER)).toBeNull();
    await vi.advanceTimersByTimeAsync(10000);
    stop();
    stop = () => {};
    expect(tally().byFeature['block-ads'] ?? 0).toBe(0);
    expect(records()).toBe(0);
  });
});

// The head's bound on the take-over (10 Oct 2026): a real post that only holds an ad slot is not hidden or counted for
// it while the slot is empty. Off only: Off judges list cards; Feedprint judges none (its pipeline reads posts), so
// there a slot inside a card is not judged at all.
describe('Off only: a post holding an empty ad slot', () => {
  beforeEach(() => { _setProductForTesting('off'); });

  it('is not hidden and not counted until the slot fills; then hidden at once and counted once', async () => {
    document.body.innerHTML = '<ytd-watch-flexy><div id="related"><ytd-compact-video-renderer id="post"><span>A related video</span><ytd-companion-slot-renderer id="inner"></ytd-companion-slot-renderer></ytd-compact-video-renderer></div></ytd-watch-flexy>';
    stop = startFeedAdBlocker('youtube', settings());
    const post = document.getElementById('post')!;
    await vi.advanceTimersByTimeAsync(4100);
    expect(post.getAttribute(FEED_AD_HIDDEN_MARKER)).toBeNull();
    expect(post.style.display).toBe('');
    expect(tally().byFeature['block-ads'] ?? 0).toBe(0);
    document.getElementById('inner')!.innerHTML = '<div><span>Sponsored</span></div><div>Raid: the new season</div>';
    await vi.advanceTimersByTimeAsync(100);
    expect(post.getAttribute(FEED_AD_HIDDEN_MARKER)).toBe('true');
    await vi.advanceTimersByTimeAsync(4100);
    stop();
    stop = () => {};
    expect(tally().byFeature['block-ads']).toBe(1);
    expect(tally().byFeature['ads-found:youtube']).toBe(1);
  });

  it('a slot already waiting, then a post with words of its own built around it, then a text-only fill: the post is hidden, counted once', async () => {
    document.body.innerHTML = '<ytd-watch-flexy><div id="related"><ytd-companion-slot-renderer id="inner"></ytd-companion-slot-renderer></div></ytd-watch-flexy>';
    stop = startFeedAdBlocker('youtube', settings());
    await vi.advanceTimersByTimeAsync(100);
    const inner = document.getElementById('inner')!;
    const post = document.createElement('ytd-compact-video-renderer');
    post.id = 'post';
    post.innerHTML = '<span>A related video</span>';
    inner.replaceWith(post);
    post.appendChild(inner);
    await vi.advanceTimersByTimeAsync(2100);
    expect(post.getAttribute(FEED_AD_HIDDEN_MARKER)).toBeNull(); // the slot is empty: the post stays
    inner.textContent = 'Raid: the new season raid.example';
    await vi.advanceTimersByTimeAsync(100);
    expect(post.getAttribute(FEED_AD_HIDDEN_MARKER)).toBe('true');
    await vi.advanceTimersByTimeAsync(4100);
    stop();
    stop = () => {};
    expect(tally().byFeature['block-ads']).toBe(1);
    expect(tally().byFeature['ads-found:youtube']).toBe(1);
  });

  it('a card that is only an empty slot\'s holder is hidden at once and counts 0 (master counted it 1)', async () => {
    document.body.innerHTML = '<ytd-watch-flexy><div id="related"><ytd-compact-video-renderer id="post"><ytd-companion-slot-renderer id="inner"></ytd-companion-slot-renderer></ytd-compact-video-renderer></div></ytd-watch-flexy>';
    stop = startFeedAdBlocker('youtube', settings());
    await vi.advanceTimersByTimeAsync(4100);
    expect(document.getElementById('post')!.getAttribute(FEED_AD_HIDDEN_MARKER)).toBe('true'); // read before the stop clears it
    stop();
    stop = () => {};
    expect(tally().byFeature['block-ads'] ?? 0).toBe(0);
  });
});
