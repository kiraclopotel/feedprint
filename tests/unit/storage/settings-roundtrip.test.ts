// Regression — a persisted setting must survive the save → getSettings()
// round-trip.
//
// Found by code review 2026-06-10: `strictLanguage` was added to FWSettings
// + DEFAULTS but NOT to the module-private SETTINGS_KEYS allowlist, so
// chrome.storage.local.get never fetched it and the overlay loop never
// applied it — a parent enabling "strict language" would be silently
// ignored forever (interface + defaults made it invisible to TypeScript).
// This bug-class recurs whenever a persisted field is added; the round-trip
// below fails for any field that saveSettings writes but SETTINGS_KEYS
// doesn't read back.

import { describe, it, expect, beforeEach, vi } from 'vitest';

function installChromeShim(store: Map<string, unknown>): void {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: vi.fn(async (keys?: string | string[] | null) => {
          const out: Record<string, unknown> = {};
          const names = keys == null ? [...store.keys()] : Array.isArray(keys) ? keys : [keys];
          for (const k of names) if (store.has(k)) out[k] = store.get(k);
          return out;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) store.set(k, v);
        }),
        remove: vi.fn(async () => undefined),
      },
      onChanged: { addListener: vi.fn() },
    },
    runtime: { sendMessage: vi.fn(async () => undefined), onMessage: { addListener: vi.fn() } },
  };
}

describe('settings round-trip — persisted fields are read back', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('strictLanguage survives save → fresh getSettings()', async () => {
    const store = new Map<string, unknown>();
    installChromeShim(store);
    const mod1 = await import('../../../src/storage/settings');
    await mod1.saveSettings({ strictLanguage: true });

    // Fresh module realm (new content-script injection / SW wake): no cache.
    vi.resetModules();
    installChromeShim(store);
    const mod2 = await import('../../../src/storage/settings');
    const settings = await mod2.getSettings();
    expect(settings.strictLanguage).toBe(true);
  });

  it('hideUnrewritable survives save → fresh getSettings()', async () => {
    const store = new Map<string, unknown>();
    installChromeShim(store);
    const mod1 = await import('../../../src/storage/settings');
    await mod1.saveSettings({ hideUnrewritable: true });

    vi.resetModules();
    installChromeShim(store);
    const mod2 = await import('../../../src/storage/settings');
    const settings = await mod2.getSettings();
    expect(settings.hideUnrewritable).toBe(true);
  });

  it('mode survives the same round-trip (sentinel for the harness itself)', async () => {
    const store = new Map<string, unknown>();
    installChromeShim(store);
    const mod1 = await import('../../../src/storage/settings');
    await mod1.saveSettings({ mode: 'child' });

    vi.resetModules();
    installChromeShim(store);
    const mod2 = await import('../../../src/storage/settings');
    expect((await mod2.getSettings()).mode).toBe('child');
  });
});
