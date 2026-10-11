// The two gates of the reset, held to what they are supposed to refuse.
//
// Written 2026-09-21 as step 1.3 of the reset plan of that day (kept outside this repository), before either hook
// existed, so each gate arrives as a failing test naming the case it has to refuse rather than as a
// hook somebody believes works. The plan's own words: "each with a test that fails first".
//
// Rule 1 of the eight: "Before any work, name the outside number or question it serves. If you
// cannot, do not do it." The diagnosis behind it is in the reset plan: 92 commits in 27 hours
// reached zero users, because nothing ever asked a change what it was for. A commit message is the
// one place that question can be asked mechanically, and the commit-msg hook is the only hook that
// can read it.
//
// Rule 2: "His list holds three acts: one note in OUTBOX/ is one act with one verb, and the commit
// hook counts them." The count is of notes carrying a `**Your act:` line, which is the convention
// every note in that folder already uses. A briefing or a fact sheet carries no such line and is
// not an act, so it does not count. That is why the gate reads the line rather than the file count:
// on the night it was written the folder held seven dated notes and exactly three acts.
//
// Both hooks are bypassable with `git commit --no-verify`, which the pre-commit header already
// documents. A gate that cannot be bypassed in an emergency gets deleted instead.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

// Each case builds a temporary repository and runs a hook in it; the first one on a cold shared runner takes more than
// the default five seconds.
vi.setConfig({ testTimeout: 60_000 });

const commitMsgHook = resolve('.githooks/commit-msg');
const outboxGate = resolve('.githooks/outbox-gate');
const preCommitHook = resolve('.githooks/pre-commit');
const dirs: string[] = [];

// Same reason as tests/repo/pre-push-hook.test.ts: when this suite runs inside a git hook, git has
// exported GIT_DIR and GIT_INDEX_FILE for the real repository, and a temp repo's git calls would
// write into the real .git/config. The owner's word is dropped too: a commit made with the word runs
// this suite inside its own hook, and a case meant to have no word would inherit it.
const cleanEnv: NodeJS.ProcessEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_') && key.toUpperCase() !== 'FW_OWNER_WORD'),
);

function shellPath(): string {
  if (process.platform !== 'win32') return '/bin/sh';
  const execPath = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim();
  return join(dirname(dirname(dirname(execPath))), 'bin', 'sh.exe');
}

function git(repo: string, args: string[], input?: string): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', input, env: cleanEnv }).trim();
}

/** A throwaway repository with one staged file, used to drive a hook the way git would. */
function repoWith(staged: Record<string, string>): string {
  const repo = mkdtempSync(join(tmpdir(), 'fw-gates-'));
  dirs.push(repo);
  git(repo, ['init', '--quiet']);
  git(repo, ['config', 'user.name', 'FeelingWise Gate Test']);
  git(repo, ['config', 'user.email', 'gate-test@example.test']);
  // The bytes staged are the bytes written: a clone with core.autocrlf=true would stage LF
  // where the file has CRLF, and the frozen cases below compare a hash of the staged blob.
  git(repo, ['config', 'core.autocrlf', 'false']);
  for (const [rel, body] of Object.entries(staged)) {
    const full = join(repo, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body, 'utf8');
    git(repo, ['add', '--', rel]);
  }
  return repo;
}

