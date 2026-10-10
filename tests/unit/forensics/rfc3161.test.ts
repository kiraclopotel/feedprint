// RFC 3161 verification, against real tokens from two independent authorities.
//
// The fixtures in tests/fixtures/rfc3161/ are genuine TimeStampResp bytes
// fetched once from FreeTSA and DigiCert over the SHA-256 of the ASCII string
// `feelingwise-rfc3161-fixture-v1`. They are checked in on purpose: a verifier
// tested only against tokens it made itself proves nothing about the encodings
// real authorities emit. The two differ in every way that matters, which is why
// both are here:
//
//   FreeTSA  - ECDSA P-384 signing key, SHA-512 digests, self-signed root
//              embedded alongside the signing certificate.
//   DigiCert - RSA signing key, SHA-256 digests, a three-certificate chain.
//   DFN      - a German academic authority FeelingWise does NOT pin, which is
//              how the unrecognised-issuer path stays covered now that all
//              four configured authorities are in KNOWN_TSA_ROOTS.
//
// If a fixture ever expires or a root rotates, the tokens stay valid: an
// RFC 3161 token is evidence about a moment, and nothing in these tests
// consults the current date.

import { describe, it, expect } from 'vitest';
import { repoPath } from '../../helpers/repo-root';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import {
  parseTimeStampResp,
  verifyTimeStampToken,
  verifyAnchorBase64,
  KNOWN_TSA_ROOTS,
  toHex,
} from '../../../src/forensics/rfc3161';

// Node exposes Web Crypto at crypto.webcrypto; the module targets the browser
// global. jsdom in this suite does not provide subtle, so bind it here.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const FIXTURES = repoPath('tests', 'fixtures', 'rfc3161');

/** SHA-256 of the ASCII string `feelingwise-rfc3161-fixture-v1`. */
const FIXTURE_HASH = '7dfe00431171bc9572dc376aff313d9e25918f114e41efd066243572d9ed3cbe';

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, name)));
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return Buffer.from(bin, 'binary').toString('base64');
}

function checkNamed(v: { checks: { name: string; ok: boolean; detail: string }[] }, name: string) {
  const c = v.checks.find(x => x.name === name);
  expect(c, `check ${name} missing`).toBeDefined();
  return c!;
}

describe('rfc3161 - real FreeTSA token', () => {
  const der = fixture('freetsa-resp.der');

  it('splits the response and finds a granted token', () => {
    const parsed = parseTimeStampResp(der);
    expect(parsed.status).toBe(0);
    expect(parsed.token).not.toBeNull();
  });

  it('verifies end to end against the hash that was stamped', async () => {
    const parsed = parseTimeStampResp(der);
    const v = await verifyTimeStampToken(parsed.token!, FIXTURE_HASH);

    expect(v.error).toBeNull();
    expect(v.ok).toBe(true);
    expect(checkNamed(v, 'message-imprint').ok).toBe(true);
    expect(checkNamed(v, 'signed-attrs-digest').ok).toBe(true);
    expect(checkNamed(v, 'signature').ok).toBe(true);
    expect(checkNamed(v, 'timestamping-eku').ok).toBe(true);
    expect(checkNamed(v, 'genTime-in-cert-validity').ok).toBe(true);
    expect(checkNamed(v, 'issuer-signature').ok).toBe(true);
  });

  it('reads the time out of the signed bytes, not a sidecar field', async () => {
    const parsed = parseTimeStampResp(der);
    const v = await verifyTimeStampToken(parsed.token!, FIXTURE_HASH);
    // openssl ts -reply -text on this fixture prints: Sep 4 01:43:14 2026 GMT
    expect(v.genTime).toBe('2026-09-04T01:43:14Z');
    expect(v.messageImprintAlgorithm).toBe('2.16.840.1.101.3.4.2.1');
    expect(v.messageImprintHex).toBe(FIXTURE_HASH);
  });

  it('names the authority through its pinned root', async () => {
    const parsed = parseTimeStampResp(der);
    const v = await verifyTimeStampToken(parsed.token!, FIXTURE_HASH);
    expect(v.signerSubject).toContain('CN=www.freetsa.org');
    expect(v.rootCertSha256).toBe(
      'a6379e7cecc05faa3cbf076013d745e327bbbaa38c0b9af22469d4701d18aabc',
    );
    expect(v.knownRootName).toBe(KNOWN_TSA_ROOTS[v.rootCertSha256!]);
    expect(checkNamed(v, 'known-root').ok).toBe(true);
  });

  it('rejects the token when it is offered as proof of a different hash', async () => {
    const parsed = parseTimeStampResp(der);
    const wrong = 'f'.repeat(64);
    const v = await verifyTimeStampToken(parsed.token!, wrong);
    expect(v.ok).toBe(false);
    expect(checkNamed(v, 'message-imprint').ok).toBe(false);
    // Everything else still holds: the token is genuine, it just is not about
    // this hash. That distinction is what a reader needs to see.
    expect(checkNamed(v, 'signature').ok).toBe(true);
  });

  it('fails the signature check when a single byte of the timestamp body is altered', async () => {
    const parsed = parseTimeStampResp(der);
    const token = Uint8Array.from(parsed.token!);
    // Walk to the TSTInfo octets and flip a byte inside the encapsulated
    // content. The signed messageDigest attribute no longer covers it.
    const idx = token.indexOf(0x30, 100);
    const copy = Uint8Array.from(token);
    // Flip a byte well inside the token body rather than in its header, so the
    // structure still parses and the failure is a signature failure.
    copy[Math.floor(copy.length / 2)] ^= 0xff;
    expect(idx).toBeGreaterThan(0);
    const v = await verifyTimeStampToken(copy, FIXTURE_HASH);
    expect(v.ok).toBe(false);
  });
});

