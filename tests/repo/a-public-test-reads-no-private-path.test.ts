// M338, 2026-09-20. The public copy (scripts/public-snapshot.mjs) was rehearsed whole in a scratch
// folder: installed, type-checked, linted, built, its unit suite run. Five test files the public
// copy carries failed there, each because it read a path the public copy does not carry: a page
// under the site's own folder, or a script under the verification folder. Every one of the five was
// written after the last time anybody had rehearsed the split, so nothing had looked.
//
// A guard nobody named cannot fail loudly; this one reads what the split itself reads (the same
// classifying function the snapshot uses) and asks, of every file the split keeps, whether its own
// text reaches for a path the split leaves out. It is written to hold up inside the copy it checks:
// there every remaining test is, by construction, one that never reached outside it, so the sweep
// runs and finds an empty list rather than being skipped.
//
// What it does not chase: a path named only in prose, in an assertion's failure text, or fed to the
// classifying function itself as a piece of data rather than opened, spawned or imported. Those are
// common and honest (a guard that tests the classifier has to hand it private-looking strings), and
// a sweep that could not tell the difference would either miss the real defect under the noise or
// have to be turned down until it did.
import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { isPublicPath } from '../../scripts/public-snapshot.mjs';
import { REPO_ROOT as ROOT } from '../helpers/repo-root';
import { TREE_READ_TIMEOUT_MS } from '../helpers/spawn-timeout';

// Reads the whole tree or asks git, which outlasts the 5s default on a busy machine; see the helper.
vi.setConfig({ testTimeout: TREE_READ_TIMEOUT_MS });

const TEST_FILE = /\.(?:test|spec)\.(?:ts|tsx|mts|js|mjs)$/;

/** Tracked files plus files written but not yet staged, the same reading the sibling repository
 *  guards take (citations.test.ts, path-resolver.test.ts). */
function tracked(...paths: string[]): string[] {
  const args = ['ls-files', '-z', '--cached', '--others', '--exclude-standard', ...paths];
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
}

/** Comment lines dropped the same way `an-instrument-never-skips-quietly.test.ts` drops them: a
 *  path named in prose, describing the very read this file exists to catch, must never be mistaken
 *  for the read itself. Written so this rule also keeps the sweep off its own header above. */
function codeOf(text: string): string {
  return text.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
}

const ROOT_NAMES = new Set(['ROOT', 'REPO_ROOT', 'REPO', 'repoRoot', 'repo', 'REPO_DIR', 'PROJECT_ROOT', 'root']);
/** Reads content, a directory listing, or a module. */
const READ_SINKS = ['readFileSync', 'readFile', 'readdirSync', 'readdir', 'existsSync', 'lstatSync', 'statSync', 'createReadStream', 'openSync', 'repoPath', 'readSource'];
/** Starts another process; only the arguments after the command name can be a path. */
const SPAWN_SINKS = ['execFileSync', 'execFile', 'spawnSync', 'spawn', 'fork'];

function argText(code: string, openParenIndex: number): string {
  let depth = 0;
  for (let i = openParenIndex; i < code.length; i++) {
    if (code[i] === '(') depth++;
    else if (code[i] === ')') { depth--; if (depth === 0) return code.slice(openParenIndex + 1, i); }
  }
  return code.slice(openParenIndex + 1);
}

/** Every argument at THIS call's own top level, not reaching into a nested call: `x.split('/')`
 *  inside `repoPath(...p.split('/'))` must never surface '/' as though it were a path segment. */
