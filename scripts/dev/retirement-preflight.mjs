#!/usr/bin/env node
// Lists every place in this repository that pins a file or folder, before anyone moves, retires or
// deletes it. About a dozen guard tests hold paths in place by existence, by their text or by a
// hash, each in its own way, and a move that satisfies some of them fails on the next commit in
// another. So this reads them all at once and says, for each place, what it asks of a move.
//
// It reads only: it writes nothing and runs no test. The lists are read from the guard tests
// themselves rather than copied here, so the two cannot drift apart without a sound: when a list
// cannot be found in its test, or the test is not where it is read, the check says so and the exit
// code is 2, because an incomplete preflight must never read like a clean one. Only in the public
// copy is a private guard skipped, named, since it cannot fail there either.
//
// A PIN line is a place that breaks or goes wrong when the path moves: a list entry, a row, a
// hash, a test or script that reads it by that path, a page that names it. A NOTE line is what a
// move needs anyway, or a mention that does not break.
//
// Exit 0 when nothing pins the path, 1 when something does, 2 when a guard could not be read or the
// command was not understood.
//
// Usage: node scripts/dev/retirement-preflight.mjs [--all] <path> [<path> ...]
//   A path is from the repository root; a folder covers every file under it.
//   --all also lists each prose line that mentions the path, which by default are only counted.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, posix, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CALIBRATION_ALLOWED, PRIVATE_DENYLIST, PUBLIC_ALLOWLIST, isPublicPath } from '../public-snapshot.mjs';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The guard tests and the files they hold paths in, from the repository root. */
export const GUARDS = {
  frozen: 'tests/repo/frozen-judge-files.test.ts',
  preCommit: '.githooks/pre-commit',
  moved: 'tests/repo/moved-ledger.test.ts',
  docs: 'tests/repo/docs.test.ts',
  root: 'tests/repo/root.test.ts',
  outbox: 'tests/repo/outbox.test.ts',
  outboxGate: '.githooks/outbox-gate',
  scripts: 'tests/repo/scripts.test.ts',
  citations: 'tests/repo/citations.test.ts',
  manifest: 'tests/private/docs/verification-manifest.test.ts',
  copy: 'tests/private/docs/public-copy-claims.test.ts',
  snapshot: 'tests/repo/snapshot-classification.test.ts',
  snapshotLists: 'scripts/public-snapshot.mjs',
  context: 'tests/repo/context-map.test.ts',
};

// ---------------------------------------------------------------------------------------------
// The tree: every tracked or new file on disk, and its text when it is text.

/** Every tracked file, and every new one git does not ignore, that is on disk. */
export function openTree(root = REPO_ROOT) {
  const args = ['ls-files', '-z', '--cached', '--others', '--exclude-standard'];
  const listed = execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean);
  const files = [...new Set(listed)].filter((p) => existsSync(resolve(root, p))).sort();
  const fileSet = new Set(files);
  const dirs = new Set();
  for (const f of files) for (let d = posix.dirname(f); d !== '.'; d = posix.dirname(d)) dirs.add(d);
  const cache = new Map();
  /** The file's text, or null when it is not there or holds a zero byte, which no text file does. */
  const text = (path) => {
    if (!cache.has(path)) {
      let value = null;
      try {
        const buf = readFileSync(resolve(root, path));
        value = buf.includes(0) ? null : buf.toString('utf8').replace(/\r\n/g, '\n');
      } catch {
        // A file that cannot be read names nothing and pins nothing.
      }
      cache.set(path, value);
    }
    return cache.get(path);
  };
  const bytes = (path) => readFileSync(resolve(root, path));
  return { root, files, fileSet, dirs, text, bytes };
}

// ---------------------------------------------------------------------------------------------
// Reading a list out of a test file: its tokens with comments dropped, then the declaration.

const BEFORE_A_VALUE = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await']);

/** Where a regular expression literal that starts at `i` ends, just past its flags. */
function regexEnd(text, i) {
  let j = i + 1;
  let inClass = false;
  while (j < text.length && text[j] !== '\n') {
    const c = text[j];
    if (c === '\\') j++;
    else if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) {
      j++;
      while (j < text.length && /[a-z]/.test(text[j])) j++;
      return j;
    }
    j++;
  }
  return i + 1;
}

/**
 * Strings, names and punctuation of a script, without its comments. Close enough for list
 * literals; a regular expression is kept whole, since a quote inside one would open a string.
 */
export function tokensOf(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i);
      i = end === -1 ? text.length : end;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    if (c === '/') {
      const prev = out[out.length - 1];
      const startsValue = !prev || (prev.type === 'punct' && !/[)\]}\w]/.test(prev.value)) || (prev.type === 'name' && BEFORE_A_VALUE.has(prev.value));
      if (startsValue) {
        const end = regexEnd(text, i);
        out.push({ type: 'regex', value: text.slice(i, end), at: i });
        i = end;
        continue;
      }
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      let value = '';
      let plain = true;
      while (j < text.length && text[j] !== c) {
        if (text[j] === '\\') {
          value += text[j + 1] ?? '';
          j += 2;
          continue;
        }
        if (c === '`' && text[j] === '$' && text[j + 1] === '{') plain = false;
        if (c !== '`' && text[j] === '\n') break;
        value += text[j];
        j++;
      }
      out.push({ type: plain ? 'string' : 'template', value, at: i });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < text.length && /[\w$]/.test(text[j])) j++;
      out.push({ type: 'name', value: text.slice(i, j), at: i });
      i = j;
      continue;
    }
    if (!/\s/.test(c)) out.push({ type: 'punct', value: c, at: i });
    i++;
  }
  return out;
}

function lineAt(text, offset) {
  let line = 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) line++;
  return line;
}

/**
 * The tokens a `const NAME = ...` gives its value, up to the `;` that ends it or the bracket that
 * closes it, or null when the file declares no such name.
 */
function valueTokens(tokens, name) {
  const at = tokens.findIndex((t, k) => t.type === 'name' && t.value === name && ['const', 'let', 'var'].includes(tokens[k - 1]?.value));
  if (at === -1) return null;
  let k = at + 1;
  // Skip a type annotation: the value starts after the first `=` at the top level.
  let depth = 0;
  for (; k < tokens.length; k++) {
    const v = tokens[k].type === 'punct' ? tokens[k].value : '';
    if ('([{<'.includes(v) && v) depth++;
    else if (')]}>'.includes(v) && v) depth--;
    else if (v === '=' && depth <= 0) break;
  }
  const out = [];
  depth = 0;
  for (k += 1; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.type === 'punct' && '([{'.includes(t.value)) depth++;
    if (t.type === 'punct' && ')]}'.includes(t.value)) depth--;
    if (depth < 0 || (depth === 0 && t.type === 'punct' && t.value === ';')) break;
    out.push(t);
  }
  return out;
}

