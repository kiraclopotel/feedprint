// @vitest-environment jsdom
//
// Feedprint covers the video ad in YouTube's player too (the tester's live run on
// 91ef0a8c: with Feedprint alone, and with both installed, the ad before a video
// was seen and heard, while Feedprint's level screen says "Hides ads" at every
// level). Each ad covered is recorded once, as a feed ad slot is. Off leaves the
// ads family to Feedprint when Feedprint runs it, so one product acts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const recorded = vi.hoisted(() => [] as { blockReason: string; matchedToken: string; platform: string }[]);
vi.mock('../../../../src/content/engagement/recorder-sink', () => ({
  recordBlocked: (p: { blockReason: string; matchedToken: string; platform: string }) => { recorded.push(p); },
}));
vi.mock('../../../../src/storage/settings', async (io) => ({
  ...(await io<object>()),
  incrementMetricsHidden: vi.fn(() => Promise.resolve()),
}));

import { _setProductForTesting } from '../../../../src/product';
import { scanFeedAds, startFeedAdBlocker } from '../../../../src/content/engagement/feed-ad-blocker';
import { adultPreset } from '../../../../src/storage/presets';
import { CURRENT_SETTINGS_SCHEMA_VERSION, type FWSettings } from '../../../../src/storage/settings';

function settings(): FWSettings {
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION, mode: 'adult', strictLanguage: false, uiLanguage: 'auto',
    features: adultPreset(), presets: { appliedAt: '', appliedPreset: 'adult' },
  } as unknown as FWSettings;
}

const PLAYER = `<div id="movie_player" class="html5-video-player">
  <div class="html5-video-container"><video class="html5-main-video"></video></div>
  <div class="ytp-ad-module"><span>Sponsored</span> <a>example.com</a></div>
</div>`;
const player = () => document.getElementById('movie_player')!;
const video = () => player().querySelector('video')!;
const flush = () => new Promise((r) => setTimeout(r, 0));

let stop: () => void = () => {};
beforeEach(() => { recorded.length = 0; document.head.innerHTML = ''; document.body.innerHTML = PLAYER; });
afterEach(() => { stop(); stop = () => {}; _setProductForTesting(null); document.body.innerHTML = ''; });

describe('the video ad in the player, in Feedprint', () => {
  it('is covered and unheard while it runs, and recorded once', async () => {
    _setProductForTesting('receipts');
    stop = startFeedAdBlocker('youtube', settings());
    player().classList.add('ad-showing');
    await flush();
    expect(video().muted).toBe(true);
    expect(document.getElementById('fw-yt-player-ad')).not.toBeNull();
    player().classList.add('ytp-ad-interrupting');
    await flush();
    player().classList.remove('ad-showing');
    await new Promise((r) => setTimeout(r, 1100)); // the ad's end, after the grace for a brief leave
    expect(video().muted).toBe(false);
    const ads = recorded.filter((r) => r.matchedToken === 'player-ad');
    expect(ads).toHaveLength(1);
    expect(ads[0]).toMatchObject({ platform: 'youtube', blockReason: 'ads', caption: 'Sponsored example.com' });
  });

  it('the words are kept apart, as a person reads them, not glued from neighbouring elements', async () => {
    _setProductForTesting('receipts');
    player().querySelector('.ytp-ad-module')!.innerHTML = '<div><div>Sponsored</div></div><div><span>Visit site</span><span>example-app.test</span></div>';
    stop = startFeedAdBlocker('youtube', settings());
    player().classList.add('ad-showing');
    await flush();
    player().classList.remove('ad-showing');
    await new Promise((r) => setTimeout(r, 1100)); // the ad's end, after the grace for a brief leave
    expect(recorded.find((r) => r.matchedToken === 'player-ad')).toMatchObject({ caption: 'Sponsored Visit site example-app.test' });
  });

  it('an ad slot\'s caption leaves out the page\'s buttons', () => {
    _setProductForTesting('receipts');
    document.body.innerHTML = '<ytd-search><ytd-item-section-renderer><ytd-ad-slot-renderer><div>ExampleApp: practise any song</div><button>Visit site</button></ytd-ad-slot-renderer></ytd-item-section-renderer></ytd-search>';
    scanFeedAds(document, 'youtube', 'en', { mode: 'adult' });
    expect(recorded.find((r) => r.matchedToken === 'ad-slot')).toMatchObject({ caption: 'ExampleApp: practise any song' });
  });

  it('an ad slot whose own words sit inside a link-button keeps them; the short button label is still left out', () => {
    _setProductForTesting('receipts');
    document.body.innerHTML = '<ytd-search><ytd-item-section-renderer><ytd-ad-slot-renderer><a role="button" href="https://simplypiano.example/"><div>Learn piano in 10 minutes a day</div><div>simplypiano.example</div></a><button>Visit site</button></ytd-ad-slot-renderer></ytd-item-section-renderer></ytd-search>';
    scanFeedAds(document, 'youtube', 'en', { mode: 'adult' });
    expect(recorded.find((r) => r.matchedToken === 'ad-slot')).toMatchObject({ caption: 'Learn piano in 10 minutes a day simplypiano.example' });
  });

  it('an ad slot\'s words are kept apart too (a search ad)', () => {
    _setProductForTesting('receipts');
    document.body.innerHTML = '<ytd-search><ytd-item-section-renderer><ytd-ad-slot-renderer><div>Sponsored</div><div>https://www.example-app.test/</div></ytd-ad-slot-renderer></ytd-item-section-renderer></ytd-search>';
    scanFeedAds(document, 'youtube', 'en', { mode: 'adult' });
    expect(recorded.find((r) => r.matchedToken === 'ad-slot')).toMatchObject({ caption: 'Sponsored https://www.example-app.test/' });
  });

  it('with Feedprint\'s Block ads off, no cover starts and nothing is recorded', async () => {
    _setProductForTesting('receipts');
    const off = settings();
    off.features = { ...off.features, 'block-ads': { enabled: false } } as FWSettings['features'];
    stop = startFeedAdBlocker('youtube', off);
    player().classList.add('ad-showing');
    await flush();
    expect(video().muted).toBe(false);
    expect(document.getElementById('fw-yt-player-ad')).toBeNull();
    expect(player().hasAttribute('data-fw-player-ad')).toBe(false);
    expect(recorded).toHaveLength(0);
  });

  it('in Off it is covered and nothing is recorded', async () => {
    _setProductForTesting('off');
    stop = startFeedAdBlocker('youtube', settings());
    player().classList.add('ad-showing');
    await flush();
    expect(video().muted).toBe(true);
    expect(recorded).toHaveLength(0);
  });
});
