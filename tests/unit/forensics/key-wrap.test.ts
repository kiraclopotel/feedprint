// FeelingWise — passphrase wrapping of the forensic signing key (Option A core).
// Pure Web Crypto (available in the Node test env, as chain-integrity relies on
// crypto.subtle too). Locks: round-trip, wrong-passphrase rejection, tamper
// rejection, randomized salt/iv, and that the private 'd' survives the trip.

import { describe, it, expect, beforeAll } from 'vitest';
import {
  wrapPrivateKeyJwk,
  unwrapPrivateKeyJwk,
  checkedIterations,
  PBKDF2_MIN_ITERATIONS,
  PBKDF2_MAX_ITERATIONS,
  PBKDF2_ITERATIONS,
} from '../../../src/forensics/key-wrap';

let privateJwk: JsonWebKey;

beforeAll(async () => {
  // A real ECDSA P-256 private JWK — same shape the signing module exports.
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
});

describe('wrapPrivateKeyJwk / unwrapPrivateKeyJwk', () => {
  it('round-trips the exact JWK with the right passphrase', async () => {
    const wrapped = await wrapPrivateKeyJwk(privateJwk, 'correct horse battery staple');
    const back = await unwrapPrivateKeyJwk(wrapped, 'correct horse battery staple');
    expect(back).toEqual(privateJwk);
    expect(back.d).toBe(privateJwk.d); // the private scalar survived
  });

  it('rejects a wrong passphrase (AES-GCM auth fails)', async () => {
    const wrapped = await wrapPrivateKeyJwk(privateJwk, 'right-pass');
    await expect(unwrapPrivateKeyJwk(wrapped, 'wrong-pass')).rejects.toThrow(/wrong passphrase|corrupted/i);
  });

  it('rejects a tampered ciphertext', async () => {
    const wrapped = await wrapPrivateKeyJwk(privateJwk, 'pass-word-1');
    // Flip the first base64 char of the ciphertext to a different valid one.
    const c0 = wrapped.ciphertext[0];
    const tampered = { ...wrapped, ciphertext: (c0 === 'A' ? 'B' : 'A') + wrapped.ciphertext.slice(1) };
    await expect(unwrapPrivateKeyJwk(tampered, 'pass-word-1')).rejects.toThrow(/wrong passphrase|corrupted/i);
  });

  it('refuses a passphrase under the floor on wrap, and takes one at the floor', async () => {
    await expect(wrapPrivateKeyJwk(privateJwk, 'seven77')).rejects.toThrow(/at least 8 characters/i);
    await expect(wrapPrivateKeyJwk(privateJwk, 'eight888')).resolves.toMatchObject({ v: 1 });
  });

  it('refuses an empty passphrase on wrap', async () => {
    await expect(wrapPrivateKeyJwk(privateJwk, '')).rejects.toThrow(/passphrase is required/i);
  });

  it('uses a fresh salt + iv each call (no deterministic reuse)', async () => {
    const a = await wrapPrivateKeyJwk(privateJwk, 'same-same-1');
    const b = await wrapPrivateKeyJwk(privateJwk, 'same-same-1');
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext); // GCM with distinct iv → distinct ct
  });

  it('refuses an unsupported format version', async () => {
    const wrapped = await wrapPrivateKeyJwk(privateJwk, 'pass-word-1');
    const bad = { ...wrapped, v: 2 as unknown as 1 };
    await expect(unwrapPrivateKeyJwk(bad, 'pass-word-1')).rejects.toThrow(/unsupported/i);
  });

  it('records the KDF parameters for transparency', async () => {
    const wrapped = await wrapPrivateKeyJwk(privateJwk, 'pass-word-1');
    expect(wrapped.kdf).toBe('PBKDF2');
    expect(wrapped.hash).toBe('SHA-256');
    expect(wrapped.iterations).toBeGreaterThanOrEqual(300_000);
  });
});

// THE COUNT TRAVELS IN THE FILE. It went straight into crypto.subtle.deriveKey
// with no check, so a backup naming 10^12 iterations does not fail — it runs,
// and the extension stops responding. Someone restoring a backup a stranger
// sent them cannot tell that apart from a crash.
describe('the iteration count a backup is allowed to ask for', () => {
  it('accepts what this product writes', () => {
    expect(checkedIterations(PBKDF2_ITERATIONS)).toBe(PBKDF2_ITERATIONS);
    expect(checkedIterations(PBKDF2_MIN_ITERATIONS)).toBe(PBKDF2_MIN_ITERATIONS);
    expect(checkedIterations(PBKDF2_MAX_ITERATIONS)).toBe(PBKDF2_MAX_ITERATIONS);
  });

  it('refuses a count that would hang the machine, naming what was asked for', () => {
    expect(() => checkedIterations(1e12)).toThrow(/1000000000000/);
    expect(() => checkedIterations(PBKDF2_MAX_ITERATIONS + 1)).toThrow(/outside/);
  });

  it('refuses a trivially weak count and anything that is not a whole number', () => {
    for (const bad of [1, 0, -5, 1.5, NaN, Infinity, '310000', null, undefined, {}]) {
      expect(() => checkedIterations(bad as never)).toThrow();
    }
  });
});
