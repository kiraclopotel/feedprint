// The install's public-key fingerprint is computed in six places by hand, and
// until 2026-09-18 nothing compared any two of them.
//
// The rule is one line: SHA-256 over the P-256 JWK's `x`, a pipe, and its `y`,
// rendered lowercase hex, first sixteen characters. Every export carries the
// result in its envelope AND inside each record's canonical payload, and the
// first thing a recipient's checker does is recompute it and refuse the file if
// it disagrees:
//
//   importVerifiedPubKey -> 'embedded public-key fingerprint mismatch'
//
// That refusal happens BEFORE a single record is checked. So a one-character
// drift between the signer and the checker does not degrade a file, it makes
// every export produced that day unusable in a recipient's hands, silently on
// the producing side, where nothing would fail.
//
// The existing tests could not see it. export-manifest, html-export-multikey,
// redaction, legacy-media-record and relegation-position-integrity all compute
// the fingerprint with the VERIFIER'S OWN function and then hand it back to the
// verifier: a thing compared to itself. known-keys does the same with the
// signer on both sides. The conformance vectors cannot help either, because
// they are minted by a seventh copy in the vector generator and checked by the
// verifier, so the production signer never touches them.
//
// Two guards here, because neither alone is enough. The first drives the signer
// and the shipped checker against each other for real, over a real export,
// which is the pair whose disagreement breaks recipients. The second reads the
// rule out of all six sources as text, because a value test needs an
// implementation it can call and four of the six are inline expressions in
// build scripts that no test imports.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import { fingerprintPublicJwk } from '../../src/forensics/signing';
import { STANDALONE_VERIFIER_PATH } from '../../scripts/build-standalone-verifier';
import { attachSignedManifest, buildForensicHtmlExport, type ExportMetadata } from '../../src/forensics/html-export';
import { computeRecordIntegrityHash } from '../../src/forensics/canonical-payload';
import type { ForensicRecord } from '../../src/types/forensic';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

// ── guard one: the signer and the checker, driven ────────────────────────────

describe('the signer and the recipient checker agree on the fingerprint', () => {
  it('a file whose fingerprint came from the PRODUCTION signer is accepted', async () => {
    const kp = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const full = await crypto.subtle.exportKey('jwk', kp.publicKey);
    const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x: full.x, y: full.y };

    // The only line that matters: the envelope's fingerprint is minted by
    // src/forensics/signing.ts, not by the verifier and not by a vector
    // generator, so the checker below is meeting the signer for the first time.
    const fingerprint = await fingerprintPublicJwk(jwk);

    const sign = async (hash: string): Promise<string> =>
      Buffer.from(await crypto.subtle.sign(
        { name: 'ECDSA', hash: { name: 'SHA-256' } }, kp.privateKey,
        new TextEncoder().encode(hash)))
        .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const base = {
      id: 'k-0', timestamp: '2026-09-18T10:00:00Z', platform: 'tiktok',
      originalText: 'a post', originalHash: 'h', originalLength: 6, neutralizedText: '',
      author: '@a', postUrl: 'https://www.tiktok.com/@a/video/1', techniques: [],
      overallScore: 0, userAgeCategory: 'adult', aiSource: 'cloud', feedSource: 'for-you',
      publicKeyFingerprint: fingerprint, chainPosition: 0, prevRecordHash: '',
      kind: 'post', verdict: 'pass',
    } as unknown as Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'>;
    const integrityHash = await computeRecordIntegrityHash(base);
    const record = { ...base, integrityHash, signature: await sign(integrityHash) } as ForensicRecord;

    const meta: ExportMetadata = {
      fwVersion: 'V-fingerprint-parity-test',
      publicKeyJwk: jwk, publicKeyFingerprint: fingerprint, locale: 'en',
    } as ExportMetadata;

    const html = await attachSignedManifest(buildForensicHtmlExport([record], meta), sign);
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const file = join(mkdtempSync(join(tmpdir(), 'fw-fp-parity-')), 'export.html');
    writeFileSync(file, html, 'utf8');

    let report: { state: string; failures: { reason: string }[] };
    try {
      report = JSON.parse(execFileSync(
        process.execPath, [STANDALONE_VERIFIER_PATH, file, '--json'], { encoding: 'utf8' }));
    } catch (err) {
      report = JSON.parse((err as { stdout: string }).stdout);
    }

    // If the two rules ever disagree this is 'failed' with reason 'key-setup',
    // detail 'embedded public-key fingerprint mismatch', and records: 0.
    expect(report.failures.map((f) => f.reason), 'the checker did not refuse the signer’s key')
      .not.toContain('key-setup');
    expect(report.state).toBe('verified');
  }, 30_000);
});