/** Every string in the value of `const NAME`, with its line, or null when it is not declared. */
export function stringsIn(text, name) {
  const value = valueTokens(tokensOf(text), name);
  if (!value) return null;
  return value.filter((t) => t.type === 'string').map((t) => ({ value: t.value, line: lineAt(text, t.at) }));
}

/**
 * The entries of an object literal `const NAME = { key: 'value', 'key': ['a', 'b'] }`: each key
 * with the strings of its value and its line, or null when it is not declared.
 */
export function entriesIn(text, name) {
  const value = valueTokens(tokensOf(text), name);
  if (!value) return null;
  const entries = [];
  let depth = 0;
  for (let k = 0; k < value.length; k++) {
    const t = value[k];
    if (t.type === 'punct' && '([{'.includes(t.value)) depth++;
    if (t.type === 'punct' && ')]}'.includes(t.value)) depth--;
    const isKey = depth === 1 && (t.type === 'string' || t.type === 'name') && value[k + 1]?.value === ':';
    if (!isKey) continue;
    const entry = { key: t.value, values: [], line: lineAt(text, t.at) };
    let inner = 0;
    for (let j = k + 2; j < value.length; j++) {
      const u = value[j];
      if (u.type === 'punct' && '([{'.includes(u.value)) inner++;
      if (u.type === 'punct' && ')]}'.includes(u.value)) inner--;
      if (inner < 0 || (inner === 0 && u.type === 'punct' && u.value === ',')) break;
      if (u.type === 'string') entry.values.push(u.value);
    }
    entries.push(entry);
  }
  return entries;
}

