// Capability audit 2026-09-06, P1 item 5: the record never said why a key
// changed. A reset keeps the key; a key changes only when storage is empty and
// one is generated, or when a backup's key is restored. Both sites now append
// to an origin ledger in chrome.storage.local, best-effort, and the export
// prints it per epoch. This locks the two writes and the never-throw contract.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetSigningKey } from '../../helpers/indexeddb';
import { webcrypto } from 'node:crypto';
import {
  clearSigningKeyCache, ensureSigningKey, getPublicKeyFingerprint, getSigningKeyOrigins,
  prepareSigningKeyRestore, commitSigningKeyRestore,
} from '../../../src/forensics/signing';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
const originalChrome = globalThis.chrome;

function fakeStorage(): { store: Record<string, unknown>; get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> } {
  const store: Record<string, unknown> = {};
  const get = vi.fn(async (keys: string[]) => {
    const out: Record<string, unknown> = {};
    for (const k of keys) if (k in store) out[k] = store[k];
    return out;
  });
  const set = vi.fn(async (items: Record<string, unknown>) => { Object.assign(store, items); });
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true, writable: true,
    value: { storage: { local: { get, set } } },
  });
  return { store, get, set };
}

beforeEach(() => clearSigningKeyCache());
afterEach(() => {
  Object.defineProperty(globalThis, 'chrome', { configurable: true, writable: true, value: originalChrome });
  clearSigningKeyCache();
  vi.restoreAllMocks();
});

describe('signing key origin ledger', () => {
  it('a key generated into empty storage is recorded as such, with its fingerprint', async () => {
    fakeStorage();
    await ensureSigningKey();
    const fp = await getPublicKeyFingerprint();
    const origins = await getSigningKeyOrigins();
    expect(origins).toHaveLength(1);
    expect(origins[0]).toMatchObject({ fingerprint: fp, origin: 'generated-storage-empty' });
    expect(origins[0].previousFingerprint).toBeUndefined();
    expect(Date.parse(origins[0].at)).not.toBeNaN();
  });

  it('a key imported from storage on the next boot is not a new origin', async () => {
    fakeStorage();
    await ensureSigningKey();
    clearSigningKeyCache();
    await ensureSigningKey();
    expect(await getSigningKeyOrigins()).toHaveLength(1);
  });

  it('a restored key is recorded with the key it replaced', async () => {
    fakeStorage();
    await ensureSigningKey();
    const before = await getPublicKeyFingerprint();
    const other = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const priv = await crypto.subtle.exportKey('jwk', other.privateKey);
    const staged = await prepareSigningKeyRestore(priv, '2026-05-01T00:00:00.000Z');
    const after = await commitSigningKeyRestore(staged);
    const origins = await getSigningKeyOrigins();
    expect(origins).toHaveLength(2);
    expect(origins[1]).toMatchObject({ fingerprint: after, origin: 'restored-from-backup', previousFingerprint: before });
    expect(after).not.toBe(before);
  });

  it('a ledger write failure never blocks key generation, and an unreadable ledger reads as empty', async () => {
    const { store, set } = fakeStorage();
    set.mockImplementation(async (items: Record<string, unknown>) => {
      if ('fw_signing_key_origins' in items) throw new Error('quota');
      Object.assign(store, items);
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(ensureSigningKey()).resolves.toBeUndefined();
    expect(await getPublicKeyFingerprint()).toHaveLength(16);
    expect(warn).toHaveBeenCalled();
    expect(await getSigningKeyOrigins()).toEqual([]);
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true, writable: true,
      value: { storage: { local: { get: vi.fn(async () => { throw new Error('dead'); }), set } } },
    });
    expect(await getSigningKeyOrigins()).toEqual([]);
  });
});

// The key lives in IndexedDB: each test starts without one.
afterEach(forgetSigningKey);