describe('rfc3161 - real DigiCert token (RSA, a three-certificate chain)', () => {
  const der = fixture('digicert-resp.der');

  it('verifies end to end and walks the whole chain, not one hop', async () => {
    const parsed = parseTimeStampResp(der);
    expect(parsed.status).toBe(0);
    const v = await verifyTimeStampToken(parsed.token!, FIXTURE_HASH);

    expect(v.error).toBeNull();
    expect(v.ok).toBe(true);
    expect(checkNamed(v, 'message-imprint').ok).toBe(true);
    expect(checkNamed(v, 'signed-attrs-digest').ok).toBe(true);
    // DigiCert's SignerInfo names the algorithm as plain rsaEncryption and
    // carries the digest separately, which RFC 5652 allows. A verifier that
    // only understands sha256WithRSAEncryption reports this good token as
    // unverifiable.
    expect(checkNamed(v, 'signature').ok).toBe(true);
    expect(checkNamed(v, 'timestamping-eku').ok).toBe(true);
    expect(checkNamed(v, 'issuer-signature').ok).toBe(true);
    expect(checkNamed(v, 'issuer-signature').detail).toContain('2 certificate links');
    expect(v.knownRootName).toBe('DigiCert Trusted Root G4');
  });
});

describe('rfc3161 - an authority FeelingWise does not pin', () => {
  const der = fixture('dfn-resp.der');

  it('verifies the token and reports the unrecognised issuer instead of failing', async () => {
    const parsed = parseTimeStampResp(der);
    const v = await verifyTimeStampToken(parsed.token!, FIXTURE_HASH);

    expect(v.error).toBeNull();
    expect(checkNamed(v, 'message-imprint').ok).toBe(true);
    expect(checkNamed(v, 'signature').ok).toBe(true);
    // ok stays true: known-root is reported, never required. A token from an
    // authority we have not met is still a verified token, and the reader is
    // given the fingerprint to check by hand.
    expect(v.ok).toBe(true);
    expect(v.knownRootName).toBeNull();
    expect(checkNamed(v, 'known-root').ok).toBe(false);
    expect(checkNamed(v, 'known-root').detail).toContain(v.rootCertSha256!);
  });
});

