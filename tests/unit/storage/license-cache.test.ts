/** @vitest-environment jsdom */
// Bug 1 — a paid/dev license must not silently degrade to FREE on a TRANSIENT
// (non-context) storage read failure. Under the heavy concurrent chrome.storage
// I/O of audio/video analysis a single `chrome.storage.local.get` blip was
// enough to flip a paid/dev user to the free-tier cap (`cap: 'tier-free'`),
// surfaced as a "free-plan / cap" error. getLicense now remembers the last
// successfully-resolved PAID license and returns it when a later read throws,
// so a blip can no longer downgrade the entitlement.
//
// Invariants locked here:
//   - paid read then throwing read → cached paid license (NOT free).
//   - throwing read with no prior paid read → FREE.
//   - successful FREE read clears the cache (user cleared their key → free is
//     authoritative; a later blip must not resurrect the stale paid license).
//   - a DEAD context returns FREE even with a cached paid license (the content
//     script is orphaned; a refresh re-injects a live one).
//
// Each test re-imports the module via vi.resetModules() so the module-level
// cache (and the context-guard flag) start clean — no test-only production seam.

import { describe, it, expect, beforeEach, vi } from 'vitest';

function installStorageStub(): { state: Record<string, unknown> } {
  const state: Record<string, unknown> = {};
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: (keys: string | string[]) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of arr) if (k in state) out[k] = state[k];
          return Promise.resolve(out);
        },
        set: (obj: Record<string, unknown>) => {
          Object.assign(state, obj);
          return Promise.resolve();
        },
        remove: (keys: string | string[]) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          for (const k of arr) delete state[k];
          return Promise.resolve();
        },
      },
    },
  };
  return { state };
}

function makeGetThrow(err: Error) {
  (globalThis as any).chrome.storage.local.get = () => Promise.reject(err);
}

type LicenseModule = typeof import('../../../src/storage/license');

describe('license cache — transient read failure must not degrade a paid user', () => {
  let mod: LicenseModule;
  beforeEach(async () => {
    vi.resetModules();
    installStorageStub();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mod = await import('../../../src/storage/license');
  });

  it('returns the cached paid license when a later read throws (non-context error)', async () => {
    await chrome.storage.local.set({ fw_license_key: 'fw-dev-founder01' });
    expect(await mod.getLicense()).toEqual({ tier: 'dev', secret: 'founder01' }); // primes cache

    makeGetThrow(new Error('storage IO error'));
    // Transient blip: paid entitlement survives instead of collapsing to free.
    expect(await mod.getLicense()).toEqual({ tier: 'dev', secret: 'founder01' });
  });

  it('returns FREE when a read throws and no paid license was ever resolved', async () => {
    makeGetThrow(new Error('storage IO error'));
    expect(await mod.getLicense()).toEqual(mod.FREE_LICENSE);
  });

  it('clears the cache after clearLicense() so a later blip cannot resurrect the paid license', async () => {
    await chrome.storage.local.set({ fw_license_key: 'fw-starter-abc12345' });
    expect((await mod.getLicense()).tier).toBe('starter'); // primes cache

    // Authoritative sign-out is the ONLY sanctioned path to free while a paid
    // license was seen: clearLicense() removes the key AND nulls the cache. (A
    // raw storage removal is not a real product path — setLicense only stores
    // paid keys — and an empty read alone is now treated as a transient blip.)
    await mod.clearLicense();
    expect(await mod.getLicense()).toEqual(mod.FREE_LICENSE); // cache nulled → free

    makeGetThrow(new Error('storage IO error'));
    // Must NOT resurrect the stale starter license on a later blip.
    expect(await mod.getLicense()).toEqual(mod.FREE_LICENSE);
  });

  it('keeps a warm dev license when a later read RESOLVES empty (no throw) and does NOT clear the cache', async () => {
    // Bug 1 PRIMARY hole: a chrome.storage.local.get that RESOLVES without the
    // key (empty record, no rejection) used to return FREE *and* null the
    // lastGoodPaidLicense safety net, disarming it for every later call. The
    // documented net was only consulted in the catch branch, so this
    // non-throwing path bypassed and disabled it. Fixed: a warm cache proves the
    // empty read is a transient blip (real downgrades route through
    // clearLicense), so the paid license survives and the net stays armed.
    await chrome.storage.local.set({ fw_license_key: 'fw-dev-founder01' });
    expect(await mod.getLicense()).toEqual({ tier: 'dev', secret: 'founder01' }); // primes cache

    // Later read resolves an EMPTY record (key missing) without throwing.
    (globalThis as any).chrome.storage.local.get = () => Promise.resolve({});
    expect(await mod.getLicense()).toEqual({ tier: 'dev', secret: 'founder01' }); // still dev, not FREE

    // The safety net is STILL armed: a subsequent throwing read also stays dev
    // (the empty read did not clear the cache).
    makeGetThrow(new Error('storage IO error'));
    expect(await mod.getLicense()).toEqual({ tier: 'dev', secret: 'founder01' });
  });

  it('does not permanently latch FREE on a cold cache: all reads throw, then a good read recovers', async () => {
    // Cold-cache throw branch: on a freshly-injected content script (cache null)
    // under heavy I/O every retry can throw, latching FREE for that call. That
    // must be transient — a later successful read must recover the real tier and
    // arm the cache, not stay stuck free.
    let failing = true;
    (globalThis as any).chrome.storage.local.get = () =>
      failing ? Promise.reject(new Error('storage IO error')) : Promise.resolve({ fw_license_key: 'fw-dev-founder01' });

    // Cache is cold and every retry throws → FREE (transient), but the cache is
    // NOT poisoned to a sticky free state.
    expect(await mod.getLicense()).toEqual(mod.FREE_LICENSE);

    // Storage recovers; the next read resolves the real dev license.
    failing = false;
    expect(await mod.getLicense()).toEqual({ tier: 'dev', secret: 'founder01' });
  });

  it('confirms a cold free realm once: the first read may retry an empty resolve, later reads do not', async () => {
    // getLicense runs per post. A genuine free user (no key ever stored) must not
    // pay the empty-read retry on every call. The FIRST cold read may retry (to
    // recover a cold PAID tab whose first read is transiently empty), but once it
    // resolves authoritatively free the realm is remembered and later reads do a
    // single fast read with no empty-read retry.
    let calls = 0;
    (globalThis as any).chrome.storage.local.get = () => {
      calls++;
      return Promise.resolve({}); // key genuinely absent — always resolves empty
    };

    expect(await mod.getLicense()).toEqual(mod.FREE_LICENSE);
    expect(calls).toBeGreaterThan(1); // first cold read retried the empty resolve

    calls = 0;
    expect(await mod.getLicense()).toEqual(mod.FREE_LICENSE);
    expect(calls).toBe(1); // realm confirmed free → single fast read, no retry
  });

  it('still recovers a cold PAID tab whose first read is empty, then good (retry not yet gated)', async () => {
    // The empty-read retry is gated OFF only after the realm is confirmed free.
    // On a cold PAID tab (never confirmed free) the first getLicense retries an
    // empty resolve and recovers the real tier when the key becomes readable.
    let calls = 0;
    (globalThis as any).chrome.storage.local.get = () => {
      calls++;
      return calls === 1
        ? Promise.resolve({}) // transient empty on the freshly-injected tab
        : Promise.resolve({ fw_license_key: 'fw-dev-founder01' });
    };
    expect(await mod.getLicense()).toEqual({ tier: 'dev', secret: 'founder01' });
    expect(calls).toBe(2); // empty resolve was retried, then recovered
  });

  it('returns FREE on a dead/invalidated context even with a cached paid license', async () => {
    await chrome.storage.local.set({ fw_license_key: 'fw-dev-founder01' });
    expect((await mod.getLicense()).tier).toBe('dev'); // primes cache

    makeGetThrow(new Error('Extension context invalidated'));
    expect(await mod.getLicense()).toEqual(mod.FREE_LICENSE);
  });
});

