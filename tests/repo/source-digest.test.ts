// One hash for the source of a build, that a stranger can recompute from the archive they are handed.
//
// SOURCE-DIGEST is the SHA-256 of the sorted "<sha256>  <path>" lines of the public files at one
// commit. It leaves out the release list, which gains its row only after the upload, so the digest
// is a function of the commit alone and never changes the day after. The same digest goes into the
// built manifest's version_name, so page one of every export names the build and the source it came
// from, and the archive's files recompute to it.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { REPO_ROOT as ROOT } from '../helpers/repo-root';
import {
  archiveFolder,
  committedBlobs,
  folderSourceDigest,
  SNAPSHOT_MODULE_FILES,
  publicPackageJson,
  publicPaths,
  sourceDigestOf,
} from '../../scripts/public-snapshot.mjs';
import { RELEASES_PATH } from '../../scripts/reproducible-build.mjs';
import { versionName } from '../../scripts/version-name.mjs';

const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
const temps: string[] = [];
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), 'fw-source-digest-'));
  temps.push(d);
  return d;
};
afterAll(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });

function writeTree(dir: string, files: Record<string, string>) {
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(join(dir, p, '..'), { recursive: true });
    writeFileSync(join(dir, p), text);
  }
}

describe('the source digest', () => {
  it('is the hash of the sorted file lines, whatever order they come in', () => {
    const a: [string, string][] = [['app/b.ts', sha('b')], ['app/a.ts', sha('a')]];
    const expected = sha(`${sha('a')}  app/a.ts\n${sha('b')}  app/b.ts\n`);
    expect(sourceDigestOf(a)).toBe(expected);
    expect(sourceDigestOf([...a].reverse())).toBe(expected);
  });

  it('leaves out the release list and the snapshot\'s own files, so it never changes after an upload', () => {
    const base: [string, string][] = [['app/a.ts', sha('a')]];
    const withExtras: [string, string][] = [...base, [RELEASES_PATH, sha('row')], ['MANIFEST.txt', sha('m')], ['SOURCE-COMMIT', sha('c')], ['SOURCE-DIGEST', sha('d')]];
    expect(sourceDigestOf(withExtras)).toBe(sourceDigestOf(base));
  });

  it('moves with one changed byte', () => {
    expect(sourceDigestOf([['app/a.ts', sha('a')]])).not.toBe(sourceDigestOf([['app/a.ts', sha('a ')]]));
  });

  it('recomputes from an unpacked folder, skipping what a build or an install adds', () => {
    const dir = temp();
    writeTree(dir, { 'manifest.json': '{}', 'app/a.ts': 'a', 'SOURCE-DIGEST': 'x\n', 'node_modules/p/index.js': 'p', 'dist/x.js': 'x', '.fw-build-id': 'fwbid-a-b' });
    const { digest, files } = folderSourceDigest(dir);
    expect(files).toEqual(['app/a.ts', 'manifest.json']);
    expect(digest).toBe(sourceDigestOf([['manifest.json', sha('{}')], ['app/a.ts', sha('a')]]));
  });

  it('skips what running the tests leaves behind', () => {
    const dir = temp();
    writeTree(dir, { 'manifest.json': '{}', 'coverage/index.html': 'c', 'test-results/x.json': 't' });
    expect(folderSourceDigest(dir).files).toEqual(['manifest.json']);
  });

  it('copies, for an upload\'s own lists, every script the snapshot script imports beside it', () => {
    // A commit's copy of the script is loaded from a temporary folder; a sibling it imports and the
    // copy lacks breaks --commit for every upload made after the import was added.
    const imported = new Set<string>();
    const queue = ['public-snapshot.mjs'];
    while (queue.length) {
      const name = queue.pop() as string;
      if (imported.has(name)) continue;
      imported.add(name);
      const text = readFileSync(join(ROOT, 'scripts', name), 'utf8');
      for (const m of text.matchAll(/^import [^;]*? from '\.\/([\w.-]+\.mjs)';/gm)) queue.push(m[1]);
    }
    expect([...imported].sort()).toEqual([...SNAPSHOT_MODULE_FILES].sort());
  });

  it('packs the folder into an archive with the same bytes every time', () => {
    const dir = temp();
    writeTree(dir, { 'manifest.json': '{"version":"9.9.9"}', 'app/a.ts': 'a', '.nvmrc': '24.14.0\n' });
    const out = temp();
    archiveFolder(dir, join(out, 'one.zip'));
    archiveFolder(dir, join(out, 'two.zip'));
    expect(sha(readFileSync(join(out, 'one.zip')))).toBe(sha(readFileSync(join(out, 'two.zip'))));
    // A dotfile the build reads travels in the archive.
    expect(readFileSync(join(out, 'one.zip')).includes(Buffer.from('.nvmrc'))).toBe(true);
  });

  it('is printed by --digest as the digest of the committed public files at HEAD', () => {
    const printed = execFileSync(process.execPath, ['scripts/public-snapshot.mjs', '--digest'], { cwd: ROOT, encoding: 'utf8' }).trim();
    expect(printed).toMatch(/^[0-9a-f]{64}$/);
    const paths = publicPaths();
    const blobs = committedBlobs(paths);
    const entries = paths.map((p): [string, string] => {
      const bytes = blobs.get(p) as Buffer;
      return [p, sha(p === 'package.json' ? publicPackageJson(bytes) : bytes)];
    });
    expect(printed).toBe(sourceDigestOf(entries));
  });
});

describe('version_name', () => {
  it('names the version, the build and the source', () => {
    expect(versionName({ version: '2.5.17', buildId: 'fwbid-0e6a9d81aaaa-r2517', sourceDigest: 'ab'.repeat(32) }))
      .toBe(`2.5.17 build fwbid-0e6a9d81aaaa-r2517 source ${'ab'.repeat(32)}`);
  });

  it('says nothing of a source an ad hoc build was not made from', () => {
    expect(versionName({ version: '2.5.17', buildId: 'fwbid-mg1x2-abc123' })).toBe('2.5.17 build fwbid-mg1x2-abc123');
  });

  it('refuses a digest that is not one', () => {
    expect(() => versionName({ version: '2.5.17', buildId: 'fwbid-a-b', sourceDigest: 'nope' })).toThrow();
  });

  it('is what the manifest plugin writes', () => {
    const config = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8');
    expect(config).toMatch(/import \{[^}]*versionName[^}]*\} from '[^']*version-name\.mjs'/);
    expect(config).toMatch(/manifest\.version_name\s*=/);
    // From the build's environment, never from a file an interrupted build could leave behind.
    expect(config).toContain('process.env[SOURCE_DIGEST_ENV]');
  });
});
