// @vitest-environment node
//
// The reference receiver (verifier/receive-export.mjs): the organisation's
// end of the donation route. Run as a child process the way an organisation
// runs it, on a free port: a real signed export POSTed to it is kept with its
// reading and answered with a receipt whose id is the file's own digest; the
// same file twice is kept once; a file that is not an export is refused with
// 422; a body over the limit with 413; anything but POST with 405.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import { attachSignedManifest, buildForensicHtmlExport } from '../../../src/forensics/html-export';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import type { ForensicRecord } from '../../../src/types/forensic';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const RECEIVER = resolve(dirname(fileURLToPath(import.meta.url)), '../../../verifier/receive-export.mjs');

function start(args: string[]): Promise<{ child: ChildProcess; port: number }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [RECEIVER, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout!.on('data', (d: Buffer) => {
      out += d.toString();
      const m = /receiving exports on http:\/\/[^:]+:(\d+)\//.exec(out);
      if (m) resolvePromise({ child, port: Number(m[1]) });
    });
    child.stderr!.on('data', (d: Buffer) => { reject(new Error(d.toString())); });
    child.on('exit', (code) => { reject(new Error('receiver exited ' + code + ': ' + out)); });
  });
}

let dir: string;
let child: ChildProcess;
let port: number;
let signedHtml: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fw-receiver-'));
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const full = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x: full.x, y: full.y };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${jwk.x}|${jwk.y}`));
  const fp = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  const sign = async (hash: string): Promise<string> => {
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: { name: 'SHA-256' } }, kp.privateKey, new TextEncoder().encode(hash));
    return Buffer.from(sig).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const base = {
    id: 'd-0', timestamp: '2026-07-01T10:00:00.000Z', platform: 'tiktok', originalText: 'post 0', originalHash: 'h',
    originalLength: 6, neutralizedText: '', author: '@user', postUrl: '', techniques: [], overallScore: 0, userAgeCategory: 'adult',
    aiSource: 'cloud', feedSource: 'for-you', publicKeyFingerprint: fp, chainPosition: 0, prevRecordHash: '', kind: 'post', verdict: 'pass',
  } as Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'>;
  const integrityHash = await computeRecordIntegrityHash(base);
  const record = { ...base, integrityHash, signature: await sign(integrityHash) } as ForensicRecord;
  signedHtml = await attachSignedManifest(buildForensicHtmlExport([record], { fwVersion: 'V-test', publicKeyJwk: jwk, publicKeyFingerprint: fp, locale: 'en' }), sign);

  ({ child, port } = await start(['--dir', dir, '--port', '0']));
}, 20000);

afterAll(() => { child?.kill(); });

describe('verifier/receive-export.mjs', () => {
  it('keeps a POSTed export with its reading and answers with a receipt that is the file digest', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`, { method: 'POST', headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: signedHtml });
    expect(res.status).toBe(200);
    const id = res.headers.get('X-Receipt');
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(await res.text()).toBe(`receipt ${id}: verified`);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(existsSync(join(dir, `${id}.html`))).toBe(true);
    expect(readFileSync(join(dir, `${id}.html`), 'utf8')).toBe(signedHtml);
    const report = JSON.parse(readFileSync(join(dir, `${id}.report.json`), 'utf8')) as { receipt: string; state: string; records: number; manifest: string };
    expect(report).toMatchObject({ receipt: id, state: 'verified', records: 1, manifest: 'ok' });

    // The same file again: the same receipt, still one copy.
    const again = await fetch(`http://127.0.0.1:${port}/`, { method: 'POST', body: signedHtml });
    expect(again.headers.get('X-Receipt')).toBe(id);
    expect(readdirSync(dir).filter((f) => f.endsWith('.html'))).toEqual([`${id}.html`]);
  });

  it('refuses what is not an export, and anything but POST', async () => {
    const bad = await fetch(`http://127.0.0.1:${port}/`, { method: 'POST', body: '<!DOCTYPE html><p>hello</p>' });
    expect(bad.status).toBe(422);
    expect(await bad.text()).toContain('not a Feedprint export');
    // JSON that parses but is no envelope is refused too, so the store never holds arbitrary objects.
    const junk = await fetch(`http://127.0.0.1:${port}/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"hello":"world"}' });
    expect(junk.status).toBe(422);
    const get = await fetch(`http://127.0.0.1:${port}/`);
    expect(get.status).toBe(405);
    const options = await fetch(`http://127.0.0.1:${port}/`, { method: 'OPTIONS' });
    expect(options.status).toBe(204);
    expect(readdirSync(dir).filter((f) => f.endsWith('.html'))).toHaveLength(1);
  });

  it('refuses a body over its limit with 413', async () => {
    const small = await start(['--dir', join(dir, 'small'), '--port', '0', '--max-mb', '0']);
    try {
      const res = await fetch(`http://127.0.0.1:${small.port}/`, { method: 'POST', body: signedHtml }).catch((err: Error) => err);
      // The server answers 413 and closes the socket; some fetches see the
      // status, others the reset. Either way nothing was kept.
      if (res instanceof Response) expect(res.status).toBe(413);
      expect(existsSync(join(dir, 'small')) ? readdirSync(join(dir, 'small')) : []).toEqual([]);
    } finally {
      small.child.kill();
    }
  });
});
