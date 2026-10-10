// @vitest-environment node
//
// One condition, two branches of verifyOne, and they disagreed: a record that
// names a signing key the file does not carry. That is what a record written
// by an earlier generation of an install looks like after a key rotation, and
// the ordinary path calls it 'prior-key', unverified, never a failure. The
// withheld path had a second fallback, "or else the file's current key", which
// could fire in no other case, and it checked a signature made by the rotated
// key against the current one. That check cannot succeed, so the record came
// back 'tampered' and the whole file read BROKEN.
//
// Measured 2026-09-18 on verifier/vectors/05-withheld-record.html with the
// withheld record re-signed by a key the file does not carry: BROKEN at
// record 2 (v-1): tampered, exit 2. A person reading that would be told a
// sound export from their own older install had been edited.
//
// Both paths are driven here through a real file and the real shipped checker,
// as a recipient runs it. The third test is the guard on the fix: where the
// named key IS in the file, a signature that does not verify still fails.

import { describe, expect, it, beforeAll, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
  manifest: string;
  records: number;
  keys: number;
  failures: Array<{ index: number; id: string | null; reason: string }>;
  unverified: { priorKey: number; unsigned: number; signatureUnverified: number; signatureRejected: number };
  redacted: number;
  notes: string[];
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

const PAYLOAD_RE = /(<script type="application\/json" id="fw-export-data">)([\s\S]*?)(<\/script>)/;

function editPayload(html: string, edit: (data: Record<string, unknown>) => void): string {
  return html.replace(PAYLOAD_RE, (_m, open: string, body: string, close: string) => {
    const data = JSON.parse(body) as Record<string, unknown>;
    edit(data);
    return open + JSON.stringify(data).replace(/</g, '\\u003c') + close;
  });
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
async function record(i: number, prev: string, names: Key, signer: Key, text: string, extra: Record<string, unknown> = {}): Promise<ForensicRecord> {
  const base = {
    id: `p-${i}`, timestamp: `2026-09-06T12:00:0${i}.000Z`, platform: 'tiktok', originalText: text, originalHash: 'h',
    originalLength: text.length, neutralizedText: '', author: `@author-${i}`, postUrl: `https://www.tiktok.com/@author-${i}/video/${i}`,
    techniques: [], overallScore: 0, userAgeCategory: 'adult', aiSource: 'cloud', feedSource: 'for-you',
    publicKeyFingerprint: names.fp, chainPosition: i, prevRecordHash: prev, kind: 'post', verdict: 'pass',
    ...extra,
  } as unknown as Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'>;
  const integrityHash = await computeRecordIntegrityHash(base);
  return { ...base, integrityHash, signature: await signer.sign(integrityHash) } as ForensicRecord;
}

let dir: string;
let own: Key;
let priorKeyOrdinary: string;
let priorKeyWithheld: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fw-prior-key-withheld-'));
  own = await freshKey();
  // The rotated key: it signs the middle record, and the file does NOT carry it.
  const old = await freshKey();
  const meta = (): ExportMetadata => ({ fwVersion: 'V-prior-key-test', publicKeyJwk: own.jwk, publicKeyFingerprint: own.fp, locale: 'en' });

  const r0 = await record(0, '', own, own, 'before the rotation');
  const r1 = await record(1, r0.integrityHash, old, old, 'signed by the key that has since rotated');
  const r2 = await record(2, r1.integrityHash, own, own, 'after the rotation');

  priorKeyOrdinary = join(dir, 'ordinary-prior-key.html');
  writeFileSync(priorKeyOrdinary, await attachSignedManifest(buildForensicHtmlExport([r0, r1, r2], meta()), own.sign), 'utf8');

  // The same file with the same record withheld: its fields are gone and a
  // signed marker in the file names its id, its hash and the fields.
  const fields = ['author', 'originalText'];
  const markerBase = {
    id: 'p-marker-1', timestamp: '2026-09-06T12:05:00.000Z', platform: 'tiktok',
    originalText: `[redaction-marker @ 2026-09-06T12:05:00.000Z] record=${r1.id} recordHash=${r1.integrityHash} fields=${fields.join(',')} reason=test`,
    originalHash: 'h', originalLength: 0, neutralizedText: '', author: 'system', postUrl: '', techniques: [], overallScore: 0,
    userAgeCategory: 'adult', aiSource: 'rules', feedSource: 'unknown', publicKeyFingerprint: own.fp, chainPosition: 3,
    prevRecordHash: r2.integrityHash, kind: 'redaction-marker', verdict: 'pass', resetReason: 'withheld on request',
  } as unknown as Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'>;
  const markerHash = await computeRecordIntegrityHash(markerBase);
  const marker = { ...markerBase, integrityHash: markerHash, signature: await own.sign(markerHash) } as ForensicRecord;
  const blanked: Record<string, unknown> = { ...r1 };
  for (const f of fields) delete blanked[f];
  blanked.redacted = { markerId: marker.id, at: marker.timestamp, fields };

  priorKeyWithheld = join(dir, 'withheld-prior-key.html');
  writeFileSync(priorKeyWithheld, await attachSignedManifest(
    buildForensicHtmlExport([r0, blanked as unknown as ForensicRecord, r2, marker], meta()), own.sign), 'utf8');
});

