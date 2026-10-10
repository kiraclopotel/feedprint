// PERF-1 (M79#7) — getSettings() TTL fast-path cache.
//
// getSettings() already shipped a module-level `_settingsCache` + a
// chrome.storage.onChanged invalidation listener, but the happy path never
// consulted the cache: every one of the ~47 call sites (13 in
// content/index.ts) paid a full chrome.storage.local.get round-trip + a full
// versioned-migration re-run on EVERY call. This adds the fast-path read,
// mirroring the proven feature-flags.ts TTL cache.
//
// Guarantees under test:
//   1. A second call within the TTL hits NO storage read (spy on storage.get).
//   2. The existing onChanged listener still invalidates the cache cross-realm.
//   3. Migration still runs on a genuine cold read (cache miss).
//   4. Fail-closed is preserved: an invalidated cache + a read error still
//      returns Child mode (strongest protection), never the stale snapshot.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { childPreset } from '../../../src/storage/presets';

type Listener = (changes: Record<string, unknown>, areaName: string) => void;

function installChromeShim(store: Map<string, unknown>) {
  const listeners: Listener[] = [];
  const get = vi.fn(async (keys?: string | string[] | null) => {
    const out: Record<string, unknown> = {};
    const names = keys == null ? [...store.keys()] : Array.isArray(keys) ? keys : [keys];
    for (const k of names) if (store.has(k)) out[k] = store.get(k);
    return out;
  });
  const set = vi.fn(async (items: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(items)) store.set(k, v);
  });
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: { get, set, remove: vi.fn(async () => undefined) },
      onChanged: {
        addListener: (fn: Listener) => listeners.push(fn),
        removeListener: (fn: Listener) => {
          const i = listeners.indexOf(fn);
          if (i >= 0) listeners.splice(i, 1);
        },
      },
    },
    runtime: { sendMessage: vi.fn(async () => undefined), onMessage: { addListener: vi.fn() } },
  };
  // Fire an onChanged event through every registered listener (the settings
  // module registers its own invalidation listener at import time).
  const fireChange = (changes: Record<string, unknown>) => {
    for (const l of [...listeners]) l(changes, 'local');
  };
  return { get, set, fireChange };
}

describe('getSettings — TTL fast-path cache (PERF-1)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('second call within the TTL returns the cache with NO storage read', async () => {
    const store = new Map<string, unknown>([['mode', 'adult']]);
    const { get } = installChromeShim(store);
    const { getSettings } = await import('../../../src/storage/settings');

    const s1 = await getSettings();
    const readsAfterCold = get.mock.calls.length;
    expect(readsAfterCold).toBe(1); // exactly one cold storage read

    const s2 = await getSettings();
    expect(get.mock.calls.length).toBe(readsAfterCold); // no additional read
    expect(s2).toBe(s1); // same cached object reference
    expect(s2.mode).toBe('adult');
  });

  it('onChanged invalidation forces the next call to re-read storage', async () => {
    const store = new Map<string, unknown>([['mode', 'adult']]);
    const { get, fireChange } = installChromeShim(store);
    const { getSettings } = await import('../../../src/storage/settings');

    await getSettings();
    const before = get.mock.calls.length;

    // Simulate a cross-realm write to a SETTINGS_KEYS field.
    store.set('mode', 'child');
    fireChange({ mode: { oldValue: 'adult', newValue: 'child' } });

    const s = await getSettings();
    expect(get.mock.calls.length).toBe(before + 1); // cache dropped → re-read
    expect(s.mode).toBe('child');
  });

  it('runs the versioned migration on a genuine cold read (not bypassed by cache)', async () => {
    // A v2-era install: no `features`, schema version '2'. A cold read must
    // migrate it up to the current version and seed the feature grid.
    const store = new Map<string, unknown>([
      ['settingsSchemaVersion', '2'],
      ['mode', 'child'],
    ]);
    const { set } = installChromeShim(store);
    const { getSettings, CURRENT_SETTINGS_SCHEMA_VERSION } = await import('../../../src/storage/settings');

    const s = await getSettings();
    expect(s.settingsSchemaVersion).toBe(CURRENT_SETTINGS_SCHEMA_VERSION);
    expect(Object.keys(s.features ?? {}).length).toBeGreaterThan(0);
    // Migration persisted the seeded features + bumped version.
    const persistedFeatures = set.mock.calls.some(([arg]) =>
      arg && typeof arg === 'object' && 'features' in (arg as Record<string, unknown>));
    expect(persistedFeatures).toBe(true);
  });

  it('preserves fail-closed: invalidated cache + read error returns Child mode', async () => {
    const store = new Map<string, unknown>([['mode', 'adult']]);
    const { get, fireChange } = installChromeShim(store);
    const { getSettings } = await import('../../../src/storage/settings');

    // Warm the cache with a good read.
    expect((await getSettings()).mode).toBe('adult');

    // Invalidate the cache, then make every storage read fail. Every, not one:
    // since 2026-09-19 this read goes through getLocalWithRetry like every
    // other reader, so a single rejection is absorbed rather than becoming a
    // verdict. The case below holds that, and this one holds what the retry
    // does not change.
    fireChange({ mode: { oldValue: 'adult', newValue: 'adult' } });
    get.mockRejectedValue(new Error('storage IO error'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const s = await getSettings();
    // Fail closed to strongest protection — never the stale cached adult snapshot.
    expect(s.mode).toBe('child');
    expect(s.features).toEqual(childPreset());
    expect(s.readFailedFallback, 'and it says the snapshot is synthetic').toBe(true);
    errSpy.mockRestore();
    get.mockReset();
  });

  it('a single transient rejection is absorbed, not turned into a verdict', async () => {
    // The defect this closes is not a downgrade, it is the opposite: the
    // fail-closed snapshot hardens mode and features and carries DEFAULTS
    // everywhere else, including `parentPin: ''`, which every parent-PIN gate
    // read as "no PIN was ever set". One blip at popup-open time opened them
    // all. The gates now refuse an unconfirmed snapshot, and this is the other
    // half: the blip should not produce one in the first place.
    const store = new Map<string, unknown>([['mode', 'adult'], ['parentPin', 'hash:abc']]);
    const { get, fireChange } = installChromeShim(store);
    const { getSettings } = await import('../../../src/storage/settings');

    expect((await getSettings()).mode).toBe('adult');
    fireChange({ mode: { oldValue: 'adult', newValue: 'adult' } });
    get.mockRejectedValueOnce(new Error('storage IO error'));

    const s = await getSettings();
    expect(s.mode, 'the real settings came back').toBe('adult');
    expect(s.parentPin, 'and the PIN with them').toBe('hash:abc');
    expect(s.readFailedFallback, 'nothing synthetic about it').toBeUndefined();
  });
});
