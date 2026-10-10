// Proving the signing key existed before there was a dispute.
//
// The chain anchors answer "was this backdated". They do not answer the
// question the 2026-09-04 audit's hostile expert asks next: a file signed by a
// key it also carries is internally consistent by construction, so anyone can
// make a keypair at lunchtime, author records, chain them, sign them, and get
// genuine timestamps over the fabricated chain heads.
//
// What a fabricator cannot do is have an authority sign their new key months
// ago. src/forensics/key-genesis.ts takes that stamp once, and the export
// checks it against a digest RECOMPUTED from the public key in the file. That
// last part is the whole mechanism: a stolen or borrowed timestamp over some
// other key fails the message-imprint check, so the claim cannot be laundered.
//
// The fixture is a real FreeTSA token over a real keypair's digest, both
// checked in, so this exercises the actual bytes rather than a mock.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { repoPath } from '../../helpers/repo-root';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { verifyAnchorBase64 } from '../../../src/forensics/rfc3161';
import { publicKeyDigestHex } from '../../../src/forensics/signing';
import { earliestGenesisTime, type KeyGenesisRecord } from '../../../src/forensics/key-genesis';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const FIXTURES = repoPath('tests', 'fixtures', 'rfc3161');
const key = JSON.parse(readFileSync(join(FIXTURES, 'keygen-key.json'), 'utf8')) as {
  publicJwk: JsonWebKey;
  privateJwk: JsonWebKey;
  publicKeyDigest: string;
};
const tokenB64 = readFileSync(join(FIXTURES, 'keygen-resp.der')).toString('base64');

describe('the digest the authority signs is derivable from the public key alone', () => {
  it('publicKeyDigestHex reproduces the digest that was stamped', async () => {
    expect(await publicKeyDigestHex(key.publicJwk)).toBe(key.publicKeyDigest);
  });

  it('the fingerprint on records is the first 16 characters of it', async () => {
    const digest = await publicKeyDigestHex(key.publicJwk);
    expect(digest.slice(0, 16)).toHaveLength(16);
    expect(key.publicKeyDigest.startsWith(digest.slice(0, 16))).toBe(true);
  });
});

describe('a recipient can check the stamp against the key in the file', () => {
  it('verifies when the digest is recomputed from the embedded public key', async () => {
    const expected = await publicKeyDigestHex(key.publicJwk);
    const v = await verifyAnchorBase64({ response: tokenB64 }, expected);
    expect(v.ok).toBe(true);
    expect(v.checks.find(c => c.name === 'message-imprint')?.ok).toBe(true);
    expect(v.genTime).toMatch(/^20\d\d-\d\d-\d\dT/);
    expect(v.knownRootName).toBe('FreeTSA (freetsa.org) Root CA');
  });

  it('a timestamp borrowed from another key fails, which is the point', async () => {
    // Someone else's genuine, older token, presented as if it covered this
    // install's key. Every cryptographic check on the token passes, because the
    // token IS genuine. The message imprint does not, because it is not about
    // this key.
    const other = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'],
    );
    const otherJwk = await crypto.subtle.exportKey('jwk', other.publicKey);
    const otherDigest = await publicKeyDigestHex(otherJwk);
    expect(otherDigest).not.toBe(key.publicKeyDigest);

    const v = await verifyAnchorBase64({ response: tokenB64 }, otherDigest);
    expect(v.ok).toBe(false);
    expect(v.checks.find(c => c.name === 'message-imprint')?.ok).toBe(false);
    expect(v.checks.find(c => c.name === 'signature')?.ok).toBe(true);
  });
});

describe('earliestGenesisTime states the strongest true version of the claim', () => {
  const record = (times: (string | null)[]): KeyGenesisRecord => ({
    publicKeyDigest: key.publicKeyDigest,
    fingerprint: key.publicKeyDigest.slice(0, 16),
    anchors: times.map((t, i) => ({
      tsaProvider: `tsa-${i}`,
      route: 'direct' as const,
      responseB64: 'r',
      tstB64: 't',
      generalizedTime: t,
      requestedAt: '2026-09-04T00:00:00.000Z',
    })),
  });

  it('takes the earliest, because the claim is "no later than"', () => {
    expect(earliestGenesisTime(record([
      '2026-09-04T02:00:00Z', '2026-09-04T01:00:00Z', '2026-09-04T03:00:00Z',
    ]))).toBe('2026-09-04T01:00:00Z');
  });

  it('ignores anchors whose token carried no readable time', () => {
    expect(earliestGenesisTime(record([null, '2026-09-04T05:00:00Z']))).toBe('2026-09-04T05:00:00Z');
  });

  it('is null when nothing was stamped', () => {
    expect(earliestGenesisTime(null)).toBeNull();
    expect(earliestGenesisTime(record([]))).toBeNull();
  });
});

