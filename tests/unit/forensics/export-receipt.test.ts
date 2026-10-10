/** @vitest-environment jsdom */
// Evidence-gap register item 17, the custody half: every HTML export returns
// a receipt naming the file, its byte length and the SHA-256 of the exact
// bytes handed to the browser, so the exporter can state which copy left the
// device. Locks: the digest is over the UTF-8 bytes the Blob carries (a
// recipient hashing the saved file gets the same value), all three
// entrypoints return one, and the everything-export carries it beside its
// counts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { webcrypto } from 'node:crypto';
import { exportHtml, exportEverythingHtml } from '../../../src/forensics/exporter';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const DOC = '<html><body>ção ✓</body></html>'; // non-ASCII on purpose: bytes != chars

vi.mock('../../../src/forensics/signing', () => ({
  getPublicKeyJWK: vi.fn().mockResolvedValue({}),
  getPublicKeyFingerprint: vi.fn().mockResolvedValue('fp'),
  getSigningKeyCreatedAt: vi.fn().mockResolvedValue(null),
  getSigningKeyOrigins: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../../src/forensics/html-export', () => ({
  buildForensicHtmlExport: vi.fn().mockReturnValue('<html><body>ção ✓</body></html>'),
  attachSignedManifest: vi.fn(async (html: string) => html),
}));
vi.mock('../../../src/forensics/archive-reader', () => ({
  loadArchivesOldestFirst: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../../src/forensics/salvage-store', () => ({
  readSalvagedRecords: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../../src/forensics/known-keys', () => ({
  publicKeysForExport: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../../src/forensics/chain-anchor-store', () => ({
  getAnchors: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../../src/forensics/key-genesis', () => ({
  getKeyGenesis: vi.fn().mockResolvedValue(null),
}));

async function expected(): Promise<{ bytes: number; sha256: string }> {
  const b = new TextEncoder().encode(DOC);
  const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b))).map(x => x.toString(16).padStart(2, '0')).join('');
  return { bytes: b.byteLength, sha256: h };
}

beforeEach(() => {
  (globalThis as any).chrome = { runtime: { getManifest: () => ({ version: '0.0.0-test' }) }, storage: { local: { get: async () => ({}), set: async () => undefined } } };
  (URL as any).createObjectURL = () => 'blob:stub';
  (URL as any).revokeObjectURL = () => undefined;
});

describe('export receipt', () => {
  it('the verification report returns file, byte length and the SHA-256 of the delivered bytes', async () => {
    const r = await exportHtml([]);
    const e = await expected();
    expect(r.filename).toMatch(/^feedprint-report-.*\.html$/);
    expect(r.bytes).toBe(e.bytes);
    expect(r.bytes).toBeGreaterThan(DOC.length); // bytes, not characters
    expect(r.sha256).toBe(e.sha256);
  });

  it('the everything export carries the same receipt shape', async () => {
    const e = await expected();
    const all = await exportEverythingHtml([]);
    expect(all.receipt.filename).toMatch(/^feedprint-whole-record-/);
    expect(all.receipt.sha256).toBe(e.sha256);
    expect(all.receipt.bytes).toBe(e.bytes);
  });
});
