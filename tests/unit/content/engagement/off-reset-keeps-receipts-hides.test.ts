// @vitest-environment jsdom
//
// With both extensions on one page, a post can carry a hide from each: Receipts hid it as an ad or as harm,
// and Off hid it for one of its own switches. Both hides live in the same inline style. Off's reset, on a
// settings change, a walk into a conversation or its stop, must take back only its own hide, never Receipts'.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adultPreset } from '../../../../src/storage/presets';
import { CURRENT_SETTINGS_SCHEMA_VERSION, type FWSettings, type FeatureToggles } from '../../../../src/storage/settings';

const rec = vi.hoisted(() => () => () => () => {});

const getSettings = vi.fn<() => Promise<FWSettings>>();
vi.mock('../../../../src/storage/settings', async (io) => ({ ...(await io<object>()), getSettings: () => getSettings() }));
vi.mock('../../../../src/storage/context-guard', () => ({ isContextAlive: () => true }));
vi.mock('../../../../src/content/engagement/picker', async (io) => ({ ...(await io<object>()), startPicker: rec(), startPickedBlocks: rec() }));
vi.mock('../../../../src/content/engagement/facebook-engagement', () => ({ startFacebookEngagementControl: rec() }));
vi.mock('../../../../src/content/engagement/instagram-engagement', () => ({ startInstagramEngagementControl: rec() }));
vi.mock('../../../../src/content/engagement/emoji-stripper', async (io) => ({ ...(await io<object>()), startEmojiStripper: rec() }));
vi.mock('../../../../src/content/engagement/empty-comment-hide', async (io) => ({ ...(await io<object>()), startEmptyCommentHider: rec() }));
vi.mock('../../../../src/content/engagement/ai-content-blocker', async (io) => ({ ...(await io<object>()), startAiContentBlocker: rec() }));
vi.mock('../../../../src/content/engagement/reels-blocker', async (io) => ({ ...(await io<object>()), startReelsBlocker: rec() }));
vi.mock('../../../../src/content/engagement/media-timeout', async (io) => ({ ...(await io<object>()), startMediaTimeout: rec() }));
vi.mock('../../../../src/content/engagement/sidebar-ad-blocker', () => ({ startSidebarAdBlocker: rec() }));
vi.mock('../../../../src/content/engagement/media-only-ad-blocker', () => ({ startMediaOnlyAdBlocker: rec() }));
vi.mock('../../../../src/content/engagement/feed-ad-blocker', () => ({ startFeedAdBlocker: rec() }));
vi.mock('../../../../src/content/engagement/word-filter', async (io) => ({ ...(await io<object>()), startWordFilter: rec() }));
vi.mock('../../../../src/content/engagement/surface-switches', async (io) => ({ ...(await io<object>()), startSurfaceSwitches: rec() }));

import { initEngagementControl } from '../../../../src/content/engagement/controller';
import { RECEIPTS_RUNS } from '../../../../src/content/engagement/recorder-runs';
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
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise<void>((r) => setTimeout(r, 0)); };
const besideReceipts = { leaveToRecorder: new Set(RECEIPTS_RUNS) };

/** A post as both products leave it: Receipts' hide as injector.ts writes it, then Off's marker on top. */
function post(attrs: Record<string, string>, style: Record<string, string>): HTMLElement {
  const el = document.createElement('div');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const [k, v] of Object.entries(style)) el.style.setProperty(k, v, 'important');
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  listeners = [];
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

describe("Off's reset beside Receipts", () => {
  it("keeps an ad Receipts hid when Off takes back its AI-label hide on the same post", async () => {
    const ad = post({ 'data-fw-ad-hidden': 'true', 'data-fw-blocked': 'ai-content', 'data-fw-block-reason': 'ai-content' }, { display: 'none' });
    const stop = await initEngagementControl('facebook', besideReceipts);
    for (const l of listeners) l({ features: { newValue: {} } }, 'local');
    await settle();
    expect(ad.style.getPropertyValue('display')).toBe('none');
    expect(ad.style.getPropertyPriority('display')).toBe('important');
    expect(ad.hasAttribute('data-fw-blocked'), "Off's own marker is gone").toBe(false);
    stop();
    expect(ad.style.getPropertyValue('display'), 'and after Off stops').toBe('none');
  });

  it('keeps an Instagram post Receipts hid by visibility, with its hide mode, when the word filter lets go of it', async () => {
    const harm = post(
      { 'data-fw-hard-hidden': 'true', 'data-fw-hide-mode': 'visibility', 'data-fw-block-reason': 'hard-hide', 'data-fw-word-filter': 'hidden' },
      { visibility: 'hidden' },
    );
    const stop = await initEngagementControl('instagram', besideReceipts);
    stop();
    expect(harm.style.getPropertyValue('visibility')).toBe('hidden');
    expect(harm.getAttribute('data-fw-hide-mode')).toBe('visibility');
    expect(harm.getAttribute('data-fw-block-reason')).toBe('hard-hide');
    expect(harm.hasAttribute('data-fw-word-filter'), "Off's own marker is gone").toBe(false);
  });

  it('leaves a post the person chose to see as Receipts left it', async () => {
    const shown = post({ 'data-fw-hard-hidden': 'true', 'data-fw-user-revealed': 'true', 'data-fw-blocked': 'ai-content' }, {});
    const stop = await initEngagementControl('facebook', besideReceipts);
    stop();
    expect(shown.style.getPropertyValue('display')).toBe('');
  });

  it('still takes back its own hide where Receipts hid nothing', async () => {
    const mine = post({ 'data-fw-blocked': 'ai-content', 'data-fw-block-reason': 'ai-content' }, { display: 'none' });
    const stop = await initEngagementControl('facebook', besideReceipts);
    stop();
    expect(mine.style.getPropertyValue('display')).toBe('');
  });
});
