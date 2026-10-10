// Q81 (wiring W70): the recheck-tab ledger serializes every
// read-modify-write through one promise chain (the inspection-registry
// discipline). Before this, the startup sweep's final write could
// overwrite a concurrently registered tab, orphaning an invisible
// background tab on a social URL that no later sweep would reconcile.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  rememberRecheckTab,
  forgetRecheckTab,
  sweepOrphanRecheckTabs,
} from '../../../src/background/recheck-tab-ledger';

// Session-storage stub with CONTROLLABLE latency so the old interleaving
// (sweep reads -> register writes -> sweep writes stale snapshot) can be
// forced deterministically.
function installSessionStub(): { state: Record<string, unknown>; delayNextGet: (ms: number) => void } {
  const state: Record<string, unknown> = {};
  let nextGetDelay = 0;
  (globalThis as any).chrome = {
    storage: {
      session: {
        get: async (key: string) => {
          const d = nextGetDelay;
          nextGetDelay = 0;
          if (d > 0) await new Promise(r => setTimeout(r, d));
          return key in state ? { [key]: state[key] } : {};
        },
        set: async (obj: Record<string, unknown>) => { Object.assign(state, obj); },
      },
    },
    tabs: { remove: vi.fn(async () => undefined) },
  };
  return { state, delayNextGet: (ms) => { nextGetDelay = ms; } };
}

beforeEach(() => {
  vi.useRealTimers();
});

describe('Q81 — ledger operations are serialized', () => {
  it('a register racing the sweep is never overwritten by the sweep write', async () => {
    const { state, delayNextGet } = installSessionStub();
    // Seed one expired orphan so the sweep has work and writes back.
    state.fw_recheck_tabs = { '111': Date.now() - 60_000 };

    // Force the sweep's read to be slow; fire the register immediately
    // after. Under the old unserialized code the register would complete
    // inside the sweep's read-write window and be clobbered.
    delayNextGet(40);
    const sweep = sweepOrphanRecheckTabs(Date.now());
    const register = rememberRecheckTab(222, Date.now() + 120_000);
    await Promise.all([sweep, register]);

    const ledger = state.fw_recheck_tabs as Record<string, number>;
    expect(ledger['222']).toBeDefined(); // the registered tab survived
    expect(ledger['111']).toBeUndefined(); // the orphan was closed
  });

  it('register + forget in flight together resolve to an empty ledger', async () => {
    const { state } = installSessionStub();
    await Promise.all([
      rememberRecheckTab(7, Date.now() + 1000).then(() => forgetRecheckTab(7)),
      rememberRecheckTab(8, Date.now() + 1000).then(() => forgetRecheckTab(8)),
    ]);
    const ledger = (state.fw_recheck_tabs ?? {}) as Record<string, number>;
    expect(Object.keys(ledger)).toEqual([]);
  });
});