/** The regular expression literal `const NAME = /.../flags;`, or null. */
export function regexIn(text, name) {
  const value = valueTokens(tokensOf(text), name);
  if (!value || value.length !== 1 || value[0].type !== 'regex') return null;
  const m = /^\/(.*)\/([a-z]*)$/s.exec(value[0].value);
  if (!m) return null;
  try {
    return new RegExp(m[1], m[2]);
  } catch {
    // A pattern this engine cannot build is a list the preflight cannot read, which the caller reports.
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Where a line names the path.

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** What is being looked for: one path, the files it covers, and how a line can name it. */
export function makeTarget(path, tree) {
  const isFolder = tree.dirs.has(path);
  const files = isFolder ? tree.files.filter((f) => f.startsWith(`${path}/`)) : tree.fileSet.has(path) ? [path] : [];
  const covers = (p) => p === path || (isFolder && p.startsWith(`${path}/`));
  const last = path.split('/').pop();
  // Text that every way of naming it contains: the name without its extension, since an import
  // leaves the extension out. An index module is the exception: code imports it by its folder, as
  // '../i18n' or '..', so for it the folder's name and a path of dots alone are looked for too.
  const needle = isFolder ? last : last.replace(/\.[^.]+$/, '') || last;
  const folderName = !isFolder && /^index\.[^.]+$/.test(last) ? (path.includes('/') ? posix.basename(posix.dirname(path)) : '') : null;
  const whole = new RegExp(`(?<![\\w@./-])${escapeRe(path)}${isFolder ? '(?![\\w.-])' : '(?![\\w/-]|\\.\\w)'}`);
  const uniqueName = tree.files.filter((f) => posix.basename(f) === last).length <= 1;
  return { path, isFolder, files, covers, needle, folderName, whole, name: last, uniqueName, fileSet: new Set(files) };
}

const DOTS_ONLY = /(['"`])(?:\.\.?\/)*\.\.?\/?\1/;
const IMPORTED_HERE = /(?:\bfrom|\bimport\s*\(?|\brequire\s*\()\s*$/;

/** Whether a line or a whole file may name the target, before its lines are read closely. */
function mayName(text, target, code) {
  if (text.includes(target.needle)) return true;
  const folder = target.folderName;
  return code && folder != null && ((folder !== '' && text.includes(folder)) || DOTS_ONLY.test(text));
}

const FILE_NAME = 'names its file name, which no other file in the tree has';
const SHARED_NAME = 'names a file of the same name, which other files in the tree share: check which one it reads';

const QUOTED = /(['"`])((?:(?!\1)[^\\\n]|\\.)*)\1/g;
const LINK = /\]\(\s*<?([^)\s>]+)>?/g;
const IMPORT_ENDINGS = ['', '.ts', '.tsx', '.mts', '.mjs', '.js', '.d.mts', '/index.ts', '/index.tsx', '/index.mjs', '/index.js'];

/** Where a relative path written in `file` leads, in each spelling an import or a link could mean. */
function relativeCandidates(file, spec) {
  const clean = spec.split(/[?#]/)[0];
  const base = posix.normalize(posix.join(posix.dirname(file), clean)).replace(/\/$/, '');
  if (base.startsWith('..')) return [];
  const out = IMPORT_ENDINGS.map((e) => base + e);
  // An ES module import of a TypeScript file names it with the ending it will have once built.
  if (base.endsWith('.js')) out.push(base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx'));
  if (base.endsWith('.mjs')) out.push(base.replace(/\.mjs$/, '.mts'));
  return out;
}

/**
 * How one line of `file` names the target, or null: its whole path, its folders and name as
 * separate quoted pieces, a relative path from the file's own folder, or its name read beside
 * the file that reads it.
 */
export function howLineNames(line, file, target, code) {
  if (!mayName(line, target, code)) return null;
  if (target.whole.test(line)) return 'names its path';
  const inside = (p) => target.fileSet.has(file) && target.covers(p);
  if (code) {
    const quoted = [...line.matchAll(QUOTED)].map((m) => ({ value: m[2], start: m.index, end: m.index + m[0].length }));
    // Pieces passed one after another to join() or a path helper, such as 'docs', 'README.md'.
    for (let a = 0; a < quoted.length; a++) {
      let parts = [quoted[a].value];
      for (let b = a + 1; b < quoted.length && /^\s*,\s*$/.test(line.slice(quoted[b - 1].end, quoted[b].start)); b++) {
        parts = [...parts, quoted[b].value];
        const joined = posix.normalize(parts.join('/')).replace(/\/$/, '');
        if (target.covers(joined)) return 'names it in pieces';
      }
    }
    const besideItself = /__dirname|import\.meta/.test(line);
    for (const q of quoted) {
      // A bare '.' or '..' is also a split or a join, so it counts only where it is imported.
      const dotsImport = target.folderName != null && /^\.\.?$/.test(q.value) && IMPORTED_HERE.test(line.slice(0, q.start));
      if (/^\.\.?\//.test(q.value) || dotsImport) {
        const hit = relativeCandidates(file, q.value).find((c) => target.covers(c));
        if (hit && !inside(hit)) return 'imports or reads it by a relative path';
      }
      if (besideItself && !q.value.includes('/') && target.covers(posix.join(posix.dirname(file), q.value))) {
        return 'reads it from its own folder';
      }
      // A page links to a page beside it by its bare name.
      if (!target.isFolder && q.value === target.name && file.endsWith('.html') && posix.dirname(file) === posix.dirname(target.path)) {
        return 'links to it from the same folder';
      }
    }
    // A bare file name joined to a folder somewhere else in the file; it pins this file for sure
    // only when no other file in the tree has that name.
    if (!target.isFolder && quoted.some((q) => q.value === target.name)) return target.uniqueName ? FILE_NAME : SHARED_NAME;
  } else {
    for (const m of line.matchAll(LINK)) {
      const spec = m[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(spec) || spec.startsWith('#') || spec.startsWith('/')) continue;
      const hit = relativeCandidates(file, spec).find((c) => target.covers(c));
      if (hit && !inside(hit)) return 'links to it';
    }
  }
  return null;
}

// Paths on a page as the docs and context-map tests read them: in backticks, or bare under a known
// folder, and a bare file name found from the folders the same line names.
const PATH_SHAPE = /^[\w.@*-]+(?:\/[\w.@*-]+)*\/?$/;
const NAME_ENDING = /\.(md|tsv|ts|tsx|mts|mjs|js|json|toml|html|css|py|txt|zip|patch|png)$/;
const WEB_ADDRESS = /^[a-z0-9-]+\.(?:org|com|net|io|dev|cz)\//;
const BARE_PATH = /(?<![\w@/.:-])((?:src|docs|tests|scripts|worker|verifier|landing|\.claude)\/[\w./@*-]*[\w/*])/g;
const FOLDER_IN_TEXT = /[\w.@-]+(?:\/[\w.@-]+)+\/?|[\w.@-]+\//g;

function pathsOnLine(line) {
  const ticked = [...line.matchAll(/`([^`\s]+)`/g)]
    .map((m) => m[1])
    .filter((t) => PATH_SHAPE.test(t) && (t.includes('/') || NAME_ENDING.test(t)))
    .filter((t) => !t.includes('YYYY') && !WEB_ADDRESS.test(t) && !t.startsWith('npm'));
  const bare = [...line.replace(/`[^`]*`/g, ' ').matchAll(BARE_PATH)].map((m) => m[1].replace(/\.$/, ''));
  return [...new Set([...ticked, ...bare])];
}

/** The name on a page line that means the target, read from the given folders and the line's own, or null. */
export function pageLineNames(line, bases, target, tree) {
  if (!line.includes(target.needle)) return null;
  const folders = new Set(bases);
  for (const m of line.matchAll(FOLDER_IN_TEXT)) {
    for (const base of bases) {
      const p = posix.join(base, m[0]).replace(/\/$/, '');
      if (tree.dirs.has(p)) folders.add(`${p}/`);
      else if (tree.fileSet.has(p)) folders.add(`${posix.dirname(p)}/`);
    }
  }
  // The tests accept a name when any of its readings is in the tree, so it depends on the target
  // only when every reading that is in the tree lies inside it.
  const inTree = (p) => tree.fileSet.has(p) || tree.dirs.has(p);
  for (const name of pathsOnLine(line)) {
    const readings = [...new Set([...folders].map((folder) => posix.join(folder, name).replace(/\/$/, '')))];
    const there = readings.filter(inTree);
    if (there.length > 0 ? there.every(target.covers) : target.files.length === 0 && readings.some(target.covers)) return name;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// The checks. Each returns { title, guard, findings } or, when its guard is absent or unreadable,
// { skipped } or { unread } with the reason.

/** Each file and line a finding stands for, so a place reported twice is counted once. */
const placesOf = (f) => f.places ?? [f.where];
const pin = (where, what) => ({ level: 'pin', where, what });
const note = (where, what) => ({ level: 'note', where, what });

/** Line numbers as short runs: 15-62,139. */
export function ranges(lines) {
  const sorted = [...new Set(lines)].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    out.push(j > i ? `${sorted[i]}-${sorted[j]}` : String(sorted[i]));
    i = j;
  }
  return out.join(',');
}

/** The file the public snapshot writes into its copy, and that nothing here carries. */
const PUBLIC_COPY_MARK = 'SOURCE-COMMIT';

/**
 * A guard that is not where the preflight reads it. In the public copy a private guard is absent by
 * design and cannot fail there, so it is skipped; anywhere else it has moved or been renamed, and a
 * preflight that went quiet about it would pass over whatever it pins.
 */
function missing(path, tree) {
  if (tree.fileSet.has(PUBLIC_COPY_MARK) && !isPublicPath(path)) return { skipped: `${path} is private, and this is the public copy` };
  return { unread: `${path} is not in the tree; the preflight reads it there, so it is out of step with the guards` };
}

function unread(guard, what) {
  return { unread: `${what} could not be found in ${guard}; the preflight is out of step with that guard` };
}

function checkFrozen(target, tree) {
  const guard = GUARDS.frozen;
  const text = tree.text(guard);
  if (text == null) return missing(guard, tree);
  const frozen = entriesIn(text, 'FROZEN');
  if (!frozen || frozen.length === 0) return unread(guard, 'The FROZEN table');
  const findings = [];
  const hookLines = new Set();
  for (const { key, values, line } of frozen) {
    if (!target.covers(key)) continue;
    const sha = values[0] ?? '';
    let now = null;
    if (tree.fileSet.has(key)) now = createHash('sha256').update(tree.bytes(key)).digest('hex');
    const state = now === sha ? 'the file on disk has that hash' : now ? `the file on disk hashes to ${now}, so the lock fails already` : 'the file is not on disk';
    findings.push(pin(`${guard}:${line}`, `its SHA-256 is frozen as ${sha}; ${state}. An edit needs the owner's word and the new hash written here in the same commit; the pre-commit hook refuses a move or deletion whatever the word, so the hook and this lock have to change first`));
    const hook = tree.text(GUARDS.preCommit);
    if (hook != null) {
      hook.split('\n').forEach((l, i) => {
        if (!l.includes(`'${key}'`) || hookLines.has(i)) return;
        hookLines.add(i);
        findings.push(pin(`${GUARDS.preCommit}:${i + 1}`, 'the pre-commit hook refuses any staged move or deletion of it, and an edit unless the owner\'s word is given and the lock test carries the new hash; the lock test checks the hook names it'));
      });
    }
  }
  return { title: 'the frozen-file lock', guard, findings };
}

function readLedger(text) {
  const rows = [];
  text.split('\n').forEach((l, i) => {
    if (!l || l.startsWith('#') || l.startsWith('old_path\t')) return;
    const [old, now, item] = l.split('\t');
    rows.push({ old, now, item, line: i + 1 });
  });
  return rows;
}

function checkMoved(target, tree) {
  const guard = GUARDS.moved;
  const text = tree.text(guard);
  if (text == null) return missing(guard, tree);
  const privateLedger = stringsIn(text, 'PRIVATE_LEDGER')?.[0]?.value;
  const publicLedger = stringsIn(text, 'PUBLIC_LEDGER')?.[0]?.value;
  if (!privateLedger || !publicLedger) return unread(guard, 'The two ledger paths');
  const findings = [];
  const again = "when it moves again, the row's new path is rewritten to the final one, since the test checks every new path exists";
  for (const ledger of [privateLedger, publicLedger]) {
    const body = tree.text(ledger);
    if (body == null) continue;
    const rows = readLedger(body);
    const here = rows.filter((r) => target.covers(r.now ?? ''));
    const old = rows.filter((r) => !target.covers(r.now ?? '') && target.covers(r.old ?? ''));
    // A folder can hold hundreds of moved files; past a few rows one line says it better.
    if (here.length > 5) {
      findings.push({ ...pin(`${ledger}:${ranges(here.map((r) => r.line))}`, `${here.length} rows have their new path in it; ${again}`), places: here.map((r) => `${ledger}:${r.line}`) });
    } else {
      for (const r of here) findings.push(pin(`${ledger}:${r.line}`, `this row moved ${r.old} here; ${again}`));
    }
    if (old.length > 5) {
      findings.push(note(`${ledger}:${ranges(old.map((r) => r.line))}`, `${old.length} rows have their old path in it: citations of those resolve through the rows`));
    } else {
      for (const r of old) findings.push(note(`${ledger}:${r.line}`, `an old address: citations of it resolve to ${r.now} through this row`));
    }
  }
  if (target.files.length > 0) {
    const where = tree.text(privateLedger) != null ? privateLedger : publicLedger;
    findings.push(note(where, `a move adds a row old path, new path, reason; when both ends are public the same row goes into ${publicLedger}, which must equal the public half`));
  }
  return { title: 'the moved-path ledger', guard, findings };
}

function checkDocs(target, tree) {
  const guard = GUARDS.docs;
  const text = tree.text(guard);
  if (text == null) return missing(guard, tree);
  const rootFiles = stringsIn(text, 'ROOT_FILES');
  const folders = stringsIn(text, 'FOLDERS');
  const ownerNotes = regexIn(text, 'OWNER_NOTES');
  const consolidations = regexIn(text, 'CONSOLIDATIONS');
  const indexPages = entriesIn(text, 'INDEX_PAGES');
  const researchIndex = stringsIn(text, 'RESEARCH_INDEX')?.[0]?.value;
  if (!rootFiles || !folders || !ownerNotes || !consolidations || !indexPages || !researchIndex) {
    return unread(guard, 'ROOT_FILES, FOLDERS, OWNER_NOTES, CONSOLIDATIONS, INDEX_PAGES or RESEARCH_INDEX');
  }
  const findings = [];
  const inDocs = target.path.startsWith('docs/') ? target.path.slice('docs/'.length) : null;
  if (inDocs != null && !inDocs.includes('/')) {
    for (const r of rootFiles) {
      if (r.value === inDocs) findings.push(pin(`${guard}:${r.line}`, 'a named file of the docs root: the test fails while the name is here and the file is not'));
    }
    for (const f of folders) {
      if (f.value === inDocs) {
        findings.push(pin(`${guard}:${f.line}`, 'a named docs folder: the test fails when a top-level docs folder is not in this list and in docs/README.md'));
      }
    }
    if (ownerNotes.test(inDocs) || consolidations.test(inDocs)) findings.push(note(guard, 'allowed at the docs root by its dated name only; anywhere else it needs no name'));
  }
  const readme = tree.text('docs/README.md');
  const reported = new Set();
  // Every guard in these two folders has to be named once in the guard table of docs/README.md.
  const guardName = /^tests\/(?:repo|gates)\/[^/]+\.test\.ts$/;
  const guardsHere = target.files.filter((f) => guardName.test(f));
  if (readme != null) {
    for (const g of guardsHere) {
      const base = g.split('/').pop();
      readme.split('\n').forEach((l, i) => {
        if (!l.includes(base)) return;
        reported.add(`docs/README.md:${i + 1}`);
        findings.push(pin(`docs/README.md:${i + 1}`, `the guard table names ${base}: every guard in tests/repo and tests/gates is named there once`));
      });
    }
  }
  for (const { key: page, values: bases, line } of indexPages) {
    const body = tree.text(page);
    if (body == null) continue;
    body.split('\n').forEach((l, i) => {
      const where = `${page}:${i + 1}`;
      if (reported.has(where)) return;
      const name = pageLineNames(l, bases, target, tree);
      if (name) findings.push(pin(where, `an index page names it as \`${name}\`; ${guard}:${line} fails when a name there is not in the tree`));
    });
  }
  const researchPrefix = `docs/${posix.dirname(researchIndex)}/`;
  const research = [...new Set(target.files.concat(target.isFolder ? [] : [target.path]).filter((f) => f.startsWith(researchPrefix) && f !== `docs/${researchIndex}`)
    .map((f) => f.slice(researchPrefix.length).split('/'))
    .map((parts) => (parts.length > 1 ? `${parts[0]}/` : parts[0])))];
  const indexText = tree.text(`docs/${researchIndex}`);
  if (indexText != null) {
    for (const entry of research) {
      indexText.split('\n').forEach((l, i) => {
        if (l.startsWith(`| \`${entry}\` |`)) findings.push(pin(`docs/${researchIndex}:${i + 1}`, `the research index row for ${entry}: every top-level research entry has one, and a row whose entry is gone is stale`));
      });
    }
  }
  return { title: 'the docs layout and its index pages', guard, findings };
}

function checkRoot(target, tree) {
  const guard = GUARDS.root;
  const text = tree.text(guard);
  if (text == null) return missing(guard, tree);
  const entries = entriesIn(text, 'ROOT_ENTRIES');
  const leaving = entriesIn(text, 'LEAVING');
  const plan = regexIn(text, 'PLAN');
  if (!entries || entries.length === 0 || !leaving || !plan) return unread(guard, 'ROOT_ENTRIES, LEAVING or PLAN');
  const findings = [];
  const top = target.path.includes('/') ? null : target.isFolder ? `${target.path}/` : target.path;
  if (top) {
    for (const e of [...entries, ...leaving]) {
      if (e.key === top) findings.push(pin(`${guard}:${e.line}`, 'a named top-level entry: the test fails while it is named here and gone, and while a new one is not named'));
    }
    if (plan.test(top)) findings.push(note(guard, 'a dated plan: one is allowed at the root, and closed ones live in docs/plans/'));
  }
  return { title: 'the repository root', guard, findings };
}

function checkOutbox(target, tree) {
  const guard = GUARDS.outbox;
  const text = tree.text(guard);
  if (text == null) return missing(guard, tree);
  const named = stringsIn(text, 'NAMED_AT_ROOT');
  const folders = stringsIn(text, 'FOLDERS');
  const dated = regexIn(text, 'DATED');
  if (!named || !folders || !dated) return unread(guard, 'NAMED_AT_ROOT, FOLDERS or DATED');
  const findings = [];
  const gate = tree.text(GUARDS.outboxGate);
  for (const f of target.files.filter((p) => p.startsWith('OUTBOX/'))) {
    const rest = f.slice('OUTBOX/'.length);
    if (!rest.includes('/')) {
      for (const n of named) if (n.value === rest) findings.push(pin(`${guard}:${n.line}`, `${rest} is a named file of the OUTBOX root; the test fails while it is named and gone`));
      const body = tree.text(f) ?? '';
      if (dated.test(rest) && gate != null && gate.includes('Your act:') && body.includes('**Your act:')) {
        findings.push(note(f, `an act waiting for the owner: ${GUARDS.outboxGate} counts it among his three while it sits at the OUTBOX root, and moving it to ${folders.map((x) => `${x.value}/`).join(' or ')} takes it off his list`));
      }
    }
    if (!dated.test(posix.basename(f)) && !named.some((n) => n.value === rest) && f !== 'OUTBOX/sent/.gitkeep') {
      findings.push(note(f, 'its name is not dated, so it may only stay where it is named'));
    }
  }
  return { title: 'the OUTBOX layout and the outbox gate', guard, findings };
}

const SCRIPT_FILE = /^scripts\/.+\.(mjs|ts|js)$/;

function checkScripts(target, tree) {
  const guard = GUARDS.scripts;
  const text = tree.text(guard);
  if (text == null) return missing(guard, tree);
  const rootFiles = stringsIn(text, 'ROOT_FILES');
  const folders = entriesIn(text, 'FOLDERS');
  const mayCite = stringsIn(text, 'PUBLIC_MAY_CITE');
  const namedNowhere = stringsIn(text, 'NAMED_NOWHERE');
  const saysNothing = stringsIn(text, 'SAYS_NOTHING_ABOUT_A_SCRIPT');
  if (!rootFiles || !folders || folders.length === 0 || !mayCite || !namedNowhere || !saysNothing) {
    return unread(guard, 'ROOT_FILES, FOLDERS, PUBLIC_MAY_CITE, NAMED_NOWHERE or SAYS_NOTHING_ABOUT_A_SCRIPT');
  }
  const excluded = new Set(saysNothing.map((s) => s.value));
  const findings = [];
  for (const f of target.files.filter((p) => p.startsWith('scripts/'))) {
    const parts = f.split('/');
    if (parts.length === 2) {
      for (const r of rootFiles) if (r.value === parts[1]) findings.push(pin(`${guard}:${r.line}`, `${parts[1]} is a named file of the scripts root: the test fails while it is named here and gone`));
    } else {
      const folder = folders.find((e) => e.key === parts[1]);
      if (folder && !target.isFolder) findings.push(note(`${guard}:${folder.line}`, `scripts/${parts[1]}/ is ${folder.values[0]} as a whole, so moving it into a folder of the other kind fails the test`));
    }
  }
  for (const c of [...mayCite, ...namedNowhere]) {
    const sides = c.value.split(' -> ');
    if (sides.some((s) => target.covers(s))) findings.push(pin(`${guard}:${c.line}`, `a listed exception ("${c.value}"); the list may only shrink, and the test fails while it holds a line that is no longer true`));
  }

  // "Every script can be found from somewhere else": a script counts as found when another file
  // holds its file name.
  const texts = tree.files.filter((f) => !excluded.has(f)).map((f) => [f, tree.text(f)]).filter(([, t]) => t != null);
  const namers = (script) => {
    const base = script.split('/').pop();
    return texts.filter(([f, t]) => f !== script && t.includes(base)).map(([f]) => f);
  };
  for (const s of target.files.filter((f) => SCRIPT_FILE.test(f))) {
    const others = namers(s).filter((f) => !target.fileSet.has(f));
    if (others.length === 0 && !target.isFolder) findings.push(pin(s, 'no other file names it now, so the test counts it as lost already'));
  }
  const scripts = tree.files.filter((f) => SCRIPT_FILE.test(f) && !target.fileSet.has(f));
  const ours = target.files.filter((f) => !excluded.has(f)).map((f) => [f, tree.text(f)]).filter(([, t]) => t != null);
  for (const s of scripts) {
    const base = s.split('/').pop();
    const inside = ours.filter(([, t]) => t.includes(base)).map(([f, t]) => `${f}:${t.split('\n').findIndex((l) => l.includes(base)) + 1}`);
    if (inside.length === 0) continue;
    const outside = namers(s).filter((f) => !target.fileSet.has(f));
    if (outside.length === 0) {
      findings.push(pin(inside.join(', '), `the only place that names ${s}; deleting it, or dropping the name, fails "every script can be found from somewhere else" unless the script is named where its job is described`));
    } else if (outside.length <= 2) {
      findings.push(note(inside.join(', '), `names ${s}, which only ${outside.join(' and ')} also name${outside.length === 1 ? 's' : ''}; retiring those as well would leave it unnamed`));
    }
  }
  const pkgText = tree.text('package.json');
  if (pkgText != null) {
    let pkg = null;
    try {
      pkg = JSON.parse(pkgText);
    } catch {
      // A package.json that does not parse fails every npm command before this matters.
    }
    const lines = pkgText.split('\n');
    for (const [name, cmd] of Object.entries(pkg?.scripts ?? {})) {
      for (const m of String(cmd).matchAll(/(?<![\w/-])(scripts\/[\w./-]+)/g)) {
        if (!target.covers(m[1])) continue;
        const at = lines.findIndex((l) => l.includes(`"${name}"`));
        findings.push(pin(`package.json:${at + 1}`, `npm run ${name} runs it by path; the test fails when an npm script names a file that is not there`));
      }
    }
  }
  return { title: 'the scripts layout', guard, findings };
}

function checkCitations(target, tree) {
  const guard = GUARDS.citations;
  const text = tree.text(guard);
  if (text == null) return missing(guard, tree);
  const prefixes = stringsIn(text, 'LIVING_PREFIXES');
  const living = stringsIn(text, 'LIVING_FILES');
  const notLiving = stringsIn(text, 'NOT_LIVING');
  const textFile = regexIn(text, 'TEXT');
  const citation = regexIn(text, 'CITATION');
  const citedEnding = regexIn(text, 'CITED_EXT');
  const baselineName = stringsIn(text, 'BASELINE_PATH');
  if (!prefixes || !living || !notLiving || !textFile || !citation || !citedEnding || !baselineName || baselineName.length === 0) {
    return unread(guard, 'LIVING_PREFIXES, LIVING_FILES, NOT_LIVING, TEXT, CITATION, CITED_EXT or BASELINE_PATH');
  }
  const livingSet = new Set(living.map((s) => s.value));
  const notLivingSet = new Set(notLiving.map((s) => s.value));
  const isLiving = (f) => !notLivingSet.has(f) && textFile.test(f) && (livingSet.has(f) || prefixes.some((p) => f.startsWith(p.value)));
  const findings = [];
  for (const s of [...living, ...notLiving]) {
    if (!target.covers(s.value)) continue;
    const which = livingSet.has(s.value) ? 'LIVING_FILES, the files outside the living folders whose citations are checked' : 'NOT_LIVING, the files whose citations are never checked';
    findings.push(pin(`${guard}:${s.line}`, `named in ${which}; at a new path the folder rules would decide instead`));
  }
  const every = new RegExp(citation.source, citation.flags.includes('g') ? citation.flags : `${citation.flags}g`);
  for (const f of tree.files) {
    if (!isLiving(f)) continue;
    const body = tree.text(f);
    if (body == null || !body.includes(target.needle)) continue;
    const lines = [];
    const cited = new Set();
    body.split('\n').forEach((l, i) => {
      for (const m of l.matchAll(every)) {
        const path = m[1].replace(/[.)]+$/, '');
        if (!citedEnding.test(path) && !path.endsWith('/')) continue;
        if (!target.covers(path.replace(/\/$/, ''))) continue;
        if (lines[lines.length - 1] !== i + 1) lines.push(i + 1);
        cited.add(path);
      }
    });
    if (lines.length === 0) continue;
    const what = cited.size === 1 ? [...cited][0] : `${cited.size} paths in it`;
    findings.push({ ...pin(`${f}:${ranges(lines)}`, `a living file cites ${what}; after a move a citation resolves only through a ledger row, or the line is changed`), places: lines.map((n) => `${f}:${n}`) });
  }
  const baseline = posix.join(posix.dirname(guard), baselineName[baselineName.length - 1].value);
  const baselineText = tree.text(baseline);
  if (baselineText != null) {
    baselineText.split('\n').forEach((l, i) => {
      const m = /"(.+) -> (.+)"/.exec(l);
      if (m && target.covers(m[2])) findings.push(pin(`${baseline}:${i + 1}`, `a citation already missing, on the baseline that may only shrink ("${m[1]} -> ${m[2]}"); it leaves the baseline when the path comes back`));
    });
  }
  const livingHere = target.files.filter(isLiving);
  if (livingHere.length > 0 && !target.isFolder) findings.push(note(target.path, 'a living file: its own citations are checked, and stay checked wherever it goes under a living folder'));
  return { title: 'citations in living files', guard, findings };
}

function checkManifest(target, tree) {
  const guard = GUARDS.manifest;
  const text = tree.text(guard);
  if (text == null) return missing(guard, tree);
  const m = /loadVerificationManifest\(\s*'([^']+)'\s*\)/.exec(text);
  if (!m) return unread(guard, 'The manifest path the test loads');
  const manifest = m[1];
  const body = tree.text(manifest);
  if (body == null) return missing(manifest, tree);
  const findings = [];
  let claim = '';
  let field = '';
  body.split('\n').forEach((l, i) => {
    const id = /"id"\s*:\s*"([^"]+)"/.exec(l);
    if (id) claim = id[1];
    const key = /"(files|commands|queueRef|liveCheck|reason|claim)"\s*:/.exec(l);
    if (key) field = key[1];
    if (!l.includes(target.needle)) return;
    const named = [...l.matchAll(/"([^"]*)"/g)].map((q) => q[1]);
    const exact = named.some((s) => target.covers(s));
    const inside = named.some((s) => target.whole.test(s));
    if (field === 'files' && exact) findings.push(pin(`${manifest}:${i + 1}`, `evidence file of the claim "${claim}": the test fails when an evidence file is not there`));
    else if (inside) findings.push(pin(`${manifest}:${i + 1}`, `the claim "${claim}" names it in its ${field || 'text'}, the replay a reader is told to run`));
  });
  return { title: 'the verification manifest', guard, findings };
}

function checkCopy(target, tree) {
  const guard = GUARDS.copy;
  const text = tree.text(guard);
  if (text == null) return missing(guard, tree);
  const listed = stringsIn(text, 'USER_FACING_COPY_FILES');
  if (!listed || listed.length === 0) return unread(guard, 'USER_FACING_COPY_FILES');
  const findings = [];
  for (const s of listed) {
    if (target.covers(s.value)) findings.push(pin(`${guard}:${s.line}`, 'on the list of user-facing copy whose words are held to what the code does; the test reads it by this path'));
  }
  // The published pages are found by reading a folder, not listed one by one.
  const pages = valueTokens(tokensOf(text), 'PUBLISHED_LANDING_PAGES');
  if (text.includes('...PUBLISHED_LANDING_PAGES')) {
    const folder = pages?.find((t, k) => t.type === 'string' && pages[k - 2]?.value === 'repoPath')?.value;
    const ending = pages?.find((t, k) => t.type === 'string' && pages[k - 2]?.value === 'endsWith')?.value;
    if (!folder || !ending) return unread(guard, 'The folder and ending of PUBLISHED_LANDING_PAGES');
    const line = lineAt(text, pages[0].at);
    for (const f of target.files) {
      if (posix.dirname(f) === folder && f.endsWith(ending)) {
        findings.push(pin(`${guard}:${line}`, `${f} is a published page: every ${ending} file at the top of ${folder}/ is user-facing copy the test reads`));
      }
    }
  }
  return { title: 'the user-facing copy list', guard, findings };
}

function checkSnapshot(target, tree) {
  const guard = GUARDS.snapshot;
  const lists = GUARDS.snapshotLists;
  const text = tree.text(lists);
  if (text == null) return missing(lists, tree);
  const findings = [];
  const lines = text.split('\n');
  const exactLine = (entry) => lines.findIndex((l) => l.trim() === `'${entry}',`) + 1;
  for (const [name, list] of [['PUBLIC_ALLOWLIST', PUBLIC_ALLOWLIST], ['PRIVATE_DENYLIST', PRIVATE_DENYLIST], ['CALIBRATION_ALLOWED', CALIBRATION_ALLOWED]]) {
    for (const entry of list) {
      const prefix = entry.endsWith('/') || entry.endsWith('*');
      if (!prefix && target.covers(entry)) {
        const why = name === 'PRIVATE_DENYLIST'
          ? 'kept out of the public copy by name; at a new path only the folder rules would decide, so the entry moves with it'
          : `${guard} fails when an exact public entry is not a tracked file, so the entry moves with it`;
        findings.push(pin(`${lists}:${exactLine(entry)}`, `an exact entry of ${name}: ${why}`));
      }
      if (prefix && target.isFolder && entry.slice(0, -1).startsWith(`${target.path}/`)) {
        findings.push(pin(`${lists}:${exactLine(entry)}`, `a ${name} entry inside it (${entry}): the folder's new place needs the entry moved with it`));
      }
    }
  }
  return { title: 'the public-snapshot lists', guard, findings };
}

async function checkContext(target, tree) {
  const guard = GUARDS.context;
  const text = tree.text(guard);
  if (text == null) return missing(guard, tree);
  // The map's builder is found through the test's own import, the same module the test runs.
  const spec = /import\s*\{[^}]*\bbuildContext\b[^}]*\}\s*from\s*'([^']+)'/.exec(text)?.[1];
  const menu = stringsIn(text, 'MENU_PATH')?.[0]?.value;
  const pages = stringsIn(text, 'pages');
  if (!spec || !menu || !pages) return unread(guard, 'The builder import, MENU_PATH or the pages it reads');
  const builderPath = posix.normalize(posix.join(posix.dirname(guard), spec));
  let builder;
  try {
    builder = await import(pathToFileURL(resolve(tree.root, builderPath)).href);
  } catch (err) {
    return { unread: `${builderPath} could not be loaded (${String(err && err.message ? err.message : err).split('\n')[0]})` };
  }
  const { GROUPS, groupOf, MAP_PATH, CARDS_DIR } = builder;
  if (!Array.isArray(GROUPS) || typeof groupOf !== 'function' || !MAP_PATH || !CARDS_DIR) return unread(builderPath, 'GROUPS, groupOf, MAP_PATH or CARDS_DIR');
  const builderText = tree.text(builderPath) ?? '';
  const covered = stringsIn(builderText, 'COVERED')?.map((s) => s.value) ?? [];
  const findings = [];
  const builderLines = builderText.split('\n');
  for (const g of GROUPS) {
    for (const p of g.paths ?? []) {
      if (!target.covers(p.replace(/\/$/, ''))) continue;
      const at = builderLines.findIndex((l) => l.includes(`id: '${g.id}'`)) + 1;
      findings.push(pin(`${builderPath}:${at}`, `the group ${g.id} names ${p}; a group entry for a path that is gone claims nothing, so the entry moves with it`));
    }
  }
  for (const f of target.files) {
    if (!covered.some((c) => f.startsWith(c))) continue;
    const g = groupOf(f);
    if (g && !target.isFolder) findings.push(note(builderPath, `it belongs to the group ${g.id}; a file under ${covered.join(', ')} that no group claims stops the map's build, so its new place needs a group too`));
  }
  const generated = [MAP_PATH, ...tree.files.filter((f) => f.startsWith(`${CARDS_DIR}/`) && f.endsWith('.md'))];
  const hand = [menu, ...pages.map((p) => p.value)].filter((p) => !generated.includes(p));
  for (const page of [...generated, ...hand]) {
    const body = tree.text(page);
    if (body == null) continue;
    let inHand = !generated.includes(page);
    body.split('\n').forEach((l, i) => {
      if (generated.includes(page) && /<!-- hand:/.test(l)) inHand = true;
      const name = pageLineNames(l, ['', `${posix.dirname(page)}/`], target, tree);
      if (name) {
        const how = inHand ? 'a hand-written line names' : 'the generated map names';
        const then = inHand ? 'the line is changed with the move' : 'the map is written again with npm run context:map in the same commit';
        findings.push(pin(`${page}:${i + 1}`, `${how} it as \`${name}\`; ${then}, since the test fails when the map is stale or a page names a path that is gone`));
      }
      if (generated.includes(page) && /<!-- \/hand:/.test(l)) inHand = false;
    });
  }
  return { title: 'the context map', guard, findings };
}

const CODE_FILE = /\.(?:ts|tsx|mts|cts|mjs|cjs|js|jsx|json|toml|ya?ml|sh|css|html)$/;
// A data file under docs/ is a record, read by people, so it counts as prose like the pages beside it.
const isCode = (f) => (CODE_FILE.test(f) && !f.startsWith('docs/')) || f.startsWith('.githooks/');

/** Every other line in the tree that names the path, split into tests, other code and prose. */
function checkMentions(target, tree, reported) {
  const tests = [];
  const code = [];
  const prose = [];
  for (const f of tree.files) {
    if (target.fileSet.has(f) && !target.isFolder) continue;
    const body = tree.text(f);
    const asCode = isCode(f);
    if (body == null || !mayName(body, target, asCode)) continue;
    body.split('\n').forEach((l, i) => {
      const where = `${f}:${i + 1}`;
      if (reported.has(where)) return;
      const how = howLineNames(l, f, target, asCode);
      if (!how) return;
      // A comment that names the path goes stale on a move but breaks nothing.
      const comment = asCode && /^\s*(?:\/\/|\/\*|\*|#|<!--)/.test(l);
      const level = asCode && !comment && how !== SHARED_NAME ? 'pin' : 'note';
      const said = comment ? `${how}, in a comment` : how;
      (f.startsWith('tests/') && asCode ? tests : asCode ? code : prose).push({ file: f, line: i + 1, how: said, level });
    });
  }
  // One line per file and level, so a file that reads the path in ten places takes one line.
  const byFile = (hits) => {
    const files = new Map();
    for (const h of hits) {
      const key = `${h.level}\n${h.file}`;
      if (!files.has(key)) files.set(key, { file: h.file, level: h.level, lines: [], hows: new Set() });
      files.get(key).lines.push(h.line);
      files.get(key).hows.add(h.how);
    }
    return [...files.values()].map(({ file, level, lines, hows }) => ({ level, where: `${file}:${ranges(lines)}`, what: [...hows].join('; '), places: lines.map((n) => `${file}:${n}`) }));
  };
  return {
    tests: { title: 'tests that read, import or hash it', guard: null, findings: byFile(tests) },
    code: { title: 'code, hooks and settings that name it', guard: null, findings: byFile(code) },
    prose: { title: 'other mentions, in prose', guard: null, findings: byFile(prose), lines: prose.length },
  };
}

// ---------------------------------------------------------------------------------------------

/** The path as the tree spells it: from the repository root, forward slashes, no trailing slash. */
export function normalTarget(input, root = REPO_ROOT) {
  let p = String(input).replace(/\\/g, '/');
  // Git Bash spells E:\work as /e/work.
  p = p.replace(/^\/([A-Za-z])(?=\/)/, '$1:');
  if (isAbsolute(p) || /^[A-Za-z]:\//.test(p)) {
    const rel = relative(root, p).replace(/\\/g, '/');
    if (rel.startsWith('..') || isAbsolute(rel)) return null;
    p = rel;
  }
  p = posix.normalize(p).replace(/^\.\//, '').replace(/\/+$/, '');
  if (!p || p === '.' || p.startsWith('..')) return null;
  return p;
}

const CHECKS = [
  ['frozen', checkFrozen],
  ['moved', checkMoved],
  ['docs', checkDocs],
  ['root', checkRoot],
  ['outbox', checkOutbox],
  ['scripts', checkScripts],
  ['citations', checkCitations],
  ['manifest', checkManifest],
  ['copy', checkCopy],
  ['snapshot', checkSnapshot],
  ['context', checkContext],
];

/** Every section of the preflight for one path. */
export async function preflight(path, tree) {
  const target = makeTarget(path, tree);
  const sections = [];
  for (const [id, check] of CHECKS) sections.push({ id, ...(await check(target, tree)) });
  const reported = new Set(sections.flatMap((s) => (s.findings ?? []).flatMap(placesOf)));
  const mentions = checkMentions(target, tree, reported);
  sections.push({ id: 'tests', ...mentions.tests }, { id: 'code', ...mentions.code }, { id: 'prose', ...mentions.prose });
  return { target, sections };
}

function describeTarget(target) {
  const kind = target.isFolder ? `a folder of ${target.files.length} file(s)` : target.files.length ? 'a file' : 'not in the tree';
  if (target.files.length === 0) return `${kind}: nothing tracked or new has this path, so only what names it is listed`;
  const classes = new Set(target.files.map((f) => (isPublicPath(f) ? 'public' : 'private')));
  const cls = classes.size === 2 ? 'partly public and partly private' : classes.has('public') ? 'public, so the public copy carries it' : 'private, so the public copy leaves it out';
  return `${kind}; ${cls}`;
}

/** The report as lines, and whether it pins, from the result of preflight(). */
export function report({ target, sections }, { all = false } = {}) {
  const out = [target.path, `  ${describeTarget(target)}`];
  const quiet = [];
  const skipped = [];
  let unreadCount = 0;
  const pins = new Set();
  const pinning = new Set();
  for (const s of sections) {
    if (s.unread) {
      unreadCount++;
      out.push('', `UNREAD  ${s.unread}`);
      continue;
    }
    if (s.skipped) {
      skipped.push(s.skipped);
      continue;
    }
    if (s.id === 'prose') continue;
    if (s.findings.length === 0) {
      quiet.push(s.title);
      continue;
    }
    out.push('', s.guard ? `${s.title} (${s.guard})` : s.title);
    for (const f of s.findings) {
      out.push(`  ${f.level === 'pin' ? 'PIN ' : 'NOTE'}  ${f.where}  ${f.what}`);
      if (f.level === 'pin') {
        for (const p of placesOf(f)) pins.add(p);
        pinning.add(s.title);
      }
    }
  }
  const prose = sections.find((s) => s.id === 'prose');
  if (prose && prose.findings.length > 0) {
    out.push('', `${prose.title}: ${prose.lines} line(s) in ${prose.findings.length} file(s); a history file's citation resolves through the ledger and is never edited`);
    if (all) for (const f of prose.findings) out.push(`  NOTE  ${f.where}  ${f.what}`);
    else out.push('  run with --all to list them');
  }
  if (quiet.length) out.push('', `nothing found by: ${quiet.join('; ')}`);
  if (skipped.length) out.push(`skipped: ${skipped.join('; ')}`);
  const verdict = unreadCount > 0 ? 'INCOMPLETE' : pins.size > 0 ? 'PINNED' : 'FREE';
  const said = unreadCount > 0
    ? `${unreadCount} check(s) could not read their guard, so this list is not whole`
    : pins.size > 0
      ? `${pins.size} place(s) pin ${target.path}, found by ${pinning.size} check(s)`
      : `nothing pins ${target.path}`;
  out.push(`${verdict}  ${said}`);
  return { lines: out, pinned: pins.size > 0, incomplete: unreadCount > 0 };
}

/** The command line, run in this process: prints through `print` and returns the exit code. */
export async function run(argv, print = (line) => console.log(line), deps = {}) {
  const root = deps.root ?? REPO_ROOT;
  const all = argv.includes('--all');
  const inputs = argv.filter((a) => a !== '--all');
  if (inputs.length === 0 || inputs.some((a) => a.startsWith('-'))) {
    print('usage: node scripts/dev/retirement-preflight.mjs [--all] <path> [<path> ...]');
    return 2;
  }
  const paths = [];
  for (const input of inputs) {
    const p = normalTarget(input, root);
    if (!p) {
      print(`FAIL  ${input} is not a path inside ${root}`);
      return 2;
    }
    paths.push(p);
  }
  let tree;
  try {
    tree = deps.tree ?? openTree(root);
  } catch (err) {
    print(`FAIL  the file list could not be read from git: ${String(err && err.message ? err.message : err).split('\n')[0]}`);
    return 2;
  }
  let code = 0;
  for (const [n, p] of paths.entries()) {
    if (n > 0) print('');
    const { lines, pinned, incomplete } = report(await preflight(p, tree), { all });
    for (const line of lines) print(line);
    code = Math.max(code, incomplete ? 2 : pinned ? 1 : 0);
  }
  return code;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  process.exitCode = await run(process.argv.slice(2));
}
