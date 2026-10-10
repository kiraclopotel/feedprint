// A record written BEFORE 2.5.0 carries videoContext / imageContext evidence and a
// configSnapshot naming the two media-understanding states. Version 2.5.0 removed the
// pipelines that produced them (docs/history/2026-09/MEDIA-FEATURE-REMOVAL-BRIEF-2026-09-04.md). Removing a
// capability going forward must not rewrite what was already signed, so this locks the two
// properties that make an old export still usable: the record hashes to the same value it
// did before the removal, and the export's own embedded verifier, running its exact source,
// still verifies it.
//
// The pinned hash is the load-bearing part. It was computed on the pre-removal tree
// (commit 2b7c5d3^) over the identical record and must never change.

import { describe, expect, it } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import { buildForensicHtmlExport, VERIFIER_CORE_FNS_SOURCE } from '../../../src/forensics/html-export';

interface Verdict { ok: boolean; unverified?: boolean; reason?: string }

const verifier = new Function(
  `"use strict";${VERIFIER_CORE_FNS_SOURCE}
   return { verifyOne: verifyOne, importPubKey: importPubKey, fingerprintJwk: fingerprintJwk };`,
)() as {
  verifyOne(rec: unknown, keys: CryptoKey | Record<string, CryptoKey>, currentFingerprint?: string): Promise<Verdict>;
  importPubKey(jwk: JsonWebKey): Promise<CryptoKey>;
  fingerprintJwk(jwk: JsonWebKey): Promise<string>;
};

/** Exactly the shape the 2026-08-02 video/image joins wrote. Do not edit: the hash below is over it. */
const LEGACY_PAYLOAD = {
  id: 'legacy-media-1',
  timestamp: '2026-08-02T10:00:00.000Z',
  platform: 'tiktok',
  originalText: 'a caption the child saw',
  originalHash: 'a'.repeat(64),
  originalLength: 23,
  neutralizedText: null,
  techniques: [{ name: 'violence', severity: 7, confidence: 0.8 }],
  verdict: 'flagged-hidden',
  aiSource: 'ai',
  mode: 'child',
  userAgeCategory: 'child',
  author: 'someone',
  chainPosition: 0,
  priorChainHash: '0'.repeat(64),
  kind: 'video',
  configSnapshot: {
    mode: 'child', threshold: 6, dailyCap: 2000,
    videoUnderstanding: 'on', imageUnderstanding: 'unlicensed',
  },
  videoContext: {
    overlayText: 'ON-SCREEN WORDS', scene: 'a street at night', contentType: 'clip',
    techniques: ['violence'], severity: 7, model: 'gemini-3.1-flash-lite', frameCount: 4,
    description: 'the caption', transcript: 'spoken words',
    audioModel: 'whisper-large-v3-turbo', audioLanguage: 'english',
  },
  imageContext: {
    overlayText: 'TEXT ON PICTURE', scene: 'a poster', contentType: 'photo',
    techniques: [], severity: 2, model: 'gemini-3.1-flash-lite', imageCount: 2,
  },
} as unknown as Omit<ForensicRecord, 'integrityHash' | 'signature'>;

/** Computed on the pre-removal tree over LEGACY_PAYLOAD. A change here is a broken chain. */
const PRE_REMOVAL_HASH = '738aa8b8030912d5cf4b5d274956d441f2d0b3350180a54198fc8305186dec4c';

describe('a record written before 2.5.0, with media evidence', () => {
  it('hashes to exactly the value it did before the media pipelines were removed', async () => {
    expect(await computeRecordIntegrityHash(LEGACY_PAYLOAD)).toBe(PRE_REMOVAL_HASH);
  });

  it("passes the export's own embedded verifier, signature and hash", async () => {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
    const pubOnly: JsonWebKey = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
    const fingerprint = await verifier.fingerprintJwk(pubOnly);

    const integrityHash = await computeRecordIntegrityHash({ ...LEGACY_PAYLOAD, publicKeyFingerprint: fingerprint });
    const sig = await crypto.subtle.sign(
      { name: 'ECDSA', hash: { name: 'SHA-256' } },
      kp.privateKey,
      new TextEncoder().encode(integrityHash),
    );
    const signature = Buffer.from(sig).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const record = { ...LEGACY_PAYLOAD, publicKeyFingerprint: fingerprint, integrityHash, signature } as ForensicRecord;

    const keys = { [fingerprint]: await verifier.importPubKey(pubOnly) };
    expect(await verifier.verifyOne(record, keys, fingerprint)).toEqual({ ok: true });
  });

  it('still renders its media evidence into a fresh export', async () => {
    const integrityHash = await computeRecordIntegrityHash(LEGACY_PAYLOAD);
    const html = buildForensicHtmlExport([{ ...LEGACY_PAYLOAD, integrityHash } as ForensicRecord], {
      locale: 'en',
      fwVersion: '2.5.0',
      publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' } as JsonWebKey,
      publicKeyFingerprint: 'fp-legacy',
    } as Parameters<typeof buildForensicHtmlExport>[1]);
    expect(html).toContain('ON-SCREEN WORDS');
    expect(html).toContain('spoken words');
    expect(html).toContain('TEXT ON PICTURE');
  });
});
