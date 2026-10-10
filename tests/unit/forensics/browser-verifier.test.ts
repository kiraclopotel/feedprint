// @vitest-environment jsdom
//
// The browser build of the separate checker (verifier/verify-export.browser.js,
// loaded by verifier/index.html): the same text as verify-export.mjs with a
// browser head and tail, one global. Locks: the committed file is what the
// builder writes; evaluated in a page it verifies a real signed export and
// names a tampered record; index.html loads it and nothing else, from nowhere.

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { webcrypto } from 'node:crypto';
import { buildBrowserVerifierSource, BROWSER_VERIFIER_PATH } from '../../../scripts/build-standalone-verifier';
import { attachSignedManifest, buildForensicHtmlExport } from '../../../src/forensics/html-export';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import type { ForensicRecord } from '../../../src/types/forensic';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

interface FWVerifier {
  parseExport(text: string): { data: Record<string, unknown>; html: string };
  verifyExportText(text: string): Promise<{ state: string; manifest: string; records: number; failures: Array<{ index: number; id: string | null; reason: string }> }>;
  describe(report: unknown): string;
}

import { REPO_ROOT as PROJECT_ROOT } from '../../helpers/repo-root';
let signedHtml: string;
let api: FWVerifier;

beforeAll(async () => {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const full = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x: full.x, y: full.y };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${jwk.x}|${jwk.y}`));
  const fp = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  const sign = async (hash: string): Promise<string> => {
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: { name: 'SHA-256' } }, kp.privateKey, new TextEncoder().encode(hash));
    return Buffer.from(sig).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const records: ForensicRecord[] = [];
  let prev = '';
  for (let i = 0; i < 2; i++) {
    const base = {
      id: `b-${i}`, timestamp: `2026-07-01T10:00:0${i}.000Z`, platform: 'tiktok', originalText: `post ${i}`, originalHash: 'h',
      originalLength: 6, neutralizedText: '', author: '@user', postUrl: '', techniques: [], overallScore: 0, userAgeCategory: 'adult',
      aiSource: 'cloud', feedSource: 'for-you', publicKeyFingerprint: fp, chainPosition: i, prevRecordHash: prev, kind: 'post', verdict: 'pass',
    } as Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'>;
    const integrityHash = await computeRecordIntegrityHash(base);
    records.push({ ...base, integrityHash, signature: await sign(integrityHash) } as ForensicRecord);
    prev = integrityHash;
  }
  signedHtml = await attachSignedManifest(buildForensicHtmlExport(records, { fwVersion: 'V-test', publicKeyJwk: jwk, publicKeyFingerprint: fp, locale: 'en' }), sign);

  // Evaluate the browser file the way a <script> tag would: in the page's
  // global scope, where it assigns window.FWVerifier.
  const src = readFileSync(BROWSER_VERIFIER_PATH, 'utf8');
  new Function('window', 'crypto', 'atob', 'TextEncoder', src)(window, crypto, atob, TextEncoder);
  api = (window as unknown as { FWVerifier: FWVerifier }).FWVerifier;
});

describe('verifier/verify-export.browser.js', () => {
  it('is what the builder writes now, with no import, no export and no shebang', () => {
    const src = readFileSync(BROWSER_VERIFIER_PATH, 'utf8');
    expect(src).toBe(buildBrowserVerifierSource());
    expect(src.startsWith('#!')).toBe(false);
    expect(src).not.toMatch(/^\s*(import|export) /m);
    expect(src).toContain('function canonicalPayload(r){');
    expect(src).toContain('window.FWVerifier = ');
  });

  it('verifies a real signed export in the page and names a tampered record', async () => {
    expect(api).toBeDefined();
    const ok = await api.verifyExportText(signedHtml);
    expect(ok.state).toBe('verified');
    expect(ok.manifest).toBe('ok');
    expect(ok.records).toBe(2);
    expect(api.describe(ok).split('\n')[0]).toContain('You are holding the whole record: 2 record(s)');
    expect(api.describe(ok).split('\n')[1].startsWith('VERIFIED: 2 record(s)')).toBe(true);

    const tampered = signedHtml.replace(/(<script type="application\/json" id="fw-export-data">)([\s\S]*?)(<\/script>)/, (_m, open: string, body: string, close: string) => {
      const data = JSON.parse(body) as { records: ForensicRecord[]; manifest?: unknown };
      data.records[0].originalText = 'edited';
      delete data.manifest;
      return open + JSON.stringify(data).replace(/</g, '\\u003c') + close;
    });
    const bad = await api.verifyExportText(tampered);
    expect(bad.state).toBe('failed');
    expect(bad.failures[0]).toMatchObject({ index: 0, id: 'b-0', reason: 'tampered' });
    expect(api.describe(bad).split('\n')[1].startsWith('FAILED at record 1 (b-0): tampered.')).toBe(true);
  });

  it('renders the reading as one structured card: what you hold, the verdict band by state, the notes, the limit, the data folded; text only, never markup', async () => {
    const root = document.createElement('div');
    const ok = await api.verifyExportText(signedHtml);
    (api as unknown as { render(report: unknown, root: Element): void }).render(ok, root);
    const card = root.querySelector('.fw-check')!;
    expect(card.className).toBe('fw-check fw-check-verified');
    expect(card.querySelector('.fw-check-holding p')?.textContent).toContain('You are holding the whole record: 2 record(s)');
    expect(card.querySelector('.fw-check-verdict-line')?.textContent?.startsWith('VERIFIED: 2 record(s)')).toBe(true);
    expect(card.querySelector('.fw-check-limit')?.textContent).toContain('does not establish who made the file');
    expect(card.querySelector('details.fw-check-raw pre')?.textContent).toContain('"state": "verified"');
    // The notes list carries the no-time-stamp line for a file without anchors.
    expect([...card.querySelectorAll('.fw-check-notes li')].map((li) => li.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('no time stamp from an outside service')]));

    // A tampered file: the band changes state, and text from the file arrives as text.
    const tampered = signedHtml.replace(/(<script type="application\/json" id="fw-export-data">)([\s\S]*?)(<\/script>)/, (_m, open: string, body: string, close: string) => {
      const data = JSON.parse(body) as { records: ForensicRecord[]; manifest?: unknown };
      data.records[0].originalText = '<img src=x onerror=alert(1)>';
      delete data.manifest;
      return open + JSON.stringify(data).replace(/</g, '\\u003c') + close;
    });
    const bad = await api.verifyExportText(tampered);
    (api as unknown as { render(report: unknown, root: Element): void }).render(bad, root);
    expect(root.querySelectorAll('.fw-check')).toHaveLength(1);
    expect(root.querySelector('.fw-check')!.className).toBe('fw-check fw-check-failed');
    expect(root.querySelector('img')).toBeNull();
  });

  it('index.html loads only the file beside it and nothing from the network', () => {
    const html = readFileSync(resolve(PROJECT_ROOT, 'verifier', 'index.html'), 'utf8');
    const srcs = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
    expect(srcs).toEqual(['verify-export.browser.js']);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<link[^>]+href=/);
    expect(html).toContain('window.FWVerifier.verifyExportText');
    expect(html).toContain('window.FWVerifier.render(report, out)');
    expect(html).toContain('does not establish who created the file');
  });
});
