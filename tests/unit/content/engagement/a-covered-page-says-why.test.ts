// @vitest-environment jsdom
//
// A site on break, a site in quiet hours and a blocked Shorts or Reels page are covered whole. Each cover
// carries one line saying why, in the person's language; a plain black page reads as a site that failed.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startMediaTimeout, MEDIA_TIMEOUT_OVERLAY_ID } from '../../../../src/content/engagement/media-timeout';
import { startReelsBlocker, REELS_COVER_NOTE_ID } from '../../../../src/content/engagement/reels-blocker';
import { COVER_STRINGS } from '../../../../src/i18n/cover-strings';
import { UI_LANGUAGES } from '../../../../src/i18n';
import type { FWSettings } from '../../../../src/storage/settings';
import { teenPreset } from '../../../../src/storage/presets';

const settingsWith = (on: 'media-timeout' | 'block-reels', uiLanguage = 'en', value?: unknown): FWSettings => {
  const features = teenPreset();
  for (const key of Object.keys(features)) features[key as keyof typeof features].enabled = false;
  features[on] = { enabled: on === 'block-reels' || value === undefined, value };
  return { mode: 'teen', strictLanguage: false, uiLanguage, features } as unknown as FWSettings;
};
const overlayLine = () => document.getElementById(MEDIA_TIMEOUT_OVERLAY_ID)?.textContent ?? null;
const noteLine = () => document.getElementById(REELS_COVER_NOTE_ID)?.textContent ?? null;

let stop: (() => void) | null = null;
beforeEach(() => {
  document.body.replaceChildren();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.stubGlobal('chrome', { runtime: { id: 'fw-test', sendMessage: vi.fn(() => Promise.resolve()) } });
});
afterEach(() => {
  stop?.(); stop = null;
  history.replaceState({}, '', '/');
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the cover says why', () => {
  it('a site on break', () => {
    stop = startMediaTimeout('youtube', settingsWith('media-timeout'));
    expect(overlayLine()).toBe('YouTube is on break. Off keeps it closed until you turn the break off.');
    stop(); stop = null;
    expect(overlayLine()).toBeNull();
  });

  it('a site in quiet hours', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date(2026, 9, 9, 2, 17));
    const everyNight = { schedule: [{ days: [0, 1, 2, 3, 4, 5, 6], startMin: 22 * 60, endMin: 7 * 60 }] };
    stop = startMediaTimeout('youtube', settingsWith('media-timeout', 'en', everyNight));
    expect(overlayLine()).toBe('Quiet hours: Off keeps YouTube closed until they end.');
  });

  it('a blocked Shorts page, and the line goes when the person leaves it', () => {
    history.replaceState({}, '', '/shorts/some-id');
    document.body.appendChild(document.createElement('ytd-shorts'));
    stop = startReelsBlocker('youtube', settingsWith('block-reels'));
    expect(noteLine()).toBe('Off blocks Shorts on this page.');
    expect(document.getElementById(REELS_COVER_NOTE_ID)?.parentElement, 'outside the body the block may hide').toBe(document.documentElement);
    stop(); stop = null;
    expect(noteLine()).toBeNull();
  });

  it('in each language the person chose', () => {
    for (const lang of UI_LANGUAGES) {
      stop = startMediaTimeout('instagram', settingsWith('media-timeout', lang));
      expect(overlayLine()).toBe(COVER_STRINGS[lang].onBreak('Instagram'));
      stop(); stop = null;
    }
    expect(COVER_STRINGS.ro.onBreak('YouTube')).toBe('YouTube e pe pauză. Off îl ține închis până oprești pauza.');
  });

  it('every line is one short sentence or two, with no long dash', () => {
    for (const lang of UI_LANGUAGES) {
      const t = COVER_STRINGS[lang];
      for (const line of [t.onBreak('Instagram'), t.quietHours('Instagram'), t.shortVideos('Shorts')]) {
        expect(line.length, line).toBeLessThanOrEqual(90);
        expect(line).not.toMatch(/[–—]/);
      }
    }
  });
});
