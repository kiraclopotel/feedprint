/** @vitest-environment jsdom */
// Q26 — PIN attempt throttling. Five free misses, then every further miss
// locks the gate for an escalating window (30 s doubling, capped 15 min).
// State persists in chrome.storage.local so SW respawns and popup reopens
// do not reset it; a correct entry clears it; unreadable throttle state
// fails closed (SEC-G5) so a forced read failure cannot buy free attempts.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { utcDayKey, utcMonthKey, CURRENT_SETTINGS_SCHEMA_VERSION } from '../../../src/storage/settings';

const PIN = '1234';

function installStorageStub(initial: Record<string, unknown>): Record<string, unknown> {
  const state: Record<string, unknown> = { ...initial };
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: (keys: string | string[]) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of arr) if (k in state) out[k] = state[k];
          return Promise.resolve(out);
        },
        set: (obj: Record<string, unknown>) => { Object.assign(state, obj); return Promise.resolve(); },
        remove: (keys: string | string[]) => {
          for (const k of Array.isArray(keys) ? keys : [keys]) delete state[k];
          return Promise.resolve();
        },
      },
      session: { set: () => Promise.resolve(), get: () => Promise.resolve({}) },
    },
    runtime: { sendMessage: () => undefined },
  };
  return state;
}

async function seededSettings(): Promise<Record<string, unknown>> {
  const { setPin } = await import('../../../src/storage/settings');
  const state = installStorageStub({
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    lastResetDate: utcDayKey(),
    lastResetMonth: utcMonthKey(),
  });
  await setPin(PIN);
  return state;
}

beforeEach(() => {
  vi.resetModules();
  vi.useRealTimers();
});

describe('verifyPin throttling', () => {
  it('five misses stay free; the sixth locks the gate', async () => {
    const state = await seededSettings();
    const { verifyPin, pinLockRemainingMs } = await import('../../../src/storage/settings');
    for (let i = 0; i < 5; i++) {
      expect(await verifyPin('0000')).toBe(false);
      expect(await pinLockRemainingMs()).toBe(0);
    }
    expect(await verifyPin('0000')).toBe(false);
    const remaining = await pinLockRemainingMs();
    expect(remaining).toBeGreaterThan(25_000);
    expect(remaining).toBeLessThanOrEqual(30_000);
    void state;
  });

  it('while locked, even the CORRECT pin is refused until the window passes', async () => {
    await seededSettings();
    const { verifyPin } = await import('../../../src/storage/settings');
    for (let i = 0; i < 6; i++) await verifyPin('0000');
    expect(await verifyPin(PIN)).toBe(false);
  });

  it('escalates and caps at 15 minutes', async () => {
    const state = await seededSettings();
    const { verifyPin, pinLockRemainingMs } = await import('../../../src/storage/settings');
    // Simulate many prior misses with an expired lock so the next miss
    // escalates from a high count.
    state['fw_pin_attempts'] = { misses: 40, lockedUntil: 0 };
    await verifyPin('0000');
    const remaining = await pinLockRemainingMs();
    expect(remaining).toBeGreaterThan(14 * 60_000);
    expect(remaining).toBeLessThanOrEqual(15 * 60_000);
  });

  it('a correct entry clears the counter', async () => {
    const state = await seededSettings();
    const { verifyPin } = await import('../../../src/storage/settings');
    for (let i = 0; i < 4; i++) await verifyPin('0000');
    expect(await verifyPin(PIN)).toBe(true);
    expect(state['fw_pin_attempts']).toBeUndefined();
  });

  it('unreadable throttle state fails closed: even the correct PIN is refused', async () => {
    await seededSettings();
    const { verifyPin, pinLockRemainingMs } = await import('../../../src/storage/settings');
    const localGet = (globalThis as any).chrome.storage.local.get;
    (globalThis as any).chrome.storage.local.get = (keys: string | string[]) => {
      const arr = Array.isArray(keys) ? keys : [keys];
      if (arr.includes('fw_pin_attempts')) return Promise.reject(new Error('blip'));
      return localGet(keys);
    };
    expect(await verifyPin(PIN)).toBe(false);
    expect(await pinLockRemainingMs()).toBeGreaterThan(0);
    // Once storage answers again the same PIN goes through: a blip costs a
    // retry, never the lockout.
    (globalThis as any).chrome.storage.local.get = localGet;
    expect(await verifyPin(PIN)).toBe(true);
  });
});