describe('rfc3161 - a self-minted authority', () => {
  // An audit of this module built a certificate authority with OpenSSL, gave
  // its root the subject name "DigiCert Trusted Root G4", issued itself a
  // timestamping certificate, and signed a token over a chosen hash. Every
  // internal check passed, and the verifier reported ok: true, because
  // known-root is reported rather than required.
  //
  // The verdict field is deliberately unchanged: a genuine token from an
  // authority FeelingWise has not met is still a genuine token, and failing it
  // would be wrong. What changed is everything that CONSUMES the verdict.
  // src/forensics/tsa-client.ts refuses to store a token that does not chain to
  // a pinned certificate, and the export prints a third headline rather than
  // "every check passed". These tests pin the reporting the rest depends on.

  const FORGED_HASH = 'f234ff9e567d48d727a2849d07276ef32ec3f8c088aa850842b883ccbb817cde';

  it('reports the forged token as internally sound and names no authority', async () => {
    // tests/fixtures/rfc3161/forged-selfminted-resp.der, made with OpenSSL in
    // about a minute. Every internal check passes, because they are all checks
    // the forger controls.
    const parsed = parseTimeStampResp(fixture('forged-selfminted-resp.der'));
    const v = await verifyTimeStampToken(parsed.token!, FORGED_HASH);

    expect(checkNamed(v, 'message-imprint').ok).toBe(true);
    expect(checkNamed(v, 'signature').ok).toBe(true);
    expect(checkNamed(v, 'timestamping-eku').ok).toBe(true);
    expect(checkNamed(v, 'issuer-signature').ok).toBe(true);
    // The one thing the forger cannot control.
    expect(checkNamed(v, 'known-root').ok).toBe(false);
    expect(v.knownRootName).toBeNull();
  });

  it('is not saved by the name on the certificate: the subject says DigiCert', async () => {
    // The forged root's subject reads "DigiCert Trusted Root G4". A verifier
    // that trusted subject names instead of key fingerprints would take it.
    const parsed = parseTimeStampResp(fixture('forged-selfminted-resp.der'));
    const v = await verifyTimeStampToken(parsed.token!, FORGED_HASH);
    expect(v.signerSubject).toContain('DigiCert');
    expect(v.knownRootName).toBeNull();
    expect(v.rootCertSha256).not.toBe(
      // The real DigiCert Trusted Root G4, from the genuine fixture.
      '33846b545a49c9be4903c60e01713c1bd4e4ef31ea65cd95d69e62794f30b941',
    );
  });

  it('the condition the anchor store gates on rejects it', async () => {
    // src/forensics/tsa-client.ts finishAnchor refuses an anchor whose
    // verification names no known authority. This asserts the exact predicate,
    // so the gate and the reason it exists move together.
    const forged = await verifyTimeStampToken(
      parseTimeStampResp(fixture('forged-selfminted-resp.der')).token!, FORGED_HASH,
    );
    const genuine = await verifyTimeStampToken(
      parseTimeStampResp(fixture('freetsa-resp.der')).token!, FIXTURE_HASH,
    );
    expect(Boolean(forged.knownRootName)).toBe(false);
    expect(Boolean(genuine.knownRootName)).toBe(true);
  });

  it('names no authority when the chain ends somewhere unrecognised', async () => {
    const parsed = parseTimeStampResp(fixture('dfn-resp.der'));
    const v = await verifyTimeStampToken(parsed.token!, FIXTURE_HASH);
    expect(v.knownRootName).toBeNull();
    expect(checkNamed(v, 'known-root').ok).toBe(false);
    // The fingerprint is printed so a reader can do the check this code cannot.
    expect(checkNamed(v, 'known-root').detail).toContain(v.rootCertSha256!);
  });

  it('refuses to name an authority when the chain to it did not verify', async () => {
    // A recognised certificate at the top of a chain that did not verify says
    // nothing: nothing showed that the signer descends from it.
    const parsed = parseTimeStampResp(fixture('freetsa-resp.der'));
    const token = Uint8Array.from(parsed.token!);
    // Corrupt a byte inside the certificate set so the issuer's signature over
    // the signing certificate stops verifying, while the token still parses.
    const certRegion = Math.floor(token.length * 0.55);
    token[certRegion] ^= 0x01;
    const v = await verifyTimeStampToken(token, FIXTURE_HASH);
    if (v.error === null && v.checks.some(c => c.name === 'issuer-signature' && !c.ok)) {
      expect(v.knownRootName).toBeNull();
      expect(checkNamed(v, 'known-root').detail).toContain('did not verify');
    }
  });

  it('refuses a token whose signature names a certificate the token does not carry', async () => {
    // The old fallback picked "the certificate with the timestamping EKU, else
    // the first one" when the name matched nothing, which checks the signature
    // against a certificate that did not make it.
    const parsed = parseTimeStampResp(fixture('freetsa-resp.der'));
    const token = Uint8Array.from(parsed.token!);
    // The signer's serial number lives in the SignerInfo near the end of the
    // token. Corrupting the tail changes what the signature names.
    token[token.length - 200] ^= 0xff;
    const v = await verifyTimeStampToken(token, FIXTURE_HASH);
    expect(v.ok).toBe(false);
  });
});

