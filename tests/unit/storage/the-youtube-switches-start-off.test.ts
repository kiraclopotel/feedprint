// The two YouTube switches (the home feed and the recommended videos) are off in every preset and in
// Off's start set until the store listing names them. They are additive, so no schema version moves:
// an install saved before they existed reads them as off, seeded from its preset on read, and keeps
// every choice it had.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adultPreset, childPreset, offStartPreset, teenPreset } from '../../../src/storage/presets';
import { ALL_FEATURE_IDS } from '../../../src/storage/settings-shape';

const IDS = ['hide-home-feed', 'hide-recommended-videos'] as const;

describe('the YouTube switches start off', () => {
  it('are switches the settings know', () => {
    for (const id of IDS) expect(ALL_FEATURE_IDS).toContain(id);
  });

  it.each([
    ['child', childPreset], ['teen', teenPreset], ['adult', adultPreset], ['Off start set', offStartPreset],
  ] as const)('are off in the %s preset', (_name, preset) => {
    const p = preset();
    for (const id of IDS) expect(p[id], id).toEqual({ enabled: false });
  });
});

describe('an install saved before the YouTube switches reads them as off', () => {
  beforeEach(() => { vi.resetModules(); });

  it('seeds them off on read without moving the schema version, and keeps every stored choice', async () => {
    const features = adultPreset() as Record<string, unknown>;
    for (const id of IDS) delete features[id];
    features['block-ads'] = { enabled: false };
    features['hide-engagement-metrics'] = { enabled: true };
    const set = vi.fn().mockResolvedValue(undefined);
    const { CURRENT_SETTINGS_SCHEMA_VERSION } = await import('../../../src/storage/settings');
    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: { local: { get: vi.fn().mockResolvedValue({
        mode: 'adult', features, settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
      }), set } },
    };
    const { getSettings, isFeatureEnabled } = await import('../../../src/storage/settings');
    const s = await getSettings();
    for (const id of IDS) {
      expect(s.features[id], id).toEqual({ enabled: false });
      expect(isFeatureEnabled(s, id, 'youtube'), id).toBe(false);
    }
    expect(s.features['block-ads']).toEqual({ enabled: false });
    expect(s.features['hide-engagement-metrics']).toEqual({ enabled: true });
    expect(set.mock.calls.some(([arg]) => (arg as Record<string, unknown>).settingsSchemaVersion !== undefined)).toBe(false);
  });
});
