// The public copy's package.json offers only commands a stranger can run.
//
// scripts/public-snapshot.mjs writes every public file exactly as HEAD stores it, with one exception:
// package.json loses the npm scripts that point at folders the public copy leaves out. Until
// 2026-09-16 it offered eleven such commands (the research runners, the licence tools, the server,
// the product walk and the verify harness), and each failed the moment anyone outside ran it.
//
// What must hold: the filter removes exactly those, nothing a stranger needs goes with them, and the
// parts `npm ci` and the reproducible build read are the same bytes they were.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { isPublicPath, publicPackageJson } from '../../scripts/public-snapshot.mjs';
import { repoPath } from '../helpers/repo-root';

type Pkg = { name: string; version: string; scripts: Record<string, string>; dependencies?: object; devDependencies?: object };

const raw = readFileSync(repoPath('package.json'));
const before = JSON.parse(raw.toString('utf8')) as Pkg;
const after = JSON.parse(publicPackageJson(raw).toString('utf8')) as Pkg;

const namedPaths = (cmd: string) =>
  [...cmd.matchAll(/(?:^|[\s"'=])((?:scripts|worker|tools|src|tests|verifier|landing|docs)\/[\w./-]+)/g)].map((m) => m[1]);

describe('the public package.json', () => {
  it('keeps the commands a stranger builds, tests and packages with', () => {
    for (const name of ['build', 'build:off', 'test', 'lint', 'package', 'package:off', 'gen:verifier', 'gen:vectors']) {
      expect(after.scripts[name], name).toBe(before.scripts[name]);
    }
  });

  it('names no private path in any command it keeps', () => {
    for (const [name, cmd] of Object.entries(after.scripts)) {
      expect(namedPaths(cmd).filter((p) => !isPublicPath(p)), `${name}: ${cmd}`).toEqual([]);
      expect(cmd, name).not.toMatch(/--prefix\s+worker/);
    }
  });

  // This file runs in two places. In the full repository, package.json still lists the private
  // commands and the filter must remove them. In the public copy, the package.json on disk is the
  // one the filter already wrote, so filtering it again must remove nothing. The fresh-clone proof
  // of 2026-09-16 found the first version of this test asserting the full-repository case in both.
  // The marker is a file the public copy never carries: worker/wrangler.toml (worker/package.json went
  // public with the relay's source on 13 Oct 2026, and the public CI went red on this very test).
  const fullRepository = existsSync(repoPath('worker', 'wrangler.toml'));

  it.runIf(fullRepository)('removes only commands that could not run, and says which', () => {
    const dropped = Object.keys(before.scripts).filter((k) => !(k in after.scripts));
    expect(dropped.length, 'something private was on offer').toBeGreaterThan(0);
    for (const name of dropped) {
      const cmd = before.scripts[name];
      const reason = namedPaths(cmd).some((p) => !isPublicPath(p)) || /--prefix\s+worker/.test(cmd);
      expect(reason, `${name} was dropped without naming a private path: ${cmd}`).toBe(true);
    }
  });

  it.skipIf(fullRepository)('in the public copy, is already what the filter writes', () => {
    expect(publicPackageJson(raw).toString('utf8')).toBe(raw.toString('utf8'));
  });

  it('leaves the name, the version and every dependency exactly as they are', () => {
    expect(after.name).toBe(before.name);
    expect(after.version).toBe(before.version);
    expect(after.dependencies).toEqual(before.dependencies);
    expect(after.devDependencies).toEqual(before.devDependencies);
  });

  it('drops a kept-looking script that only calls a dropped one', () => {
    // A real private file, so the citation guard reads a path that exists.
    const pkg = { name: 'x', scripts: { own: 'node scripts/research/filters/run-functional-eval.mjs', wrapper: 'npm run own', fine: 'vitest run' } };
    const out = JSON.parse(publicPackageJson(Buffer.from(JSON.stringify(pkg))).toString('utf8')) as Pkg;
    expect(Object.keys(out.scripts)).toEqual(['fine']);
  });

  it('writes a file with nothing private in it byte for byte as it came', () => {
    const pkg = `${JSON.stringify({ name: 'x', scripts: { test: 'vitest run' } }, null, 2)}\n`;
    expect(publicPackageJson(Buffer.from(pkg)).toString('utf8')).toBe(pkg);
  });
});