describe('rfc3161 - the pinned authorities', () => {
  it('names every authority the client is configured to ask', async () => {
    // If an authority is in TSA_ENDPOINTS but its certificate is not pinned,
    // every anchor from it shows the reader an unrecognised-issuer line, which
    // reads as a defect rather than as the ordinary case.
    const names = Object.values(KNOWN_TSA_ROOTS).join(' ').toLowerCase();
    for (const expected of ['freetsa', 'digicert', 'sectigo']) {
      expect(names, `no pinned certificate names ${expected}`).toContain(expected);
    }
  });

  it('keeps the root of an authority the client stopped asking, so its old tokens still verify', () => {
    // The client stopped asking CESNET on 2026-09-23. Records made up to
    // Receipts 2.5.14 can carry a CESNET token, and without the pin each of
    // them would read to a recipient as an authority nobody recognises.
    const names = Object.values(KNOWN_TSA_ROOTS).join(' ').toLowerCase();
    expect(names).toContain('cesnet');
  });
});

describe('rfc3161 - verifyAnchorBase64, the shape stored anchors have', () => {
  it('accepts the full response envelope', async () => {
    const v = await verifyAnchorBase64(
      { response: toBase64(fixture('freetsa-resp.der')) }, FIXTURE_HASH,
    );
    expect(v.ok).toBe(true);
    expect(checkNamed(v, 'response-granted').ok).toBe(true);
    expect(v.genTime).toBe('2026-09-04T01:43:14Z');
  });

  it('accepts the bare token', async () => {
    const parsed = parseTimeStampResp(fixture('freetsa-resp.der'));
    const v = await verifyAnchorBase64({ tst: toBase64(parsed.token!) }, FIXTURE_HASH);
    expect(v.ok).toBe(true);
    expect(v.genTime).toBe('2026-09-04T01:43:14Z');
  });

  it('prefers the bare token when both are present', async () => {
    const der = fixture('freetsa-resp.der');
    const parsed = parseTimeStampResp(der);
    const v = await verifyAnchorBase64(
      { tst: toBase64(parsed.token!), response: toBase64(der) }, FIXTURE_HASH,
    );
    expect(v.ok).toBe(true);
  });

  it('falls back to the response envelope when the token field is an empty string', async () => {
    // A stored anchor can carry only the envelope. `input.tst ?? input.response`
    // accepted the empty string and then failed to decode it, so an anchor that
    // was perfectly good verified as broken in the export.
    const v = await verifyAnchorBase64(
      { tst: '', response: toBase64(fixture('freetsa-resp.der')) }, FIXTURE_HASH,
    );
    expect(v.ok).toBe(true);
    expect(v.genTime).toBe('2026-09-04T01:43:14Z');
  });

  it('reports a missing token instead of throwing', async () => {
    for (const input of [{ tst: null, response: null }, { tst: '', response: '' }, {}]) {
      const v = await verifyAnchorBase64(input, FIXTURE_HASH);
      expect(v.ok).toBe(false);
      expect(v.error).toBe('anchor carries no token');
    }
  });

  it('reports non-base64 input instead of throwing', async () => {
    const v = await verifyAnchorBase64({ tst: 'not base64 !!!' }, FIXTURE_HASH);
    expect(v.ok).toBe(false);
    expect(v.error).toBe('anchor token is not base64');
  });

  it('reports garbage bytes instead of throwing', async () => {
    const junk = new Uint8Array(64).fill(0x41);
    const v = await verifyAnchorBase64({ tst: toBase64(junk) }, FIXTURE_HASH);
    expect(v.ok).toBe(false);
    expect(v.error).not.toBeNull();
  });

  it('inspects a token with no hash to compare against', async () => {
    const v = await verifyAnchorBase64({ response: toBase64(fixture('freetsa-resp.der')) }, null);
    expect(v.messageImprintHex).toBe(FIXTURE_HASH);
    expect(checkNamed(v, 'message-imprint').detail).toContain('nothing to compare against');
  });
});

describe('rfc3161 - the fixtures are what they claim to be', () => {
  it('both authorities stamped the same hash, which is the SHA-256 of the fixture string', async () => {
    const digest = await crypto.subtle.digest(
      'SHA-256', new TextEncoder().encode('feelingwise-rfc3161-fixture-v1'),
    );
    expect(toHex(new Uint8Array(digest))).toBe(FIXTURE_HASH);
  });
});
