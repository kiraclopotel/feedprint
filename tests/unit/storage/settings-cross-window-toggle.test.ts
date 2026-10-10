// POP-2 (P0) — cross-window lost update on the feature-toggle grid.
//
// The popup can detach into a persistent second window, so two FW surfaces can
// be open at once, each holding its own in-memory `settings` snapshot. The old
// toggle handlers built `{ ...settings.features, [id]: … }` from that snapshot
// and wrote the WHOLE `features` blob. Because `features` is a single storage
// key, the later write silently reverted whatever the OTHER window had toggled
// — a durable lost update. `updateFeature()` fixes it by merging the one changed
// feature onto a FRESH read of storage.

import { describe, it, expect, beforeEach, vi } from 'vitest';

function installChromeShim(store: Map<string, unknown>) {
  const set = vi.fn(async (items: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(items)) store.set(k, v);
  });
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: vi.fn(async (keys?: string | string[] | null) => {
          const out: Record<string, unknown> = {};
          const names = keys == null ? [...store.keys()] : Array.isArray(keys) ? keys : [keys];
          for (const k of names) if (store.has(k)) out[k] = store.get(k);
          return out;
        }),
        set,
        remove: vi.fn(async () => undefined),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: { sendMessage: vi.fn(async () => undefined), onMessage: { addListener: vi.fn() } },
  };
  return { set };
}

type Feat = Record<string, { enabled: boolean; value?: unknown; perPlatform?: Record<string, { enabled?: boolean }> }>;

const readFeatures = (store: Map<string, unknown>): Feat => store.get('features') as Feat;

describe('cross-window feature toggle (POP-2)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('DOCUMENTS THE BUG: a bare whole-blob write from a stale snapshot clobbers the other window', async () => {
    const store = new Map<string, unknown>([
      ['mode', 'child'],
      ['features', { 'block-reels': { enabled: false }, 'block-ads': { enabled: false } }],
    ]);
    installChromeShim(store);
    const { saveSettings, updateFeature } = await import('../../../src/storage/settings');

    // Window B's stale snapshot, captured BEFORE window A writes.
    const staleFeatures = JSON.parse(JSON.stringify(readFeatures(store)));

    // Window A turns block-reels ON (fresh, correct).
    await updateFeature('block-reels', cur => ({ ...cur, enabled: true }));

    // Window B, still on its stale snapshot, writes the WHOLE blob (old pattern).
    await saveSettings({ features: { ...staleFeatures, 'block-ads': { enabled: true } } });

    // block-reels was silently reverted — the lost update.
    expect(readFeatures(store)['block-reels'].enabled).toBe(false);
    expect(readFeatures(store)['block-ads'].enabled).toBe(true);
  });

  it('updateFeature: two windows toggling DIFFERENT features — both survive', async () => {
    const store = new Map<string, unknown>([
      ['mode', 'child'],
      ['features', { 'block-reels': { enabled: false }, 'block-ads': { enabled: false } }],
    ]);
    installChromeShim(store);
    const { updateFeature } = await import('../../../src/storage/settings');

    // Window B holds a stale snapshot (never re-read) — mirrors the durable race.
    const staleWindowBEnabled = (readFeatures(store)['block-ads'].enabled); // false

    // Window A turns block-reels ON.
    await updateFeature('block-reels', cur => ({ ...cur, enabled: true }));

    // Window B turns block-ads ON, computing its intent from the stale snapshot.
    await updateFeature('block-ads', cur => ({ ...cur, enabled: !staleWindowBEnabled }));

    const final = readFeatures(store);
    expect(final['block-reels'].enabled).toBe(true); // window A survived
    expect(final['block-ads'].enabled).toBe(true);   // window B survived
  });

  it('updateFeature preserves other features and untouched perPlatform overrides', async () => {
    const store = new Map<string, unknown>([
      ['mode', 'child'],
      ['features', {
        'hide-action-buttons': { enabled: true, perPlatform: { tiktok: { enabled: true } } },
        'block-reels': { enabled: false },
      }],
    ]);
    installChromeShim(store);
    const { updateFeature } = await import('../../../src/storage/settings');

    // Flip the instagram override on hide-action-buttons; tiktok must survive.
    await updateFeature('hide-action-buttons', cur => ({
      ...cur,
      perPlatform: { ...(cur.perPlatform ?? {}), instagram: { enabled: true } },
    }));

    const f = readFeatures(store);
    expect(f['hide-action-buttons'].perPlatform?.tiktok?.enabled).toBe(true);
    expect(f['hide-action-buttons'].perPlatform?.instagram?.enabled).toBe(true);
    expect(f['hide-action-buttons'].enabled).toBe(true);
    expect(f['block-reels'].enabled).toBe(false); // other feature untouched
  });

  it('updateFeature ABORTS (never writes) when the storage read fails', async () => {
    // The old catch synthesized a Teen-preset base and persisted it, silently
    // resetting a Child install's whole grid on one failed read. The contract
    // now: a failed read rejects and chrome.storage.local.set is never called.
    const store = new Map<string, unknown>([
      ['mode', 'child'],
      ['features', { 'block-reels': { enabled: true }, 'block-comment-posting': { enabled: true } }],
    ]);
    const { set } = installChromeShim(store);
    const chromeShim = (globalThis as unknown as {
      chrome: { storage: { local: { get: unknown } } };
    }).chrome;
    chromeShim.storage.local.get = vi.fn(async () => {
      throw new Error('Extension context invalidated.');
    });
    const { updateFeature } = await import('../../../src/storage/settings');

    await expect(
      updateFeature('block-reels', cur => ({ ...cur, enabled: false })),
    ).rejects.toThrow();

    expect(set).not.toHaveBeenCalled();
    // The stored grid is untouched: still the Child-strength values.
    const f = readFeatures(store);
    expect(f['block-reels'].enabled).toBe(true);
    expect(f['block-comment-posting'].enabled).toBe(true);
  });
});
