// Cold audit 13 Oct 2026, finding 3: the private signing key sat in chrome.storage.local, which a
// content script can read by default. It now lives in one IndexedDB record of the extension origin
// (database feelingwise-signing-key), which a page-origin script cannot open. chrome.storage keeps
// only the public half and the creation date, which other modules read. An install from before
// moves its key on the first read, and the old slot is removed only after the copy reads back.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorageStub, type ChromeStorageStub } from '../../helpers/chrome-storage';
import { deleteDb } from '../../helpers/indexeddb';
import { openSimpleStore } from '../../../src/forensics/idb-open';

vi.mock('../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/storage/settings')>();
  return { ...actual, getSettingsForAttestation: vi.fn(async () => ({ mode: 'adult', readFailed: false })) };
});
vi.mock('../../../src/storage/cache', () => ({ processingCache: { clear: vi.fn() } }));
vi.mock('../../../src/analysis/comment-batch-scorer', () => ({ clearBatchCache: vi.fn() }));
vi.mock('../../../src/forensics/delivery-outbox', () => ({
  getForensicDeliveryStatus: vi.fn(async () => ({ pendingCount: 0 })),
}));

import {
  clearSigningKeyCache, commitSigningKeyRestore, ensureSigningKey, exportWrappedPrivateKey,
  fingerprintPublicJwk, getPublicKeyFingerprint, getSigningKeyCreatedAt, prepareSigningKeyRestore,
  publicJwkFromPrivateJwk, verifyHash,
} from '../../../src/forensics/signing';
import { resetForensicChain } from '../../../src/forensics/store';

const KEY_DB = 'feelingwise-signing-key';
const PRIVATE = 'fw_signing_private_jwk';
const PUBLIC = 'fw_signing_public_jwk';
const CREATED_AT = 'fw_signing_created_at';
const ALGO = { name: 'ECDSA', namedCurve: 'P-256' } as const;

interface KeyRecord { privateJwk: JsonWebKey; publicJwk: JsonWebKey; createdAt: string }

let chromeStub: ChromeStorageStub;

async function heldRecord(): Promise<KeyRecord | undefined> {
  const db = await openSimpleStore(KEY_DB, 1, 'keys');
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction('keys', 'readonly').objectStore('keys').get('current');
      req.onsuccess = () => resolve(req.result as KeyRecord | undefined);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function putRecord(record: KeyRecord): Promise<void> {
  const db = await openSimpleStore(KEY_DB, 1, 'keys');
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('keys', 'readwrite');
      tx.objectStore('keys').put(record, 'current');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** A key made the way 2.5.18 made it, with one hash it signed. */
async function legacyKey(): Promise<{ privateJwk: JsonWebKey; publicJwk: JsonWebKey; hash: string; signature: string }> {
  const pair = await crypto.subtle.generateKey(ALGO, true, ['sign', 'verify']);
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const hash = 'a'.repeat(64);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: { name: 'SHA-256' } }, pair.privateKey, new TextEncoder().encode(hash));
  const signature = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { privateJwk, publicJwk, hash, signature };
}

beforeEach(async () => {
  clearSigningKeyCache();
  await deleteDb(KEY_DB);
  chromeStub = installChromeStorageStub();
});

afterEach(() => {
  clearSigningKeyCache();
  chromeStub.restore();
});

