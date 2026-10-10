// M91 — durable recheck-tab bookkeeping (recheck-tab-ledger.ts).
//
// The defect class: an MV3 worker hard-killed between tabs.create and its
// finally leaks an invisible background tab with no reconciliation. These
// tests lock the ledger contract: tracked before waiting, forgotten on the
// happy path, and orphans from a dead instance closed (expired → now;
// live-window → on a scheduled timer that re-checks the ledger first).

import { describe, it, expect, beforeEach } from 'vitest';
import {
  rememberRecheckTab,
  forgetRecheckTab,
  sweepOrphanRecheckTabs,
} from '../../../src/background/recheck-tab-ledger';

type Store = Record<string, unknown>;

let sessionStore: Store;
let removedTabs: number[];
let removeThrows: Set<number>;

beforeEach(() => {
  sessionStore = {};
  removedTabs = [];
  removeThrows = new Set();
  (globalThis as any).chrome = {
    storage: {
      session: {
        get: (key: string) => Promise.resolve(key in sessionStore ? { [key]: sessionStore[key] } : {}),
        set: (obj: Store) => { Object.assign(sessionStore, obj); return Promise.resolve(); },
      },
    },
    tabs: {
      remove: (tabId: number) => {
        if (removeThrows.has(tabId)) return Promise.reject(new Error('No tab with id'));
        removedTabs.push(tabId);
        return Promise.resolve();
      },
    },
  };
});

const ledger = () => (sessionStore['fw_recheck_tabs'] ?? {}) as Record<string, number>;

describe('M91 recheck-tab ledger', () => {
  it('remember/forget round-trips through storage.session', async () => {
    await rememberRecheckTab(101, 5_000);
    expect(ledger()['101']).toBe(5_000);
    await forgetRecheckTab(101);
    expect('101' in ledger()).toBe(false);
  });

  it('sweep closes expired orphans immediately and clears their entries', async () => {
    await rememberRecheckTab(7, 1_000);
    await rememberRecheckTab(8, 2_000);
    const { closedNow, scheduled } = await sweepOrphanRecheckTabs(10_000, () => {});
    expect(closedNow.sort()).toEqual([7, 8]);
    expect(scheduled).toEqual([]);
    expect(removedTabs.sort()).toEqual([7, 8]);
    expect(ledger()).toEqual({});
  });

  it('sweep schedules live-window orphans and the timer re-checks the ledger before closing', async () => {
    await rememberRecheckTab(9, 60_000);
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const { closedNow, scheduled } = await sweepOrphanRecheckTabs(1_000, (fn, ms) => timers.push({ fn, ms }));
    expect(closedNow).toEqual([]);
    expect(scheduled).toEqual([9]);
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(60_000 - 1_000 + 5_000);

    // Happy path forgot the tab before the timer fired → timer must NOT close it.
    await forgetRecheckTab(9);
    timers[0].fn();
    await new Promise((r) => setTimeout(r, 0));
    expect(removedTabs).toEqual([]);

    // A still-present entry when the timer fires DOES get closed.
    await rememberRecheckTab(11, 60_000);
    const timers2: Array<{ fn: () => void; ms: number }> = [];
    await sweepOrphanRecheckTabs(1_000, (fn, ms) => timers2.push({ fn, ms }));
    timers2[0].fn();
    await new Promise((r) => setTimeout(r, 0));
    expect(removedTabs).toEqual([11]);
    expect(ledger()).toEqual({});
  });

  it('sweep tolerates already-closed tabs (tabs.remove rejects) and still clears entries', async () => {
    await rememberRecheckTab(21, 1_000);
    removeThrows.add(21);
    const { closedNow } = await sweepOrphanRecheckTabs(10_000, () => {});
    expect(closedNow).toEqual([21]);
    expect(ledger()).toEqual({});
  });

  it('sweep drops malformed (non-numeric) keys without touching tabs', async () => {
    sessionStore['fw_recheck_tabs'] = { garbage: 1, '31': 1 };
    const { closedNow } = await sweepOrphanRecheckTabs(10_000, () => {});
    expect(closedNow).toEqual([31]);
    expect(removedTabs).toEqual([31]);
    expect(ledger()).toEqual({});
  });
});
