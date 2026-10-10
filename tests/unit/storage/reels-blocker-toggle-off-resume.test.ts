// @vitest-environment jsdom
//
// Regression — reels-blocker toggle-off media-resume.
//
// Background. When `block-reels` is ON on a /shorts/ or /reels/ surface,
// `blockContainer` hides the platform's main container via display:none AND
// calls `muteAllMediaIn(container)` (pause + muted=true on every <video> /
// <audio> in the subtree). It also installs a per-container MutationObserver
// that re-mutes any late-mounted media.
//
// Before the fix, `resetDOM` (triggered when the parent toggles `block-reels`
// OFF in the popup) removed the data-fw-blocked marker and the inline
// display:none — but never (a) unmuted / resumed the paused media, and never
// (b) disconnected the per-container MO. The page reappeared with a paused,
// muted, frozen video, and any subsequent DOM mutation in the container
// triggered the still-alive MO and re-muted the media. Confirmed live
// on YT /shorts/: had to refresh the page to get the video back.
//
// Fix shape:
//   1. blockContainer registers its per-container MutationObserver in a
//      module-level Map<HTMLElement, MutationObserver>.
//   2. resetDOM iterates the Map, disconnects each observer, AND calls
//      `unmuteAllMediaIn(container)` to set muted=false + call play() on
//      every <video>/<audio> in the subtree, then clears the Map.
//
// Test strategy. Spy on HTMLMediaElement.prototype.{play, pause} so we can
// observe what the blocker calls. Mount a <video> inside the platform's
// reel container, start the blocker (asserts pause+mute fired), then call
// the stop lambda (which runs resetDOM) and assert media was resumed AND
// late-mounted media is no longer muted by a stale observer.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startReelsBlocker } from '../../../src/content/engagement/reels-blocker';
import {
  FWSettings,
  FeatureToggles,
  CURRENT_SETTINGS_SCHEMA_VERSION,
} from '../../../src/storage/settings';
import { teenPreset } from '../../../src/storage/presets';

function makeSettings(features: FeatureToggles): FWSettings {
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    mode: 'teen',
    strictLanguage: false, hideUnrewritable: false, aiAnalysisEnabled: true,
    parentPin: '', dailyCap: 5000, monthlyUsdCapOverride: null, locale: 'en',
    outputLanguage: 'auto', uiLanguage: 'auto',
    totalChecksToday: 0, totalNeutralizedToday: 0, totalTokensToday: 0,
    estimatedCostToday: 0, lastResetDate: '',
    totalChecksThisMonth: 0, totalTokensThisMonth: 0, lastResetMonth: '',
    totalTokensAllTime: 0, totalChecksAllTime: 0,
    totalNeutralizedAllTime: 0, estimatedCostAllTime: 0,
    features,
    presets: { appliedAt: '', appliedPreset: 'teen' },
    dashboardTheme: 'dark',
  };
}

function settingsWithReelsBlockerOn(): FWSettings {
  const features = teenPreset();
  for (const key of Object.keys(features)) {
    features[key as keyof typeof features].enabled = false;
  }
  features['block-reels'].enabled = true;
  return makeSettings(features);
}

const PRISTINE_PUSH = history.pushState.bind(history);
const PRISTINE_REPLACE = history.replaceState.bind(history);
const PRISTINE_PLAY = HTMLMediaElement.prototype.play;
const PRISTINE_PAUSE = HTMLMediaElement.prototype.pause;

let playSpy: ReturnType<typeof vi.fn>;
let pauseSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  document.body.replaceChildren();
  document.head.replaceChildren();
  history.pushState = PRISTINE_PUSH;
  history.replaceState = PRISTINE_REPLACE;

  // jsdom's default <video>.play() returns a rejected promise (no media
  // stack). Stub to resolved so the catch handler doesn't have to fire and
  // call ordering is predictable for assertions.
  playSpy = vi.fn(() => Promise.resolve());
  pauseSpy = vi.fn();
  HTMLMediaElement.prototype.play = playSpy as unknown as HTMLMediaElement['play'];
  HTMLMediaElement.prototype.pause = pauseSpy as unknown as HTMLMediaElement['pause'];

  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => { /* no-op */ }),
        remove: vi.fn(async () => { /* no-op */ }),
      },
      onChanged: { addListener: vi.fn() },
    },
    runtime: {
      sendMessage: vi.fn(() => Promise.resolve()),
    },
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  history.pushState = PRISTINE_PUSH;
  history.replaceState = PRISTINE_REPLACE;
  HTMLMediaElement.prototype.play = PRISTINE_PLAY;
  HTMLMediaElement.prototype.pause = PRISTINE_PAUSE;
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

describe('reels-blocker — toggle-off media resume', () => {
  it('unmutes and resumes <video> playback on YT /shorts/ when block-reels is toggled OFF', () => {
    history.replaceState({}, '', '/shorts/test-id');
    const ytdShorts = document.createElement('ytd-shorts');
    const video = document.createElement('video');
    ytdShorts.appendChild(video);
    document.body.appendChild(ytdShorts);

    const stop = startReelsBlocker('youtube', settingsWithReelsBlockerOn());

    // Block fired: video paused + muted.
    expect(pauseSpy).toHaveBeenCalled();
    expect(video.muted).toBe(true);

    // Clear spy state so the toggle-off assertions test only the resume path.
    playSpy.mockClear();
    pauseSpy.mockClear();

    // Toggle OFF (storage listener invokes the cleanup lambda).
    stop();

    // The fix: resetDOM must unmute and resume the paused media. Without it,
    // the viewer has to refresh the page to get playback back.
    expect(video.muted).toBe(false);
    expect(playSpy).toHaveBeenCalled();
  });

  it('disconnects per-container mute observer so late-mounted media is not re-muted after toggle-off', async () => {
    history.replaceState({}, '', '/shorts/test-id');
    const ytdShorts = document.createElement('ytd-shorts');
    document.body.appendChild(ytdShorts);

    const stop = startReelsBlocker('youtube', settingsWithReelsBlockerOn());
    stop();

    // After toggle-off, reset spy state. Then late-mount a <video> as if the
    // platform's SPA hydrated a new player after the user navigated to a
    // different shorts permalink. With the fix, the per-container MO is
    // disconnected, so no pause() should fire on the late-mounted media.
    pauseSpy.mockClear();

    const lateVideo = document.createElement('video');
    ytdShorts.appendChild(lateVideo);

    // MutationObserver callbacks are microtask-batched. Yield twice so any
    // queued observer callback would have run by the time we assert.
    await Promise.resolve();
    await Promise.resolve();

    expect(pauseSpy).not.toHaveBeenCalled();
    expect(lateVideo.muted).toBe(false);
  });

  it('resumes media on IG /reels/ under the same toggle-off cycle (cross-platform regression)', () => {
    history.replaceState({}, '', '/reels/abc/');
    const main = document.createElement('main');
    main.setAttribute('role', 'main');
    const video = document.createElement('video');
    main.appendChild(video);
    document.body.appendChild(main);

    const stop = startReelsBlocker('instagram', settingsWithReelsBlockerOn());

    expect(video.muted).toBe(true);

    playSpy.mockClear();
    stop();

    expect(video.muted).toBe(false);
    expect(playSpy).toHaveBeenCalled();
  });
});
