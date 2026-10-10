/** @vitest-environment jsdom */
// SEC-G5: the parent PIN is stored as a per-install salted PBKDF2 digest,
// compared in constant time. A legacy unsalted sha256(pin) still verifies
// once and is rewritten in the salted form on that success.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { utcDayKey, utcMonthKey, CURRENT_SETTINGS_SCHEMA_VERSION } from '../../../src/storage/settings';
import { sha256 } from '../../../src/forensics/hasher';
import { PBKDF2_ITERATIONS } from '../../../src/forensics/key-wrap';

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

function baseState(): Record<string, unknown> {
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    lastResetDate: utcDayKey(),
    lastResetMonth: utcMonthKey(),
  };
}

beforeEach(() => { vi.resetModules(); });

describe('salted PIN hash (SEC-G5)', () => {
  it('stores something other than the bare sha256 of the PIN, at the key-wrap iteration count', async () => {
    const state = installStorageStub(baseState());
    const { setPin } = await import('../../../src/storage/settings');
    await setPin(PIN);
    const stored = state['parentPin'] as string;
    expect(stored).not.toBe(await sha256(PIN));
    expect(stored.startsWith(`pbkdf2$${PBKDF2_ITERATIONS}$`)).toBe(true);
  });

  it('two installs with the same PIN store different values', async () => {
    const a = installStorageStub(baseState());
    const mod = await import('../../../src/storage/settings');
    await mod.setPin(PIN);
    const first = a['parentPin'];
    vi.resetModules();
    const b = installStorageStub(baseState());
    const mod2 = await import('../../../src/storage/settings');
    await mod2.setPin(PIN);
    expect(b['parentPin']).not.toBe(first);
  });

  it('the right PIN verifies and the wrong PIN is rejected', async () => {
    installStorageStub(baseState());
    const { setPin, verifyPin } = await import('../../../src/storage/settings');
    await setPin(PIN);
    expect(await verifyPin('0000')).toBe(false);
    expect(await verifyPin(PIN)).toBe(true);
  });

  it('a legacy unsalted digest verifies once and is migrated to the salted form', async () => {
    const state = installStorageStub({ ...baseState(), parentPin: await sha256(PIN) });
    const { verifyPin } = await import('../../../src/storage/settings');
    expect(await verifyPin('9999')).toBe(false);
    expect(state['parentPin']).toBe(await sha256(PIN));
    expect(await verifyPin(PIN)).toBe(true);
    const migrated = state['parentPin'] as string;
    expect(migrated).not.toBe(await sha256(PIN));
    expect(migrated.startsWith('pbkdf2$')).toBe(true);
    expect(await verifyPin(PIN)).toBe(true);
    expect(await verifyPin('0000')).toBe(false);
  });

  it('a malformed stored value never verifies', async () => {
    installStorageStub({ ...baseState(), parentPin: 'pbkdf2$notanumber$zz$zz' });
    const { verifyPin } = await import('../../../src/storage/settings');
    expect(await verifyPin(PIN)).toBe(false);
  });
});
