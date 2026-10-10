// @vitest-environment node
//
// A seam is attributed when the records on both sides of it came back green.
// verifier/FORMAT.md section 4 now says which readings stop that, and the list
// is easy to get wrong in one direction in particular: a record that verified
// under a key the file CARRIED beside the records, rather than under the file's
// own key, still attributes a seam. Its signature did verify. What the file
// cannot say is whose key it was, which is counted separately as `carriedKey`
// and is not an unverified reading.
//
// The sentence was written into the published format from reading four lines of
// verifier-core-source.ts (`return {ok:true,carriedKey:true,fingerprint:fp}`,
// with no `unverified` flag). Reading is not measuring, and a wrong sentence in
// that document sends a second implementer somewhere this checker does not go.
// So the pair is driven here through real files and the real shipped checker:
// the same three records and the same break, differing only in whether the
// earlier key travels in the file. (2026-09-18)

import { describe, expect, it, beforeAll, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { SPAWN_TIMEOUT_MS } from '../../helpers/spawn-timeout';
import { STANDALONE_VERIFIER_PATH } from '../../../scripts/build-standalone-verifier';
import { attachSignedManifest, buildForensicHtmlExport, type ExportMetadata } from '../../../src/forensics/html-export';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import type { ForensicRecord } from '../../../src/types/forensic';

// This file starts child processes, so its tests do not fit vitest's 5s
// default under a parallel run. See tests/helpers/spawn-timeout.ts.
vi.setConfig({ testTimeout: SPAWN_TIMEOUT_MS });

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

interface Report {
  state: 'verified' | 'partial' | 'failed';
  records: number;
  failures: Array<{ index: number; reason: string }>;
  unverified: { priorKey: number; unsigned: number; signatureUnverified: number; signatureRejected: number };
  carriedKey: number;
  chain: { branches: number; restarts: number; unattributed: number; outside: number };
}

function run(file: string): { report: Report; code: number } {
  try {
    const out = execFileSync(process.execPath, [STANDALONE_VERIFIER_PATH, file, '--json'], { encoding: 'utf8' });
    return { report: JSON.parse(out) as Report, code: 0 };
  } catch (err) {
    const e = err as { status: number; stdout: string };
    return { report: JSON.parse(e.stdout) as Report, code: e.status };
  }
}

interface Key { jwk: JsonWebKey; fp: string; sign: (hash: string) => Promise<string> }

async function freshKey(): Promise<Key> {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const full = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x: full.x, y: full.y };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${jwk.x}|${jwk.y}`));
  const fp = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  const sign = async (hash: string): Promise<string> =>
    Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: { name: 'SHA-256' } }, kp.privateKey, new TextEncoder().encode(hash)))
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { jwk, fp, sign };
}

/** One record, hashed over the key it NAMES and signed by the key given. */
async function record(i: number, prev: string, names: Key, signer: Key, text: string): Promise<ForensicRecord> {
  const base = {
    id: `s-${i}`, timestamp: `2026-09-06T12:00:0${i}.000Z`, platform: 'tiktok', originalText: text, originalHash: 'h',
    originalLength: text.length, neutralizedText: '', author: `@author-${i}`, postUrl: `https://www.tiktok.com/@author-${i}/video/${i}`,
    techniques: [], overallScore: 0, userAgeCategory: 'adult', aiSource: 'cloud', feedSource: 'for-you',
    publicKeyFingerprint: names.fp, chainPosition: i, prevRecordHash: prev, kind: 'post', verdict: 'pass',
  } as unknown as Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'>;
  const integrityHash = await computeRecordIntegrityHash(base);
  return { ...base, integrityHash, signature: await signer.sign(integrityHash) } as ForensicRecord;
}

// A hash of nothing in this file: the link at position 1 resolves to no record,
// and positions 0 and 1 are consecutive, which is the definition of a seam.
const SEAM_PREV = 'c4e9a2f70b18d365a9e2c48f1b7d0e63a5f89c210d4e7b36f8a1c095e2d47b81';

let dir: string;
let withTheKey: string;
let withoutTheKey: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fw-carried-key-seam-'));
  const own = await freshKey();
  const earlier = await freshKey();
  const meta = (carry: boolean): ExportMetadata => ({
    fwVersion: 'V-carried-key-seam-test',
    publicKeyJwk: own.jwk,
    publicKeyFingerprint: own.fp,
    locale: 'en',
    ...(carry ? { publicKeys: [{ fingerprint: earlier.fp, jwk: earlier.jwk }] } : {}),
  } as ExportMetadata);

  // Before the break, signed by the earlier key. After it, the file's own.
  const r0 = await record(0, '', earlier, earlier, 'before the break');
  const r1 = await record(1, SEAM_PREV, own, own, 'first after the break');
  const r2 = await record(2, r1.integrityHash, own, own, 'second after the break');
  const chain = [r0, r1, r2];

  withTheKey = join(dir, 'carried.html');
  writeFileSync(withTheKey, await attachSignedManifest(buildForensicHtmlExport(chain, meta(true)), own.sign), 'utf8');

  withoutTheKey = join(dir, 'not-carried.html');
  writeFileSync(withoutTheKey, await attachSignedManifest(buildForensicHtmlExport(chain, meta(false)), own.sign), 'utf8');
});

describe('a seam whose earlier side was signed by a different key', () => {
  it('is ATTRIBUTED when that key travels in the file: carriedKey is not an unverified reading', () => {
    const { report, code } = run(withTheKey);
    expect(report.failures).toEqual([]);
    expect(report.carriedKey).toBe(1);
    expect(report.unverified).toEqual({ priorKey: 0, unsigned: 0, signatureUnverified: 0, signatureRejected: 0 });
    expect(report.chain.restarts).toBe(1);
    expect(report.chain.unattributed).toBe(0);
    expect(report.chain.branches).toBe(0);
    expect(report.chain.outside).toBe(0);
    // Never green: the file cannot say whose key travelled in it.
    expect(report.state).toBe('partial');
    expect(code).toBe(1);
  });

  it('is UNATTRIBUTED when that key is absent: the same break, one field of the envelope apart', () => {
    const { report, code } = run(withoutTheKey);
    expect(report.failures).toEqual([]);
    expect(report.carriedKey).toBe(0);
    expect(report.unverified.priorKey).toBe(1);
    expect(report.chain.restarts).toBe(1);
    expect(report.chain.unattributed).toBe(1);
    expect(report.state).toBe('partial');
    expect(code).toBe(1);
  });
});
