// @vitest-environment jsdom
//
// Beside a Receipts that names what it runs one family at a time, Off runs every switch Receipts does not
// name, from Off's own settings: the ads where Receipts' Block ads is off, swearing where Receipts stars
// none, and always Off's own list, which only Off knows.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adultPreset } from '../../../../src/storage/presets';
import { CURRENT_SETTINGS_SCHEMA_VERSION, type FWSettings, type FeatureToggles } from '../../../../src/storage/settings';

const started = vi.hoisted(() => [] as string[]);
const rec = vi.hoisted(() => (name: string) => () => { started.push(name); return () => {}; });

const getSettings = vi.fn<() => Promise<FWSettings>>();
vi.mock('../../../../src/storage/settings', async (io) => ({ ...(await io<object>()), getSettings: () => getSettings() }));
vi.mock('../../../../src/storage/context-guard', () => ({ isContextAlive: () => true }));
vi.mock('../../../../src/content/engagement/picker', async (io) => ({ ...(await io<object>()), startPicker: rec('startPicker'), startPickedBlocks: rec('startPickedBlocks') }));
vi.mock('../../../../src/content/engagement/facebook-engagement', () => ({ startFacebookEngagementControl: rec('startFacebookEngagementControl') }));
vi.mock('../../../../src/content/engagement/instagram-engagement', () => ({ startInstagramEngagementControl: rec('startInstagramEngagementControl') }));
vi.mock('../../../../src/content/engagement/emoji-stripper', async (io) => ({ ...(await io<object>()), startEmojiStripper: rec('startEmojiStripper') }));
vi.mock('../../../../src/content/engagement/empty-comment-hide', async (io) => ({ ...(await io<object>()), startEmptyCommentHider: rec('startEmptyCommentHider') }));
vi.mock('../../../../src/content/engagement/ai-content-blocker', async (io) => ({ ...(await io<object>()), startAiContentBlocker: rec('startAiContentBlocker') }));
vi.mock('../../../../src/content/engagement/reels-blocker', async (io) => ({ ...(await io<object>()), startReelsBlocker: rec('startReelsBlocker') }));
vi.mock('../../../../src/content/engagement/media-timeout', async (io) => ({ ...(await io<object>()), startMediaTimeout: rec('startMediaTimeout') }));
vi.mock('../../../../src/content/engagement/sidebar-ad-blocker', () => ({ startSidebarAdBlocker: rec('startSidebarAdBlocker') }));
vi.mock('../../../../src/content/engagement/media-only-ad-blocker', () => ({ startMediaOnlyAdBlocker: rec('startMediaOnlyAdBlocker') }));
const feedAdRan = vi.hoisted(() => ({ n: 0 }));
vi.mock('../../../../src/content/engagement/feed-ad-blocker', () => ({ startFeedAdBlocker: () => { feedAdRan.n += 1; started.push('startFeedAdBlocker'); return () => {}; } }));
const wordFilterRan = vi.hoisted(() => [] as Array<{ strictLanguage: boolean; mode: string; slurs?: boolean }>);
vi.mock('../../../../src/content/engagement/word-filter', async (io) => ({
  ...(await io<object>()),
  startWordFilter: (_p: string, s: { strictLanguage: boolean; mode: string }, r: { slurs?: boolean } = {}) => {
    wordFilterRan.push({ strictLanguage: s.strictLanguage, mode: s.mode, slurs: r.slurs });
    return () => {};
  },
}));
vi.mock('../../../../src/content/engagement/surface-switches', async (io) => ({ ...(await io<object>()), startSurfaceSwitches: rec('startSurfaceSwitches') }));

import { initEngagementControl } from '../../../../src/content/engagement/controller';
import type { RecorderFamily } from '../../../../src/content/engagement/recorder-runs';
import { _setProductForTesting } from '../../../../src/product';

function everythingOn(): FWSettings {
  const features: FeatureToggles = adultPreset();
  for (const id of Object.keys(features) as (keyof FeatureToggles)[]) features[id] = { ...features[id], enabled: true };
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION, mode: 'adult', strictLanguage: true, parentPin: '', locale: 'en',
    outputLanguage: 'auto', uiLanguage: 'auto', features, presets: { appliedAt: '', appliedPreset: 'adult' }, dashboardTheme: 'dark',
  } as unknown as FWSettings;
}