/** Runs a hook in `repo` and returns its exit code and what it said. */
function runHook(
  hook: string,
  repo: string,
  args: string[] = [],
  extraEnv: NodeJS.ProcessEnv = {},
): { code: number; said: string } {
  // Windows environment names are case-insensitive, so an added PATH beside the inherited Path
  // would leave which one the shell reads to chance. The overridden names go out first.
  const overridden = new Set(Object.keys(extraEnv).map((key) => key.toUpperCase()));
  const env: NodeJS.ProcessEnv = {
    ...Object.fromEntries(Object.entries(cleanEnv).filter(([key]) => !overridden.has(key.toUpperCase()))),
    ...extraEnv,
  };
  const r = spawnSync(shellPath(), [hook, ...args], { cwd: repo, encoding: 'utf8', env });
  return { code: r.status ?? -1, said: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function messageFile(repo: string, text: string): string {
  const path = join(repo, 'hook-message');
  writeFileSync(path, text, 'utf8');
  return path;
}

/**
 * A PATH whose first folder holds a no-op `npx`, so the hook's later gates (tsc, eslint, two
 * vitest projects) do not run a compiler and a suite inside a suite against a temp repo with no
 * node_modules. Same reason the outbox gate moved into its own file: the case that has to pass
 * is the hook's own decision, and everything after it is stubbed rather than believed.
 */
function gatesStubbed(): NodeJS.ProcessEnv {
  const bin = mkdtempSync(join(tmpdir(), 'fw-gates-bin-'));
  dirs.push(bin);
  const npx = join(bin, 'npx');
  writeFileSync(npx, '#!/bin/sh\nexit 0\n', 'utf8');
  chmodSync(npx, 0o755);
  return { PATH: `${bin}${delimiter}${process.env.PATH ?? ''}` };
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('the item gate: a product commit names what it is for', () => {
  // Real repository paths, on purpose. tests/repo/citations.test.ts reads any repo-shaped path in a
  // living file as a citation, and an invented fixture name is indistinguishable from a reference
  // that has gone stale. The contents here are nonsense and never reach the real tree: these files
  // are written into a throwaway repository under the system temp folder.
  const PRODUCT_FILE = { 'src/types/messages.ts': '// a staged product file\n' };

  it('refuses a product commit whose message names no outside number or question', () => {
    const repo = repoWith(PRODUCT_FILE);
    const msg = messageFile(repo, 'Tidy up the example\n\nIt was untidy.\n');
    const { code, said } = runHook(commitMsgHook, repo, [msg]);
    expect(code, `the hook allowed it and said: ${said}`).not.toBe(0);
    expect(said).toMatch(/outside/i);
  });

  it('allows a product commit that names the outside number', () => {
    const repo = repoWith(PRODUCT_FILE);
    const msg = messageFile(
      repo,
      'Tidy up the example\n\nOutside number this serves: Off has 2 store users, read live at 22:27.\n',
    );
    const { code, said } = runHook(commitMsgHook, repo, [msg]);
    expect(code, said).toBe(0);
  });

  it('allows a product commit that names the outside question instead', () => {
    const repo = repoWith(PRODUCT_FILE);
    const msg = messageFile(
      repo,
      'Tidy up the example\n\nOutside question this serves: whether the 19 October listing test is clean.\n',
    );
    const { code, said } = runHook(commitMsgHook, repo, [msg]);
    expect(code, said).toBe(0);
  });

  it('does not ask a prose-only commit for a number', () => {
    // A note, a plan or a memory file is not a change to the product, and making every commit
    // recite a number is how a rule becomes a ritual nobody reads.
    const repo = repoWith({ 'docs/README.md': 'a note\n' });
    const msg = messageFile(repo, 'Write a note\n\nBecause it was worth writing down.\n');
    const { code, said } = runHook(commitMsgHook, repo, [msg]);
    expect(code, said).toBe(0);
  });

  it('refuses an empty reason, so the line cannot be satisfied by typing it', () => {
    const repo = repoWith(PRODUCT_FILE);
    const msg = messageFile(repo, 'Tidy up\n\nOutside number this serves:\n');
    const { code } = runHook(commitMsgHook, repo, [msg]);
    expect(code).not.toBe(0);
  });
});

describe('the outbox gate: his list holds three acts', () => {
  const act = (verb: string) => `# A note\n\n**Your act: ${verb}.**\n\nThe rest is detail.\n`;
  const reference = '# A briefing\n\nFacts for him to write from. Nothing here needs him.\n';
  const PRODUCT_FILE = { 'src/types/messages.ts': '// a staged product file\n' };

  // These drive .githooks/outbox-gate rather than .githooks/pre-commit, and the reason is worth
  // keeping. The first version pointed at pre-commit, so every case ran tsc, eslint and the whole
  // unit suite inside a suite that was already running, and the "allows" cases failed on a
  // throwaway repository with no node_modules for a reason that had nothing to do with the outbox.
  // The gate moved into its own file so it could be driven on its own. A gate has to be cheap to
  // test or it ends up tested by belief.

  it('allows a product commit while three notes carry an act', () => {
    const repo = repoWith({
      ...PRODUCT_FILE,
      'OUTBOX/2026-09-18-one.md': act('send the message'),
      'OUTBOX/2026-09-19-two.md': act('paste the listing'),
      'OUTBOX/2026-09-20-three.md': act('type `reword them`'),
      'OUTBOX/2026-09-14-briefing.md': reference,
      'OUTBOX/README.md': 'the rules\n',
    });
    const { code, said } = runHook(outboxGate, repo);
    expect(code, said).toBe(0);
  });

  it('refuses a product commit once a fourth act is waiting', () => {
    const repo = repoWith({
      ...PRODUCT_FILE,
      'OUTBOX/2026-09-18-one.md': act('send the message'),
      'OUTBOX/2026-09-19-two.md': act('paste the listing'),
      'OUTBOX/2026-09-20-three.md': act('type `reword them`'),
      'OUTBOX/2026-09-21-four.md': act('upload the package'),
    });
    const { code, said } = runHook(outboxGate, repo);
    expect(code, `the hook allowed a fourth act and said: ${said}`).not.toBe(0);
    expect(said).toMatch(/four|4/i);
  });

  it('does not count a note in sent or superseded, because those are not waiting', () => {
    const repo = repoWith({
      ...PRODUCT_FILE,
      'OUTBOX/2026-09-18-one.md': act('send the message'),
      'OUTBOX/2026-09-19-two.md': act('paste the listing'),
      'OUTBOX/2026-09-20-three.md': act('type `reword them`'),
      'OUTBOX/sent/2026-09-17-done.md': act('publish the checker'),
      'OUTBOX/superseded/2026-09-16-gone.md': act('type `wording`'),
    });
    const { code, said } = runHook(outboxGate, repo);
    expect(code, said).toBe(0);
  });

  it('lets a commit that adds no product file through, so the outbox can be sorted', () => {
    // The way out of a blocked tree is to close a note, and closing one is a prose commit. A gate
    // that blocked its own remedy would be bypassed with --no-verify every time and then ignored.
    const repo = repoWith({
      'OUTBOX/2026-09-18-one.md': act('send the message'),
      'OUTBOX/2026-09-19-two.md': act('paste the listing'),
      'OUTBOX/2026-09-20-three.md': act('type `reword them`'),
      'OUTBOX/2026-09-21-four.md': act('upload the package'),
    });
    const { code, said } = runHook(outboxGate, repo);
    expect(code, said).toBe(0);
  });
});

describe("the frozen lock: the owner's word opens it, and only with the new hashes staged beside it", () => {
  // Two halves of one lock contradicted each other until this block was written (2026-09-22).
  // tests/repo/frozen-judge-files.test.ts says that when the owner unlocks a frozen file "the new
  // hashes are written here in the same commit", and step 4 of .githooks/pre-commit refuses any
  // commit that stages a frozen file at all, so the commit that test describes could only ever be
  // made by skipping the hooks. The rule held here is the one his note proposes, and nothing
  // wider (OUTBOX/2026-09-20-two-comment-lines.md, "One more thing your word has to cover"): the
  // word alone opens nothing, the word beside a lock file carrying the old hash opens nothing, and
  // a deletion opens nothing.
  //
  // Real repository paths again, for the reason the item gate block above gives. The bytes are
  // nonsense and never leave the throwaway repository: the frozen files in this repository are
  // read by these cases and never written.
  const FROZEN_FILE = 'src/core/neutralizer.ts';
  const LOCK_FILE = 'tests/repo/frozen-judge-files.test.ts';
  const NEW_BODY = '// the unlocked file, rewritten in a throwaway repository only\n';
  const OLD_BODY = '// the bytes the lock was written for\n';
  const sha256 = (text: string) => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
  const lockCarrying = (sha: string) =>
    `// a stand-in for the lock test, holding one hash\nconst FROZEN: Record<string, string> = {\n  '${FROZEN_FILE}': '${sha}',\n};\n`;
  const WORD: NodeJS.ProcessEnv = { FW_OWNER_WORD: 'reword them' };

  it('refuses a frozen file staged with no word at all', () => {
    const repo = repoWith({ [FROZEN_FILE]: NEW_BODY });
    const { code, said } = runHook(preCommitHook, repo, [], gatesStubbed());
    expect(code, `the hook allowed it and said: ${said}`).not.toBe(0);
    expect(said).toContain('a frozen judge file is staged');
  });

  it('refuses it with the word but without the lock test in the same commit', () => {
    const repo = repoWith({ [FROZEN_FILE]: NEW_BODY });
    const { code, said } = runHook(preCommitHook, repo, [], { ...WORD, ...gatesStubbed() });
    expect(code, `the word alone opened the lock and it said: ${said}`).not.toBe(0);
    expect(said).toContain('a frozen judge file is staged');
  });

  it('refuses it when the staged lock test still carries the old hash', () => {
    // The case that makes the rule worth having: the word was given and the lock file is in the
    // commit, but it describes the bytes that were there before, so the commit would ship a
    // fingerprint of something it does not contain.
    const repo = repoWith({ [FROZEN_FILE]: NEW_BODY, [LOCK_FILE]: lockCarrying(sha256(OLD_BODY)) });
    const { code, said } = runHook(preCommitHook, repo, [], { ...WORD, ...gatesStubbed() });
    expect(code, `a stale hash opened the lock and it said: ${said}`).not.toBe(0);
    expect(said).toContain('a frozen judge file is staged');
  });

  it(
    'lets it through with the word, the lock test staged, and the new hash inside it',
    () => {
      const repo = repoWith({ [FROZEN_FILE]: NEW_BODY, [LOCK_FILE]: lockCarrying(sha256(NEW_BODY)) });
      const { code, said } = runHook(preCommitHook, repo, [], { ...WORD, ...gatesStubbed() });
      expect(code, `the hook refused the one commit the lock test describes: ${said}`).toBe(0);
      expect(said).not.toContain('BLOCKED');
    },
    // Real git and a real hook spawn under here (gatesStubbed only skips tsc/eslint/vitest, not
    // git itself); a heavily loaded machine has clocked this past the default 5000ms three times
    // (gem 66), always passing clean alone straight after. Raised, not removed: a genuine hang
    // still fails.
    20_000,
  );

  it('refuses a deletion or a rename of a frozen file, whatever the word says', () => {
    // A deletion leaves no staged blob to hash, so no lock file can describe it. This is the
    // never-event: the exception must not become a way to remove the instrument.
    const repo = repoWith({ [FROZEN_FILE]: OLD_BODY });
    git(repo, ['commit', '--quiet', '-m', 'the frozen file as it was']);
    git(repo, ['rm', '--quiet', '--', FROZEN_FILE]);
    mkdirSync(dirname(join(repo, LOCK_FILE)), { recursive: true });
    writeFileSync(join(repo, LOCK_FILE), lockCarrying(sha256(NEW_BODY)), 'utf8');
    git(repo, ['add', '--', LOCK_FILE]);
    const { code, said } = runHook(preCommitHook, repo, [], { ...WORD, ...gatesStubbed() });
    expect(code, `the word removed a frozen file and it said: ${said}`).not.toBe(0);
    expect(said).toContain('a frozen judge file is staged');
  });

  it(
    'says which of the three was missing, so the refusal can be acted on',
    () => {
      // The refusal keeps its message and gains one line naming what was absent. Without it the
      // person who has the word cannot tell a missing word from a stale hash, and the next move is
      // --no-verify.
      const noWord = runHook(preCommitHook, repoWith({ [FROZEN_FILE]: NEW_BODY }), [], gatesStubbed());
      expect(noWord.said).toContain('FW_OWNER_WORD');
      const noLock = repoWith({ [FROZEN_FILE]: NEW_BODY });
      expect(runHook(preCommitHook, noLock, [], { ...WORD, ...gatesStubbed() }).said).toContain(LOCK_FILE);
      const stale = repoWith({ [FROZEN_FILE]: NEW_BODY, [LOCK_FILE]: lockCarrying(sha256(OLD_BODY)) });
      expect(runHook(preCommitHook, stale, [], { ...WORD, ...gatesStubbed() }).said).toContain(sha256(NEW_BODY));
    },
    // Three real hook spawns in one test; same load-timeout reason as the case above (gem 66).
    20_000,
  );
});

describe('the fast gate: one tree is run once, and the whole unit project runs where it counts', () => {
  // The hook's own decisions are held here, read from what it says; every gate after them is
  // stubbed. A branch commit runs two narrower lanes instead of the whole unit project, so the cases
  // that must still run it whole, and the record that lets a passed tree skip, are the gate itself.
  const SOURCE = 'src/types/messages.ts';
  const NOT_FORCED: NodeJS.ProcessEnv = { FW_FULL_GATE: '', FW_GATE_MERGE: '' };

  /** A repository with one commit on `branch` (never the temp default) and `staged` staged on top. */
  function branchRepo(staged: Record<string, string>, branch = 'topic', committed: Record<string, string> = {}): string {
    const repo = repoWith({ 'README.md': 'a first commit\n', ...committed });
    git(repo, ['symbolic-ref', 'HEAD', `refs/heads/${branch}`]);
    git(repo, ['commit', '--quiet', '-m', 'first']);
    for (const [rel, body] of Object.entries(staged)) {
      const full = join(repo, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, body, 'utf8');
    }
    if (Object.keys(staged).length > 0) git(repo, ['add', '--', ...new Set(Object.keys(staged).map((p) => p.split('/')[0]))]);
    return repo;
  }
  // Git names its own folder's files, as the hook does, so no path here spells that folder out.
  const inGitFolder = (repo: string, name: string) => resolve(repo, git(repo, ['rev-parse', '--git-path', name]));
  const stagedTree = (repo: string) => git(repo, ['write-tree']);
  const parent = (repo: string) => git(repo, ['rev-parse', 'HEAD']);
  const record = (repo: string, line: string) => appendFileSync(inGitFolder(repo, 'fw-green-trees'), `${line}\n`, 'utf8');
  const run = (repo: string) => runHook(preCommitHook, repo, [], { ...NOT_FORCED, ...gatesStubbed() });

  it(
    'runs the narrow lanes on a branch, then does not run the same staged tree twice',
    () => {
      const repo = branchRepo({ [SOURCE]: '// a staged product file\n' });
      const first = run(repo);
      expect(first.code, first.said).toBe(0);
      expect(first.said).toContain('the tests that read the tree');
      expect(first.said).toContain('vitest related');
      expect(first.said).not.toContain('not run twice');
      const second = run(repo);
      expect(second.code, second.said).toBe(0);
      expect(second.said).toContain('not run twice');
      expect(second.said).not.toContain('tsc --noEmit');
    },
    20_000,
  );

  it(
    'does not skip a tree whose pass was recorded on another parent',
    () => {
      const repo = branchRepo({ [SOURCE]: '// a staged product file\n' });
      record(repo, `${stagedTree(repo)} ${'0'.repeat(40)}`);
      const { code, said } = run(repo);
      expect(code, said).toBe(0);
      expect(said).not.toContain('not run twice');
      expect(said).toContain('all gates passed');
    },
    20_000,
  );

  const many = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`extra/f${i}.txt`, `${i}\n`]));
  const REASONS: { name: string; reason: string; make: () => string }[] = [
    {
      name: 'a merge',
      reason: 'a merge',
      make: () => {
        const repo = branchRepo({ [SOURCE]: '// a staged product file\n' });
        writeFileSync(inGitFolder(repo, 'MERGE_HEAD'), `${parent(repo)}\n`, 'utf8');
        return repo;
      },
    },
    { name: 'a commit on master', reason: 'a commit on master', make: () => branchRepo({ [SOURCE]: '// x\n' }, 'master') },
    {
      name: 'a deleted code path',
      reason: 'a code path is deleted or renamed',
      make: () => {
        const repo = branchRepo({ [SOURCE]: '// a staged product file\n' }, 'topic', { 'src/types/mode.ts': '// old\n' });
        git(repo, ['rm', '--quiet', '--', 'src/types/mode.ts']);
        return repo;
      },
    },
    { name: 'a package file', reason: 'package.json changes how every test runs', make: () => branchRepo({ 'package.json': '{}\n' }) },
    { name: 'over 200 paths', reason: '201 paths are staged', make: () => branchRepo(many) },
  ];

  for (const { name, reason, make } of REASONS) {
    it(
      `runs the whole unit project for ${name}, even over a recorded pass on this parent`,
      () => {
        const repo = make();
        record(repo, `${stagedTree(repo)} ${parent(repo)}`);
        const { code, said } = run(repo);
        expect(code, said).toBe(0);
        expect(said).not.toContain('not run twice');
        expect(said).toMatch(new RegExp(`the whole project \\(\\d+ workers\\): ${reason}`));
      },
      20_000,
    );
  }

  it(
    'runs the gate on a merge commit git makes by itself, through pre-merge-commit',
    () => {
      // A merge that does not stop on a conflict never calls pre-commit; git calls pre-merge-commit
      // instead, and with no such file three merges into master passed no gate at all. So this case
      // lets git itself make the merge, with this repository's hooks folder for that one command. The
      // branch merged into is not master, so only the merge itself can be the reason: git writes
      // MERGE_HEAD after it calls this hook, and a gate that looked only for that file took the fast
      // lane here.
      const repo = branchRepo({}, 'integration');
      git(repo, ['checkout', '--quiet', '-b', 'topic']);
      mkdirSync(dirname(join(repo, SOURCE)), { recursive: true });
      writeFileSync(join(repo, SOURCE), '// changed on the topic branch\n', 'utf8');
      git(repo, ['add', '--', SOURCE]);
      git(repo, ['commit', '--quiet', '-m', 'on topic']);
      git(repo, ['checkout', '--quiet', 'integration']);
      const extraEnv = { ...NOT_FORCED, ...gatesStubbed() };
      const overridden = new Set(Object.keys(extraEnv).map((key) => key.toUpperCase()));
      const env: NodeJS.ProcessEnv = {
        ...Object.fromEntries(Object.entries(cleanEnv).filter(([key]) => !overridden.has(key.toUpperCase()))),
        ...extraEnv,
      };
      const r = spawnSync(
        'git',
        ['-c', `core.hooksPath=${dirname(preCommitHook)}`, 'merge', '--no-ff', '--no-edit', 'topic'],
        { cwd: repo, encoding: 'utf8', env },
      );
      const said = `${r.stdout ?? ''}${r.stderr ?? ''}`;
      expect(r.status, said).toBe(0);
      expect(said).toMatch(/the whole project \(\d+ workers\): a merge/);
      expect(said).toContain('all gates passed');
      expect(git(repo, ['rev-list', '--parents', '-n', '1', 'HEAD']).split(' ')).toHaveLength(3);
    },
    20_000,
  );

  it(
    'skips even a merge for a tree that passed every gate there is, and FW_FULL_GATE runs it again',
    () => {
      // Sound because the record says the same bytes passed the whole unit project, the tooling
      // project and the worker typecheck; nothing a merge would run is left.
      const repo = branchRepo({ [SOURCE]: '// a staged product file\n' });
      writeFileSync(inGitFolder(repo, 'MERGE_HEAD'), `${parent(repo)}\n`, 'utf8');
      record(repo, `${stagedTree(repo)} all`);
      expect(run(repo).said).toContain('not run twice');
      const forced = runHook(preCommitHook, repo, [], { FW_FULL_GATE: '1', ...gatesStubbed() });
      expect(forced.said).not.toContain('not run twice');
      expect(forced.said).toMatch(/the whole project \(\d+ workers\): FW_FULL_GATE is set/);
    },
    20_000,
  );
});
