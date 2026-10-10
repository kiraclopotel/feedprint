import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

/**
 * Tests that start a process, build a temporary git repository, or run the standalone verifier.
 * They are slower and they compete for the machine, and that competition has made them red before:
 * demo-export-verifies takes 0.29s alone and was clocked at 21s inside the full run, which is why
 * tests/helpers/spawn-timeout.ts exists. They are their own project (PLAN-2026-09-16 item 7.7), so
 * the per-commit run is the deterministic half and these run when their own paths are staged and at
 * every wave end. Nothing that guards a per-commit proof belongs on this list.
 */
export const TOOLING_TESTS = [
  'tests/private/hooks/no-push-hook.test.ts',
  'tests/private/scripts/analyze-export-batch-d.test.ts',
  'tests/private/scripts/check-same-code-in-a-repo.test.ts',
  'tests/private/scripts/worker-live-is-current-in-a-repo.test.ts',
  'tests/private/site/analyze-export-agrees.test.ts',
  'tests/private/site/demo-export-verifies.test.ts',
  'tests/private/site/the-romanian-checker-counts-in-romanian.test.ts',
  'tests/private/site/a-file-without-its-manifest-is-not-read-as-innocent.test.ts',
  'tests/private/worker/package-script.test.ts',
  'tests/unit/background/dev-reload.test.ts',
  'tests/unit/forensics/import-marker.test.ts',
  'tests/repo/pre-push-hook.test.ts',
  // Builds throwaway git repositories and drives the hooks in them, exactly like the pre-push
  // test above. It cannot run in the unit project: that project is what the pre-commit hook runs,
  // so a commit would be running these hooks inside the hook, against temp repos, on every commit.
  'tests/repo/commit-gates.test.ts',
  'tests/unit/forensics/receive-export.test.ts',
  'tests/repo/reproducible-build-id.test.ts',
  'tests/unit/forensics/standalone-verifier.test.ts',
  'tests/gates/verifier-vectors.test.ts',
  // Starts a node process and reads the real Windows process list to find it.
  'tests/private/scripts/stray-runs-live.test.ts',
];

const TEST_FILES = 'tests/**/*.{test,spec}.{ts,tsx,mts,js,mjs}';

const SHARED_EXCLUDE = [
  ...configDefaults.exclude,
  '**/.claude/worktrees/**',
  '**/.worktrees/**',
  // The public tree scripts/public-snapshot.mjs writes; a copy of tests/ that
  // must never run as a second suite from here.
  '**/public-snapshot/**',
  // Scratch probes a review agent writes during a run, marked TEMPORARY PROBE and deleted when the
  // agent finishes. They are gitignored, but that only stops them being committed: while a run is
  // live they land mid-suite, sometimes with a parse error and sometimes vanishing between
  // collection and execution, and a red suite then blocks the pre-commit hook on work that has
  // nothing to do with them. `zz` is the convention those agents already use; no real test in this
  // repository starts with it.
  '**/tests/**/zz*',
  // The one folder for a throwaway probe (item 7.6).
  '**/scratch/**',
];

// One machine, shared with renders for another project: an uncapped run took every core (22
// workers, 14:39) and held the machine from a build the other project needed. Default 1 (so a
// suite is at most two node processes, the orchestrator's own count), read from FW_TEST_WORKERS
// so it can be lifted once the machine is confirmed free.
const maxWorkers = Number(process.env.FW_TEST_WORKERS) || 1;

// What a test reads from disk, or a process it starts, is invisible to vitest's import graph, so
// "related" runs cannot see that a change to a doc, a locale, a script or a hook concerns it. The
// pre-commit hook therefore runs every such test on every commit as its own lane. The lane is found
// here, not listed by hand: a test is in it when its own text, or anything it imports by a relative
// path, at any depth, touches the disk or starts a process. A hand list would miss the next test
// that reads a file through a shared helper (32 tests did, through tests/helpers/read-source.ts).
const READS_THE_TREE =
  /node:fs|from ['"]fs['"]|fs\/promises|readFileSync|readdirSync|existsSync|statSync|globSync|import\.meta\.glob|\?raw|child_process|execSync|spawnSync|execFile|madge|playwright/;
const RELATIVE_IMPORT = /(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g;
const SOURCE_EXTENSIONS = ['', '.ts', '.tsx', '.mts', '.mjs', '.js', '/index.ts', '/index.tsx'];

function treeReadingTests(root: string): string[] {
  const parsed = new Map<string, { reads: boolean; imports: string[] }>();
  const parse = (file: string) => {
    let entry = parsed.get(file);
    if (entry) return entry;
    let text = '';
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      // An import that resolves to nothing readable adds nothing.
    }
    const imports: string[] = [];
    for (const m of text.matchAll(RELATIVE_IMPORT)) {
      const target = resolve(dirname(file), m[1].split('?')[0]);
      const found = SOURCE_EXTENSIONS.map((ext) => target + ext).find(
        (p) => existsSync(p) && statSync(p).isFile(),
      );
      if (found) imports.push(found);
    }
    entry = { reads: READS_THE_TREE.test(text), imports };
    parsed.set(file, entry);
    return entry;
  };
  // Each test walks its own import closure, so an import cycle cannot hide a reader the way a shared
  // "not yet known" answer would; only the parse of each file is shared between walks.
  const readsTheTree = (test: string): boolean => {
    const seen = new Set<string>([test]);
    const queue = [test];
    for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
      if (parse(file).reads) return true;
      for (const next of parse(file).imports) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return false;
  };
  const tooling = new Set(TOOLING_TESTS);
  return readdirSync(join(root, 'tests'), { recursive: true, encoding: 'utf8' })
    .map((f) => relative(root, join(root, 'tests', f)).split('\\').join('/'))
    .filter((f) => /\.(test|spec)\.(ts|tsx|mts|js|mjs)$/.test(f) && !tooling.has(f))
    .filter((f) => readsTheTree(join(root, f)));
}

// FW_TEST_LANE=guards narrows the unit project to that lane; unset, the unit project is whole.
const unitInclude =
  process.env.FW_TEST_LANE === 'guards' ? treeReadingTests(fileURLToPath(new URL('.', import.meta.url))) : [TEST_FILES];

export default defineConfig({
  test: {
    maxWorkers,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          // Named on purpose: a test runs because it is in tests/, not because nothing excluded it.
          include: unitInclude,
          exclude: [...SHARED_EXCLUDE, ...TOOLING_TESTS],
        },
      },
      {
        extends: true,
        test: {
          name: 'tooling',
          include: TOOLING_TESTS,
          exclude: SHARED_EXCLUDE,
        },
      },
    ],
  },
});
