// @vitest-environment jsdom
//
// When Receipts is updated or switched off under an open tab, its stamp leaves and Off, seeing no stamp, takes the
// ads back, so Receipts' own ad filters must stop too, or both act on the same ad. This goes through
// initEngagementControl: the controller hands its stop to the stamp for Receipts only. The filters start after an
// await, and a settings change restarts them after another, so Receipts can go in between; then the stop still
// holds. A stamp written after the end leaves at once.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FWSettings, FeatureToggles } from '../../../../src/storage/settings';
import { CURRENT_SETTINGS_SCHEMA_VERSION } from '../../../../src/storage/settings';
import { adultPreset } from '../../../../src/storage/presets';

const { st, rec, guard } = vi.hoisted(() => {
  const st = { live: {} as Record<string, number>, stopCalls: {} as Record<string, number> };
  const rec = (name: string) => () => {
    st.live[name] = (st.live[name] ?? 0) + 1;
    let stopped = false;
    return () => {
      st.stopCalls[name] = (st.stopCalls[name] ?? 0) + 1;
      if (!stopped) { stopped = true; st.live[name] -= 1; }
    };
  };
  const ends: Array<() => void> = [];
  const guard = {
    dead: false,
    isContextAlive: () => !guard.dead,
    onContextInvalidated: (l: () => void) => { if (guard.dead) l(); else ends.push(l); },
    markContextInvalidated: () => { guard.dead = true; for (const l of ends.splice(0)) l(); },
  };
  return { st, rec, guard };
});

const getSettings = vi.fn<() => Promise<FWSettings>>();
vi.mock('../../../../src/storage/settings', async (io) => ({ ...(await io<object>()), getSettings: () => getSettings() }));
vi.mock('../../../../src/storage/context-guard', () => guard);
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

function settings(): FWSettings {
  const features: FeatureToggles = adultPreset();
  for (const id of Object.keys(features) as (keyof FeatureToggles)[]) features[id] = { ...features[id], enabled: true };
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION, mode: 'adult', strictLanguage: false, uiLanguage: 'auto',
    features, presets: { appliedAt: '', appliedPreset: 'adult' },
  } as unknown as FWSettings;
}

type Listener = (changes: Record<string, unknown>, area?: string) => void;
let listeners: Listener[];
const live = (): string[] => Object.entries(st.live).filter(([, n]) => n > 0).map(([k]) => k).sort();
const root = document.documentElement;

let controller: typeof import('../../../../src/content/engagement/controller');
let runs: typeof import('../../../../src/content/engagement/recorder-runs');
let product: typeof import('../../../../src/product');

beforeEach(async () => {
  vi.resetModules();
  st.live = {};
  st.stopCalls = {};
  guard.dead = false;
  listeners = [];
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.stubGlobal('chrome', {
    storage: {
      onChanged: { addListener: (l: Listener) => { listeners.push(l); }, removeListener: (l: Listener) => { listeners = listeners.filter((x) => x !== l); } },
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    },
  });
  getSettings.mockImplementation(async () => settings());
  controller = await import('../../../../src/content/engagement/controller');
  runs = await import('../../../../src/content/engagement/recorder-runs');
  product = await import('../../../../src/product');
  root.removeAttribute('data-fw-recorder');
  root.removeAttribute(runs.RECORDER_RUNS_ATTR);
});
afterEach(() => { product._setProductForTesting(null); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const stamp = () => runs.keepRecorderStamp('facebook', settings(), async () => settings(), '2.5.19');

describe("Receipts' filters when Receipts goes away", () => {
  it('stop with its stamp', async () => {
    product._setProductForTesting('receipts');
    stamp();
    await controller.initEngagementControl('facebook');
    expect(live()).toEqual(['feedAd', 'mediaOnlyAd', 'sidebarAd']);
    guard.markContextInvalidated();
    expect(runs.recorderRuns()).toBeNull();
    expect(live()).toEqual([]);
  });

  it('stop as soon as their start finishes, when Receipts went while it awaited', async () => {
    product._setProductForTesting('receipts');
    stamp();
    let settle!: (s: FWSettings) => void;
    getSettings.mockImplementation(() => new Promise<FWSettings>((r) => { settle = r; }));
    const started = controller.initEngagementControl('facebook');
    guard.markContextInvalidated();
    settle(settings());
    await started;
    expect(live()).toEqual([]);
  });

  it('a normal stop is not run again when Receipts goes later', async () => {
    product._setProductForTesting('receipts');
    stamp();
    const stop = await controller.initEngagementControl('facebook');
    stop();
    expect(live()).toEqual([]);
    guard.markContextInvalidated();
    expect(st.stopCalls.feedAd, 'stopped once, by the normal stop').toBe(1);
  });

  it('a settings change still reading when Receipts goes starts nothing after the stop', async () => {
    product._setProductForTesting('receipts');
    stamp();
    await controller.initEngagementControl('facebook');
    let settle!: (s: FWSettings) => void;
    getSettings.mockImplementation(() => new Promise<FWSettings>((r) => { settle = r; }));
    for (const l of [...listeners]) l({ features: { newValue: settings().features } }, 'local');
    guard.markContextInvalidated();
    expect(live()).toEqual([]);
    settle(settings());
    for (let i = 0; i < 4; i++) await new Promise<void>((r) => setTimeout(r, 0));
    expect(live()).toEqual([]);
  });

  it("Off's filters are not stopped: the hand-over is Receipts' alone", async () => {
    product._setProductForTesting('off');
    stamp();
    const stop = await controller.initEngagementControl('facebook');
    const before = live();
    expect(before.length).toBeGreaterThan(3);
    guard.markContextInvalidated();
    expect(live()).toEqual(before);
    stop();
  });

  it('a stamp written after the end leaves at once, and the filters do not start', async () => {
    product._setProductForTesting('receipts');
    guard.markContextInvalidated();
    stamp();
    await controller.initEngagementControl('facebook');
    expect(runs.recorderRuns()).toBeNull();
    expect(live()).toEqual([]);
  });
});
