// @vitest-environment jsdom
//
// Receipts starts the feed ad rule too, so the rule can take the ad slots its pipeline does not read (YouTube
// search and the watch page's right column, named in the rule itself in feed-ad-blocker.ts). The real module runs
// here; only its start is watched.

import { afterEach, describe, expect, it, vi } from 'vitest';

const started = vi.hoisted(() => [] as string[]);
vi.mock('../../../../src/content/engagement/feed-ad-blocker', async (io) => {
  const real = await io<typeof import('../../../../src/content/engagement/feed-ad-blocker')>();
  return {
    ...real,
    startFeedAdBlocker: (platform: Parameters<typeof real.startFeedAdBlocker>[0], settings: Parameters<typeof real.startFeedAdBlocker>[1]) => {
      started.push(platform);
      return real.startFeedAdBlocker(platform, settings);
    },
  };
});
vi.mock('../../../../src/content/engagement/recorder-sink', () => ({ recordBlocked: () => {} }));
vi.mock('../../../../src/storage/context-guard', () => ({ isContextAlive: () => true }));
vi.mock('../../../../src/storage/settings', async (io) => ({
  ...(await io<object>()),
  incrementMetricsHidden: vi.fn(() => Promise.resolve()),
  getSettings: async () => settings(),
}));

import { _setProductForTesting } from '../../../../src/product';
import { initEngagementControl } from '../../../../src/content/engagement/controller';
import { adultPreset } from '../../../../src/storage/presets';
import { CURRENT_SETTINGS_SCHEMA_VERSION, type FWSettings } from '../../../../src/storage/settings';

function settings(): FWSettings {
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION, mode: 'adult', strictLanguage: false, uiLanguage: 'auto',
    features: adultPreset(), presets: { appliedAt: '', appliedPreset: 'adult' },
  } as unknown as FWSettings;
}

afterEach(() => { _setProductForTesting(null); vi.unstubAllGlobals(); started.length = 0; });

describe('Receipts and the feed ad rule', () => {
  it('starts the rule on YouTube, and stops it with the rest', async () => {
    vi.stubGlobal('chrome', {
      storage: { onChanged: { addListener: () => {}, removeListener: () => {} }, local: { get: async () => ({}), set: async () => {} } },
      runtime: { sendMessage: () => Promise.resolve() },
    });
    _setProductForTesting('receipts');
    const stop = await initEngagementControl('youtube');
    expect(started).toEqual(['youtube']);
    stop();
  });
});
