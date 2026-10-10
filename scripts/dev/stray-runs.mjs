#!/usr/bin/env node
// Lists the node processes that are running a test or a build (vitest, tsc, vite or eslint) for one
// folder, with the time each one started, so that after a piece of work whoever ran it can check
// that nothing it started is still going. A run whose starter has gone keeps the machine busy, and
// where only one run at a time is allowed, every run after it waits.
//
// It only lists: it reads the Windows process list and never stops a process.
//
// Windows keeps a process's working folder out of its process list, so a process belongs to the
// folder when its command line names the folder, or when it is tied to such a process in the
// process tree: the npm or npx process that started the run above it, and every node process below
// it, such as the test workers. A path into a folder inside the given one that is a git checkout of
// its own, like a worktree kept inside the main checkout, does not count as naming the given folder.
//
// Exit 0 when nothing is running, 1 when something is, 2 when the list could not be read or the
// command was not understood.
//
// Usage: node scripts/dev/stray-runs.mjs <folder> [--since <time>]
//   --since lists only the processes started at or after that time, in any form Date.parse reads,
//   for example what `date -Iseconds` prints.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOOLS = ['vitest', 'tsc', 'vite', 'eslint'];

// A tool counts as a word of the command line or as a folder or file name in one of its paths
// ("vitest run", ".../vitest/vitest.mjs", ".../typescript/bin/tsc"), so that other programs whose
// names only contain one, like tsserver or an editor's eslintServer.js, do not.
const TOOL = new RegExp(`(?:^|[\\s"'/=])(?:${TOOLS.join('|')})(?=$|[\\s"'/.])`);
// npm and npx start a tool from a node process of their own, which may name only the npm script.
const WRAPPER = /\/np[mx]-cli\.js(?=$|[\s"'])/;
const NAME_CHAR = /[\p{L}\p{N}_.-]/u;

/** A path or command line in one spelling: forward slashes, no doubled ones, lower case, as Windows compares paths. */
function normal(text) {
  return String(text).replace(/\\/g, '/').replace(/\/{2,}/g, '/').toLowerCase();
}

/** The folder as the command lines are searched for it. */
export function folderKey(folder) {
  const key = normal(folder);
  return key.length > 1 ? key.replace(/\/+$/, '') : key;
}

function isNode(name) {
  return /^node(?:\.exe)?$/i.test(String(name ?? ''));
}

function isWrapper(commandLine) {
  return commandLine != null && WRAPPER.test(normal(commandLine));
}

/**
 * Whether a command line names vitest, tsc, vite or eslint. The folder is taken out first, so a
 * folder whose own path holds a tool's name does not make every process in it a test run.
 */
export function runsATool(commandLine, folder = '') {
  if (commandLine == null) return false;
  const text = normal(commandLine);
  const key = folder ? folderKey(folder) : '';
  return TOOL.test(key ? text.split(key).join(' ') : text);
}

/** Whether `<folder>/<rest>` still reads as the folder once "." and ".." are followed, and does not run into another checkout. */
function staysInFolder(folder, rest, isCheckout) {
  const parts = [];
  for (const part of rest.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return false;
      parts.pop();
      continue;
    }
    parts.push(part);
    if (isCheckout(`${folder}/${parts.join('/')}`)) return false;
  }
  return true;
}

function defaultIsCheckout(dir) {
  return existsSync(`${dir}/.git`);
}

/**
 * Whether a command line names the folder: the folder's path as a whole name, not as the start of a
 * longer one (a folder "app" is not named by "app2"), and not as the way into another checkout.
 */
export function namesFolder(commandLine, folder, isCheckout = defaultIsCheckout) {
  if (commandLine == null) return false;
  const text = normal(commandLine);
  const key = folderKey(folder);
  if (!key) return false;
  for (let at = text.indexOf(key); at !== -1; at = text.indexOf(key, at + 1)) {
    const before = text[at - 1];
    const after = text[at + key.length];
    if (before !== undefined && NAME_CHAR.test(before)) continue;
    if (after === undefined || (after !== '/' && !NAME_CHAR.test(after))) return true;
    if (after !== '/') continue;
    // A quoted path may hold spaces, so it runs to the closing quote; an unquoted one to the next space.
    const tail = text.slice(at + key.length + 1);
    const end = before === '"' || before === "'" ? tail.indexOf(before) : tail.search(/[\s"']/);
    if (staysInFolder(key, end === -1 ? tail : tail.slice(0, end), isCheckout)) return true;
  }
  return false;
}

/**
 * The node processes running a test or a build for the folder, oldest first, each with the reason it
 * belongs to the folder, and how many node processes on the machine run one at all.
 *
 * The parent of a process is trusted only when it started no later than the process itself, because
 * Windows reuses the number of a process that has ended, and a later process with that number is
 * not its parent.
 */
export function findRuns(processes, folder, options = {}) {
  const { since = null, selfPid = null } = options;
  const known = new Map();
  const isCheckout = (dir) => {
    if (!known.has(dir)) known.set(dir, (options.isCheckout ?? defaultIsCheckout)(dir));
    return known.get(dir);
  };
  const byPid = new Map(processes.map((p) => [p.pid, p]));
  const parentOf = (p) => {
    const parent = byPid.get(p.ppid);
    if (!parent || parent.pid === p.pid) return null;
    if (parent.started != null && p.started != null && parent.started > p.started) return null;
    return parent;
  };
  const ancestors = (p) => {
    const out = [];
    const seen = new Set([p.pid]);
    for (let q = parentOf(p); q && !seen.has(q.pid); q = parentOf(q)) {
      seen.add(q.pid);
      out.push(q);
    }
    return out;
  };

  const nodes = processes.filter((p) => isNode(p.name) && p.pid !== selfPid);
  const tools = nodes.filter((p) => runsATool(p.commandLine, folder));
  const direct = new Set(tools.filter((p) => namesFolder(p.commandLine, folder, isCheckout)).map((p) => p.pid));

  // Above a run, only the npm or npx process that started it belongs to it; the walk stops at any
  // other node process, which is a program that started the run for a folder of its own.
  const above = new Map();
  for (const pid of direct) {
    for (const q of ancestors(byPid.get(pid))) {
      if (!isNode(q.name)) continue;
      if (!isWrapper(q.commandLine) || direct.has(q.pid)) break;
      if (!above.has(q.pid)) above.set(q.pid, pid);
    }
  }

  const runs = [];
  for (const p of nodes) {
    let why = null;
    if (direct.has(p.pid)) why = 'its command line names the folder';
    else if (above.has(p.pid)) why = `it started pid ${above.get(p.pid)}, whose command line names the folder`;
    else {
      const under = ancestors(p).find((q) => direct.has(q.pid));
      if (under) why = `it runs under pid ${under.pid}, whose command line names the folder`;
    }
    if (!why) continue;
    if (since != null && p.started != null && p.started < since) continue;
    runs.push({ ...p, why });
  }
  runs.sort((a, b) => (a.started ?? 0) - (b.started ?? 0) || a.pid - b.pid);
  return { runs, machineWide: tools.length };
}

/** Rows as the process query prints them; a row without a whole-number pid is dropped. */
export function parseProcessList(text) {
  const body = String(text).replace(/^\uFEFF/, '').trim();
  if (!body) return [];
  const data = JSON.parse(body);
  return (Array.isArray(data) ? data : [data])
    .filter((r) => r && typeof r === 'object' && Number.isInteger(r.pid))
    .map((r) => ({
      pid: r.pid,
      ppid: Number.isInteger(r.ppid) ? r.ppid : null,
      name: typeof r.name === 'string' ? r.name : '',
      started: Number.isFinite(r.started) ? r.started : null,
      commandLine: typeof r.commandLine === 'string' ? r.commandLine : null,
    }));
}

// Every process with its parent and start time, and the command line of node processes only: the
// others are needed for the tree between a run and its npx process, not for what they were given.
// It is passed encoded so that no quoting rule between node, Windows and PowerShell can change it,
// and a failure comes back as JSON on the output, since PowerShell wraps its error text in XML.
export const PROCESS_QUERY = [
  "$ErrorActionPreference = 'Stop'",
  "$ProgressPreference = 'SilentlyContinue'",
  '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false',
  'try {',
  '  $rows = @(Get-CimInstance -ClassName Win32_Process | ForEach-Object {',
  '    [pscustomobject]@{',
  '      pid = [long]$_.ProcessId',
  '      ppid = [long]$_.ParentProcessId',
  '      name = [string]$_.Name',
  '      started = $(if ($_.CreationDate) { ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } else { $null })',
  "      commandLine = $(if ($_.Name -ieq 'node.exe') { $_.CommandLine } else { $null })",
  '    }',
  '  })',
  '  ConvertTo-Json -InputObject $rows -Compress',
  '} catch {',
  '  ConvertTo-Json -InputObject @{ error = [string]$_.Exception.Message } -Compress',
  '  exit 1',
  '}',
].join('\n');

/** The Windows process list, read through PowerShell. */
export function readWindowsProcesses() {
  if (process.platform !== 'win32') throw new Error(`it reads the Windows process list, and this system is ${process.platform}`);
  let out;
  try {
    out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(PROCESS_QUERY, 'utf16le').toString('base64')],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 60_000, maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (err) {
    if (err && err.code === 'ENOENT') throw new Error('powershell.exe was not found');
    if (err && err.code === 'ETIMEDOUT') throw new Error('the PowerShell query took more than a minute');
    let said = '';
    try {
      said = String(JSON.parse(String(err && err.stdout).trim()).error ?? '');
    } catch {
      // Nothing readable came back; the exit code is all there is to say.
    }
    throw new Error(`the PowerShell query failed${err && err.status != null ? ` with exit code ${err.status}` : ''}${said ? `: ${said.trim()}` : ''}`);
  }
  return parseProcessList(out);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/** A start time in the machine's own clock, with its offset. */
export function localTime(ms) {
  const d = new Date(ms);
  const offset = -d.getTimezoneOffset();
  const sign = offset < 0 ? '-' : '+';
  const zone = `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${zone}`;
}

export function age(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 120) return `${s} s`;
  const min = Math.round(s / 60);
  return min < 120 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

function whenStarted(started, now) {
  return started == null ? 'start time unknown' : `started ${localTime(started)} (${age(now - started)} ago)`;
}

/** The command line, run in this process: prints through `print` and returns the exit code. */
export function run(argv, print = (line) => console.log(line), deps = {}) {
  const readProcesses = deps.readProcesses ?? readWindowsProcesses;
  const now = deps.now ?? Date.now;
  let since = null;
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--since') {
      since = Date.parse(argv[++i] ?? '');
      if (Number.isNaN(since)) {
        print(`FAIL  --since needs a time Date.parse reads, not ${JSON.stringify(argv[i] ?? '')}`);
        return 2;
      }
    } else rest.push(argv[i]);
  }
  if (rest.length !== 1 || rest[0].startsWith('-')) {
    print('usage: node scripts/dev/stray-runs.mjs <folder> [--since <time>]');
    return 2;
  }
  // Git Bash spells E:\work as /e/work; the command lines Windows keeps use the drive letter.
  const folder = resolve(rest[0].replace(/^\/([A-Za-z])(?=\/|$)/, '$1:'));
  let processes;
  try {
    processes = readProcesses();
  } catch (err) {
    const detail = err && err.message ? err.message : String(err);
    print(`FAIL  the process list could not be read: ${detail.split(/\r?\n/)[0]}`);
    return 2;
  }
  if (processes.length === 0) {
    print('FAIL  the process list came back empty, which says nothing about what is running');
    return 2;
  }
  const { runs, machineWide } = findRuns(processes, folder, {
    since,
    selfPid: deps.selfPid === undefined ? process.pid : deps.selfPid,
    isCheckout: deps.isCheckout,
  });
  const window = since == null ? '' : `, started at or after ${localTime(since)}`;
  print(`${machineWide} node process(es) on this machine run vitest, tsc, vite or eslint; ${runs.length} node process(es) are part of a run for ${folder}${window}`);

  // Test workers share one command line and one parent, so they are listed together.
  const groups = new Map();
  for (const r of runs) {
    const key = `${r.ppid}\n${r.commandLine}\n${r.why}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const t = now();
  for (const group of groups.values()) {
    const [first] = group;
    print(`RUNNING  pid ${first.pid}  ${whenStarted(first.started, t)}`);
    if (group.length > 1) {
      const last = group[group.length - 1];
      print(`         and ${group.length - 1} more with the same parent and command line, the last ${whenStarted(last.started, t)}: ${group.slice(1).map((r) => r.pid).join(' ')}`);
    }
    print(`         ${first.commandLine ?? '(no command line)'}`);
    print(`         ${first.why}`);
  }
  if (runs.length === 0) {
    print(`PASS  nothing is running vitest, tsc, vite or eslint for ${folder}`);
    return 0;
  }
  print(`FAIL  ${runs.length} process(es) for this folder are still running; this script stops none of them`);
  return 1;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  process.exitCode = run(process.argv.slice(2));
}