// ── guard two: the rule, read out of all six sources ─────────────────────────

/** Where each implementation lives, and enough of a hook to find it. */
const SITES: { file: string; near: string }[] = [
  { file: 'src/forensics/signing.ts', near: 'publicKeyDigestHex' },
  { file: 'src/forensics/verifier-core-source.ts', near: 'function fingerprintJwk' },
  { file: 'scripts/build-verifier-vectors.ts', near: 'function fingerprintOf' },
  { file: 'scripts/build-demo-export.ts', near: 'const fingerprint =' },
  { file: 'scripts/salvage-gather.ts', near: 'function fingerprintOf' },
  { file: 'scripts/salvage-keys.ts', near: 'const derived =' },
];

/**
 * The two facts that ARE the rule, lifted out of whatever idiom states them.
 *
 * The idioms genuinely differ and must: the browser has Web Crypto, node has
 * createHash, and the checker ships as ES5 inside a template string. So the
 * comparison is not of the text but of what the text says: which material is
 * hashed, and how much of the hex is kept.
 */
function ruleIn(source: string, near: string): { material: string; slice: string } {
  const at = source.indexOf(near);
  expect(at, `found ${near}`).toBeGreaterThan(-1);
  const region = source.slice(at, at + 600);

  // The joined material, normalised: drop the template and property syntax so
  // that `${jwk.x ?? ''}|${jwk.y ?? ''}` (production, tolerant of a missing
  // coordinate) and `jwk.x+'|'+jwk.y` (the checker, which throws instead) both
  // reduce to the same three characters. The nullish default is stripped BEFORE
  // the quotes are, because it contains a pair of them.
  const joinMatch = region.match(/`[^`]*\|[^`]*`|jwk\.x\s*\+\s*['"]\|['"]\s*\+\s*jwk\.y/);
  expect(joinMatch, `found the joined material near ${near}`).not.toBeNull();
  const material = joinMatch![0]
    .replace(/\?\?\s*''/g, '')
    .replace(/\$\{|\}/g, '')
    .replace(/jwk\.|['"`+\s]/g, '');

  const sliceMatch = region.match(/slice\(\s*0\s*,\s*(\d+)\s*\)/);
  expect(sliceMatch, `found the slice near ${near}`).not.toBeNull();
  return { material, slice: sliceMatch![1] };
}

describe('all six implementations state one rule', () => {
  it('hash the same material and keep the same number of characters', () => {
    const read = SITES.map((s) => ({
      file: s.file,
      ...ruleIn(readFileSync(join(REPO_ROOT, s.file), 'utf8'), s.near),
    }));

    // A guard that found nothing because it looked at nothing is worthless.
    expect(read, 'every site was read').toHaveLength(6);

    for (const r of read) {
      expect(r.material, `${r.file} hashes x|y`).toBe('x|y');
      expect(r.slice, `${r.file} keeps 16 characters`).toBe('16');
    }
  });

  it('uses SHA-256 in every one of them', () => {
    for (const s of SITES) {
      const source = readFileSync(join(REPO_ROOT, s.file), 'utf8');
      const at = source.indexOf(s.near);
      const region = source.slice(at, at + 600);
      expect(region, `${s.file} digests with SHA-256`).toMatch(/SHA-256|sha256/i);
    }
  });

  // The extractor itself, shown to fire. Without this the block above passes
  // the day somebody changes a slice and the regex quietly stops matching.
  it('the extractor notices a changed rule', () => {
    const drifted = "function fingerprintOf(jwk){ return sha256(`${jwk.x}|${jwk.y}`).slice(0, 12); }";
    expect(ruleIn(drifted, 'function fingerprintOf').slice).toBe('12');
    const wrongMaterial = "function fingerprintOf(jwk){ return sha256(`${jwk.y}|${jwk.x}`).slice(0, 16); }";
    expect(ruleIn(wrongMaterial, 'function fingerprintOf').material).toBe('y|x');
  });
});