describe('the signing key lives in the extension database', () => {
  it('a new key is written there, and chrome.storage keeps only the public half and the date', async () => {
    await ensureSigningKey();
    const held = await heldRecord();
    expect(held?.privateJwk.d).toEqual(expect.any(String));
    expect(chromeStub.state[PRIVATE]).toBeUndefined();
    expect(chromeStub.state[PUBLIC]).toEqual(held?.publicJwk);
    expect(chromeStub.state[CREATED_AT]).toBe(held?.createdAt);
    expect(await getPublicKeyFingerprint()).toBe(await fingerprintPublicJwk(held!.publicJwk));
  });

  it('an install from before moves its key: same fingerprint, its old signatures verify, the old slot is gone', async () => {
    const legacy = await legacyKey();
    const createdAt = '2026-09-01T10:00:00.000Z';
    Object.assign(chromeStub.state, { [PRIVATE]: legacy.privateJwk, [PUBLIC]: legacy.publicJwk, [CREATED_AT]: createdAt });

    await ensureSigningKey();

    expect(await getPublicKeyFingerprint()).toBe(await fingerprintPublicJwk(legacy.publicJwk));
    expect(await verifyHash(legacy.hash, legacy.signature)).toBe(true);
    expect((await heldRecord())?.privateJwk.d).toBe(legacy.privateJwk.d);
    expect(chromeStub.state[PRIVATE]).toBeUndefined();
    expect(chromeStub.state[PUBLIC]).toEqual(legacy.publicJwk);
    expect(await getSigningKeyCreatedAt()).toBe(createdAt);
  });

  it('a crash between the copy and the removal: the next read uses the database and removes the old slot', async () => {
    const legacy = await legacyKey();
    const createdAt = '2026-09-02T10:00:00.000Z';
    await putRecord({ privateJwk: legacy.privateJwk, publicJwk: legacy.publicJwk, createdAt });
    Object.assign(chromeStub.state, { [PRIVATE]: legacy.privateJwk, [PUBLIC]: legacy.publicJwk, [CREATED_AT]: createdAt });

    await ensureSigningKey();

    expect(await getPublicKeyFingerprint()).toBe(await fingerprintPublicJwk(legacy.publicJwk));
    expect(chromeStub.state[PRIVATE]).toBeUndefined();
  });

  it('a crash between the database write and the public mirror: the next read writes the mirror again', async () => {
    const legacy = await legacyKey();
    await putRecord({ privateJwk: legacy.privateJwk, publicJwk: legacy.publicJwk, createdAt: '2026-09-03T10:00:00.000Z' });

    await ensureSigningKey();

    expect(chromeStub.state[PUBLIC]).toEqual(legacy.publicJwk);
    expect(chromeStub.state[CREATED_AT]).toBe('2026-09-03T10:00:00.000Z');
  });

  it('a backup is made from the key in the database', async () => {
    const legacy = await legacyKey();
    Object.assign(chromeStub.state, { [PRIVATE]: legacy.privateJwk, [PUBLIC]: legacy.publicJwk, [CREATED_AT]: '2026-09-04T10:00:00.000Z' });
    await ensureSigningKey();
    await expect(exportWrappedPrivateKey('a long enough passphrase')).resolves.toBeTruthy();
  });

  it('restoring a backup writes the database, and the old slot stays empty', async () => {
    await ensureSigningKey();
    const restored = await legacyKey();
    const staged = await prepareSigningKeyRestore(restored.privateJwk, '2026-08-01T10:00:00.000Z');

    await commitSigningKeyRestore(staged);

    expect((await heldRecord())?.privateJwk.d).toBe(restored.privateJwk.d);
    expect(chromeStub.state[PRIVATE]).toBeUndefined();
    expect(chromeStub.state[PUBLIC]).toEqual(publicJwkFromPrivateJwk(restored.privateJwk));
    clearSigningKeyCache();
    expect(await getPublicKeyFingerprint()).toBe(staged.fingerprint);
  });

  it('the reset keeps the key', async () => {
    await ensureSigningKey();
    const before = await getPublicKeyFingerprint();

    await resetForensicChain();
    clearSigningKeyCache();

    expect(await getPublicKeyFingerprint()).toBe(before);
  });

  it('a database that cannot be opened is an error, never a new key', async () => {
    const legacy = await legacyKey();
    Object.assign(chromeStub.state, { [PRIVATE]: legacy.privateJwk, [PUBLIC]: legacy.publicJwk, [CREATED_AT]: '2026-09-05T10:00:00.000Z' });
    const open = vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw new Error('disk gone'); });
    try {
      await expect(ensureSigningKey()).rejects.toThrow('disk gone');
    } finally {
      open.mockRestore();
    }
    expect(chromeStub.state[PRIVATE]).toEqual(legacy.privateJwk);
  });

  // The service worker and the dashboard are two realms on one database. Each case below lets the
  // other realm store a key in the gap between this realm's database read and its own write.
  function otherRealmStoresDuringNextRead(record: KeyRecord): void {
    const local = (globalThis as unknown as { chrome: { storage: { local: { get: (k: unknown) => Promise<Record<string, unknown>> } } } })
      .chrome.storage.local;
    const honest = local.get;
    let done = false;
    local.get = async (keys) => {
      if (!done) { done = true; await putRecord(record); }
      return honest(keys);
    };
  }

  it('a key another page stored during the move stands, and the move does not overwrite it', async () => {
    const legacy = await legacyKey();
    Object.assign(chromeStub.state, { [PRIVATE]: legacy.privateJwk, [PUBLIC]: legacy.publicJwk, [CREATED_AT]: '2026-09-06T10:00:00.000Z' });
    const other = await legacyKey();
    otherRealmStoresDuringNextRead({ privateJwk: other.privateJwk, publicJwk: other.publicJwk, createdAt: '2026-09-07T10:00:00.000Z' });

    await ensureSigningKey();

    expect(await getPublicKeyFingerprint()).toBe(await fingerprintPublicJwk(other.publicJwk));
    expect((await heldRecord())?.privateJwk.d).toBe(other.privateJwk.d);
    expect(chromeStub.state[PUBLIC]).toEqual(other.publicJwk);
  });

  it('two pages making a first key at once: the key stored first stands, and this page signs with it', async () => {
    const other = await legacyKey();
    otherRealmStoresDuringNextRead({ privateJwk: other.privateJwk, publicJwk: other.publicJwk, createdAt: '2026-09-08T10:00:00.000Z' });

    await ensureSigningKey();

    expect(await getPublicKeyFingerprint()).toBe(await fingerprintPublicJwk(other.publicJwk));
    expect(await verifyHash(other.hash, other.signature)).toBe(true);
    expect((await heldRecord())?.privateJwk.d).toBe(other.privateJwk.d);
  });

});
