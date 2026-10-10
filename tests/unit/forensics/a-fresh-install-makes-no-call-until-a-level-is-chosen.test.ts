// A fresh install makes no outside call until the person has chosen a level.
//
// A new install starts at the Moderate defaults, and the six-hourly time-stamp alarm first fires 15
// minutes after install. Someone who browses a feed for a quarter of an hour before opening the
// popup would already have sent a fingerprint of their record to the time-stamp services, and if
// they then chose Strict, "Strict makes no call" was never true for them. So no level chosen reads
// like Strict for every outward call: the recorder keeps writing locally and the calls start once a
// level is chosen. Only the install event writes "not chosen", so installs that were already running
// before this version keep their calls, whether or not they ever finished the first-run screen
// (installs from before 14 September 2026 can have neither a PIN nor that mark).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { getSettings, saveSettings, noteLevelChosenOnInstall } from '../../../src/storage/settings';
import { levelMakesNoCalls, makesNoOutsideCall } from '../../../src/types/mode';
import { requestVerifiedTimestamps } from '../../../src/forensics/tsa-client';

const HASH = 'ab'.repeat(32);
let store: Map<string, unknown>;
let fetched: string[];

function installChrome(): void {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { id: 'test' },
    permissions: { contains: async () => true },
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
      },
      session: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) },
      onChanged: { addListener: vi.fn() },
    },
  };
}

beforeEach(() => {
  store = new Map();
  fetched = [];
  installChrome();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    fetched.push(String(url));
    return { ok: false, status: 503, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0), text: async () => '' } as unknown as Response;
  }));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

// saveSettings drops the module's cached snapshot, so each test reads the store it set up.
const reset = async (items: Record<string, unknown> = {}) => saveSettings(items);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a fresh install makes no outside call until a level is chosen', () => {
  it('a fresh install (Moderate defaults, no level chosen): a time-stamp round sends nothing and says why', async () => {
    await noteLevelChosenOnInstall('install');
    const s = await getSettings();
    expect(s.mode).toBe('teen');
    expect(makesNoOutsideCall(s)).toBe(true);
    // The screens still call this install Moderate, not Strict.
    expect(levelMakesNoCalls(s)).toBe(false);
    const round = await requestVerifiedTimestamps(HASH);
    expect(round.anchors).toEqual([]);
    expect(round.reasons).toEqual(['no_level_chosen']);
    expect(fetched).toEqual([]);
  });

  it('once a level is chosen, Moderate asks the time-stamp services', async () => {
    await reset({ mode: 'teen', levelChosen: true });
    expect(makesNoOutsideCall(await getSettings())).toBe(false);
    await requestVerifiedTimestamps(HASH);
    expect(fetched.length).toBeGreaterThan(0);
  });

  it('Strict still makes no call once chosen, and names Strict as the reason', async () => {
    await reset({ mode: 'child', levelChosen: true });
    const round = await requestVerifiedTimestamps(HASH);
    expect(round.reasons).toEqual(['strict_makes_no_calls']);
    expect(fetched).toEqual([]);
  });

  it('an install updated from an earlier version keeps its calls, even with setupDone false and no PIN', async () => {
    await reset({ mode: 'adult', setupDone: false });
    await noteLevelChosenOnInstall('update');
    const s = await getSettings();
    expect(s.levelChosen).not.toBe(false);
    expect(makesNoOutsideCall(s)).toBe(false);
    await requestVerifiedTimestamps(HASH);
    expect(fetched.length).toBeGreaterThan(0);
  });

  it('a browser update leaves a fresh install waiting, and choosing a level ends the wait', async () => {
    await noteLevelChosenOnInstall('install');
    await noteLevelChosenOnInstall('chrome_update');
    expect(makesNoOutsideCall(await getSettings())).toBe(true);
    await reset({ levelChosen: true });
    expect(makesNoOutsideCall(await getSettings())).toBe(false);
  });
});
