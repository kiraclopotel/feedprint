// @vitest-environment jsdom
//
// The page parts, the break, Block this, the AI-label hide, comment posting and emoji live in Off.
// Receipts runs the ads (and, in its pipeline, the language and the own rules) and no other module of
// the engagement controller, even when an older install stored one of those switches on. With both
// installed on one profile, Receipts stamps the page with what it runs; Off reads the stamp and leaves
// exactly those to it, and keeps running the rest. An older Receipts that names nothing runs every
// switch, so Off stands down whole beside it. Every module the controller starts is replaced by a
// recorder that counts its live copies.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adultPreset } from '../../../../src/storage/presets';
import { CURRENT_SETTINGS_SCHEMA_VERSION, type FWSettings, type FeatureToggles } from '../../../../src/storage/settings';

const { st, rec } = vi.hoisted(() => {
  const st = { live: {} as Record<string, number> };
  const rec = (name: string) => () => {
    st.live[name] = (st.live[name] ?? 0) + 1;
    let stopped = false;
    return () => { if (!stopped) { stopped = true; st.live[name] -= 1; } };
  };
  return { st, rec };
});

const getSettings = vi.fn<() => Promise<FWSettings>>();
vi.mock('../../../../src/storage/settings', async (io) => ({ ...(await io<object>()), getSettings: () => getSettings() }));
vi.mock('../../../../src/storage/context-guard', () => ({ isContextAlive: () => true }));
vi.mock('../../../../src/content/engagement/picker', async (io) => ({ ...(await io<object>()), startPicker: rec('picker'), startPickedBlocks: rec('pickedBlocks') }));
vi.mock('../../../../src/content/engagement/facebook-engagement', () => ({ startFacebookEngagementControl: rec('platform(facebook)') }));
vi.mock('../../../../src/content/engagement/emoji-stripper', async (io) => ({ ...(await io<object>()), startEmojiStripper: rec('emojiStripper') }));
vi.mock('../../../../src/content/engagement/empty-comment-hide', async (io) => ({ ...(await io<object>()), startEmptyCommentHider: rec('emptyComment') }));
vi.mock('../../../../src/content/engagement/ai-content-blocker', async (io) => ({ ...(await io<object>()), startAiContentBlocker: rec('aiContent') }));
vi.mock('../../../../src/content/engagement/reels-blocker', async (io) => ({ ...(await io<object>()), startReelsBlocker: rec('reels') }));
vi.mock('../../../../src/content/engagement/media-timeout', async (io) => ({ ...(await io<object>()), startMediaTimeout: rec('mediaTimeout') }));
vi.mock('../../../../src/content/engagement/sidebar-ad-blocker', () => ({ startSidebarAdBlocker: rec('sidebarAd') }));
vi.mock('../../../../src/content/engagement/media-only-ad-blocker', () => ({ startMediaOnlyAdBlocker: rec('mediaOnlyAd') }));
vi.mock('../../../../src/content/engagement/feed-ad-blocker', () => ({ startFeedAdBlocker: rec('feedAd') }));
vi.mock('../../../../src/content/engagement/word-filter', async (io) => ({ ...(await io<object>()), startWordFilter: rec('wordFilter') }));
vi.mock('../../../../src/content/engagement/surface-switches', async (io) => ({ ...(await io<object>()), startSurfaceSwitches: rec('surface') }));

import { initEngagementControl } from '../../../../src/content/engagement/controller';
import { RECORDER_RUNS_ATTR, RECEIPTS_RUNS, recorderRuns } from '../../../../src/content/engagement/recorder-runs';
import { RECORDER_STAMP } from '../../../../src/products/off/stand-down';
import { _setProductForTesting } from '../../../../src/product';

/** Every switch on, the page parts and the break among them, and one Block this pick here. */
function everythingOn(): FWSettings {
  const features: FeatureToggles = adultPreset();
  for (const id of Object.keys(features) as (keyof FeatureToggles)[]) features[id] = { ...features[id], enabled: true };
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION, mode: 'adult', strictLanguage: true, parentPin: '', locale: 'en',
    outputLanguage: 'auto', uiLanguage: 'auto', features, presets: { appliedAt: '', appliedPreset: 'adult' }, dashboardTheme: 'dark',
    pickedBlocks: [{ id: 'p1', platform: 'facebook', selector: 'div.x', label: 'a box', createdAt: '2026-10-01T00:00:00Z' }],
  } as unknown as FWSettings;
}

