// The store zip shipped a field named `secret`, and the same value again inside
// the service worker.
//
// Found 2026-09-19 by unpacking release/receipts-2.5.11.zip: `build-id.json`
// read `{"buildId":"fwbid-d19670f054a6-r2511","secret":"fwsec-…"}` and
// `service-worker.js` carried the same `fwsec-` literal, baked by a vite
// define. In a reproducible build that value is a throwaway derived from the
// commit, but a zip cut straight after `npm run build` carries the developer's
// own `.fw-dev-secret`.
//
// What it is NOT: exploitable by anyone who installs from the store. Dev reload
// also requires `installType === 'development'` and a token server on the
// person's own 127.0.0.1, and the live listings have passed review with this
// code three times. What it IS: a credential shipped to strangers for no
// reason, in a file that does nothing in a store install, sitting beside a
// localhost endpoint and `chrome.runtime.reload()`.
//
// Two closures, and this file holds both. The packager leaves `build-id.json`
// out of the zip, because only the local dev-reload server reads it and it
// reads it off disk. And the two packaging paths set `FW_DEV_RELOAD=0`, so the
// build that becomes a zip bakes no secret at all; the bundle gate then checks
// the ABSENCE rather than the presence, which is the half that was missing.
//
// Measured after the change by building with the flag and unpacking the result:
// 23 files, no build-id.json, no `fwsec-` in any of them.
//
// Still open and deliberately not claimed here: the localhost URL and the
// reload call stay in the bundle, inert behind the installType gate. Removing
// those needs the import itself to be conditional, which is a bigger change
// than this one.

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO_ROOT as ROOT } from '../helpers/repo-root';
import { NOT_IN_THE_ZIP, packageExtension, zipNameFor } from '../../scripts/package.mjs';

const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

describe('the zip carries no dev secret (2026-09-19)', () => {
  it('the packager leaves build-id.json on disk and out of the zip', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fw-pkg-'));
    try {
      const dist = join(dir, 'dist');
      mkdirSync(dist);
      writeFileSync(join(dist, 'manifest.json'), '{"name":"x"}', 'utf8');
      writeFileSync(join(dist, 'service-worker.js'), 'console.log(1);', 'utf8');
      writeFileSync(join(dist, 'build-id.json'), '{"buildId":"fwbid-a-b","secret":"fwsec-0123456789"}', 'utf8');
      const out = join(dir, 'out.zip');
      const result = packageExtension({ distDir: dist, outFile: out });

      // The zip's own central directory, read as bytes: the file name would be
      // in there verbatim, and so would the secret if the file were in it.
      const zip = readFileSync(out);
      expect(zip.includes(Buffer.from('build-id.json')), 'the name is nowhere in the archive').toBe(false);
      expect(zip.includes(Buffer.from('fwsec-')), 'and neither is the value').toBe(false);
      expect(zip.includes(Buffer.from('manifest.json')), 'the manifest is still in it').toBe(true);
      expect(result.fileCount, 'two files packaged, not three').toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the exclusion is named, so a reader can see what is left out and why', () => {
    expect(NOT_IN_THE_ZIP).toContain('build-id.json');
  });

  // ─── The nameless twin (2026-09-19) ───
  //
  // A plain `npm run package` wrote `release/feelingwise.zip`: no version in
  // the name, in the same folder as the reproducible artefacts and
  // indistinguishable from them. One was found there dated 18 September
  // carrying a dev build id and the developer's own dev-reload secret, beside
  // `receipts-2.5.11.zip` of the same version. Uploading the wrong one would
  // have put an unreproducible row in RELEASES.tsv under a version number that
  // means something else.
  //
  // M57 already recorded that file being deleted once. It came back, because
  // the default name is what recreates it.

  it('the default name carries the version and says it is a local build', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fw-name-'));
    try {
      const dist = join(dir, 'dist');
      mkdirSync(dist);
      writeFileSync(join(dist, 'manifest.json'), JSON.stringify({ name: 'Receipts by FeelingWise', version: '9.9.9' }), 'utf8');
      expect(zipNameFor(dist, { local: true })).toBe('receipts-9.9.9.local.zip');
      expect(zipNameFor(dist, { local: false })).toBe('receipts-9.9.9.zip');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the local name can never collide with the reproducible one', () => {
    // The other half of why the marker is in the NAME. The reproducible build
    // writes `<slug>-<version>.zip` into release/, and that is the one artefact
    // a session must never overwrite (M280, which happened).
    const dir = mkdtempSync(join(tmpdir(), 'fw-name-'));
    try {
      const dist = join(dir, 'dist');
      mkdirSync(dist);
      writeFileSync(join(dist, 'manifest.json'), JSON.stringify({ name: 'Receipts', version: '1.0.0' }), 'utf8');
      expect(zipNameFor(dist, { local: true })).not.toBe(zipNameFor(dist, { local: false }));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('nothing in the packager falls back to an unversioned name', () => {
    // Read off the source, because the fallback is what produced the file and
    // a fallback is invisible until the day it fires.
    const src = read('scripts/package.mjs');
    expect(src, "no hard-coded nameless zip").not.toMatch(/'feelingwise\.zip'/);
    expect(src, 'the default is computed from the manifest').toContain("zipNameFor(dist, { local: true })");
  });

  it('both packaging scripts turn the dev-reload secret off', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts.package, 'npm run package').toContain('FW_DEV_RELOAD=0');
    expect(pkg.scripts['package:off'], 'npm run package:off').toContain('FW_DEV_RELOAD=0');
  });

  it('the reproducible build turns it off too, which is the path the store zip comes from', () => {
    expect(read('scripts/reproducible-build.mjs')).toContain("FW_DEV_RELOAD: '0'");
  });

  it('the build honours the flag by baking an empty secret', () => {
    const vite = read('vite.config.ts');
    expect(vite).toContain("const BAKE_DEV_SECRET = process.env.FW_DEV_RELOAD !== '0'");
    expect(vite, 'and the reader is told this is not a watch-build gate, because the reload loop is npm run build')
      .toContain('npm run dev');
  });

  it('the bundle gate checks the absence, not only the presence', () => {
    // The half that was missing. A gate that only ever asserts "exactly one
    // secret is baked" passes every developer build and says nothing about the
    // one build where a secret must not be there at all.
    const gate = read('scripts/check-sw-bundle.mjs');
    expect(gate).toContain("const wantSecret = process.env.FW_DEV_RELOAD !== '0'");
    expect(gate).toContain('!wantSecret && secrets.length !== 0');
  });
});