function topLevelArgs(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
  }
  out.push(text.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

const PURE_LITERAL = /^(['"])((?:(?!\1)[^\\]|\\.)*)\1$/;

/** The value of each top-level argument, only when every one of them is a plain quoted string: a
 *  spread, a member access or a nested call means the real segments cannot be read off the text,
 *  and guessing from whichever quotes happen to be nearby is how '/' from `p.split('/')` was once
 *  read as a path. Used where segments are joined in order (`join`, `resolve`, `repoPath`), because
 *  an order built from a partial read is a path nobody asked about. */
function literalsIn(text: string): string[] | null {
  const args = topLevelArgs(text);
  const values: string[] = [];
  for (const arg of args) {
    const m = PURE_LITERAL.exec(arg);
    if (!m) return null;
    values.push(m[2]);
  }
  return values;
}

/** Every plain quoted string anywhere in the text, nested calls and array literals included. Safe
 *  only where each literal is judged on its own (a spawned process's argument list), never joined
 *  in sequence with the others. */
function anyLiteralsIn(text: string): string[] {
  const out: string[] = [];
  const re = /(['"])((?:(?!\1)[^\\]|\\.)*)\1/g;
  for (const m of text.matchAll(re)) out.push(m[2]);
  return out;
}

function firstArgText(argsText: string): { first: string; rest: string } {
  let depth = 0;
  for (let i = 0; i < argsText.length; i++) {
    const c = argsText[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) return { first: argsText.slice(0, i).trim(), rest: argsText.slice(i + 1) };
  }
  return { first: argsText.trim(), rest: '' };
}

/** A bare word ('git', 'utf8', a CLI flag) is not a path; a path has an internal slash and no scheme. */
function looksLikeRepoPath(s: string): boolean {
  return /^[\w.-]+(?:\/[\w.-]+)+$/.test(s) && !/^https?:/.test(s);
}

function normalize(base: string, joined: string): string | null {
  const p = posix.normalize(posix.join(base, joined));
  return p.startsWith('..') ? null : p.replace(/\/$/, '');
}

/**
 * isPublicPath, forgiving of the two shapes a hand-assembled candidate can lose that a real read
 * never would: the trailing slash a directory prefix needs (`resolve(ROOT, 'src')`, madge scanning
 * the folder), and the extension a TypeScript specifier omits (`from '../../scripts/build-standalone-verifier'`).
 */
function isPublicCandidate(p: string): boolean {
  if (isPublicPath(p) || isPublicPath(`${p}/`)) return true;
  if (!/\.[A-Za-z]+$/.test(p)) {
    for (const ext of ['.ts', '.tsx', '.mts', '.js', '.mjs']) if (isPublicPath(p + ext)) return true;
  }
  return false;
}

/** Honest exceptions: a literal that reaches a sink but is never a content read of a private path.
 *  Each is `existsSync` used only to ask which environment this run is in, which is why the docs
 *  next to each one spell out that the branch it feeds does nothing when the file is absent. */
const ALLOWED: Record<string, string[]> = {
  'tests/repo/releases.test.ts': ['SOURCE-COMMIT'],
  'tests/repo/snapshot-classification.test.ts': ['SOURCE-COMMIT'],
  'tests/repo/public-package-json.test.ts': ['worker/package.json'],
  'tests/repo/verification-gates.test.ts': ['CLAUDE.md'],
  // Not a repository path at all, and not a read. `hook-message` is the name this test gives the
  // file it WRITES inside a throwaway repository under the system temp folder, to hand to the
  // commit-msg hook the way git hands it one. The sweep sees `join(base, 'hook-message')` and
  // cannot tell that `base` is a temp directory rather than the repo root, which is the one shape
  // it is blind to. Adding it here rather than renaming the literal, because a name chosen to slip
  // past a check is worse than an exception that says what it is (2026-09-21).
  'tests/repo/commit-gates.test.ts': ['hook-message'],
};

function candidatesIn(file: string, rawText: string): { line: number; path: string }[] {
  const code = codeOf(rawText);
  const dir = posix.dirname(file);
  const hits: { line: number; path: string }[] = [];
  const lineOf = (i: number) => code.slice(0, i).split('\n').length;

  for (const re of [
    /\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]/g,
    /\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g,
    /\brequire\(\s*['"](\.{1,2}\/[^'"]+)['"]\)/g,
  ]) {
    for (const m of code.matchAll(re)) {
      const target = normalize(dir, m[1]);
      if (target) hits.push({ line: lineOf(m.index ?? 0), path: target });
    }
  }

  const names = [...READ_SINKS, ...SPAWN_SINKS, 'join', 'resolve'];
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const callRe = new RegExp(`\\b(${escaped.join('|')})\\s*\\(`, 'g');
  for (const m of code.matchAll(callRe)) {
    const name = m[1];
    const open = (m.index ?? 0) + m[0].length - 1;
    const args = argText(code, open);
    const line = lineOf(m.index ?? 0);
    if (name === 'join' || name === 'resolve') {
      const { first, rest } = firstArgText(args);
      let base: string | null = null;
      if (first === '__dirname') base = dir;
      else if (first === 'process.cwd()' || ROOT_NAMES.has(first)) base = '.';
      if (base === null) continue;
      const segs = literalsIn(rest);
      if (!segs || segs.length === 0) continue;
      const target = normalize(base, segs.join('/'));
      if (target) hits.push({ line, path: target });
    } else if (name === 'repoPath') {
      const segs = literalsIn(args);
      if (!segs || segs.length === 0) continue;
      const target = normalize('.', segs.join('/'));
      if (target) hits.push({ line, path: target });
    } else if ((SPAWN_SINKS as string[]).includes(name)) {
      for (const lit of anyLiteralsIn(args)) {
        if (looksLikeRepoPath(lit)) {
          const target = normalize('.', lit);
          if (target) hits.push({ line, path: target });
        }
      }
    } else {
      const { first } = firstArgText(args);
      const segs = literalsIn(first);
      const lit = segs && segs.length === 1 ? segs[0] : undefined;
      if (lit === undefined || !looksLikeRepoPath(lit)) continue;
      const target = normalize('.', lit);
      if (target) hits.push({ line, path: target });
    }
  }
  return hits;
}

describe('a public test reads no private path (2026-09-20)', () => {
  const files = tracked('tests').filter((f) => TEST_FILE.test(f)).filter(isPublicPath);
  // Every file is read here, while vitest collects this file, because collecting has no time limit
  // and reading every public test can outlast the per-test limit on a busy machine.
  const texts = new Map(files.map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]));

  it('actually scanned the public test files', () => {
    // A sweep over an empty list passes; this is the floor that says it looked.
    expect(files.length).toBeGreaterThan(500);
  });

  it('no public test reaches a path the split leaves private', () => {
    const misses: string[] = [];
    for (const f of files) {
      const text = texts.get(f)!;
      const allowed = new Set(ALLOWED[f] ?? []);
      for (const { line, path } of candidatesIn(f, text)) {
        if (allowed.has(path)) continue;
        if (!isPublicCandidate(path)) misses.push(`${f}:${line} reads ${path}, which the public copy does not carry`);
      }
    }
    expect(misses).toEqual([]);
  });

  it('the allowlist only names files that are still public and still there', () => {
    for (const f of Object.keys(ALLOWED)) {
      expect(files, `${f} is a public test file`).toContain(f);
    }
  });
});