type Listener = (changes: Record<string, chrome.storage.StorageChange>, area?: string) => void;
let listeners: Listener[];
const beside = (...f: RecorderFamily[]) => ({ leaveToRecorder: new Set(f) });

beforeEach(() => {
  listeners = []; wordFilterRan.length = 0; feedAdRan.n = 0; started.length = 0;
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.stubGlobal('chrome', {
    storage: {
      onChanged: { addListener: (l: Listener) => { listeners.push(l); }, removeListener: (l: Listener) => { listeners = listeners.filter((x) => x !== l); } },
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    },
    runtime: { getManifest: () => ({ version: '2.5.18' }) },
  });
  getSettings.mockImplementation(async () => everythingOn());
  _setProductForTesting('off');
});
afterEach(() => { document.body.innerHTML = ''; _setProductForTesting(null); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Off beside a Receipts that names families one by one', () => {
  it('beside a Receipts that takes only the ads, stars swearing and hides slurs itself, short texts included', async () => {
    const stop = await initEngagementControl('facebook', beside('ads'));
    expect(wordFilterRan).toEqual([{ strictLanguage: true, mode: 'adult', slurs: true }]);
    expect(feedAdRan.n).toBe(0);
    stop();
  });

  it("stars swearing itself when Receipts names none, with Off's No swearing on", async () => {
    const stop = await initEngagementControl('facebook', beside('ads', 'slurs'));
    expect(wordFilterRan).toEqual([{ strictLanguage: true, mode: 'adult', slurs: false }]);
    stop();
  });

  it('runs its own list but leaves the starring to Receipts when Receipts names swearing', async () => {
    const stop = await initEngagementControl('facebook', beside('ads', 'slurs', 'swearing'));
    expect(wordFilterRan).toEqual([{ strictLanguage: false, mode: 'adult', slurs: false }]);
    stop();
  });

  it('hides the ads itself where Receipts does not name them', async () => {
    const stop = await initEngagementControl('facebook', beside('slurs'));
    expect(feedAdRan.n).toBe(1);
    stop();
  });

  it('leaves every word rule to a Receipts that names the words whole, as 2.5.18 does', async () => {
    const stop = await initEngagementControl('facebook', beside('ads', 'words'));
    expect(wordFilterRan).toEqual([]);
    expect(feedAdRan.n).toBe(0);
    stop();
  });
});

describe('every switch beside Receipts (TWO-PRODUCTS.md rows 1 to 17)', () => {
  const ads = ['startFeedAdBlocker', 'startMediaOnlyAdBlocker', 'startSidebarAdBlocker'];
  const offOnly = [
    'startAiContentBlocker', 'startEmojiStripper', 'startEmptyCommentHider', 'startFacebookEngagementControl',
    'startMediaTimeout', 'startPickedBlocks', 'startPicker', 'startReelsBlocker', 'startSurfaceSwitches',
  ];

  it('leaves the three ad blockers to Receipts and starts every switch Receipts never runs', async () => {
    const stop = await initEngagementControl('facebook', beside('ads'));
    const ran = new Set(started);
    for (const name of ads) expect(ran.has(name), name).toBe(false);
    for (const name of offOnly) expect(ran.has(name), name).toBe(true);
    expect(wordFilterRan).toHaveLength(1);
    stop();
  });

  it('starts the same switches as alone, ads included, when Receipts names nothing it takes over', async () => {
    const alone = await initEngagementControl('facebook');
    const aloneRan = [...new Set(started)].sort();
    alone();
    started.length = 0;
    const both = await initEngagementControl('facebook', beside());
    expect([...new Set(started)].sort()).toEqual(aloneRan);
    for (const name of [...ads, ...offOnly]) expect(aloneRan, name).toContain(name);
    both();
  });
});

describe('Off alone', () => {
  it('hides slurs itself', async () => {
    const stop = await initEngagementControl('facebook');
    expect(wordFilterRan).toEqual([{ strictLanguage: true, mode: 'adult', slurs: true }]);
    stop();
  });
});