describe('ensureKeyGenesisAnchor is idempotent and never blocks on the network', () => {
  const storage: Record<string, unknown> = {};

  beforeEach(() => {
    for (const k of Object.keys(storage)) delete storage[k];
    // A key already exists on this install. ensureKeyGenesisAnchor checks for
    // one directly rather than through getPublicKeyJWK, because that path
    // GENERATES a keypair when storage is empty and would mint an identity on
    // an install that has never recorded anything.
    storage.fw_signing_public_jwk = { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' };
    vi.resetModules();
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: (keys: string | string[]) => {
            const arr = Array.isArray(keys) ? keys : [keys];
            const out: Record<string, unknown> = {};
            for (const k of arr) if (k in storage) out[k] = storage[k];
            return Promise.resolve(out);
          },
          set: (obj: Record<string, unknown>) => {
            Object.assign(storage, obj);
            return Promise.resolve();
          },
        },
      },
    };
  });

  it('skips without a signing key rather than throwing', async () => {
    vi.doMock('../../../src/forensics/signing', () => ({
      getPublicKeyJWK: vi.fn(async () => { throw new Error('no key'); }),
      publicKeyDigestHex: vi.fn(async () => 'x'),
    }));
    const { ensureKeyGenesisAnchor } = await import('../../../src/forensics/key-genesis');
    const r = await ensureKeyGenesisAnchor();
    expect(r.status).toBe('skipped');
    if (r.status === 'skipped') expect(r.reason).toBe('no_signing_key');
  });

  it('does not mint a key on an install that has never recorded anything', async () => {
    // The alarm fires on every install, recording or not. Reaching for the key
    // through getPublicKeyJWK would create one and then spend two network
    // requests dating an identity nothing has ever signed with.
    delete storage.fw_signing_public_jwk;
    const getPublicKeyJWK = vi.fn(async () => ({ kty: 'EC', crv: 'P-256', x: 'x', y: 'y' }));
    const request = vi.fn(async () => ({ anchors: [], reasons: [] }));
    vi.doMock('../../../src/forensics/signing', () => ({
      getPublicKeyJWK,
      publicKeyDigestHex: vi.fn(async () => 'd'),
    }));
    vi.doMock('../../../src/forensics/tsa-client', () => ({ requestVerifiedTimestamps: request }));
    const { ensureKeyGenesisAnchor } = await import('../../../src/forensics/key-genesis');
    const r = await ensureKeyGenesisAnchor();
    expect(r.status).toBe('skipped');
    if (r.status === 'skipped') expect(r.reason).toBe('no_signing_key');
    expect(getPublicKeyJWK).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('puts a genesis record back only when it is about the key now in use', async () => {
    // A restore under the original identity has to bring the key's date with
    // it, or the next alarm re-stamps the same key with today's.
    vi.doMock('../../../src/forensics/signing', () => ({
      getPublicKeyJWK: vi.fn(async () => key.publicJwk),
      publicKeyDigestHex: vi.fn(async () => key.publicKeyDigest),
    }));
    const { restoreKeyGenesis, getKeyGenesis } = await import('../../../src/forensics/key-genesis');
    const record = {
      publicKeyDigest: key.publicKeyDigest,
      fingerprint: key.publicKeyDigest.slice(0, 16),
      anchors: [{
        tsaProvider: 'freetsa', route: 'direct' as const, responseB64: 'r', tstB64: 't',
        generalizedTime: '2026-06-01T00:00:00Z', requestedAt: '2026-06-01T00:00:00.000Z',
      }],
    };
    expect(await restoreKeyGenesis(record)).toBe(true);
    expect((await getKeyGenesis())?.anchors[0].generalizedTime).toBe('2026-06-01T00:00:00Z');

    // A record about a different key is refused: its date would otherwise be
    // attached to a key it never covered.
    expect(await restoreKeyGenesis({ ...record, publicKeyDigest: 'f'.repeat(64) })).toBe(false);
    expect(await restoreKeyGenesis(undefined)).toBe(false);
    expect((await getKeyGenesis())?.publicKeyDigest).toBe(key.publicKeyDigest);
  });

  it('stamps once, then reports already-stamped without asking again', async () => {
    const request = vi.fn(async () => ({
      anchors: [{
        ok: true as const, tsaProvider: 'freetsa', route: 'direct' as const,
        response: 'r', tst: 't', generalizedTime: '2026-09-04T01:00:00Z',
        verification: { ok: true, checks: [] } as never,
      }],
      reasons: [],
    }));
    vi.doMock('../../../src/forensics/signing', () => ({
      getPublicKeyJWK: vi.fn(async () => key.publicJwk),
      publicKeyDigestHex: vi.fn(async () => key.publicKeyDigest),
    }));
    vi.doMock('../../../src/forensics/tsa-client', () => ({ requestVerifiedTimestamps: request }));
    const { ensureKeyGenesisAnchor, getKeyGenesis } = await import('../../../src/forensics/key-genesis');

    const first = await ensureKeyGenesisAnchor();
    expect(first.status).toBe('stamped');
    expect(request).toHaveBeenCalledTimes(1);

    const second = await ensureKeyGenesisAnchor();
    expect(second.status).toBe('already-stamped');
    expect(request).toHaveBeenCalledTimes(1);

    const stored = await getKeyGenesis();
    expect(stored?.publicKeyDigest).toBe(key.publicKeyDigest);
    expect(stored?.fingerprint).toBe(key.publicKeyDigest.slice(0, 16));
  });

  it('re-stamps when the key has been replaced, and does not keep the old date', async () => {
    // A restore from a backup under a different identity. Keeping the previous
    // stamp would invite a reader to attach its date to a key it never covered.
    let digest = key.publicKeyDigest;
    const request = vi.fn(async () => ({
      anchors: [{
        ok: true as const, tsaProvider: 'cesnet', route: 'direct' as const,
        response: 'r', tst: 't', generalizedTime: '2026-09-05T01:00:00Z',
        verification: { ok: true, checks: [] } as never,
      }],
      reasons: [],
    }));
    vi.doMock('../../../src/forensics/signing', () => ({
      getPublicKeyJWK: vi.fn(async () => key.publicJwk),
      publicKeyDigestHex: vi.fn(async () => digest),
    }));
    vi.doMock('../../../src/forensics/tsa-client', () => ({ requestVerifiedTimestamps: request }));
    const { ensureKeyGenesisAnchor, getKeyGenesis } = await import('../../../src/forensics/key-genesis');

    await ensureKeyGenesisAnchor();
    digest = 'f'.repeat(64);
    const again = await ensureKeyGenesisAnchor();
    expect(again.status).toBe('stamped');
    expect(request).toHaveBeenCalledTimes(2);
    const stored = await getKeyGenesis();
    expect(stored?.publicKeyDigest).toBe('f'.repeat(64));
    expect(stored?.anchors).toHaveLength(1);
  });

  it('reports why it could not stamp instead of storing an empty record', async () => {
    vi.doMock('../../../src/forensics/signing', () => ({
      getPublicKeyJWK: vi.fn(async () => key.publicJwk),
      publicKeyDigestHex: vi.fn(async () => key.publicKeyDigest),
    }));
    vi.doMock('../../../src/forensics/tsa-client', () => ({
      requestVerifiedTimestamps: vi.fn(async () => ({ anchors: [], reasons: ['freetsa_network_error'] })),
    }));
    const { ensureKeyGenesisAnchor, getKeyGenesis } = await import('../../../src/forensics/key-genesis');
    const r = await ensureKeyGenesisAnchor();
    expect(r.status).toBe('skipped');
    if (r.status === 'skipped') expect(r.reason).toBe('freetsa_network_error');
    expect(await getKeyGenesis()).toBeNull();
  });
});
