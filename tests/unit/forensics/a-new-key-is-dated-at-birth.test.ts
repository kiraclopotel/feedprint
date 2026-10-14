// A key is born once, and the worker is told the moment it is, so its dating by independent
// authorities starts at birth instead of at the next six-hourly alarm. Signing never waits on the
// dating and never fails with it.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetSigningKey } from '../../helpers/indexeddb';
import { webcrypto } from 'node:crypto';
import {
  clearSigningKeyCache, ensureSigningKey, onSigningKeyBorn, signHash,
} from '../../../src/forensics/signing';
import { readSource } from '../../helpers/read-source';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
const originalChrome = globalThis.chrome;

function fakeStorage(): void {
  const store: Record<string, unknown> = {};
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true, writable: true,
    value: {
      storage: {
        local: {
          get: vi.fn(async (keys: string[]) => {
            const out: Record<string, unknown> = {};
            for (const k of keys) if (k in store) out[k] = store[k];
            return out;
          }),
          set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(store, items); }),
        },
      },
    },
  });
}

beforeEach(() => clearSigningKeyCache());
afterEach(() => {
  onSigningKeyBorn(null);
  Object.defineProperty(globalThis, 'chrome', { configurable: true, writable: true, value: originalChrome });
  clearSigningKeyCache();
});

describe('a new key is dated at birth', () => {
  it('the listener hears a key made into empty storage, once', async () => {
    fakeStorage();
    const born = vi.fn();
    onSigningKeyBorn(born);
    await ensureSigningKey();
    expect(born).toHaveBeenCalledTimes(1);
    clearSigningKeyCache();
    await ensureSigningKey();
    expect(born, 'a key read back from storage is not born again').toHaveBeenCalledTimes(1);
  });

  it('a listener that throws does not stop the first record from being signed', async () => {
    fakeStorage();
    onSigningKeyBorn(() => { throw new Error('network'); });
    await expect(signHash('a'.repeat(64))).resolves.toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('the worker hands the birth to the key dating', () => {
    const sw = readSource('src/background/service-worker.ts');
    expect(sw).toContain('onSigningKeyBorn(stampKeyGenesis);');
    expect(sw).toMatch(/function stampKeyGenesis\(\): void \{\n\s+ensureKeyGenesisAnchor\(\)/);
  });
});

// The key lives in IndexedDB: each test starts without one.
afterEach(forgetSigningKey);
