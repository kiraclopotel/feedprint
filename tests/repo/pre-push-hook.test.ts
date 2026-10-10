import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const AUTHORIZED_REMOTE = 'https://github.com/kiraclopotel/FeelingWise-Alpha.git';
const ZERO = '0000000000000000000000000000000000000000';
const hook = resolve('.githooks/pre-push');
const repos: string[] = [];

// When this suite runs inside a git hook, git has exported GIT_DIR and
// GIT_INDEX_FILE for the real repository. Without stripping them, the temp
// repo's `git init` and `git config` calls write into the real .git/config
// (core.bare, user.name), which breaks every worktree of the project.
const cleanEnv: NodeJS.ProcessEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
);

function git(repo: string, args: string[], input?: string): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    input,
    env: cleanEnv,
  }).trim();
}

function shellPath(): string {
  if (process.platform !== 'win32') return '/bin/sh';
  const execPath = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim();
  return join(dirname(dirname(dirname(execPath))), 'bin', 'sh.exe');
}

function makeHistory(): { repo: string; clean: string; mixed: string; root: string } {
  const repo = mkdtempSync(join(tmpdir(), 'fw-pre-push-'));
  repos.push(repo);
  git(repo, ['init', '--quiet']);
  git(repo, ['config', 'user.name', 'FeelingWise Hook Test']);
  git(repo, ['config', 'user.email', 'hook-test@example.test']);

  const tree = git(repo, ['mktree'], '');
  const root = git(repo, ['commit-tree', tree], 'sanitized root');
  const clean = git(repo, ['commit-tree', tree, '-p', root], 'clean descendant');
  const legacy = git(repo, ['commit-tree', tree], 'unrelated legacy root');
  const mixed = git(
    repo,
    ['commit-tree', tree, '-p', clean, '-p', legacy],
    'unsafe unrelated merge',
  );
  git(repo, ['config', 'feelingwise.publicRoot', root]);
  return { repo, clean, mixed, root };
}

function invokeHook(repo: string, oid: string, allowPush = true): number | null {
  // The hook's own git calls must see the temp repo, not the hook-exported
  // GIT_DIR of the real one (same stripping as git() above).
  // FW_ALLOW_PUSH is the owner's per-push authorisation (2026-09-06). The
  // history-boundary cases set it so they exercise the boundary, not the gate.
  return spawnSync(shellPath(), [hook, 'origin', AUTHORIZED_REMOTE], {
    cwd: repo,
    encoding: 'utf8',
    env: allowPush ? { ...cleanEnv, FW_ALLOW_PUSH: '1' } : cleanEnv,
    input: `refs/heads/master ${oid} refs/heads/master ${ZERO}\n`,
  }).status;
}

afterEach(() => {
  for (const repo of repos.splice(0)) rmSync(repo, { recursive: true, force: true });
});

describe('FeelingWise pre-push history boundary', () => {
  // Each test shells out to a real git binary for both makeHistory() and
  // invokeHook() (execFileSync/spawnSync against a mkdtempSync repo, not
  // mocked). Under full-suite parallel load on Windows those subprocesses
  // have measured up to ~8.5s, past vitest's 5000ms default; 30000ms leaves
  // headroom without masking a genuinely hung hook.
  it('allows a clean descendant with exactly one configured root', () => {
    const { repo, clean } = makeHistory();
    expect(invokeHook(repo, clean)).toBe(0);
  }, 30000);

  it('blocks every push unless the owner authorised this one', () => {
    const { repo, clean } = makeHistory();
    expect(invokeHook(repo, clean, false)).not.toBe(0);
  }, 30000);

  it('rejects a merge that makes unrelated legacy history reachable', () => {
    const { repo, mixed } = makeHistory();
    expect(invokeHook(repo, mixed)).not.toBe(0);
  }, 30000);
});
