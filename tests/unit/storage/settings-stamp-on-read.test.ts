// An install that saved its settings under a build that never stamped the
// schema version (every 2.3.0 install, read on the 2026-09-03 update gate)
// is read as current and stamped once on read, so a later migration has a
// version to key on. A fresh install (nothing stored) is not stamped: there
// is nothing to migrate yet. The stored choices are read untouched either way.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adultPreset } from '../../../src/storage/presets';

function chromeWith(stored: Record<string, unknown>) {
  const set = vi.fn().mockResolvedValue(undefined);
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { local: { get: vi.fn().mockResolvedValue(stored), set } },
  };
  return set;
}

describe('getSettings stamps the schema version on an unstamped install', () => {
  beforeEach(() => { vi.resetModules(); });

  it('writes settingsSchemaVersion once for a stored blob without one, and keeps every stored choice', async () => {
    const features = adultPreset();
    delete (features as Partial<typeof features>)['hide-stories'];
    features['block-ads'] = { enabled: false };
    const set = chromeWith({ mode: 'teen', strictLanguage: true, features });
    const { getSettings, CURRENT_SETTINGS_SCHEMA_VERSION } = await import('../../../src/storage/settings');
    const s = await getSettings();
    expect(s.mode).toBe('teen');
    expect(s.strictLanguage).toBe(true);
    expect(s.features['block-ads']).toEqual({ enabled: false });
    expect(s.features['hide-stories']).toEqual({ enabled: false });
    const stamps = set.mock.calls.filter(([arg]) => (arg as Record<string, unknown>).settingsSchemaVersion !== undefined);
    expect(stamps).toHaveLength(1);
    expect(stamps[0][0]).toEqual({ settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION });
  });

  it('does not stamp a fresh install with nothing stored', async () => {
    const set = chromeWith({});
    const { getSettings } = await import('../../../src/storage/settings');
    await getSettings();
    expect(set.mock.calls.some(([arg]) => (arg as Record<string, unknown>).settingsSchemaVersion !== undefined)).toBe(false);
  });

  it('does not stamp a blob that already carries a version', async () => {
    const set = chromeWith({ mode: 'adult', features: adultPreset(), settingsSchemaVersion: '14' });
    const { getSettings } = await import('../../../src/storage/settings');
    await getSettings();
    expect(set.mock.calls.some(([arg]) => (arg as Record<string, unknown>).settingsSchemaVersion !== undefined)).toBe(false);
  });
});
