import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { forgetSigningKey } from '../../helpers/indexeddb';
import { clearSigningKeyCache, ensureSigningKey } from '../../../src/forensics/signing';

const originalChrome = globalThis.chrome;

afterEach(() => {
  clearSigningKeyCache();
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    writable: true,
    value: originalChrome,
  });
  vi.restoreAllMocks();
});

describe('ensureSigningKey storage failures', () => {
  it('does not replace the signing identity when the stored-key read fails', async () => {
    const set = vi.fn(async () => undefined);
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      writable: true,
      value: {
        storage: {
          local: {
            get: vi.fn(async () => { throw new Error('temporary storage failure'); }),
            set,
          },
        },
      },
    });
    clearSigningKeyCache();

    await expect(ensureSigningKey()).rejects.toThrow('temporary storage failure');
    expect(set).not.toHaveBeenCalled();
  });

  it('does not replace a partially present signing identity', async () => {
    const set = vi.fn(async () => undefined);
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      writable: true,
      value: {
        storage: {
          local: {
            get: vi.fn(async () => ({
              fw_signing_private_jwk: { kty: 'EC' },
            })),
            set,
          },
        },
      },
    });
    clearSigningKeyCache();

    await expect(ensureSigningKey()).rejects.toThrow('Stored signing key is incomplete');
    expect(set).not.toHaveBeenCalled();
  });
});

// The key lives in IndexedDB: each test starts without one.
afterEach(forgetSigningKey);
