import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { REPO_ROOT as ROOT } from '../helpers/repo-root';
import { TREE_READ_TIMEOUT_MS } from '../helpers/spawn-timeout';

// Reads the whole tree or asks git, which outlasts the 5s default on a busy machine; see the helper.
vi.setConfig({ testTimeout: TREE_READ_TIMEOUT_MS });

// Every source file, not a list of eleven. The list was written when the disables lived in a few
// big entry files, and it had to be edited by hand each time one of them was split: the popup's
// nine files and the export's four would all have dropped out of this check silently
// (PLAN-2026-09-16 item 10.3). Files written but not added yet count, the same reading the other
// guards take.
function directiveScanFiles(): string[] {
  const args = ['ls-files', '--cached', '--others', '--exclude-standard', 'src'];
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.(ts|tsx)$/.test(f));
}

function readRootFile(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

// Git is asked and every source file read here, while vitest imports this file, because an import
// has no time limit and reading all of src can outlast the per-test limit on a busy machine.
const DIRECTIVE_SOURCES = directiveScanFiles().map((file) => ({ file, text: readRootFile(file) }));

describe('repository verification gates', () => {
  it('excludes isolated worktrees from Vitest discovery', () => {
    const configPath = join(ROOT, 'vitest.config.ts');
    expect(existsSync(configPath)).toBe(true);
    if (!existsSync(configPath)) return;

    const config = readRootFile('vitest.config.ts');
    expect(config).toContain('**/.claude/worktrees/**');
    expect(config).toContain('**/.worktrees/**');
  });

  it('excludes private corpus preparation artifacts from ESLint discovery', () => {
    expect(readRootFile('eslint.config.mjs')).toContain('corpus/.prep/**');
  });

  it('does not reference ESLint rules that are absent from the minimal config', () => {
    // The old check matched one literal spelling and missed the
    // `eslint-disable-next-line react-hooks/exhaustive-deps` that kept lint
    // red from 2026-08-10 (ARCHITECTURE-9). Any directive naming a rule the
    // config does not load fails eslint itself, so scan every form.
    const config = readRootFile('eslint.config.mjs');
    const configured = new Set(Array.from(config.matchAll(/'([@\w/-]+\/[\w-]+|no-[\w-]+)':/g), m => m[1]));
    const offenders: string[] = [];
    for (const { file, text } of DIRECTIVE_SOURCES) {
      for (const m of text.matchAll(/eslint-disable(?:-next-line|-line)?\s+([^\r\n*]+)/g)) {
        for (const rule of m[1].split(/[,\s]+/).filter(Boolean)) {
          if (!configured.has(rule)) offenders.push(`${file}: ${rule}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('ships a pre-commit hook that runs the CI gates locally (TESTS-TOOLING-REPO-1)', () => {
    const hookPath = join(ROOT, '.githooks', 'pre-commit');
    expect(existsSync(hookPath)).toBe(true);
    const hook = readFileSync(hookPath, 'utf8');
    for (const gate of ['npx tsc --noEmit', 'tsc -p tsconfig.tests.json', 'npx eslint .', 'npx vitest run', 'git ls-files -i -c --exclude-standard']) {
      expect(hook).toContain(gate);
    }
    // Every private path the data rule names is checked.
    for (const path of ['corpus/', 'past-forensics/', '.fw-chain.json', 'worker/dev-license.seed.json', 'scripts/license-backup-*', 'scripts/trial-licenses.log']) {
      expect(hook).toContain(path);
    }
  });

  it('keeps retired governance vocabulary out of the living docs (TESTS-TOOLING-REPO-8)', () => {
    // The owner retired a governance layer on 2026-08-22, outside this repository. The
    // living instructions must not send a session back into it. Patterns are
    // phrases, not bare words: "boot" alone would match the dashboard boot
    // path.
    const retired: Array<[string, RegExp]> = [
      ['Boot section', /^## Boot$/m],
      ['boot ritual', /\b(?:on boot|boot-read|boot order|boot sequence|boot surfaces)\b/],
      ['/boot command', /(?<![\w/.])\/boot\b/],
      ['purpose gate', /\bpurpose gate\b/i],
      ['epoch stamp', /\bepoch stamp/i],
      ['falsifier', /\bfalsifier\b/i],
      ['orchestrator role', /(?:(?<![\w/.-])\/orchestrator\b|Owner-Orchestrator|\borchestrator `[0-9a-f]{8}`)/],
      ['baton', /\bbaton\b/i],
      ['HOT/COLD ritual', /HOT\/COLD/],
      ['numbered turns', /\b(?:numbered turns|turn numbers?|Next free turn)\b/i],
      ['guard protocol', /\bguard protocol\b/i],
      ['FENCES.md', /FENCES\.md|\bfences? (?:first|list)\b|\bfence [0-9]\b/i],
      ['reply contract', /\breply contract\b/i],
    ];
    // Living docs only. .brain moved to docs/history/ on 2026-09-16 (history is exempt, as its
    // lessons and archive always were) and .claude/agents no longer exists; the path rules in
    // .claude/rules are the living instruction text now.
    const files = [
      // CLAUDE.md was removed on 2026-09-06; the gate covers it when present.
      ...(existsSync(join(ROOT, 'CLAUDE.md')) ? ['CLAUDE.md'] : []),
      ...listMarkdown('.claude/rules', false),
      ...listMarkdown('docs/spec', true),
    ];
    // The spec is the living set that must be read; .brain and .claude/agents may be absent.
    expect(files.filter((f) => f.startsWith('docs/spec/')).length).toBeGreaterThan(20);
    const hits: string[] = [];
    for (const file of files) {
      const lines = readRootFile(file).split(/\r?\n/);
      lines.forEach((line, i) => {
        for (const [name, re] of retired) {
          if (re.test(line)) hits.push(`${file}:${i + 1} [${name}] ${line.trim().slice(0, 80)}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });
});

function listMarkdown(dir: string, recursive: boolean): string[] {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (recursive) out.push(...listMarkdown(rel, true));
    } else if (entry.name.endsWith('.md')) {
      out.push(rel);
    }
  }
  return out;
}
