// The store zip lists its files in byte order, whatever language the builder's system reads.
//
// scripts/package.mjs sorted the entries with localeCompare, so the order came from the collation
// of the machine's locale. Measured 2026-09-16 on the current build folders: en-US, German and
// Swedish give byte order, but Thai puts `assets/` before `_locales/` in both extensions and Hawaiian
// moves an icon in Receipts. A stranger on such a system rebuilt the same files into a zip with
// another hash, and the reproducible build called that a MISMATCH. The zip's hash is what an upload
// is recorded by, so the order is now bytes, which gave the same order as en-US for every zip
// uploaded so far.
import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { packageExtension } from '../../scripts/package.mjs';
import { repoPath } from '../helpers/repo-root';

/** The entry names of a zip, in the order its local headers appear. */
function entryNames(zip: Buffer): string[] {
  const names: string[] = [];
  let at = 0;
  while (zip.readUInt32LE(at) === 0x04034b50) {
    const compressed = zip.readUInt32LE(at + 18);
    const nameLength = zip.readUInt16LE(at + 26);
    const extraLength = zip.readUInt16LE(at + 28);
    names.push(zip.subarray(at + 30, at + 30 + nameLength).toString('utf8'));
    at += 30 + nameLength + extraLength + compressed;
  }
  return names;
}

describe('the store zip', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fw-package-order-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('lists its entries in byte order, where a Thai collation would not', () => {
    const dist = join(dir, 'dist');
    // The names that reorder under Thai and Hawaiian collation in the real builds.
    const files = ['manifest.json', '_locales/en/messages.json', 'assets/client-x.css', 'assets/icons/icon-128.png', 'content.js'];
    for (const f of files) {
      mkdirSync(dirname(join(dist, f)), { recursive: true });
      writeFileSync(join(dist, f), f === 'manifest.json' ? '{"name":"x","version":"1.0.0"}' : f);
    }
    const out = join(dir, 'x.zip');
    packageExtension({ distDir: dist, outFile: out });
    const names = entryNames(readFileSync(out));
    const bytes = [...files].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(names).toEqual(bytes);
    // What the old sort gave on a Thai system: not this order, so this test tells the two apart.
    expect([...files].sort((a, b) => a.localeCompare(b, 'th'))).not.toEqual(bytes);
  });

  it('never asks the locale how to order anything', () => {
    expect(readFileSync(repoPath('scripts', 'package.mjs'), 'utf8')).not.toMatch(/\.localeCompare\(/);
  });
});