describe('a record naming a key the file does not carry', () => {
  it('reads prior-key on the ordinary path: unverified, never a failure', () => {
    const { report, code } = run(priorKeyOrdinary);
    expect(report.failures).toEqual([]);
    expect(report.state).toBe('partial');
    expect(report.unverified.priorKey).toBe(1);
    expect(report.redacted).toBe(0);
    expect(code).toBe(1);
  });

  it('reads prior-key on the WITHHELD path too, and is not called tampering', () => {
    const { report, code } = run(priorKeyWithheld);
    expect(report.failures).toEqual([]);
    expect(report.state).toBe('partial');
    expect(report.unverified.priorKey).toBe(1);
    expect(report.redacted).toBe(1);
    expect(code).toBe(1);

    // And the prose agrees with the counters. The withheld-record note told
    // every reader "its signature over that hash was checked", of every
    // withheld record, and for this one there is no key in the file to check it
    // under, so it was not (2026-09-18). A counter nobody reads saying the
    // right thing does not excuse the sentence everybody reads saying the
    // wrong one.
    const note = report.notes.find((n) => n.includes('had fields withheld'));
    expect(note).toBeDefined();
    expect(note).not.toContain('and its signature over that hash was checked');
    expect(note).toContain('a signing key this file does not carry');
  });

  // The fix removed a fallback, not a check. Where the key the withheld record
  // names IS in the file, its signature over its hash is still the only thing
  // saying the install made the record, and a signature that does not verify
  // still fails. Without this, the two tests above would pass just as well
  // over a branch that had stopped checking signatures altogether.
  it('still fails a withheld record whose signature does not verify under a key the file DOES carry', () => {
    const forged = join(dir, 'withheld-forged.html');
    writeFileSync(forged, editPayload(
      // The manifest signs the records, so it is removed here to let the
      // per-record check be the thing that speaks rather than the manifest.
      // The same removal is how tests/unit/forensics/standalone-verifier.test.ts
      // reaches this branch.
      readFileSync(priorKeyWithheld, 'utf8'),
      (d) => {
        delete d.manifest;
        const rs = d.records as ForensicRecord[];
        const target = rs.find((r) => (r as unknown as { redacted?: unknown }).redacted);
        expect(target).toBeDefined();
        target!.publicKeyFingerprint = own.fp;
        target!.signature = 'A'.repeat(86);
      },
    ), 'utf8');
    const { report, code } = run(forged);
    expect(report.failures.some((f) => f.reason === 'tampered')).toBe(true);
    expect(report.state).toBe('failed');
    expect(code).toBe(2);
  });
});
