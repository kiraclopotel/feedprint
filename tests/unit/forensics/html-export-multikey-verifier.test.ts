// The embedded verifier checks each record under the key its fingerprint
// names, for every key the file carries (2026-09-03, the owner's
// consolidated export: "112,836 record signature(s) could not be verified"
// while the keys of 20 of its 58 generations sat in the files he had
// imported). Evaluates the EXACT source the recipient's browser runs.

import { describe, expect, it } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import { VERIFIER_CORE_FNS_SOURCE } from '../../../src/forensics/html-export';

interface Verdict { ok: boolean; unverified?: boolean; priorKey?: boolean; carriedKey?: boolean; unsigned?: boolean; reason?: string; fingerprint?: string }

const verifier = new Function(
  `"use strict";${VERIFIER_CORE_FNS_SOURCE}
   return { verifyOne: verifyOne, importPubKey: importPubKey, fingerprintJwk: fingerprintJwk, verificationState: verificationState };`,
)() as {
  verifyOne(rec: unknown, keys: CryptoKey | Record<string, CryptoKey>, currentFingerprint?: string, redactions?: Record<string, unknown>): Promise<Verdict>;
  importPubKey(jwk: JsonWebKey): Promise<CryptoKey>;
  fingerprintJwk(jwk: JsonWebKey): Promise<string>;
  verificationState(perRecord: Verdict[], chain: { ok: boolean; branches?: number; restarts?: number }): string;
};

async function keypair(): Promise<{ priv: CryptoKey; pub: CryptoKey; fp: string }> {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const pubOnly: JsonWebKey = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
  return { priv: kp.privateKey, pub: await verifier.importPubKey(pubOnly), fp: await verifier.fingerprintJwk(pubOnly) };
}

async function signed(id: string, fp: string, priv: CryptoKey): Promise<ForensicRecord> {
  const payload = {
    id, timestamp: '2026-09-03T08:00:00.000Z', platform: 'twitter', originalText: `t ${id}`,
    originalHash: `oh-${id}`, originalLength: 5, neutralizedText: '', author: '@a', postUrl: 'https://x.com/p/1',
    techniques: [], overallScore: 0, userAgeCategory: 'adult', aiSource: 'cloud', feedSource: 'unknown',
    prevRecordHash: 'genesis', chainPosition: 0, publicKeyFingerprint: fp,
  } as Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'>;
  const integrityHash = await computeRecordIntegrityHash(payload);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: { name: 'SHA-256' } }, priv, new TextEncoder().encode(integrityHash));
  const signature = Buffer.from(sig).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { ...payload, integrityHash, signature } as ForensicRecord;
}

describe('export verifier: one key per generation', () => {
  it('verifies a record of an earlier generation under the carried key, and hash-only without it', async () => {
    const own = await keypair();
    const old = await keypair();
    const rec = await signed('old-1', old.fp, old.priv);

    // Register item 12 (2026-09-06): a carried key verifies the signature but
    // is not attested, so the verdict says so and the file reads partial.
    const withKey = await verifier.verifyOne(rec, { [own.fp]: own.pub, [old.fp]: old.pub }, own.fp);
    expect(withKey).toEqual({ ok: true, carriedKey: true, fingerprint: old.fp });
    expect(verifier.verificationState([withKey], { ok: true })).toBe('partial');
    const ownRec = await signed('own-1', own.fp, own.priv);
    expect(await verifier.verifyOne(ownRec, { [own.fp]: own.pub, [old.fp]: old.pub }, own.fp)).toEqual({ ok: true });

    const without = await verifier.verifyOne(rec, { [own.fp]: own.pub }, own.fp);
    expect(without).toMatchObject({ ok: true, unverified: true, priorKey: true, reason: 'prior-key', fingerprint: old.fp });
    expect(verifier.verificationState([without], { ok: true })).toBe('partial');
  });

  it('a forged signature under a carried key fails, as under the own key', async () => {
    const own = await keypair();
    const old = await keypair();
    const other = await keypair();
    const forged = await signed('old-2', old.fp, other.priv);
    const verdict = await verifier.verifyOne(forged, { [own.fp]: own.pub, [old.fp]: old.pub }, own.fp);
    expect(verdict).toEqual({ ok: false, reason: 'key-mismatch' });
  });

  it('a bare key still means the file\'s own key, and a record with no fingerprint is checked under it', async () => {
    const own = await keypair();
    const rec = await signed('own-1', own.fp, own.priv);
    expect(await verifier.verifyOne(rec, own.pub, own.fp)).toEqual({ ok: true });
    // Written before the fingerprint stamp existed: signed by the own key, names no key.
    const early = await signed('own-2', undefined as unknown as string, own.priv);
    expect(early.publicKeyFingerprint).toBeUndefined();
    expect(await verifier.verifyOne(early, { [own.fp]: own.pub }, own.fp)).toEqual({ ok: true });
  });
});