// STORAGE-LICENCE-WORKER-2: a sign-out in the popup realm must reach every
// running tab. The content realm's warm cache is a safety net for transient
// read blips, so the only way it learns of an authoritative removal in ANOTHER
// realm is chrome.storage.onChanged.
describe('license cache — sign-out in another realm reaches this one', () => {
  let mod: LicenseModule;
  let listeners: Array<(changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void>;
  beforeEach(async () => {
    vi.resetModules();
    installStorageStub();
    listeners = [];
    (globalThis as any).chrome.storage.onChanged = {
      addListener: (fn: (typeof listeners)[number]) => { listeners.push(fn); },
    };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mod = await import('../../../src/storage/license');
  });

  it('a simulated key removal in another realm makes the next getLicense() free even when the read blips', async () => {
    await chrome.storage.local.set({ fw_license_key: 'fw-family-abc12345' });
    expect((await mod.getLicense()).tier).toBe('family'); // warm cache
    expect(listeners).toHaveLength(1);

    // The popup realm removed the key: this realm only sees the change event
    // and, on its next read, an empty resolve (or a blip).
    await chrome.storage.local.remove('fw_license_key');
    listeners[0]({ fw_license_key: { oldValue: 'fw-family-abc12345', newValue: undefined } }, 'local');
    expect(await mod.getLicense()).toEqual(mod.FREE_LICENSE);

    makeGetThrow(new Error('storage IO error'));
    expect(await mod.getLicense()).toEqual(mod.FREE_LICENSE);
  });

  it('a key pasted in another realm warms this realm with the new licence', async () => {
    listeners[0]({ fw_license_key: { newValue: 'fw-extended-zzz99999' } }, 'local');
    makeGetThrow(new Error('storage IO error'));
    expect((await mod.getLicense()).tier).toBe('extended');
  });

  it('setLicense and clearLicense drop both proxy-cap markers', async () => {
    await chrome.storage.local.set({ textCapReached: { cap: 'monthly', periodKey: '2026-08' }, mediaMonthlyCapReached: { month: '2026-08' } });
    await mod.setLicense('fw-starter-abc12345');
    expect(await chrome.storage.local.get(['textCapReached', 'mediaMonthlyCapReached'])).toEqual({});
    await chrome.storage.local.set({ textCapReached: { cap: 'daily', periodKey: '2026-08-23' } });
    await mod.clearLicense();
    expect(await chrome.storage.local.get('textCapReached')).toEqual({});
  });
});
