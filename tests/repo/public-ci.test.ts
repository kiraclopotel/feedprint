// .github/workflows/ci.yml: the public repository's own check.
//
// It is the only machine that will ever run this project's gates on a copy nobody here controls,
// and the only one that rebuilds an upload outside the owner's computer. What it must keep doing:
// run the same gates as the commit hook, rebuild and compare the uploads outside pull requests,
// install the exact Node the uploads were built with, and never hand a job more than read access
// or run an action a moved tag could change.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { isPublicPath } from '../../scripts/public-snapshot.mjs';
import { repoPath } from '../helpers/repo-root';

const ci = readFileSync(repoPath('.github', 'workflows', 'ci.yml'), 'utf8');

/** The text of one job: from its name to the next job or the end. */
function job(name: string): string {
  const start = ci.indexOf(`\n  ${name}:\n`);
  expect(start, name).toBeGreaterThan(0);
  const next = ci.slice(start + 1).search(/\n {2}[\w-]+:\n/);
  return next < 0 ? ci.slice(start) : ci.slice(start, start + 1 + next);
}

const runs = (text: string) => [...text.matchAll(/^\s+run: (.+)$/gm)].map((m) => m[1].trim());

describe('the public CI', () => {
  it('goes public, and is the only workflow that does until another is named', () => {
    expect(isPublicPath('.github/workflows/ci.yml')).toBe(true);
    expect(isPublicPath('.github/workflows/deploy.yml')).toBe(false);
  });

  it('runs the gates the commit hook runs', () => {
    expect(runs(job('checks'))).toEqual([
      'git config --global core.autocrlf true',
      'npm ci',
      'npx playwright install chromium',
      'npx tsc --noEmit',
      'npx tsc -p tsconfig.tests.json --noEmit',
      'npm run lint',
      'npx vitest run --project unit',
      'npx vitest run --project tooling',
    ]);
    const hook = readFileSync(repoPath('.githooks', 'pre-commit'), 'utf8');
    for (const gate of ['npx tsc --noEmit', 'npx tsc -p tsconfig.tests.json', 'npx eslint .', 'npx vitest run --project unit', 'npx vitest run --project tooling']) {
      expect(hook, gate).toContain(gate);
    }
  });

  it('rebuilds and compares an upload on its tag, never for a pull request or an update between uploads', () => {
    const release = job('release');
    expect(runs(release)).toContain('node scripts/reproducible-build.mjs --expect-release');
    expect(release).toContain("if: github.event_name != 'pull_request'");
    // The same workflow is tracked in the private repository, whose HEAD is never an upload's commit,
    // and the public repository gains a commit after each merge batch, most of which built no upload.
    expect(release).toContain("if: hashFiles('SOURCE-COMMIT') != '' && startsWith(github.ref, 'refs/tags/v')");
    expect(release).toContain("if: hashFiles('SOURCE-COMMIT') == '' || !startsWith(github.ref, 'refs/tags/v')");
    expect(runs(job('checks')).join('\n')).not.toContain('--expect-release');
    // The release-list test reads ancestry, which a shallow clone does not have.
    expect(job('checks')).toContain('fetch-depth: 0');
  });

  it('installs the Node version from .nvmrc, on Windows with the line endings a Windows clone has', () => {
    for (const name of ['checks', 'release']) {
      const text = job(name);
      expect(text).toContain('node-version-file: .nvmrc');
      expect(text).toMatch(/runs-on: windows-\d{4}/);
      expect(runs(text)[0]).toBe('git config --global core.autocrlf true');
      expect(text).toContain('persist-credentials: false');
    }
  });

  it('asks for read access only, never runs on pull_request_target, and pins every action by commit', () => {
    expect(ci).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(ci).not.toMatch(/pull_request_target|secrets\./);
    const uses = [...ci.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u, u).toMatch(/^[\w-]+\/[\w-]+@[0-9a-f]{40}$/);
  });
});