type Listener = (changes: Record<string, chrome.storage.StorageChange>, area?: string) => void;
let listeners: Listener[];
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise<void>((r) => setTimeout(r, 0)); };
const live = (): string[] => Object.entries(st.live).filter(([, n]) => n > 0).map(([k]) => k).sort();

/** What Off's page parts start as: every module but the ones it leaves to the recorder. */
const OFF_PAGE_PARTS = ['aiContent', 'emojiStripper', 'emptyComment', 'mediaTimeout', 'pickedBlocks', 'picker', 'platform(facebook)', 'reels', 'surface'];
const ADS = ['feedAd', 'mediaOnlyAd', 'sidebarAd'];

beforeEach(() => {
  listeners = []; st.live = {};
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.stubGlobal('chrome', {
    storage: {
      onChanged: { addListener: (l: Listener) => { listeners.push(l); }, removeListener: (l: Listener) => { listeners = listeners.filter((x) => x !== l); } },
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    },
    runtime: { getManifest: () => ({ version: '2.5.18' }) },
  });
  getSettings.mockImplementation(async () => everythingOn());
  document.documentElement.removeAttribute(RECORDER_STAMP);
  document.documentElement.removeAttribute(RECORDER_RUNS_ATTR);
});
afterEach(() => { _setProductForTesting(null); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Receipts runs the ads and nothing that Off holds', () => {
  it('starts the ad modules alone, with every page-part switch and a pick stored on', async () => {
    _setProductForTesting('receipts');
    const stop = await initEngagementControl('facebook');
    expect(live()).toEqual(['feedAd', 'mediaOnlyAd', 'sidebarAd']);
    // A settings change rebuilds the same set and nothing more.
    for (const l of listeners) l({ features: { newValue: {} } }, 'local');
    await settle();
    expect(live()).toEqual(['feedAd', 'mediaOnlyAd', 'sidebarAd']);
    stop();
    expect(live()).toEqual([]);
  });

  it('leaves a hide Off made on the page in place when its own settings change', async () => {
    _setProductForTesting('receipts');
    const offTag = document.createElement('style');
    offTag.id = 'fw-facebook-metrics-css';
    document.head.appendChild(offTag);
    const offHidden = document.createElement('div');
    offHidden.dataset.fwEngagementBar = 'true';
    offHidden.style.display = 'none';
    document.body.appendChild(offHidden);
    const stop = await initEngagementControl('facebook');
    for (const l of listeners) l({ features: { newValue: {} } }, 'local');
    await settle();
    stop();
    expect(document.getElementById('fw-facebook-metrics-css')).not.toBeNull();
    expect(offHidden.style.display).toBe('none');
    offTag.remove(); offHidden.remove();
  });
});

describe('Off beside Receipts', () => {
  it('reads what the recorder runs from its stamp', () => {
    expect(recorderRuns()).toBeNull();
    document.documentElement.setAttribute(RECORDER_STAMP, '2.5.17');
    expect(recorderRuns()).toBe('all');
    document.documentElement.setAttribute(RECORDER_RUNS_ATTR, RECEIPTS_RUNS.join(' '));
    expect(recorderRuns()).toEqual(new Set(['ads', 'words']));
  });

  it('keeps the page parts, the break, Block this, the AI-label hide, comment posting and emoji, and leaves ads and words to Receipts', async () => {
    _setProductForTesting('off');
    const stop = await initEngagementControl('facebook', { leaveToRecorder: new Set(RECEIPTS_RUNS) });
    expect(live()).toEqual(OFF_PAGE_PARTS);
    for (const l of listeners) l({ features: { newValue: {} } }, 'local');
    await settle();
    expect(live()).toEqual(OFF_PAGE_PARTS);
    stop();
  });

  it('alone, runs every module it has', async () => {
    _setProductForTesting('off');
    const stop = await initEngagementControl('facebook');
    expect(live()).toEqual([...OFF_PAGE_PARTS, ...ADS, 'wordFilter'].sort());
    stop();
  });
});
