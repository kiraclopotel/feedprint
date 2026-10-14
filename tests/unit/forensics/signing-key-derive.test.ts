// FeelingWise — publicJwkFromPrivateJwk (pure). The export/restore orchestration
// touches chrome.storage + the module key cache and is live-verified; this locks
// the pure public-from-private derivation, which the restore path relies on to
// rebuild the verify key from a backed-up private key.

import 'fake-indexeddb/auto';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { forgetSigningKey } from '../../helpers/indexeddb';
import {
  clearSigningKeyCache,
  commitSigningKeyRestore,
  prepareSigningKeyRestore,
  publicJwkFromPrivateJwk,
} from '../../../src/forensics/signing';

afterEach(() => {
  clearSigningKeyCache();
  vi.unstubAllGlobals();
});

describe('publicJwkFromPrivateJwk', () => {
  it('matches the real exported public JWK coordinates and drops the private scalar', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const realPublicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);

    const derived = publicJwkFromPrivateJwk(privateJwk);

    expect(derived.kty).toBe(realPublicJwk.kty);
    expect(derived.crv).toBe(realPublicJwk.crv);
    expect(derived.x).toBe(realPublicJwk.x);
    expect(derived.y).toBe(realPublicJwk.y);
    expect(derived.d).toBeUndefined(); // private scalar must NOT leak into the public JWK
  });

  it('produces a JWK that Web Crypto accepts as a verify key', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const derived = publicJwkFromPrivateJwk(privateJwk);

    // Importing the derived public JWK + verifying a signature made by the
    // matching private key must succeed.
    const pub = await crypto.subtle.importKey('jwk', derived, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
    const msg = new TextEncoder().encode('hello');
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, msg);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, sig, msg)).toBe(true);
  });

  it('stages a restore without persistence and commits only when requested', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const set = vi.fn(async () => undefined);
    vi.stubGlobal('chrome', { storage: { local: { set } } });

    const staged = await prepareSigningKeyRestore(privateJwk, '2026-07-01T00:00:00.000Z');
    expect(set).not.toHaveBeenCalled();

    const fingerprint = await commitSigningKeyRestore(staged);
    expect(fingerprint).toBe(staged.fingerprint);
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      fw_signing_created_at: '2026-07-01T00:00:00.000Z',
    }));
  });
});

// The key lives in IndexedDB: each test starts without one.
afterEach(forgetSigningKey);
