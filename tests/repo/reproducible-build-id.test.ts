// The reproducible build (scripts/reproducible-build.mjs, 14 Sep 2026): the
// build id and the dev-reload secret are the two things that made two builds
// of the same commit differ. Both are now derived from the commit, in the
// exact shapes check-sw-bundle.mjs and vite.config.ts accept, so the same
// source gives the same bytes. The end-to-end proof (build twice, same zip
// hash) is run by hand and recorded in STATE; this file locks the derivation.

import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// The script is plain ESM; scripts/reproducible-build.d.mts types its pure exports for this lane.
import { productConfig, reproducibleBuildId, reproducibleSecret, resolveSourceCommit, samePath } from '../../scripts/reproducible-build.mjs';
import { repoPath } from '../helpers/repo-root';

const COMMIT = '902862d1f0a4b7c9e2d3f4a5b6c7d8e9f0a1b2c3';

describe('reproducible build: the derived id and secret', () => {
  it('the id has the shape the bundle gate greps for and depends only on commit and version', () => {
    const a = reproducibleBuildId(COMMIT, '2.5.5');
    expect(a).toMatch(/^fwbid-[a-z0-9]+-[a-z0-9]+$/);
    expect(a).toBe('fwbid-902862d1f0a4-r255');
    expect(reproducibleBuildId(COMMIT, '2.5.5')).toBe(a);
    expect(reproducibleBuildId(COMMIT, '2.5.6')).not.toBe(a);
    expect(reproducibleBuildId(COMMIT.replace('9028', 'aaaa'), '2.5.5')).not.toBe(a);
  });

  it('the secret has the shape vite.config.ts accepts and is stable per commit', () => {
    const s = reproducibleSecret(COMMIT);
    expect(s).toMatch(/^fwsec-[a-z0-9]{10}$/);
    expect(reproducibleSecret(COMMIT)).toBe(s);
    expect(reproducibleSecret('0000000')).not.toBe(s);
  });

  it('refuses a value that is not a commit hash', () => {
    expect(() => reproducibleBuildId('not-a-hash', '2.5.5')).toThrow();
  });

  it('new-build-id.mjs keeps a pinned id only when asked and only when well formed', () => {
    const src = readFileSync(repoPath('scripts', 'new-build-id.mjs'), 'utf8');
    expect(src).toContain("process.env.FW_KEEP_BUILD_ID === '1'");
    expect(src).toContain('/^fwbid-[a-z0-9]+-[a-z0-9]+$/.test(pinned)');
  });
});

describe('reproducible build: the commit a public snapshot builds from', () => {
  // The public repository is a fresh snapshot with a commit of its own; without SOURCE-COMMIT a
  // stranger's build would derive another id and never reproduce the store hash (2026-09-15).
  it('prefers --source-commit, then SOURCE-COMMIT, then git HEAD', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fw-src-commit-'));
    try {
      const head = () => 'a'.repeat(40);
      expect(resolveSourceCommit([], dir, head)).toEqual({ commit: 'a'.repeat(40), from: 'git' });
      writeFileSync(join(dir, 'SOURCE-COMMIT'), `${COMMIT}\n`);
      expect(resolveSourceCommit([], dir, head)).toEqual({ commit: COMMIT, from: 'SOURCE-COMMIT' });
      expect(resolveSourceCommit(['--source-commit', 'B'.repeat(40)], dir, head)).toEqual({ commit: 'b'.repeat(40), from: 'argument' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('names what each product builds from and writes, and refuses any other product', () => {
    expect(productConfig('receipts')).toEqual({ name: 'Feedprint', manifest: 'manifest.json', script: 'build', dist: 'dist', stem: 'receipts', storeId: 'mcdanhgfcpjpajlmjcdfeaeanlkodifp' });
    expect(productConfig('off')).toEqual({ name: 'Off', manifest: 'manifest.off.json', script: 'build:off', dist: 'dist-off', stem: 'off', storeId: 'kebfpnjiiiboofdjhomcbgphfnlbahmh' });
    expect(() => productConfig('both')).toThrow(/receipts, off, receipts-firefox, off-firefox/);
  });

  it('tells when --verify names the file the run writes (a comparison with itself always matched)', () => {
    expect(samePath('E:/repo/receipts-2.5.8.zip', 'e:\\repo\\RECEIPTS-2.5.8.zip', 'win32')).toBe(true);
    expect(samePath('/repo/receipts-2.5.8.zip', '/repo/RECEIPTS-2.5.8.zip', 'linux')).toBe(false);
    expect(samePath('/repo/receipts-2.5.8.zip', '/elsewhere/receipts-2.5.8.zip', 'linux')).toBe(false);
  });

  it('refuses a SOURCE-COMMIT or an argument that is not one full commit hash', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fw-src-commit-'));
    try {
      writeFileSync(join(dir, 'SOURCE-COMMIT'), 'main\n');
      expect(() => resolveSourceCommit([], dir, () => 'x')).toThrow(/SOURCE-COMMIT/);
      expect(() => resolveSourceCommit(['--source-commit', '902862d'], dir, () => 'x')).toThrow(/40-character/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
