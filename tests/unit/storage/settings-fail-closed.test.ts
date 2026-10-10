// D3 (2026-08-04 laydown) — the synthetic fail-closed snapshot must SAY it is
// synthetic. getSettings() fails closed to {mode:'child', child grid} when
// storage cannot be read and no cached snapshot exists; forensic records
// written in that window used to attest a child install was present. The
// `readFailedFallback` flag marks the synthetic snapshot (and ONLY it) so the
// configSnapshot can carry `settingsReadFailed` instead of a false attestation.

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('getSettings fail-closed provenance (D3)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('storage read throws with no cached snapshot: child posture + readFailedFallback', async () => {
    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: {
        local: {
          get: vi.fn(async () => { throw new Error('boom'); }),
          set: vi.fn(async () => undefined),
        },
        onChanged: { addListener: vi.fn() },
      },
    };
    const { getSettings } = await import('../../../src/storage/settings');
    const s = await getSettings();
    expect(s.mode).toBe('child');
    expect(s.readFailedFallback).toBe(true);
  });

  it('a successful read returns real settings with NO fallback flag', async () => {
    const store = new Map<string, unknown>([['mode', 'adult']]);
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
        },
        onChanged: { addListener: vi.fn() },
      },
    };
    const { getSettings } = await import('../../../src/storage/settings');
    const s = await getSettings();
    expect(s.mode).toBe('adult');
    expect(s.readFailedFallback).toBeUndefined();
  });

  it('a later failed read serves the cached REAL snapshot, not the synthetic one', async () => {
    const store = new Map<string, unknown>([['mode', 'adult']]);
    let fail = false;
    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: {
        local: {
          get: vi.fn(async (keys?: string | string[] | null) => {
            if (fail) throw new Error('boom');
            const out: Record<string, unknown> = {};
            const names = keys == null ? [...store.keys()] : Array.isArray(keys) ? keys : [keys];
            for (const k of names) if (store.has(k)) out[k] = store.get(k);
            return out;
          }),
          set: vi.fn(async (items: Record<string, unknown>) => {
            for (const [k, v] of Object.entries(items)) store.set(k, v);
          }),
        },
        onChanged: { addListener: vi.fn() },
      },
    };
    const { getSettings } = await import('../../../src/storage/settings');
    const good = await getSettings();
    expect(good.readFailedFallback).toBeUndefined();
    fail = true;
    // Within the cache TTL the cached snapshot is served either way; the
    // contract under test is only that no synthetic flag ever appears once a
    // real snapshot exists.
    const s = await getSettings();
    expect(s.mode).toBe('adult');
    expect(s.readFailedFallback).toBeUndefined();
  });
});
