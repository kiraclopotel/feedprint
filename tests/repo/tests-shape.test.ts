// The tests folder keeps the shape of src (PLAN-2026-09-16 item 11.6).
//
// Before wave 11, 569 test files sat in one flat folder and finding the test for a module meant
// guessing at its name. They are now in folders that mirror src, and this is what keeps them there:
// the top level is a fixed list, no test sits loose at the root of tests/unit, and every folder
// under tests/unit answers to a folder that really exists in src.
//
// A new folder under tests/unit is not forbidden; a new folder that mirrors nothing is.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT as ROOT } from '../helpers/repo-root';

/** Tracked files plus files written but not added yet, the reading the other repository guards take. */
function ls(...paths: string[]): string[] {
  const args = ['ls-files', '--cached', '--others', '--exclude-standard', ...paths];
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
}

/** What each folder at the top of tests/ is for. A new one needs a line here and a reason. */
const TOP_LEVEL: Record<string, string> = {
  unit: 'one folder per src folder, the tests of the code that ships',
  repo: 'guards on the repository as a whole: its files, hooks and docs, and rules that span many src folders',
  private: 'tests that name private paths and never reach the public copy',
  gates: 'the published checker, its vectors and the public tools held against the code, and the corpus lock',
  helpers: 'what the tests share: the repository root, stubs, factories',
  fixtures: 'the data the tests read, from label sets to recorded pages',
  types: 'type-level tests, where the subject is a declaration',
};

describe('the tests folder keeps the shape of src', () => {
  const testFiles = ls('tests');

  // Named, not exact: this guard runs in the public copy too, where tests/private is absent by
  // design. A folder missing is allowed; a folder nobody named is not.
  it('every folder at the top of tests is one of the named ones', () => {
    const top = [...new Set(testFiles.map((f) => f.split('/')[1]))].sort();
    expect(top.filter((f) => !(f in TOP_LEVEL))).toEqual([]);
    for (const always of ['unit', 'repo', 'helpers', 'fixtures']) {
      expect(top, `${always} is always there`).toContain(always);
    }
  });

  it('no test file sits loose at the root of tests/unit', () => {
    const loose = testFiles.filter((f) => f.startsWith('tests/unit/') && f.split('/').length === 3);
    expect(loose).toEqual([]);
  });

  it('every folder under tests/unit mirrors a folder that exists in src', () => {
    // Every folder in src, including the ones that only hold other folders: src/products holds
    // nothing itself, and tests/unit/products is still a mirror of it.
    const srcFolders = new Set<string>();
    for (const f of ls('src')) {
      const parts = f.split('/').slice(1, -1);
      for (let i = 1; i <= parts.length; i++) srcFolders.add(parts.slice(0, i).join('/'));
    }
    const missing = [...new Set(
      testFiles
        .filter((f) => f.startsWith('tests/unit/'))
        .map((f) => f.split('/').slice(2, -1).join('/'))
        .filter(Boolean),
    )].filter((folder) => !srcFolders.has(folder)).sort();
    expect(missing).toEqual([]);
  });

  // A test that never runs the code it is about proves a line is present, not that anything works.
  // The name has to say so, and the read has to go through readSource, which refuses a file that
  // has been emptied or reduced to re-exports (PLAN-2026-09-16 item 11.4). Without both, splitting
  // a file turns the scan into an empty pass and the test stays green.
  it('a test under tests/unit that only reads source text is named for it', () => {
    const VALUE_IMPORT = /^import\s+(?!type\s)(?:\{[^}]*\}|[\w*\s,]+)\s+from\s+'\.\.[^']*\/src\/[^']+'/m;
    const DYNAMIC = /(?<!type )import\(\s*'\.\.[^']*\/src\/[^']+'\s*\)/;
    // Importing from src/ is one way to run the code and not the only one. The
    // checker a stranger runs is a built file, and the tests that matter most
    // for it drive it exactly as that stranger does, as a child process over a
    // real export: the tamper corpus, and the fixture proving a file exported
    // before the coverage widened still verifies. Those read files AND run the
    // product, so the rule this test enforces does not apply to them, and
    // renaming them `.source.` would have said the opposite of the truth
    // (2026-09-18).
    // Either it starts the process itself, or it imports the spawn timeout,
    // which exists for one reason: a test that starts child processes does not
    // fit vitest's default under a parallel run. Importing it is a statement
    // that this test runs something, even when the spawning is done for it by a
    // corpus runner beside it.
    const RUNS_AS_CHILD = /execFileSync\(|execFile\(|spawnSync\(|spawn\(|SPAWN_TIMEOUT_MS/;
    const READS = /readSource\(|readFileSync\(/;
    const unnamed = testFiles
      .filter((f) => f.startsWith('tests/unit/') && /\.tsx?$/.test(f) && !f.includes('.source.'))
      .filter((f) => {
        const text = readFileSync(join(ROOT, f), 'utf8');
        if (RUNS_AS_CHILD.test(text)) return false;
        return READS.test(text) && !VALUE_IMPORT.test(text) && !DYNAMIC.test(text);
      });
    expect(unnamed).toEqual([]);
  });
});
