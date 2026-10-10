// @vitest-environment jsdom
//
// F49 (item 3's gate 5): when one filter's start throws, that filter is skipped ALONE and every other filter stays live under
// the settings listener. Today startPlatformEngagement undoes every module started before the thrower (up to all ten, ads and
// Reels among them) and the page keeps only the picker. Every module the controller starts for X is replaced by a recorder
// that counts its live copies (started and not yet stopped). One module throws on every start. After the page-load start and
// after each of two settings changes, the live set must be every OTHER module once, the thrower absent, the picker live, and
// a settings listener attached so a change reaches the controller. Modelled on run/verifier/f49-probe.test.ts (the verifier's
// probe). Off product: Receipts starts only its three ad modules.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adultPreset } from '../../../../src/storage/presets';
import { CURRENT_SETTINGS_SCHEMA_VERSION, type FWSettings, type FeatureToggles } from '../../../../src/storage/settings';

const { st, rec } = vi.hoisted(() => {
  const st = { live: {} as Record<string, number>, throwAt: '' };
  const rec = (name: string) => () => {
    if (st.throwAt === name) throw new Error(`injected: ${name} start throws`);
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
vi.mock('../../../../src/content/engagement/twitter-engagement', () => ({ startTwitterEngagementControl: rec('platform(x)') }));
vi.mock('../../../../src/content/engagement/emoji-stripper', async (io) => ({ ...(await io<object>()), startEmojiStripper: rec('emojiStripper') }));
vi.mock('../../../../src/content/engagement/empty-comment-hide', async (io) => ({ ...(await io<object>()), startEmptyCommentHider: rec('emptyComment') }));
vi.mock('../../../../src/content/engagement/ai-content-blocker', async (io) => ({ ...(await io<object>()), startAiContentBlocker: rec('aiContent') }));
vi.mock('../../../../src/content/engagement/reels-blocker', async (io) => ({ ...(await io<object>()), startReelsBlocker: rec('reels') }));
vi.mock('../../../../src/content/engagement/media-timeout', async (io) => ({ ...(await io<object>()), startMediaTimeout: rec('mediaTimeout') }));
vi.mock('../../../../src/content/engagement/sidebar-ad-blocker', () => ({ startSidebarAdBlocker: rec('sidebarAd') }));
vi.mock('../../../../src/content/engagement/media-only-ad-blocker', () => ({ startMediaOnlyAdBlocker: rec('mediaOnlyAd') }));
vi.mock('../../../../src/content/engagement/feed-ad-blocker', () => ({ startFeedAdBlocker: rec('feedAd') }));
vi.mock('../../../../src/content/engagement/surface-switches', async (io) => ({ ...(await io<object>()), startSurfaceSwitches: rec('surface') }));
vi.mock('../../../../src/content/engagement/word-filter', async (io) => ({ ...(await io<object>()), startWordFilter: rec('wordFilter') }));

import { initEngagementControl } from '../../../../src/content/engagement/controller';
import { _setProductForTesting } from '../../../../src/product';

/** Every module the controller starts for X in Off, which runs the whole set; the picker is separate. */
const SET_IN_START_ORDER = [
  'sidebarAd', 'mediaOnlyAd', 'feedAd', 'wordFilter', 'emojiStripper', 'emptyComment', 'aiContent', 'reels', 'mediaTimeout', 'pickedBlocks',
  'surface', 'platform(x)',
];
const PICKER = 'picker';

function makeSettings(features: FeatureToggles): FWSettings {
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION, mode: 'adult',
    strictLanguage: false, hideUnrewritable: false, aiAnalysisEnabled: true,
    parentPin: '', dailyCap: 5000, monthlyUsdCapOverride: null, locale: 'en', outputLanguage: 'auto', uiLanguage: 'auto',
    totalChecksToday: 0, totalNeutralizedToday: 0, totalTokensToday: 0, estimatedCostToday: 0, lastResetDate: '',
    totalChecksThisMonth: 0, totalTokensThisMonth: 0, lastResetMonth: '', totalTokensAllTime: 0, totalChecksAllTime: 0,
    totalNeutralizedAllTime: 0, estimatedCostAllTime: 0, features,
    presets: { appliedAt: '', appliedPreset: 'adult' }, dashboardTheme: 'dark',
  } as FWSettings;
}

type Listener = (changes: Record<string, chrome.storage.StorageChange>, area?: string) => void;
let listeners: Listener[];
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise<void>((r) => setTimeout(r, 0)); };

/** What is live right now: module name to its count of live copies, zero entries left out. */
const live = (): Record<string, number> =>
  Object.fromEntries(Object.entries(st.live).filter(([, n]) => n !== 0));

/** The expected live set: each named module exactly once. */
const once = (names: string[]): Record<string, number> => Object.fromEntries(names.map((n) => [n, 1]));

beforeEach(() => {
  _setProductForTesting('off');
  listeners = []; st.live = {}; st.throwAt = '';
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.stubGlobal('chrome', {
    storage: {
      onChanged: { addListener: (l: Listener) => { listeners.push(l); }, removeListener: (l: Listener) => { listeners = listeners.filter((x) => x !== l); } },
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      session: { get: async () => ({}), set: async () => {} },
    },
    runtime: { id: 'test' },
  });
  getSettings.mockReset().mockResolvedValue(makeSettings(adultPreset()));
});
afterEach(() => { _setProductForTesting(null); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** Page-load start, then two settings changes; the live set is checked after each, and again once the page's cleanup has run. */
async function runAndCheck(expected: Record<string, number>): Promise<void> {
  const stop = await initEngagementControl('twitter');
  await settle();
  expect(listeners, 'a settings listener is attached after the page-load start').toHaveLength(1);
  expect(live(), 'live after the page-load start').toEqual(expected);

  for (const n of [1, 2]) {
    expect(listeners, `a settings listener is attached before change ${n}`).toHaveLength(1);
    listeners[0]({ strictLanguage: { newValue: n % 2 === 1 } as chrome.storage.StorageChange }, 'local');
    await settle();
    expect(listeners, `a settings listener is still attached after change ${n}`).toHaveLength(1);
    expect(live(), `live after settings change ${n}`).toEqual(expected);
  }

  stop();
  expect(live(), 'live after the page cleanup ran: every module that started is stopped').toEqual({});
  expect(listeners, 'the settings listener is removed by the page cleanup').toHaveLength(0);
}

describe('F49: a filter whose start throws is skipped alone', () => {
  it('control: nothing throws, so every module of the set and the picker are live once, at load and after two changes', async () => {
    st.throwAt = '';
    await runAndCheck(once([...SET_IN_START_ORDER, PICKER]));
  });

  it('the first module (emoji stripper) throws: every other module and the picker stay live once, at load and after two changes', async () => {
    st.throwAt = 'emojiStripper';
    await runAndCheck(once([...SET_IN_START_ORDER.filter((n) => n !== 'emojiStripper'), PICKER]));
  });

  it('the fourth module (reels) throws: every other module and the picker stay live once, at load and after two changes', async () => {
    st.throwAt = 'reels';
    await runAndCheck(once([...SET_IN_START_ORDER.filter((n) => n !== 'reels'), PICKER]));
  });

  it('the last module (the X platform module) throws: every other module and the picker stay live once, at load and after two changes', async () => {
    st.throwAt = 'platform(x)';
    await runAndCheck(once([...SET_IN_START_ORDER.filter((n) => n !== 'platform(x)'), PICKER]));
  });
});
