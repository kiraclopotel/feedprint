/** @vitest-environment jsdom */
// FeelingWise — Standalone HTML evidence export is FREE (decision lock).
//
// DECISIONS.md 2026-06-21: "HTML evidence export moved FREE (was
// paid-gated)... Now FREE = the full provable black box (record + dashboard
// + ALL exports incl. the verifiable HTML); PAID = the real-time AI defense
// only." landing/pricing.html lists verifiable exports under Free.
//
// This file previously locked the OPPOSITE behavior (a Layer-2 paywall
// throw in exporter.ts). The dashboard button gate (Layer 1) was removed
// with the decision, but the function-layer assert survived until
// 2026-07-15 (register M43): a free-tier parent's ENABLED export button
// failed at runtime with a paywall error contradicting the pricing page.
// The assert is now deleted; this test locks the decision so the paywall
// cannot silently grow back on either entrypoint.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { repoPath } from '../../helpers/repo-root';

import { exportHtml, exportEverythingHtml } from '../../../src/forensics/exporter';

const EXPORTER_PATH = 'src/forensics/exporter.ts';

// Minimal chrome.storage.local stub mirroring the shape used by
// `getLicense`. Same pattern as tests/unit/storage/license.test.ts.
function installStorageStub(licenseKey: string | null): void {
  const state: Record<string, unknown> = {};
  if (licenseKey !== null) {
    state.fw_license_key = licenseKey;
  }
  (globalThis as any).chrome = {
    runtime: {
      getManifest: () => ({ version: '0.0.0-test' }),
    },
    storage: {
      local: {
        get: (keys: string | string[]) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of arr) {
            if (k in state) out[k] = state[k];
          }
          return Promise.resolve(out);
        },
        set: (obj: Record<string, unknown>) => {
          Object.assign(state, obj);
          return Promise.resolve();
        },
        remove: (keys: string | string[]) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          for (const k of arr) delete state[k];
          return Promise.resolve();
        },
      },
    },
  };
}

// The HTML-export entrypoints internally call into signing (Web Crypto)
// and then trigger a browser download via DOM APIs. None of that is what
// this test verifies — only that NO tier gate blocks the export. Stub the
// downstream calls so execution completes without Web Crypto / file APIs.
vi.mock('../../../src/forensics/signing', () => ({
  getPublicKeyJWK: vi.fn().mockResolvedValue({}),
  getPublicKeyFingerprint: vi.fn().mockResolvedValue(''),
  getSigningKeyCreatedAt: vi.fn().mockResolvedValue(null),
  getSigningKeyOrigins: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../src/forensics/html-export', () => ({
  buildForensicHtmlExport: vi.fn().mockReturnValue('<html></html>'),
  attachSignedManifest: vi.fn(async (html: string) => html),
}));

describe('Standalone HTML export — free for every tier (2026-06-21 decision lock)', () => {
  beforeEach(() => {
    // jsdom provides URL + document + Blob. Stub URL.createObjectURL because
    // jsdom doesn't implement it.
    if (typeof URL.createObjectURL !== 'function') {
      (URL as any).createObjectURL = () => 'blob:stub';
    }
    if (typeof URL.revokeObjectURL !== 'function') {
      (URL as any).revokeObjectURL = () => undefined;
    }
  });

  it('FREE tier (empty storage): both entrypoints complete without a tier error', async () => {
    installStorageStub(null);
    await expect(exportHtml([])).resolves.not.toThrow();
    await expect(exportEverythingHtml([])).resolves.not.toThrow();
  });

  it('paid tiers: both entrypoints complete (no regression for licensed installs)', async () => {
    for (const key of ['fw-starter-abc12345', 'fw-family-abc12345', 'fw-extended-abc12345']) {
      installStorageStub(key);
      await expect(exportHtml([])).resolves.not.toThrow();
      await expect(exportEverythingHtml([])).resolves.not.toThrow();
    }
  });

  it('the deleted paywall cannot grow back: exporter.ts carries no tier assert on the HTML paths', async () => {
    // Source-scan lock (theme-single-source pattern): the drift class is
    // "someone re-adds a tier check to an export entrypoint", which the
    // behavioral tests above would catch only for the exact error shape.
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(repoPath(...EXPORTER_PATH.split(String.fromCharCode(47))), 'utf8');
    expect(src).not.toMatch(/assertPaidTierForHtmlExport|requires Starter, Family, or Extended/);
  });
});
