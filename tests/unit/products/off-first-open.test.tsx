/** @vitest-environment jsdom */
// Off on its first open. A new install reads what the store listing promises (swearing masked;
// slurs, like counts, Reels and Shorts, and ads hidden), and nothing else. An install with any
// choice saved reads exactly as before. And opening the popup changes no stored setting, on a new
// install or on one with settings saved.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { CURRENT_SETTINGS_SCHEMA_VERSION } from '../../../src/storage/settings';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let state: Record<string, unknown> = {};

function installStorage(initial: Record<string, unknown>): void {
  state = structuredClone(initial);
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: (keys: string | string[] | null | undefined) => {
          if (keys === null || keys === undefined) return Promise.resolve(structuredClone(state));
          const out: Record<string, unknown> = {};
          for (const k of Array.isArray(keys) ? keys : [keys]) if (k in state) out[k] = structuredClone(state[k]);
          return Promise.resolve(out);
        },
        set: (obj: Record<string, unknown>) => { Object.assign(state, structuredClone(obj)); return Promise.resolve(); },
        remove: (keys: string | string[]) => {
          for (const k of Array.isArray(keys) ? keys : [keys]) delete state[k];
          return Promise.resolve();
        },
      },
      session: { set: () => Promise.resolve(), get: () => Promise.resolve({}), remove: () => Promise.resolve() },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: { id: 'test', sendMessage: vi.fn(async () => undefined), getManifest: () => ({ version: '1.0.11' }) },
  };
}

/** Fresh modules, so the settings cache and the product choice start clean. */
async function load(product: 'off' | 'receipts') {
  vi.resetModules();
  const { _setProductForTesting } = await import('../../../src/product');
  _setProductForTesting(product);
  const settings = await import('../../../src/storage/settings');
  const presets = await import('../../../src/storage/presets');
  return { ...settings, ...presets };
}

afterEach(() => { document.body.innerHTML = ''; });

describe('what a new Off install reads', () => {
  beforeEach(() => installStorage({}));

  it('the listing set: swearing masked, like counts, Reels and Shorts, and ads hidden, nothing else', async () => {
    const m = await load('off');
    const s = await m.getSettings();
    expect(s.strictLanguage).toBe(true);
    expect(s.features).toEqual(m.offStartPreset());
    const on = Object.entries(s.features).filter(([, v]) => v.enabled).map(([k]) => k).sort();
    // The rest of what is on is the plumbing every preset carries: the empty own-rules list and
    // the recorder-only reading switches, which Off does not have.
    expect(on).toEqual(['block-ads', 'block-reels', 'comments-to-analyze-per-video', 'hide-engagement-metrics',
      'parent-blocklist', 'reframe-rewrites', 'rewritten-comments-first', 'show-reframe-markers'].sort());
  });

  it('the recorder keeps its own default', async () => {
    const m = await load('receipts');
    const s = await m.getSettings();
    expect(s.mode).toBe('teen');
    expect(s.strictLanguage).toBe(false);
    expect(s.features).toEqual(m.teenPreset());
  });

  it('the first switch flipped stores the start set with it, so nothing else moves', async () => {
    const m = await load('off');
    await m.updateFeature('strip-emojis', cur => ({ ...cur, enabled: true }));
    expect(state.mode).toBe('adult');
    expect(state.strictLanguage).toBe(true);
    expect(state.features).toEqual({ ...m.offStartPreset(), 'strip-emojis': { enabled: true } });
  });

  it('turning swearing off first keeps the rest of the start set', async () => {
    const m = await load('off');
    await m.saveSettings({ strictLanguage: false });
    expect(state.strictLanguage).toBe(false);
    expect(state.features).toEqual(m.offStartPreset());
  });

  it('a language pick is not a choice about what is hidden, and stores nothing else', async () => {
    const m = await load('off');
    await m.saveSettings({ uiLanguage: 'ro' });
    expect(Object.keys(state)).toEqual(['uiLanguage']);
  });
});

describe('an Off install with a choice saved reads exactly as before', () => {
  it('a saved grid with no mode stays Teen-based, swearing unmasked', async () => {
    installStorage({ features: { 'block-ads': { enabled: false } } });
    const m = await load('off');
    const s = await m.getSettings();
    expect(s.mode).toBe('teen');
    expect(s.strictLanguage).toBe(false);
    expect(s.features['block-ads']).toEqual({ enabled: false });
    expect(s.features['hide-engagement-metrics']).toEqual(m.teenPreset()['hide-engagement-metrics']);
  });

  it('a saved swearing choice alone keeps Teen for the rest', async () => {
    installStorage({ strictLanguage: false });
    const m = await load('off');
    const s = await m.getSettings();
    expect(s.mode).toBe('teen');
    expect(s.features).toEqual(m.teenPreset());
  });

  it('a flip on such an install writes only the grid', async () => {
    installStorage({ mode: 'child' });
    const m = await load('off');
    await m.updateFeature('block-ads', cur => ({ ...cur, enabled: false }));
    expect(Object.keys(state).sort()).toEqual(['features', 'mode']);
    expect(state.mode).toBe('child');
    expect(state.features).toEqual({ ...m.childPreset(), 'block-ads': { enabled: false } });
  });
});

// Keys a popup open writes today and always has, none of them a setting: the day and month
// counters every settings read rolls over, and the version the update notice last saw.
const BOOKKEEPING = new Set([
  'lastResetDate', 'lastResetMonth', 'totalChecksToday', 'totalNeutralizedToday', 'totalTokensToday',
  'estimatedCostToday', 'metricsHiddenToday', 'totalChecksThisMonth', 'totalTokensThisMonth', 'fw_seen_version',
]);

async function openPopup(): Promise<void> {
  await load('off');
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => { await import('../../../src/products/off/popup/OffPopup'); });
  for (let i = 0; i < 10 && !document.querySelector('.off-status'); i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
  }
  expect(document.querySelector('.off-status'), 'the popup opened to its first screen').not.toBeNull();
}

function changedSettings(before: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(state)]);
  return [...keys].filter(k => !BOOKKEEPING.has(k) && JSON.stringify(before[k]) !== JSON.stringify(state[k]));
}

describe('opening the popup changes no stored setting', () => {
  it('on a new install', async () => {
    installStorage({});
    await openPopup();
    expect(changedSettings({})).toEqual([]);
    expect(document.querySelector('.off-status')?.textContent).toMatch(/masking swearing/i);
  });

  it('on an install with settings saved', async () => {
    const saved = {
      settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION, mode: 'teen', strictLanguage: false, uiLanguage: 'en',
      features: { 'block-ads': { enabled: true }, 'strip-emojis': { enabled: true } },
      presets: { appliedAt: '2026-09-20T10:00:00.000Z', appliedPreset: 'teen' },
      pickedBlocks: [], hiddenByFeature: { 'block-ads': 4 },
    };
    installStorage(saved);
    await openPopup();
    expect(changedSettings(saved)).toEqual([]);
    expect(document.querySelector('.off-status')?.textContent).not.toContain('swearing');
  });
});
