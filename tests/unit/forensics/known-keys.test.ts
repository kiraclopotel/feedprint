// forensics/known-keys.ts: the public keys of earlier generations, remembered
// from the files the recovery picker is handed and embedded in exports whose
// records they signed. The fingerprint is derived, never read from the file.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';
import { fingerprintPublicJwk } from '../../../src/forensics/signing';
import { publicKeysForExport, publicKeysInFileJson, rememberPublicKeys } from '../../../src/forensics/known-keys';

let store: Record<string, unknown> = {};
const g = globalThis as unknown as { chrome?: unknown };
let savedChrome: unknown;

beforeEach(() => {
  store = {};
  savedChrome = g.chrome;
  g.chrome = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (v: Record<string, unknown>) => { Object.assign(store, v); },
      },
    },
  };
});
afterEach(() => { g.chrome = savedChrome; });

async function pubJwk(): Promise<JsonWebKey> {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, ext: true, key_ops: ['verify'] };
}

describe('rememberPublicKeys', () => {
  it('keeps only P-256 public keys, by derived fingerprint, once each', async () => {
    const a = await pubJwk();
    const b = await pubJwk();
    expect(await rememberPublicKeys([a, { kty: 'RSA' }, null, 'x', b])).toBe(2);
    expect(await rememberPublicKeys([a])).toBe(1);
    const held = store.fwKnownPublicKeys as Record<string, JsonWebKey>;
    expect(Object.keys(held).sort()).toEqual([await fingerprintPublicJwk(a), await fingerprintPublicJwk(b)].sort());
    // only the public coordinates are stored
    expect(held[await fingerprintPublicJwk(a)]).toEqual({ kty: 'EC', crv: 'P-256', x: a.x, y: a.y });
  });
});

describe('publicKeysForExport', () => {
  it('own key first, then the remembered keys the records name, never a key nobody named', async () => {
    const own = await pubJwk();
    const oldA = await pubJwk();
    const oldB = await pubJwk();
    await rememberPublicKeys([oldA, oldB]);
    const ownFp = await fingerprintPublicJwk(own);
    const fpA = await fingerprintPublicJwk(oldA);
    const records = [
      { publicKeyFingerprint: ownFp }, { publicKeyFingerprint: fpA }, { publicKeyFingerprint: 'never-exported' }, {},
    ] as ForensicRecord[];
    const keys = await publicKeysForExport(records, own, ownFp);
    expect(keys.map(k => k.fingerprint)).toEqual([ownFp, fpA]);
    expect(keys[1].jwk).toEqual({ kty: 'EC', crv: 'P-256', x: oldA.x, y: oldA.y });
  });
});

describe('publicKeysInFileJson', () => {
  it('reads an export payload, an epoch file, and a keys list', () => {
    expect(publicKeysInFileJson({ records: [], publicKeyJwk: { x: 1 }, publicKeys: [{ fingerprint: 'f', jwk: { x: 2 } }] }))
      .toEqual([{ x: 1 }, { x: 2 }]);
    expect(publicKeysInFileJson([{ fingerprint: 'f', jwk: { x: 3 }, from: 'a.html' }])).toEqual([{ x: 3 }]);
    expect(publicKeysInFileJson([{ id: 'r1' }])).toEqual([]);
    expect(publicKeysInFileJson('nope')).toEqual([]);
  });
});
